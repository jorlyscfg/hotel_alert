import { io } from 'socket.io-client';
import type { DeviceConfig, DeviceSyncSnapshot, RealtimeAuth, TransportAck } from '@hotel/shared';
import {
  createNotificationReceiver,
  type DurableCursorStore,
  type NotificationReceiver,
  type NotificationSink
} from '@hotel/notification-receiver';

const SNAPSHOT_PATH = '/api/v1/device/session';
const REALTIME_PATH = '/realtime';
const SOCKET_PATH = '/socket.io';
const DEFAULT_ACK_TIMEOUT_MS = 10_000;
const AUTH_FAILURE_CODES = new Set([
  'AUTH_REQUIRED',
  'AUTH_INVALID',
  'AUTH_AMBIGUOUS_CREDENTIALS',
  'DEVICE_INACTIVE',
  'DEVICE_TOKEN_REVOKED',
  'TOKEN_ROTATION_EXPIRED',
  'FORBIDDEN_ASSIGNMENT'
]);

export type LanNotificationReceiverStatus =
  | 'idle'
  | 'fetching-snapshot'
  | 'connecting'
  | 'connected'
  | 'synchronizing'
  | 'synchronized'
  | 'auth-failed'
  | 'error'
  | 'stopped';

export interface SnapshotResponse {
  data: DeviceSyncSnapshot;
  requestId: string;
}

export interface LanSocketOptions {
  autoConnect: false;
  path: typeof SOCKET_PATH;
  reconnection: true;
  auth: RealtimeAuth;
}

export interface LanSocket {
  connected: boolean;
  auth?: unknown;
  on(eventName: string, handler: (...args: unknown[]) => void): this;
  off(eventName: string, handler?: (...args: unknown[]) => void): this;
  onAny(handler: (eventName: string, payload: unknown) => void): this;
  offAny(handler?: (eventName: string, payload: unknown) => void): this;
  emit(eventName: string, ...args: unknown[]): this;
  timeout(milliseconds: number): { emit(eventName: string, ...args: unknown[]): LanSocket };
  connect(): this;
  disconnect(): this;
  disableReconnection?(): void;
}

export type LanFetch = (input: string, init: { method: 'GET'; headers: Record<string, string> }) => Promise<unknown>;
export type LanSocketFactory = (url: string, options: LanSocketOptions) => LanSocket;

export interface LanNotificationReceiverOptions {
  serverOrigin: string;
  deviceId: string;
  deviceToken: string;
  clientInstanceId: string;
  clientVersion: string;
  cursor: DurableCursorStore;
  sink: NotificationSink;
  fetch?: LanFetch;
  socketFactory?: LanSocketFactory;
  onSnapshot?: (snapshot: DeviceSyncSnapshot) => void | Promise<void>;
  onStatus?: (status: LanNotificationReceiverStatus) => void;
  onAuthFailure?: (error: unknown) => void;
  onError?: (error: unknown) => void;
  syncAckTimeoutMs?: number;
}

export interface LanNotificationReceiver {
  start(): Promise<void>;
  stop(): void;
  getSnapshot(): DeviceSyncSnapshot | undefined;
}

export function createLanNotificationReceiver(options: LanNotificationReceiverOptions): LanNotificationReceiver {
  const fetchSnapshot = options.fetch ?? defaultFetch;
  const socketFactory = options.socketFactory ?? defaultSocketFactory;
  const origin = normalizeOrigin(options.serverOrigin);
  const snapshotUrl = `${origin}${SNAPSHOT_PATH}`;
  const realtimeUrl = `${origin}${REALTIME_PATH}`;
  const syncAckTimeoutMs = options.syncAckTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
  const cursor = createCursorAdapter(options.cursor);

  let status: LanNotificationReceiverStatus = 'idle';
  let snapshot: DeviceSyncSnapshot | undefined;
  let socket: LanSocket | undefined;
  let receiver: NotificationReceiver | undefined;
  let assignedAreaId: string | undefined;
  let lastSeenEventSequence = cursor.lastSeenEventSequence;
  let synchronized = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatInFlight = false;
  let syncInFlight = false;
  let resyncRequested = false;
  let startPromise: Promise<void> | undefined;
  let settleStart: ((value: void | PromiseLike<void>) => void) | undefined;
  let rejectStart: ((reason?: unknown) => void) | undefined;
  let startupSettled = false;
  let stopped = false;
  let authFailed = false;
  let bufferedEvents: unknown[] = [];
  let eventQueue = Promise.resolve();
  let readyHandler: ((payload: unknown) => void) | undefined;
  let syncRequiredHandler: ((payload: unknown) => void) | undefined;
  let connectHandler: (() => void) | undefined;
  let disconnectHandler: ((reason: unknown) => void) | undefined;
  let connectErrorHandler: ((error: unknown) => void) | undefined;
  let anyEventHandler: ((eventName: string, payload: unknown) => void) | undefined;

  async function start(): Promise<void> {
    if (startPromise !== undefined) return startPromise;
    if (stopped) throw new Error('The LAN notification receiver has been stopped.');

    startPromise = new Promise<void>((resolve, reject) => {
      settleStart = resolve;
      rejectStart = reject;
    });

    void startInternal().catch((error: unknown) => {
      handleStartupError(error);
    });
    return startPromise;
  }

  async function startInternal(): Promise<void> {
    setStatus('fetching-snapshot');
    await replaceSnapshot(await fetchAuthoritativeSnapshot(), false);
    if (stopped) return;

    const auth = buildAuth();
    socket = socketFactory(realtimeUrl, {
      autoConnect: false,
      path: SOCKET_PATH,
      reconnection: true,
      auth
    });
    socket.auth = auth;
    attachSocketHandlers(socket);
    setStatus('connecting');
    socket.connect();
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    synchronized = false;
    clearHeartbeatTimer();
    detachSocketHandlers();
    socket?.disconnect();
    setStatus('stopped');
    if (!startupSettled) {
      startupSettled = true;
      rejectStart?.(new Error('The LAN notification receiver was stopped before synchronization completed.'));
    }
  }

  function getSnapshot(): DeviceSyncSnapshot | undefined {
    return snapshot;
  }

  function attachSocketHandlers(nextSocket: LanSocket): void {
    readyHandler = (payload) => {
      void handleConnectionReady(payload);
    };
    syncRequiredHandler = (payload) => {
      void handleSyncRequired(payload);
    };
    connectHandler = () => {
      if (!stopped && !authFailed) setStatus('connected');
    };
    disconnectHandler = () => {
      if (stopped || authFailed) return;
      synchronized = false;
      clearHeartbeatTimer();
      setStatus('connecting');
    };
    connectErrorHandler = (error) => {
      if (isAuthenticationFailure(error)) {
        handleAuthFailure(error);
      } else {
        setStatus('error');
        options.onError?.(error);
        rejectStartup(error);
      }
    };
    anyEventHandler = (eventName, payload) => {
      if (eventName === 'connection.ready' || eventName === 'sync.required') return;
      enqueueEvent(eventName, payload);
    };

    nextSocket.on('connection.ready', readyHandler);
    nextSocket.on('sync.required', syncRequiredHandler);
    nextSocket.on('connect', connectHandler);
    nextSocket.on('disconnect', disconnectHandler);
    nextSocket.on('connect_error', connectErrorHandler);
    nextSocket.onAny(anyEventHandler);
  }

  function detachSocketHandlers(): void {
    if (socket === undefined) return;
    if (readyHandler !== undefined) socket.off('connection.ready', readyHandler);
    if (syncRequiredHandler !== undefined) socket.off('sync.required', syncRequiredHandler);
    if (connectHandler !== undefined) socket.off('connect', connectHandler);
    if (disconnectHandler !== undefined) socket.off('disconnect', disconnectHandler);
    if (connectErrorHandler !== undefined) socket.off('connect_error', connectErrorHandler);
    if (anyEventHandler !== undefined) socket.offAny(anyEventHandler);
    readyHandler = undefined;
    syncRequiredHandler = undefined;
    connectHandler = undefined;
    disconnectHandler = undefined;
    connectErrorHandler = undefined;
    anyEventHandler = undefined;
  }

  async function handleConnectionReady(payload: unknown): Promise<void> {
    if (stopped || authFailed) return;
    const ready = parseConnectionReady(payload);
    if (ready === null) {
      handleRuntimeError(new Error('The realtime connection.ready payload is invalid.'));
      return;
    }
    if (ready.sync === 'FULL_SNAPSHOT_REQUIRED') {
      resyncRequested = true;
    }
    await synchronize(resyncRequested);
  }

  async function handleSyncRequired(payload: unknown): Promise<void> {
    if (stopped || authFailed) return;
    if (parseSyncRequired(payload) === null) {
      handleRuntimeError(new Error('The realtime sync.required payload is invalid.'));
      return;
    }
    resyncRequested = true;
    if (!syncInFlight) await synchronize(true);
  }

  async function synchronize(refreshSnapshot: boolean): Promise<void> {
    if (syncInFlight) return;
    syncInFlight = true;
    synchronized = false;
    clearHeartbeatTimer();
    setStatus('synchronizing');
    try {
      if (refreshSnapshot || resyncRequested) {
        resyncRequested = false;
        await replaceSnapshot(await fetchAuthoritativeSnapshot(), true);
      }
      const response = await emitAcknowledged('connection.sync', {
        lastSeenEventSequence,
        deviceConfigVersion: snapshot?.deviceConfigVersion
      });
      if (!response.ok) {
        if (isAuthenticationFailure(response)) throw new AuthenticationFailureError(response);
        throw new Error(`Realtime synchronization failed: ${response.errorCode ?? 'unknown error'}.`);
      }
      if (response.sync === 'FULL_SNAPSHOT_REQUIRED') {
        resyncRequested = true;
        syncInFlight = false;
        await synchronize(true);
        return;
      }
      synchronized = true;
      setStatus('synchronized');
      await drainBufferedEvents();
      scheduleHeartbeat();
      resolveStartup();
      if (resyncRequested) {
        syncInFlight = false;
        await synchronize(true);
        return;
      }
    } catch (error) {
      if (isAuthenticationFailure(error)) handleAuthFailure(error);
      else handleRuntimeError(error);
    } finally {
      syncInFlight = false;
    }
  }

  function enqueueEvent(eventName: string, payload: unknown): void {
    if (stopped || authFailed) return;
    eventQueue = eventQueue
      .then(async () => {
        await processEvent(eventName, payload);
      })
      .catch((error: unknown) => {
        handleRuntimeError(error);
      });
  }

  async function processEvent(eventName: string, payload: unknown): Promise<void> {
    if (eventName === 'device.config.changed' && !isEventForDevice(payload)) return;
    if (receiver === undefined) return;
    if (eventName === 'device.token.rotation.required' && synchronized) {
      handleAuthFailure(new AuthenticationFailureError({ errorCode: 'TOKEN_ROTATION_REQUIRED' }));
      return;
    }
    const result = await receiver.handle(payload, { synchronized });
    if (result.outcome === 'deferred') {
      bufferedEvents.push({ eventName, payload });
      return;
    }
    lastSeenEventSequence = Math.max(lastSeenEventSequence, result.cursorSequence);
    if (result.cursorAdvanced) {
      await acknowledgeEvent(result.outcome === 'delivered' ? result.notification.eventId : eventIdOf(payload));
    }
    if (eventName === 'device.config.changed') {
      resyncRequested = true;
      if (!syncInFlight) await synchronize(true);
    }
  }

  async function drainBufferedEvents(): Promise<void> {
    const pending = bufferedEvents;
    bufferedEvents = [];
    for (const item of pending) {
      if (!isRecord(item) || typeof item['eventName'] !== 'string') continue;
      await processEvent(item['eventName'], item['payload']);
    }
  }

  async function acknowledgeEvent(eventId: string | undefined): Promise<void> {
    const activeSocket = socket;
    if (eventId === undefined || activeSocket === undefined || !activeSocket.connected) return;
    const response = await new Promise<TransportAck>((resolve) => {
      activeSocket.emit('client.event.received', { eventId }, (ack: TransportAck) => resolve(ack));
    });
    if (!response.ok && isAuthenticationFailure(response)) throw new AuthenticationFailureError(response);
  }

  function scheduleHeartbeat(): void {
    clearHeartbeatTimer();
    const intervalMs = snapshot?.config.heartbeatIntervalMs;
    if (!synchronized || socket === undefined || intervalMs === undefined) return;
    heartbeatTimer = setInterval(() => {
      void sendHeartbeat();
    }, intervalMs);
  }

  async function sendHeartbeat(): Promise<void> {
    const activeSocket = socket;
    if (heartbeatInFlight || !synchronized || stopped || authFailed || activeSocket === undefined || !activeSocket.connected) return;
    heartbeatInFlight = true;
    try {
      const response = await new Promise<TransportAck>((resolve) => {
        activeSocket.emit('device.heartbeat', { clientVersion: options.clientVersion, socketConnected: true }, (ack: TransportAck) => resolve(ack));
      });
      if (!response.ok) {
        if (isAuthenticationFailure(response)) handleAuthFailure(new AuthenticationFailureError(response));
        else handleRuntimeError(new Error(`Realtime heartbeat failed: ${response.errorCode ?? 'unknown error'}.`));
      }
    } finally {
      heartbeatInFlight = false;
    }
  }

  async function replaceSnapshot(nextSnapshot: DeviceSyncSnapshot, advanceCursor: boolean): Promise<void> {
    validateSnapshot(nextSnapshot);
    if (advanceCursor && nextSnapshot.currentEventSequence > lastSeenEventSequence) {
      await cursor.advanceTo(nextSnapshot.currentEventSequence);
      lastSeenEventSequence = nextSnapshot.currentEventSequence;
    }
    const previousAreaId = assignedAreaId;
    assignedAreaId = nextSnapshot.device.areaId ?? undefined;
    snapshot = nextSnapshot;
    createCore();
    if (socket !== undefined) {
      const auth = buildAuth();
      socket.auth = auth;
    }
    await options.onSnapshot?.(nextSnapshot);
    if (previousAreaId !== undefined && previousAreaId !== assignedAreaId) {
      bufferedEvents = [];
    }
  }

  function createCore(): void {
    if (assignedAreaId === undefined) throw new Error('An AREA assignment is required before creating the receiver core.');
    receiver = createNotificationReceiver({
      assignedAreaId,
      cursor,
      sink: options.sink
    });
  }

  async function fetchAuthoritativeSnapshot(): Promise<DeviceSyncSnapshot> {
    const response = await fetchSnapshot(snapshotUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${options.deviceToken}`
      }
    });
    const body = await readSnapshotBody(response);
    if (!isSnapshotResponse(body)) throw new Error('The device session response is invalid.');
    validateSnapshot(body.data);
    return body.data;
  }

  function buildAuth(): RealtimeAuth {
    const auth: RealtimeAuth = {
      clientInstanceId: options.clientInstanceId,
      clientVersion: options.clientVersion,
      deviceId: options.deviceId,
      deviceToken: options.deviceToken,
      lastSeenEventSequence,
    };
    if (snapshot !== undefined) auth.deviceConfigVersion = snapshot.deviceConfigVersion;
    return auth;
  }

  function emitAcknowledged(eventName: string, payload: unknown): Promise<TransportAck> {
    const activeSocket = socket;
    if (activeSocket === undefined) return Promise.reject(new Error('The realtime socket is not available.'));
    return new Promise((resolve, reject) => {
      try {
        activeSocket.timeout(syncAckTimeoutMs).emit(eventName, payload, (error: unknown, response: TransportAck) => {
          if (error !== null && error !== undefined) {
            reject(error);
            return;
          }
          resolve(response ?? { ok: false, errorCode: 'INTERNAL_ERROR' });
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function clearHeartbeatTimer(): void {
    if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
    heartbeatInFlight = false;
  }

  function setStatus(nextStatus: LanNotificationReceiverStatus): void {
    if (status === nextStatus) return;
    status = nextStatus;
    options.onStatus?.(nextStatus);
  }

  function resolveStartup(): void {
    if (startupSettled) return;
    startupSettled = true;
    settleStart?.();
  }

  function rejectStartup(error: unknown): void {
    if (startupSettled) return;
    startupSettled = true;
    rejectStart?.(error);
  }

  function handleStartupError(error: unknown): void {
    if (isAuthenticationFailure(error)) handleAuthFailure(error);
    else handleRuntimeError(error);
  }

  function handleAuthFailure(error: unknown): void {
    if (authFailed || stopped) return;
    authFailed = true;
    synchronized = false;
    clearHeartbeatTimer();
    socket?.disableReconnection?.();
    detachSocketHandlers();
    socket?.disconnect();
    setStatus('auth-failed');
    options.onAuthFailure?.(error);
    rejectStartup(error);
  }

  function handleRuntimeError(error: unknown): void {
    if (stopped || authFailed) return;
    options.onError?.(error);
    if (!startupSettled) {
      setStatus('error');
      rejectStartup(error);
    }
  }

  function isEventForDevice(payload: unknown): boolean {
    return isRecord(payload)
      && isRecord(payload['payload'])
      && payload['payload']['deviceId'] === options.deviceId;
  }

  return { start, stop, getSnapshot };
}

function createCursorAdapter(cursorStore: DurableCursorStore): DurableCursorStore {
  let lastSeenEventSequence = cursorStore.lastSeenEventSequence;
  return {
    get lastSeenEventSequence() {
      return lastSeenEventSequence;
    },
    async advanceTo(eventSequence) {
      await cursorStore.advanceTo(eventSequence);
      lastSeenEventSequence = eventSequence;
    }
  };
}

async function defaultFetch(input: string, init: { method: 'GET'; headers: Record<string, string> }): Promise<unknown> {
  return globalThis.fetch(input, init);
}

function defaultSocketFactory(url: string, options: LanSocketOptions): LanSocket {
  const socket = io(url, options) as unknown as LanSocket;
  socket.disableReconnection = () => {
    const manager = (socket as unknown as { io?: { reconnection(value: boolean): unknown } }).io;
    manager?.reconnection(false);
  };
  return socket;
}

function normalizeOrigin(serverOrigin: string): string {
  return serverOrigin.replace(/\/+$/, '');
}

async function readSnapshotBody(response: unknown): Promise<unknown> {
  if (isRecord(response) && typeof response['ok'] === 'boolean' && typeof response['json'] === 'function') {
    if (!response['ok']) {
      const status = typeof response['status'] === 'number' ? response['status'] : 0;
      throw new Error(`The device session request failed with HTTP ${status}.`);
    }
    return (await (response['json'] as () => Promise<unknown>)());
  }
  return response;
}

function isSnapshotResponse(value: unknown): value is SnapshotResponse {
  return isRecord(value)
    && typeof value['requestId'] === 'string'
    && isDeviceSyncSnapshot(value['data']);
}

function validateSnapshot(snapshot: DeviceSyncSnapshot): void {
  if (!isDeviceSyncSnapshot(snapshot)) throw new Error('The device session snapshot is invalid.');
  if (!snapshot.device.active || snapshot.device.assignmentMode !== 'AREA' || snapshot.device.areaId === null) {
    throw new Error('The device must have an active AREA assignment.');
  }
  if (snapshot.config.mode !== 'AREA' || snapshot.config.room !== null || snapshot.config.area?.id !== snapshot.device.areaId) {
    throw new Error('The device session snapshot has an inconsistent AREA assignment.');
  }
}

function isDeviceSyncSnapshot(value: unknown): value is DeviceSyncSnapshot {
  if (!isRecord(value)
    || !isNonNegativeInteger(value['snapshotSequence'])
    || !isNonNegativeInteger(value['currentEventSequence'])
    || !isNonNegativeInteger(value['configurationRevision'])
    || !isPositiveInteger(value['deviceConfigVersion'])
    || !isNonEmptyString(value['serverTime'])
    || !isDevice(value['device'])
    || !isDeviceConfig(value['config'])
    || !Array.isArray(value['activeRequests'])
    || !value['activeRequests'].every(isRequest)
    || !(value['pendingTokenRotation'] === null || isRecord(value['pendingTokenRotation']))) {
    return false;
  }
  return true;
}

function isDevice(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value['id'])
    && isNonEmptyString(value['installationId'])
    && isNonEmptyString(value['displayName'])
    && (value['assignmentMode'] === 'ROOM' || value['assignmentMode'] === 'AREA')
    && (value['roomId'] === null || typeof value['roomId'] === 'string')
    && (value['areaId'] === null || typeof value['areaId'] === 'string')
    && typeof value['active'] === 'boolean'
    && isNonNegativeInteger(value['deviceConfigVersion'])
    && (value['lastHeartbeatAt'] === null || typeof value['lastHeartbeatAt'] === 'string')
    && isDevicePresence(value['presence']);
}

function isDeviceConfig(value: unknown): value is DeviceConfig {
  if (!isRecord(value)) return false;
  return (value['mode'] === 'ROOM' || value['mode'] === 'AREA')
    && (value['room'] === null || isCompactRoom(value['room']))
    && (value['area'] === null || isCompactReference(value['area']))
    && Array.isArray(value['services'])
    && value['services'].every(isRecord)
    && isNonEmptyString(value['hotelName'])
    && (value['hotelLogo'] === null || typeof value['hotelLogo'] === 'string')
    && isRoomBackground(value['roomBackground'])
    && (value['clockFormat'] === '12h' || value['clockFormat'] === '24h')
    && isPositiveInteger(value['offlineQueueTtlHours'])
    && isPositiveInteger(value['heartbeatIntervalMs'])
    && isPositiveInteger(value['heartbeatStaleAfterMs'])
    && isPositiveInteger(value['heartbeatOfflineAfterMs'])
    && isPositiveInteger(value['pendingAlertIntervalMs']);
}

function isRoomBackground(value: unknown): boolean {
  return value === null
    || typeof value === 'string'
    || isRecord(value) && typeof value['square480'] === 'string' && typeof value['tablet'] === 'string';
}

function isRequest(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value['id'])
    && isNonEmptyString(value['roomId'])
    && isNonEmptyString(value['serviceId'])
    && isNonEmptyString(value['responsibleAreaId'])
    && isCompactRoom(value['room'])
    && isCompactReference(value['service'])
    && isCompactReference(value['responsibleArea'])
    && isRequestStatus(value['status'])
    && isPositiveInteger(value['version'])
    && isNonEmptyString(value['createdAt'])
    && isNonEmptyString(value['updatedAt'])
    && isNullableString(value['acceptedAt'])
    && isNullableString(value['inProgressAt'])
    && isNullableString(value['completedAt']);
}

function isCompactRoom(value: unknown): boolean {
  return isCompactReference(value) && isRecord(value) && typeof value['doNotDisturb'] === 'boolean';
}

function isCompactReference(value: unknown): boolean {
  return isRecord(value)
    && isNonEmptyString(value['id'])
    && isNonEmptyString(value['code'])
    && isNonEmptyString(value['displayName']);
}

function isRequestStatus(value: unknown): boolean {
  return value === 'PENDING' || value === 'ACCEPTED' || value === 'IN_PROGRESS' || value === 'COMPLETED';
}

function isDevicePresence(value: unknown): boolean {
  return value === 'ONLINE' || value === 'STALE' || value === 'OFFLINE' || value === 'DISABLED';
}

function parseConnectionReady(value: unknown): { sync: 'REPLAY_AVAILABLE' | 'FULL_SNAPSHOT_REQUIRED' | 'UP_TO_DATE' } | null {
  if (!isRecord(value) || typeof value['serverTime'] !== 'string' || !isNonNegativeInteger(value['currentEventSequence'])) return null;
  return value['sync'] === 'REPLAY_AVAILABLE' || value['sync'] === 'FULL_SNAPSHOT_REQUIRED' || value['sync'] === 'UP_TO_DATE'
    ? { sync: value['sync'] }
    : null;
}

function parseSyncRequired(value: unknown): boolean | null {
  if (!isRecord(value) || !isNonNegativeInteger(value['currentEventSequence'])) return null;
  return value['reason'] === 'EVENT_GAP'
    || value['reason'] === 'ASSIGNMENT_CHANGED'
    || value['reason'] === 'SERVER_RESTART'
    || value['reason'] === 'DEVICE_CONFIG_MISMATCH';
}

function isAuthenticationFailure(value: unknown): boolean {
  const code = errorCodeOf(value);
  return code !== undefined && AUTH_FAILURE_CODES.has(code);
}

function errorCodeOf(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value['errorCode'] === 'string') return value['errorCode'];
  if (typeof value['code'] === 'string') return value['code'];
  if (typeof value['name'] === 'string') return value['name'];
  return undefined;
}

function eventIdOf(value: unknown): string | undefined {
  return isRecord(value) && typeof value['eventId'] === 'string' ? value['eventId'] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

class AuthenticationFailureError extends Error {
  public readonly errorCode: string;

  public constructor(response: { errorCode?: string }) {
    super(`LAN notification receiver authentication failed: ${response.errorCode ?? 'AUTH_INVALID'}.`);
    this.name = response.errorCode ?? 'AUTH_INVALID';
    this.errorCode = response.errorCode ?? 'AUTH_INVALID';
  }
}

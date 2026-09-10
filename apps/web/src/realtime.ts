import { useEffect, useRef } from 'react';
import type { TransportAck } from '@hotel/shared';
import { io } from 'socket.io-client';
import { api, isApiError, isDeviceInvalidationError } from './api';
import { getOrCreateClientInstanceId } from './app-model';

interface RealtimeConnectionOptions {
  enabled: boolean;
  hasSnapshot: boolean;
  deviceId?: string | undefined;
  deviceToken?: string | undefined;
  deviceConfigVersion?: number | undefined;
  lastSeenEventSequence?: number | undefined;
  heartbeatIntervalMs?: number | undefined;
  onEvent: (eventName?: string, payload?: unknown) => RealtimeRefreshResult | void | Promise<RealtimeRefreshResult | void>;
  onAuthFailure: () => void;
  onStatus: (status: ConnectionStatus) => void;
}

export type ConnectionStatus = 'connecting' | 'online' | 'offline' | 'stale';

export interface RealtimeRefreshResult {
  synchronized: boolean;
  lastSeenEventSequence?: number;
  deviceConfigVersion?: number;
}

export interface RealtimeEventDeduplicator {
  lastSeenEventSequence: number;
  highestObservedEventSequence: number;
  seenEventIds: Set<string>;
  aggregateVersions: Map<string, number>;
  pendingEvents: Map<string, DurableEventPayload>;
  pendingMaxEventSequence: number;
  pendingOverflow: boolean;
}

const CLIENT_VERSION = '0.1.0';
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_DEDUPLICATED_EVENTS = 2048;
const SYNC_RETRY_BASE_DELAY_MS = 250;
const SYNC_RETRY_MAX_DELAY_MS = 10_000;
const SYNC_ACK_TIMEOUT_MS = 5_000;
const MAX_SYNC_ATTEMPTS = 3;
const REACTIVE_EVENTS = new Set([
  'request.created',
  'request.updated',
  'device.config.changed',
  'device.token.rotation.required',
  'service.catalog.changed',
  'device.presence.changed',
  'room.updated',
  'sync.required',
  'system.maintenance'
]);

interface RealtimeAuthInput {
  clientInstanceId: string;
  deviceId?: string | undefined;
  deviceToken?: string | undefined;
  deviceConfigVersion?: number | undefined;
  lastSeenEventSequence?: number | undefined;
}

export interface RealtimeAuth {
  clientInstanceId: string;
  clientVersion: string;
  deviceId?: string;
  deviceToken?: string;
  deviceConfigVersion?: number;
  lastSeenEventSequence?: number;
}

export function buildRealtimeAuth(input: RealtimeAuthInput): RealtimeAuth {
  return {
    clientInstanceId: input.clientInstanceId,
    clientVersion: CLIENT_VERSION,
    ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
    ...(input.deviceToken === undefined ? {} : { deviceToken: input.deviceToken }),
    ...(input.deviceConfigVersion === undefined ? {} : { deviceConfigVersion: input.deviceConfigVersion }),
    ...(input.lastSeenEventSequence === undefined ? {} : { lastSeenEventSequence: input.lastSeenEventSequence })
  };
}

export function createRealtimeEventDeduplicator(lastSeenEventSequence = 0): RealtimeEventDeduplicator {
  return {
    lastSeenEventSequence,
    highestObservedEventSequence: lastSeenEventSequence,
    seenEventIds: new Set<string>(),
    aggregateVersions: new Map<string, number>(),
    pendingEvents: new Map<string, DurableEventPayload>(),
    pendingMaxEventSequence: lastSeenEventSequence,
    pendingOverflow: false
  };
}

export function shouldProcessRealtimeEvent(payload: unknown, state: RealtimeEventDeduplicator): boolean {
  if (!isDurableEventPayload(payload)) return true;
  if (state.seenEventIds.has(payload.eventId) || state.pendingEvents.has(payload.eventId)) return false;
  if (payload.eventSequence <= state.lastSeenEventSequence || payload.eventSequence <= state.highestObservedEventSequence) return false;
  const aggregateKey = getAggregateKey(payload);
  let shouldApply = true;
  if (aggregateKey !== null && payload.aggregateVersion !== undefined) {
    const previousVersion = getKnownAggregateVersion(state, aggregateKey);
    if (previousVersion !== undefined && payload.aggregateVersion <= previousVersion) shouldApply = false;
  }
  state.pendingEvents.set(payload.eventId, payload);
  state.pendingMaxEventSequence = Math.max(state.pendingMaxEventSequence, payload.eventSequence);
  state.highestObservedEventSequence = Math.max(state.highestObservedEventSequence, payload.eventSequence);
  if (state.pendingEvents.size > MAX_DEDUPLICATED_EVENTS) {
    const oldest = state.pendingEvents.keys().next().value as string | undefined;
    if (oldest !== undefined) {
      state.pendingEvents.delete(oldest);
      state.pendingOverflow = true;
    }
  }
  return shouldApply;
}

export function commitRealtimeEventCandidates(state: RealtimeEventDeduplicator, result: RealtimeRefreshResult): boolean {
  if (!result.synchronized) return false;
  const committedCursor = result.lastSeenEventSequence;
  const canCommitAllCandidates = committedCursor === undefined || committedCursor >= state.pendingMaxEventSequence;

  for (const [eventId, payload] of state.pendingEvents) {
    if (committedCursor !== undefined && payload.eventSequence > committedCursor) continue;
    state.seenEventIds.add(eventId);
    state.lastSeenEventSequence = Math.max(state.lastSeenEventSequence, payload.eventSequence);
    const aggregateKey = getAggregateKey(payload);
    if (aggregateKey !== null && payload.aggregateVersion !== undefined) {
      const currentVersion = state.aggregateVersions.get(aggregateKey);
      if (currentVersion === undefined || payload.aggregateVersion > currentVersion) state.aggregateVersions.set(aggregateKey, payload.aggregateVersion);
    }
    state.pendingEvents.delete(eventId);
  }

  if (committedCursor !== undefined) state.lastSeenEventSequence = Math.max(state.lastSeenEventSequence, committedCursor);
  if (state.pendingEvents.size === 0 && canCommitAllCandidates) {
    state.pendingMaxEventSequence = state.lastSeenEventSequence;
    state.highestObservedEventSequence = state.lastSeenEventSequence;
    state.pendingOverflow = false;
  }
  pruneDeduplicationState(state);
  return canCommitAllCandidates && state.pendingEvents.size === 0 && !state.pendingOverflow;
}

export function resolveHeartbeatIntervalMs(value: number | undefined): number {
  return value ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
}

export function resolveRealtimeStatus(input: { enabled: boolean; hasSnapshot: boolean; transportConnected: boolean; synchronized: boolean; refreshFailed?: boolean }): ConnectionStatus {
  if (!input.enabled || !input.hasSnapshot || !input.transportConnected) return 'offline';
  if (input.refreshFailed === true) return 'stale';
  return input.synchronized ? 'online' : 'connecting';
}

export function canCommitMutation(status: ConnectionStatus): boolean {
  return status === 'online';
}

export function isReactiveRealtimeEvent(eventName: string): boolean {
  return REACTIVE_EVENTS.has(eventName);
}

export function resolveSyncRetryDelayMs(attempt: number): number {
  const normalizedAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return Math.min(SYNC_RETRY_MAX_DELAY_MS, SYNC_RETRY_BASE_DELAY_MS * 2 ** normalizedAttempt);
}

export function useRealtimeConnection(options: RealtimeConnectionOptions): void {
  const {
    enabled,
    hasSnapshot,
    deviceId,
    deviceToken,
    deviceConfigVersion,
    lastSeenEventSequence,
    heartbeatIntervalMs,
    onEvent,
    onAuthFailure,
    onStatus
  } = options;
  const handshakeRef = useRef({ deviceConfigVersion, lastSeenEventSequence });
  handshakeRef.current = { deviceConfigVersion, lastSeenEventSequence };

  useEffect(() => {
    if (!enabled) {
      onStatus('offline');
      return undefined;
    }

    onStatus('connecting');
    const clientInstanceId = getOrCreateClientInstanceId();
    const currentAuth = (): RealtimeAuth => buildRealtimeAuth({
      clientInstanceId,
      deviceId,
      deviceToken,
      ...handshakeRef.current
    });
    const socket = io('/realtime', {
      path: '/socket.io',
      auth: currentAuth(),
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000
    });
    let syncTimer: ReturnType<typeof setTimeout> | undefined;
    let syncRetryTimer: ReturnType<typeof setTimeout> | undefined;
    let syncRetryGeneration = 0;
    let refreshGeneration = 0;
    let syncRequestGeneration = 0;
    let transportConnected = false;
    let readyReceived = false;
    let synchronized = false;
    let refreshFailed = false;
    const eventDeduplicator = createRealtimeEventDeduplicator(lastSeenEventSequence ?? 0);

    const publishStatus = (): void => {
      onStatus(resolveRealtimeStatus({ enabled: true, hasSnapshot, transportConnected, synchronized, refreshFailed }));
    };

    const cancelSyncRetry = (): void => {
      if (syncRetryTimer !== undefined) clearTimeout(syncRetryTimer);
      syncRetryTimer = undefined;
      syncRetryGeneration += 1;
      syncRequestGeneration += 1;
    };

    const cancelRefresh = (): void => {
      if (syncTimer !== undefined) clearTimeout(syncTimer);
      syncTimer = undefined;
      cancelSyncRetry();
      refreshGeneration += 1;
    };

    const sendSocketHeartbeat = (): void => {
      if (deviceToken === undefined || !transportConnected || !synchronized) return;
      socket.emit('device.heartbeat', {
        clientVersion: CLIENT_VERSION,
        socketConnected: true,
        screenVisible: document.visibilityState === 'visible'
      });
    };

    const markSynchronized = (): void => {
      if (!transportConnected || !readyReceived) return;
      synchronized = true;
      refreshFailed = false;
      publishStatus();
      sendSocketHeartbeat();
    };

    const scheduleSyncRetry = (result: RealtimeRefreshResult, attempt: number): void => {
      if (attempt + 1 >= MAX_SYNC_ATTEMPTS) {
        synchronized = false;
        refreshFailed = true;
        publishStatus();
        return;
      }
      if (syncRetryTimer !== undefined) clearTimeout(syncRetryTimer);
      syncRetryGeneration += 1;
      const generation = syncRetryGeneration;
      publishStatus();
      syncRetryTimer = setTimeout(() => {
        if (generation !== syncRetryGeneration || !transportConnected || !readyReceived) return;
        syncRetryTimer = undefined;
        requestServerSync(result, attempt + 1);
      }, resolveSyncRetryDelayMs(attempt));
    };

    const requestServerSync = (result: RealtimeRefreshResult, attempt = 0): void => {
      if (!transportConnected || !readyReceived || !result.synchronized) return;
      const payload = {
        ...(result.lastSeenEventSequence === undefined ? {} : { lastSeenEventSequence: result.lastSeenEventSequence }),
        ...(result.deviceConfigVersion === undefined ? {} : { deviceConfigVersion: result.deviceConfigVersion })
      };
      if (Object.keys(payload).length === 0) {
        markSynchronized();
        return;
      }
      const requestGeneration = ++syncRequestGeneration;
      socket.timeout(SYNC_ACK_TIMEOUT_MS).emit('connection.sync', payload, (timeoutError: Error | null, ack?: TransportAck) => {
        if (!transportConnected || requestGeneration !== syncRequestGeneration) return;
        if (timeoutError !== null || ack === undefined || !ack.ok) {
          if (isAuthErrorCode(ack?.errorCode)) {
            cancelRefresh();
            onAuthFailure();
            return;
          }
          scheduleSyncRetry(result, attempt);
          return;
        }
        if (ack.sync === 'FULL_SNAPSHOT_REQUIRED') {
          synchronized = false;
          refreshFailed = false;
          publishStatus();
          scheduleRefresh();
          return;
        }
        if (ack.sync === 'REPLAY_AVAILABLE') {
          synchronized = false;
          refreshFailed = false;
          publishStatus();
          scheduleRefresh();
          return;
        }
        if (ack.sync === 'UP_TO_DATE') markSynchronized();
      });
    };

    const handleRefreshFailure = (attempt: number, eventName?: string, eventPayload?: unknown): void => {
      if (!transportConnected || !readyReceived) return;
      synchronized = false;
      refreshFailed = true;
      publishStatus();
      if (attempt + 1 < MAX_SYNC_ATTEMPTS) scheduleRefresh(attempt + 1, eventName, eventPayload);
    };

    const scheduleRefresh = (attempt = 0, eventName?: string, eventPayload?: unknown): void => {
      if (!transportConnected || !readyReceived) return;
      if (syncTimer !== undefined) clearTimeout(syncTimer);
      cancelSyncRetry();
      synchronized = false;
      publishStatus();
      const generation = ++refreshGeneration;
      syncTimer = setTimeout(() => {
        syncTimer = undefined;
        void Promise.resolve()
          .then(() => onEvent(eventName, eventPayload))
          .then((result) => {
            if (generation !== refreshGeneration || !transportConnected || !readyReceived) return;
            const normalized: RealtimeRefreshResult = result ?? { synchronized: true };
            if (!commitRealtimeEventCandidates(eventDeduplicator, normalized)) {
              handleRefreshFailure(attempt, eventName, eventPayload);
              return;
            }
            if (!normalized.synchronized) {
              handleRefreshFailure(attempt, eventName, eventPayload);
              return;
            }
            refreshFailed = false;
            publishStatus();
            requestServerSync(normalized);
          })
          .catch(() => {
            if (generation !== refreshGeneration) return;
            handleRefreshFailure(attempt, eventName, eventPayload);
          });
      }, attempt === 0 ? 150 : resolveSyncRetryDelayMs(attempt - 1));
    };
    const refreshAuth = (): void => {
      socket.auth = currentAuth();
    };

    socket.on('connect', () => {
      transportConnected = true;
      readyReceived = false;
      synchronized = false;
      refreshFailed = false;
      refreshAuth();
      publishStatus();
    });
    socket.on('connection.ready', (_payload: { sync: 'REPLAY_AVAILABLE' | 'FULL_SNAPSHOT_REQUIRED' | 'UP_TO_DATE' }) => {
      readyReceived = true;
      synchronized = false;
      refreshFailed = false;
      publishStatus();
      scheduleRefresh();
    });
    socket.on('sync.required', () => {
      synchronized = false;
      refreshFailed = false;
      publishStatus();
      scheduleRefresh(0, 'sync.required');
    });
    socket.on('disconnect', () => {
      transportConnected = false;
      readyReceived = false;
      synchronized = false;
      cancelRefresh();
      refreshAuth();
      publishStatus();
    });
    socket.on('connect_error', (error: Error & { name?: string }) => {
      transportConnected = false;
      readyReceived = false;
      synchronized = false;
      cancelRefresh();
      refreshAuth();
      publishStatus();
      if (isAuthError(error)) onAuthFailure();
    });
    socket.onAny((eventName: string, payload: unknown) => {
       if (!isReactiveRealtimeEvent(eventName)) return;
      if (eventName !== 'sync.required') {
        const previousHighestObserved = eventDeduplicator.highestObservedEventSequence;
        const shouldApply = shouldProcessRealtimeEvent(payload, eventDeduplicator);
        if (!shouldApply && eventDeduplicator.highestObservedEventSequence === previousHighestObserved) return;
      }
      scheduleRefresh(0, eventName, payload);
    });

    const heartbeat = deviceToken === undefined ? undefined : setInterval(() => {
      void api.post('/device/heartbeat', {
        clientVersion: CLIENT_VERSION,
        socketConnected: socket.connected && synchronized,
        screenVisible: document.visibilityState === 'visible'
      }, { token: deviceToken }).catch((error: unknown) => {
        if (isApiError(error, 401) || isDeviceInvalidationError(error)) onAuthFailure();
      });
    }, resolveHeartbeatIntervalMs(heartbeatIntervalMs));

    return () => {
      cancelRefresh();
      transportConnected = false;
      if (heartbeat !== undefined) clearInterval(heartbeat);
      socket.disconnect();
    };
  }, [
    enabled,
    deviceId,
    deviceToken,
    heartbeatIntervalMs,
    hasSnapshot,
    onEvent,
    onAuthFailure,
    onStatus
  ]);
}

interface DurableEventPayload {
  eventId: string;
  eventSequence: number;
  aggregateType?: string;
  aggregateId?: string;
  aggregateVersion?: number;
}

function isDurableEventPayload(value: unknown): value is DurableEventPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['eventId'] === 'string'
    && candidate['eventId'].length > 0
    && typeof candidate['eventSequence'] === 'number'
    && Number.isInteger(candidate['eventSequence'])
    && candidate['eventSequence'] >= 0
    && (candidate['aggregateType'] === undefined || typeof candidate['aggregateType'] === 'string' && candidate['aggregateType'].length > 0)
    && (candidate['aggregateId'] === undefined || typeof candidate['aggregateId'] === 'string' && candidate['aggregateId'].length > 0)
    && (candidate['aggregateVersion'] === undefined || typeof candidate['aggregateVersion'] === 'number' && Number.isInteger(candidate['aggregateVersion']) && candidate['aggregateVersion'] >= 0);
}

function getAggregateKey(payload: DurableEventPayload): string | null {
  if (payload.aggregateType === undefined || payload.aggregateId === undefined) return null;
  return `${payload.aggregateType}:${payload.aggregateId}`;
}

function getKnownAggregateVersion(state: RealtimeEventDeduplicator, aggregateKey: string): number | undefined {
  let knownVersion = state.aggregateVersions.get(aggregateKey);
  for (const payload of state.pendingEvents.values()) {
    if (getAggregateKey(payload) !== aggregateKey || payload.aggregateVersion === undefined) continue;
    if (knownVersion === undefined || payload.aggregateVersion > knownVersion) knownVersion = payload.aggregateVersion;
  }
  return knownVersion;
}

function pruneDeduplicationState(state: RealtimeEventDeduplicator): void {
  while (state.seenEventIds.size > MAX_DEDUPLICATED_EVENTS) {
    const oldest = state.seenEventIds.values().next().value as string | undefined;
    if (oldest === undefined) break;
    state.seenEventIds.delete(oldest);
  }
  while (state.aggregateVersions.size > MAX_DEDUPLICATED_EVENTS) {
    const oldest = state.aggregateVersions.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    state.aggregateVersions.delete(oldest);
  }
}

function isAuthError(error: Error & { name?: string }): boolean {
  const text = `${error.name ?? ''} ${error.message}`.toUpperCase();
  return text.includes('AUTH_') || text.includes('DEVICE_INACTIVE') || text.includes('TOKEN_REVOKED');
}

function isAuthErrorCode(code: string | undefined): boolean {
  if (code === undefined) return false;
  const normalized = code.toUpperCase();
  return normalized.startsWith('AUTH_') || normalized === 'DEVICE_INACTIVE' || normalized === 'TOKEN_REVOKED';
}

import type { DeviceSyncSnapshot, DurableRealtimeEvent, RequestCreatedPayload, RequestDTO, TransportAck } from '@hotel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLanNotificationReceiver,
  type LanNotificationReceiverStatus,
  type LanSocket,
  type SnapshotResponse
} from '../../packages/notification-receiver-lan/src';
import type { DurableCursorStore, RequestNotification } from '../../packages/notification-receiver/src';

describe('LAN notification receiver runtime', () => {
  let socket: FakeSocket;
  let fetchSnapshot: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    socket = new FakeSocket();
    fetchSnapshot = vi.fn(async () => snapshotResponse(createSnapshot()));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches the authoritative snapshot before connecting and sends the exact Socket.IO contract', async () => {
    const cursor = createCursor(7);
    const socketFactory = vi.fn((_url: string, _options: unknown) => socket);
    const receiver = createLanNotificationReceiver({
      serverOrigin: 'http://hotel.local:3000/',
      deviceId: 'device-area',
      deviceToken: 'device-secret',
      clientInstanceId: 'lan-client-instance',
      clientVersion: '1.2.3',
      cursor,
      sink: { deliver: vi.fn() },
      fetch: fetchSnapshot,
      socketFactory
    });

    const start = receiver.start();
    await flush();

    expect(fetchSnapshot).toHaveBeenCalledWith('http://hotel.local:3000/api/v1/device/session', expect.objectContaining({
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: 'Bearer device-secret' }
    }));
    expect(socketFactory).toHaveBeenCalledWith('http://hotel.local:3000/realtime', expect.objectContaining({
      autoConnect: false,
      path: '/socket.io',
      reconnection: true,
      auth: {
        clientInstanceId: 'lan-client-instance',
        clientVersion: '1.2.3',
        deviceId: 'device-area',
        deviceToken: 'device-secret',
        lastSeenEventSequence: 7,
        deviceConfigVersion: 3
      }
    }));
    expect(socket.connectCalls).toBe(1);

    socket.trigger('connection.ready', { sync: 'UP_TO_DATE', currentEventSequence: 7, serverTime: '2026-09-19T12:00:00.000Z' });
    await start;

    expect(receiver.getSnapshot()?.device.areaId).toBe('area-housekeeping');
    expect(cursor.writes).toEqual([]);
  });

  it.each([
    ['inactive device', { device: { active: false } }, 'active AREA assignment'],
    ['room assignment', { device: { assignmentMode: 'ROOM', roomId: 'room-101', areaId: null }, config: { mode: 'ROOM', room: { id: 'room-101', code: '101', displayName: 'Room 101', doNotDisturb: false }, area: null } }, 'active AREA assignment'],
    ['mismatched area assignment', { config: { area: { id: 'area-maintenance', code: 'MAINTENANCE', displayName: 'Maintenance' } } }, 'inconsistent AREA assignment']
  ])('rejects an authoritative snapshot with %s', async (_description, changes, message) => {
    fetchSnapshot = vi.fn(async () => snapshotResponse(createSnapshot(changes as SnapshotChanges)));
    const socketFactory = vi.fn(() => socket);
    const receiver = createLanNotificationReceiver({
      serverOrigin: 'http://hotel.local:3000',
      deviceId: 'device-area',
      deviceToken: 'device-secret',
      clientInstanceId: 'lan-client-instance',
      clientVersion: '1.2.3',
      cursor: createCursor(),
      sink: { deliver: vi.fn() },
      fetch: fetchSnapshot,
      socketFactory
    });

    await expect(receiver.start()).rejects.toThrow(message);
    expect(socketFactory).not.toHaveBeenCalled();
  });

  it('buffers durable events until synchronization is acknowledged', async () => {
    const delivered: RequestNotification[] = [];
    const receiver = mount({ sink: { deliver: (notification) => delivered.push(notification) } });
    const { start } = await connectAndHoldSynchronization(receiver);

    socket.triggerAny('request.created', createRequestCreatedEvent(11, 'event-buffered'));
    await flush();
    expect(delivered).toHaveLength(0);

    socket.resolvePendingSync({ ok: true, sync: 'UP_TO_DATE' });
    await start;
    await flush();

    expect(delivered.map((notification) => notification.eventId)).toEqual(['event-buffered']);
    expect(socket.receivedEventIds).toEqual(['event-buffered']);
  });

  it('buffers token rotation until synchronization, then reports auth failure without consuming the event', async () => {
    const cursor = createCursor();
    const statuses: LanNotificationReceiverStatus[] = [];
    const onAuthFailure = vi.fn();
    const onError = vi.fn();
    const receiver = mount({
      cursor,
      onStatus: (status) => statuses.push(status),
      onAuthFailure,
      onError
    });
    const { start } = await connectAndHoldSynchronization(receiver);
    const event = createTokenRotationRequiredEvent(11);

    socket.triggerAny('device.token.rotation.required', event);
    await flush();

    expect(onAuthFailure).not.toHaveBeenCalled();
    expect(cursor.writes).toEqual([]);
    expect(socket.receivedEventIds).toEqual([]);

    socket.resolvePendingSync({ ok: true, sync: 'UP_TO_DATE' });
    await expect(start).rejects.toMatchObject({ errorCode: 'TOKEN_ROTATION_REQUIRED' });
    await flush();

    expect(onAuthFailure).toHaveBeenCalledOnce();
    expect(onAuthFailure).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'TOKEN_ROTATION_REQUIRED' }));
    expect(onError).not.toHaveBeenCalled();
    expect(statuses).toContain('auth-failed');
    expect(socket.reconnectEnabled).toBe(false);

    socket.triggerAny('request.created', createRequestCreatedEvent(12, 'event-after-rotation'));
    await flush();

    expect(cursor.writes).toEqual([]);
    expect(socket.receivedEventIds).toEqual([]);
    expect(receiver.getSnapshot()?.currentEventSequence).toBe(10);
  });

  it('processes ordered replay, filters areas, advances unsupported durable cursors, and suppresses duplicates', async () => {
    const cursor = createCursor(10);
    const delivered: RequestNotification[] = [];
    const receiver = mount({ cursor, sink: { deliver: (notification) => delivered.push(notification) } });
    await connectAndSynchronize(receiver);

    socket.triggerAny('request.created', createRequestCreatedEvent(11, 'event-assigned', 'area-housekeeping'));
    socket.triggerAny('request.created', createRequestCreatedEvent(12, 'event-other-area', 'area-maintenance'));
    socket.triggerAny('room.updated', createUnsupportedEvent(13, 'room.updated', 'ROOM'));
    socket.triggerAny('request.created', createRequestCreatedEvent(11, 'event-assigned', 'area-housekeeping'));
    socket.triggerAny('room.updated', createUnsupportedEvent(10, 'room.updated', 'ROOM'));
    await flush();

    expect(delivered.map((notification) => notification.eventId)).toEqual(['event-assigned']);
    expect(cursor.writes).toEqual([11, 12, 13]);
    expect(socket.receivedEventIds).toEqual(['event-assigned', 'event-other-area', 'event-room-update']);
  });

  it('restores pending snapshot requests without synthesizing notifications', async () => {
    fetchSnapshot = vi.fn(async () => snapshotResponse(createSnapshot({ activeRequests: [createRequest(4, 'PENDING')] })));
    const delivered: RequestNotification[] = [];
    const snapshots: DeviceSyncSnapshot[] = [];
    const receiver = mount({
      sink: { deliver: (notification) => delivered.push(notification) },
      onSnapshot: (snapshot) => snapshots.push(snapshot)
    });

    await connectAndSynchronize(receiver);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.activeRequests).toHaveLength(1);
    expect(delivered).toHaveLength(0);
  });

  it('does not advance the cursor or acknowledge a durable event when the sink fails', async () => {
    const cursor = createCursor();
    let attempts = 0;
    const receiver = mount({
      cursor,
      sink: {
        deliver: () => {
          attempts += 1;
          if (attempts === 1) throw new Error('sink unavailable');
        }
      }
    });
    await connectAndSynchronize(receiver);

    const event = createRequestCreatedEvent(11, 'event-retry');
    socket.triggerAny('request.created', event);
    await flush();

    expect(cursor.writes).toEqual([]);
    expect(socket.receivedEventIds).toEqual([]);

    socket.triggerAny('request.created', event);
    await flush();

    expect(cursor.writes).toEqual([11]);
    expect(socket.receivedEventIds).toEqual(['event-retry']);
  });

  it('acknowledges client events only after asynchronous sink handling succeeds', async () => {
    let resolveDelivery: (() => void) | undefined;
    const delivery = new Promise<void>((resolve) => { resolveDelivery = resolve; });
    const receiver = mount({ sink: { deliver: async () => delivery } });
    await connectAndSynchronize(receiver);

    socket.triggerAny('request.created', createRequestCreatedEvent(11, 'event-async'));
    await flush();
    expect(socket.receivedEventIds).toEqual([]);

    resolveDelivery?.();
    await flush();
    expect(socket.receivedEventIds).toEqual(['event-async']);
  });

  it('sends heartbeats after synchronization and stops on an authentication failure', async () => {
    const statuses: LanNotificationReceiverStatus[] = [];
    const onAuthFailure = vi.fn();
    const receiver = mount({
      onStatus: (status) => statuses.push(status),
      onAuthFailure,
      snapshot: { config: { heartbeatIntervalMs: 10 } }
    });
    await connectAndSynchronize(receiver);

    await vi.advanceTimersByTimeAsync(10);
    expect(socket.heartbeatPayloads).toHaveLength(1);

    socket.heartbeatAck = { ok: false, errorCode: 'DEVICE_INACTIVE' };
    await vi.advanceTimersByTimeAsync(10);

    expect(onAuthFailure).toHaveBeenCalledOnce();
    expect(statuses).toContain('auth-failed');
    expect(socket.reconnectEnabled).toBe(false);
    const heartbeatCount = socket.heartbeatPayloads.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(socket.heartbeatPayloads).toHaveLength(heartbeatCount);
  });

  it('stops reconnecting when connect_error reports an expired token rotation', async () => {
    const statuses: LanNotificationReceiverStatus[] = [];
    const onAuthFailure = vi.fn();
    const onError = vi.fn();
    const receiver = mount({
      onStatus: (status) => statuses.push(status),
      onAuthFailure,
      onError
    });
    const start = receiver.start();
    await flush();

    socket.trigger('connect_error', { errorCode: 'TOKEN_ROTATION_EXPIRED' });

    await expect(start).rejects.toMatchObject({ errorCode: 'TOKEN_ROTATION_EXPIRED' });
    expect(onAuthFailure).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    expect(statuses).toContain('auth-failed');
    expect(socket.reconnectEnabled).toBe(false);
  });

  it('refreshes and rebinds from an authoritative snapshot after assignment changes', async () => {
    const firstSnapshot = createSnapshot();
    const secondSnapshot = createSnapshot({
      currentEventSequence: 15,
      snapshotSequence: 15,
      deviceConfigVersion: 4,
      device: { areaId: 'area-maintenance', deviceConfigVersion: 4 },
      config: { area: { id: 'area-maintenance', code: 'MAINTENANCE', displayName: 'Maintenance' }, heartbeatIntervalMs: 25 }
    });
    let snapshotCall = 0;
    fetchSnapshot = vi.fn(async () => snapshotResponse(++snapshotCall === 1 ? firstSnapshot : secondSnapshot));
    const delivered: RequestNotification[] = [];
    const snapshots: DeviceSyncSnapshot[] = [];
    const errors: unknown[] = [];
    const receiver = mount({
      sink: { deliver: (notification) => delivered.push(notification) },
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onError: (error) => errors.push(error)
    });
    await connectAndSynchronize(receiver);

    socket.triggerAny('device.config.changed', {
      ...createUnsupportedEvent(11, 'device.config.changed', 'DEVICE'),
      payload: { deviceId: 'device-area' }
    });
    await flush();

    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    expect(errors).toEqual([]);
    expect(snapshots.map((item) => item.device.areaId)).toEqual(['area-housekeeping', 'area-maintenance']);

    socket.triggerAny('request.created', createRequestCreatedEvent(16, 'event-new-area', 'area-maintenance'));
    await flush();
    expect(delivered.map((notification) => notification.eventId)).toEqual(['event-new-area']);
    expect(receiver.getSnapshot()?.deviceConfigVersion).toBe(4);
  });

  it('clears timers and socket listeners when stopped', async () => {
    const receiver = mount({ snapshot: { config: { heartbeatIntervalMs: 10 } } });
    await connectAndSynchronize(receiver);
    const disconnectCallsBeforeStop = socket.disconnectCalls;

    receiver.stop();
    await vi.advanceTimersByTimeAsync(100);
    socket.triggerAny('request.created', createRequestCreatedEvent(11, 'event-after-stop'));
    await flush();

    expect(socket.disconnectCalls).toBe(disconnectCallsBeforeStop + 1);
    expect(socket.listenerCount('connection.ready')).toBe(0);
    expect(socket.anyListenerCount()).toBe(0);
    expect(socket.heartbeatPayloads).toHaveLength(0);
  });

  async function connectAndSynchronize(receiver: ReturnType<typeof createLanNotificationReceiver>): Promise<void> {
    const start = receiver.start();
    await flush();
    socket.trigger('connection.ready', { sync: 'UP_TO_DATE', currentEventSequence: 10, serverTime: '2026-09-19T12:00:00.000Z' });
    await start;
  }

  async function connectAndHoldSynchronization(receiver: ReturnType<typeof createLanNotificationReceiver>): Promise<{ start: Promise<void> }> {
    const start = receiver.start();
    await flush();
    socket.syncAckMode = 'hold';
    socket.trigger('connection.ready', { sync: 'UP_TO_DATE', currentEventSequence: 10, serverTime: '2026-09-19T12:00:00.000Z' });
    await flush();
    expect(socket.pendingSyncAcknowledgement).toBeDefined();
    return { start };
  }

  function mount(overrides: MountOverrides = {}): ReturnType<typeof createLanNotificationReceiver> {
    if (overrides.snapshot !== undefined) {
      const baseSnapshot = createSnapshot();
      fetchSnapshot = vi.fn(async () => snapshotResponse(createSnapshot(overrides.snapshot)));
      if (overrides.snapshot.config?.heartbeatIntervalMs !== undefined) {
        fetchSnapshot = vi.fn(async () => snapshotResponse({
          ...baseSnapshot,
          config: { ...baseSnapshot.config, heartbeatIntervalMs: overrides.snapshot?.config?.heartbeatIntervalMs ?? baseSnapshot.config.heartbeatIntervalMs }
        }));
      }
    }
    return createLanNotificationReceiver({
      serverOrigin: 'http://hotel.local:3000',
      deviceId: 'device-area',
      deviceToken: 'device-secret',
      clientInstanceId: 'lan-client-instance',
      clientVersion: '1.2.3',
      cursor: overrides.cursor ?? createCursor(),
      sink: overrides.sink ?? { deliver: vi.fn() },
      onSnapshot: overrides.onSnapshot,
      onStatus: overrides.onStatus,
      onAuthFailure: overrides.onAuthFailure,
      onError: overrides.onError,
      fetch: fetchSnapshot,
      socketFactory: () => socket
    });
  }
});

interface MountOverrides {
  cursor?: DurableCursorStore & { writes: number[] };
  sink?: { deliver(notification: RequestNotification): void | Promise<void> };
  onSnapshot?: (snapshot: DeviceSyncSnapshot) => void | Promise<void>;
  onStatus?: (status: LanNotificationReceiverStatus) => void;
  onAuthFailure?: (error: unknown) => void;
  onError?: (error: unknown) => void;
  snapshot?: SnapshotChanges;
}

type SnapshotChanges = {
  snapshotSequence?: number;
  currentEventSequence?: number;
  deviceConfigVersion?: number;
  device?: Partial<DeviceSyncSnapshot['device']>;
  config?: Partial<DeviceSyncSnapshot['config']>;
  activeRequests?: RequestDTO[];
};

function snapshotResponse(data: DeviceSyncSnapshot): SnapshotResponse {
  return { data, requestId: 'request-snapshot' };
}

function createSnapshot(changes: SnapshotChanges = {}): DeviceSyncSnapshot {
  const deviceConfigVersion = changes.deviceConfigVersion ?? 3;
  const areaId = changes.device?.areaId ?? 'area-housekeeping';
  const assignmentMode = changes.device?.assignmentMode ?? 'AREA';
  const configArea = changes.config?.area === null
    ? null
    : { id: areaId, code: areaId === 'area-housekeeping' ? 'HOUSEKEEPING' : 'MAINTENANCE', displayName: areaId === 'area-housekeeping' ? 'Housekeeping' : 'Maintenance', ...(changes.config?.area ?? {}) };
  return {
    snapshotSequence: changes.snapshotSequence ?? changes.currentEventSequence ?? 10,
    currentEventSequence: changes.currentEventSequence ?? 10,
    configurationRevision: 8,
    deviceConfigVersion,
    serverTime: '2026-09-19T12:00:00.000Z',
    device: {
      id: 'device-area',
      installationId: 'installation-area',
      displayName: 'Housekeeping console',
      assignmentMode,
      roomId: changes.device?.roomId ?? null,
      areaId,
      active: changes.device?.active ?? true,
      deviceConfigVersion,
      lastHeartbeatAt: null,
      presence: 'OFFLINE',
      ...changes.device
    },
    config: {
      mode: changes.config?.mode ?? 'AREA',
      room: changes.config?.room ?? null,
      area: configArea,
      services: [],
      hotelName: 'Hotel Local',
      hotelLogo: null,
      roomBackground: null,
      clockFormat: '24h',
      offlineQueueTtlHours: 48,
      heartbeatIntervalMs: changes.config?.heartbeatIntervalMs ?? 20,
      heartbeatStaleAfterMs: 60_000,
      heartbeatOfflineAfterMs: 120_000,
      pendingAlertIntervalMs: 5_000,
      ...changes.config
    },
    activeRequests: changes.activeRequests ?? [],
    pendingTokenRotation: null
  };
}

function createCursor(initialSequence = 0): DurableCursorStore & { writes: number[] } {
  let lastSeenEventSequence = initialSequence;
  const writes: number[] = [];
  return {
    writes,
    get lastSeenEventSequence() {
      return lastSeenEventSequence;
    },
    advanceTo(eventSequence) {
      writes.push(eventSequence);
      lastSeenEventSequence = eventSequence;
    }
  };
}

function createRequest(version: number, status: RequestDTO['status'] = 'PENDING', areaId = 'area-housekeeping'): RequestDTO {
  return {
    id: `request-${version}`,
    roomId: 'room-101',
    serviceId: 'service-towels',
    responsibleAreaId: areaId,
    room: { id: 'room-101', code: '101', displayName: 'Room 101', doNotDisturb: false },
    service: { id: 'service-towels', code: 'TOWELS', displayName: 'Fresh towels', iconKey: 'towels' },
    responsibleArea: { id: areaId, code: areaId === 'area-housekeeping' ? 'HOUSEKEEPING' : 'MAINTENANCE', displayName: areaId === 'area-housekeeping' ? 'Housekeeping' : 'Maintenance' },
    status,
    version,
    createdAt: '2026-09-19T11:59:00.000Z',
    acceptedAt: status === 'ACCEPTED' ? '2026-09-19T12:00:00.000Z' : null,
    inProgressAt: null,
    completedAt: null,
    updatedAt: '2026-09-19T12:00:00.000Z'
  };
}

function createRequestCreatedEvent(eventSequence: number, eventId: string, areaId = 'area-housekeeping'): DurableRealtimeEvent<'request.created', RequestCreatedPayload> {
  const request = createRequest(1, 'PENDING', areaId);
  return {
    schemaVersion: 1,
    eventId,
    eventSequence,
    name: 'request.created',
    occurredAt: '2026-09-19T12:00:00.000Z',
    aggregateType: 'REQUEST',
    aggregateId: request.id,
    aggregateVersion: request.version,
    payload: { request, alert: { repeatUntil: 'ACCEPTED' } }
  };
}

function createUnsupportedEvent(eventSequence: number, name: string, aggregateType: DurableRealtimeEvent<string, unknown>['aggregateType']): DurableRealtimeEvent<string, unknown> {
  return {
    schemaVersion: 1,
    eventId: eventSequence === 13 ? 'event-room-update' : `event-${name}-${eventSequence}`,
    eventSequence,
    name,
    occurredAt: '2026-09-19T12:00:00.000Z',
    aggregateType,
    aggregateId: aggregateType === 'DEVICE' ? 'device-area' : 'room-101',
    payload: {}
  };
}

function createTokenRotationRequiredEvent(eventSequence: number): DurableRealtimeEvent<string, unknown> {
  return {
    schemaVersion: 1,
    eventId: 'event-token-rotation-required',
    eventSequence,
    name: 'device.token.rotation.required',
    occurredAt: '2026-09-19T12:00:00.000Z',
    aggregateType: 'DEVICE',
    aggregateId: 'device-area',
    payload: {
      deviceId: 'device-area',
      rotationId: 'rotation-1',
      state: 'ROTATION_PENDING',
      graceExpiresAt: '2026-09-20T12:00:00.000Z',
      configurationRevision: 8
    }
  };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 50; index += 1) await Promise.resolve();
}

class FakeSocket implements LanSocket {
  public connected = false;
  public auth: unknown;
  public connectCalls = 0;
  public disconnectCalls = 0;
  public reconnectEnabled = true;
  public heartbeatAck: TransportAck = { ok: true };
  public syncAckMode: 'auto' | 'hold' = 'auto';
  public pendingSyncAcknowledgement: ((...args: unknown[]) => void) | undefined;
  public heartbeatPayloads: unknown[] = [];
  public receivedEventIds: string[] = [];
  private readonly handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  private readonly anyHandlers = new Set<(eventName: string, payload: unknown) => void>();

  public on(eventName: string, handler: (...args: unknown[]) => void): this {
    const handlers = this.handlers.get(eventName) ?? new Set<(...args: unknown[]) => void>();
    handlers.add(handler);
    this.handlers.set(eventName, handlers);
    return this;
  }

  public off(eventName: string, handler?: (...args: unknown[]) => void): this {
    if (handler === undefined) this.handlers.delete(eventName);
    else this.handlers.get(eventName)?.delete(handler);
    return this;
  }

  public onAny(handler: (eventName: string, payload: unknown) => void): this {
    this.anyHandlers.add(handler);
    return this;
  }

  public offAny(handler?: (eventName: string, payload: unknown) => void): this {
    if (handler === undefined) this.anyHandlers.clear();
    else this.anyHandlers.delete(handler);
    return this;
  }

  public emit(eventName: string, ...args: unknown[]): this {
    const acknowledgement = args.at(-1);
    if (eventName === 'connection.sync' && typeof acknowledgement === 'function') {
      if (this.syncAckMode === 'hold') this.pendingSyncAcknowledgement = acknowledgement as (...args: unknown[]) => void;
      else (acknowledgement as (...args: unknown[]) => void)(null, { ok: true, sync: 'UP_TO_DATE' });
    }
    if (eventName === 'device.heartbeat') {
      this.heartbeatPayloads.push(args[0]);
      if (typeof acknowledgement === 'function') (acknowledgement as (...args: unknown[]) => void)(this.heartbeatAck);
    }
    if (eventName === 'client.event.received' && typeof acknowledgement === 'function') {
      const payload = args[0] as { eventId?: string };
      if (payload.eventId !== undefined) this.receivedEventIds.push(payload.eventId);
      (acknowledgement as (...args: unknown[]) => void)({ ok: true, eventId: payload.eventId });
    }
    return this;
  }

  public timeout(_milliseconds: number): { emit: (eventName: string, ...args: unknown[]) => this } {
    return { emit: this.emit.bind(this) };
  }

  public connect(): this {
    this.connectCalls += 1;
    this.connected = true;
    this.trigger('connect');
    return this;
  }

  public disconnect(): this {
    this.disconnectCalls += 1;
    this.connected = false;
    return this;
  }

  public disableReconnection(): void {
    this.reconnectEnabled = false;
  }

  public trigger(eventName: string, ...args: unknown[]): void {
    this.handlers.get(eventName)?.forEach((handler) => handler(...args));
  }

  public triggerAny(eventName: string, payload: unknown): void {
    this.anyHandlers.forEach((handler) => handler(eventName, payload));
  }

  public resolvePendingSync(response: TransportAck): void {
    const acknowledgement = this.pendingSyncAcknowledgement;
    this.pendingSyncAcknowledgement = undefined;
    acknowledgement?.(null, response);
  }

  public listenerCount(eventName: string): number {
    return this.handlers.get(eventName)?.size ?? 0;
  }

  public anyListenerCount(): number {
    return this.anyHandlers.size;
  }
}

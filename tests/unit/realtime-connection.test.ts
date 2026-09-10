import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type * as React from 'react';
import { ApiError, api } from '../../apps/web/src/api';
import type { ConnectionStatus, RealtimeRefreshResult } from '../../apps/web/src/realtime';

const hookState = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined }));

vi.mock('../../apps/web/node_modules/react', async (importOriginal) => {
  const actual = await importOriginal<typeof React>();
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)): void => {
      const cleanup = effect();
      hookState.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
    },
    useRef: <T>(current: T): { current: T } => ({ current })
  };
});

vi.mock('socket.io-client', () => ({ io: vi.fn() }));

const { useRealtimeConnection } = await import('../../apps/web/src/realtime');

describe('web realtime connection lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string): string | null => values.get(key) ?? null,
        setItem: (key: string, value: string): void => { values.set(key, value); },
        removeItem: (key: string): void => { values.delete(key); }
      }
    });
  });

  afterEach(() => {
    hookState.cleanup?.();
    hookState.cleanup = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.mocked(io).mockReset();
    Reflect.deleteProperty(globalThis, 'document');
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('publishes offline to mounted snapshot views after a synchronized socket disconnects', () => {
    const statuses: ConnectionStatus[] = [];
    const socket = new FakeSocket();

    vi.mocked(io).mockReturnValue(socket as unknown as Socket);
    useRealtimeConnection({
      enabled: true,
      hasSnapshot: true,
      onEvent: async () => ({ synchronized: true }),
      onAuthFailure: () => undefined,
      onStatus: (status) => statuses.push(status)
    });

    socket.trigger('connect');
    socket.trigger('connection.ready', { sync: 'UP_TO_DATE' });
    socket.connected = true;
    return vi.advanceTimersByTimeAsync(150).then(() => {
      expect(statuses.at(-1)).toBe('online');

      socket.connected = false;
      socket.trigger('disconnect', 'transport close');

      expect(statuses.at(-1)).toBe('offline');
    });
  });

  it('does not publish online after a failed refresh until a later refresh synchronizes', async () => {
    const statuses: ConnectionStatus[] = [];
    const onEvent = vi.fn<() => Promise<RealtimeRefreshResult>>()
      .mockRejectedValueOnce(new Error('refresh failed'))
      .mockResolvedValueOnce({ synchronized: true, lastSeenEventSequence: 1 });
    const socket = mountRealtime({
      onEvent,
      onAuthFailure: () => undefined,
      onStatus: (status) => statuses.push(status)
    });
    socket.onEmit = acknowledgeSync;

    socket.trigger('connect');
    socket.trigger('connection.ready', { sync: 'UP_TO_DATE' });
    await vi.advanceTimersByTimeAsync(150);

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(statuses).not.toContain('online');
    expect(statuses.at(-1)).toBe('stale');

    await vi.advanceTimersByTimeAsync(250);

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(statuses.at(-1)).toBe('online');
  });

  it('does not publish online after failed synchronization acknowledgements', async () => {
    const statuses: ConnectionStatus[] = [];
    const socket = new FakeSocket();
    let syncAttempts = 0;
    socket.onEmit = (_eventName, args) => {
      const acknowledgement = args.at(-1);
      if (typeof acknowledgement !== 'function') return;
      syncAttempts += 1;
      if (syncAttempts === 1) acknowledgement(new Error('sync failed'));
        else acknowledgement(null, { ok: true, sync: 'UP_TO_DATE' });
    };
    vi.mocked(io).mockReturnValue(socket as unknown as Socket);
    useRealtimeConnection({
      enabled: true,
      hasSnapshot: true,
      onEvent: async () => ({ synchronized: true, lastSeenEventSequence: 1 }),
      onAuthFailure: () => undefined,
      onStatus: (status) => statuses.push(status)
    });

    socket.trigger('connect');
    socket.trigger('connection.ready', { sync: 'UP_TO_DATE' });
    await vi.advanceTimersByTimeAsync(150);
    expect(statuses).not.toContain('online');

    await vi.advanceTimersByTimeAsync(250);

    expect(syncAttempts).toBe(2);
    expect(statuses.at(-1)).toBe('online');
  });

  it('passes the triggering realtime event name to the refresh callback', async () => {
    const eventNames: Array<string | undefined> = [];
    const socket = mountRealtime({
      onEvent: async (eventName) => {
        eventNames.push(eventName);
        return { synchronized: true };
      },
      onAuthFailure: () => undefined,
      onStatus: () => undefined
    });
    socket.onEmit = acknowledgeSync;

    socket.trigger('connect');
    socket.trigger('connection.ready', { sync: 'UP_TO_DATE' });
    await vi.advanceTimersByTimeAsync(150);

    socket.triggerAny('request.updated', {});
    await vi.advanceTimersByTimeAsync(150);

    expect(eventNames).toEqual([undefined, 'request.updated']);
  });

  it('passes the triggering realtime event payload to the refresh callback', async () => {
    const eventPayloads: unknown[] = [];
    const socket = mountRealtime({
      onEvent: async (_eventName, payload) => {
        eventPayloads.push(payload);
        return { synchronized: true };
      },
      onAuthFailure: () => undefined,
      onStatus: () => undefined
    });
    socket.onEmit = acknowledgeSync;
    const payload = { payload: { request: { roomId: 'room-1' } } };

    socket.trigger('connect');
    socket.trigger('connection.ready', { sync: 'UP_TO_DATE' });
    await vi.advanceTimersByTimeAsync(150);

    socket.triggerAny('request.updated', payload);
    await vi.advanceTimersByTimeAsync(150);

    expect(eventPayloads).toEqual([undefined, payload]);
  });

  it('keeps synchronization pending after a replay-available acknowledgement until a later authoritative sync', async () => {
    const statuses: ConnectionStatus[] = [];
    const onEvent = vi.fn<() => Promise<RealtimeRefreshResult>>()
      .mockResolvedValue({ synchronized: true, lastSeenEventSequence: 1 });
    let syncAttempts = 0;
    const socket = mountRealtime({
      onEvent,
      onAuthFailure: () => undefined,
      onStatus: (status) => statuses.push(status)
    });
    socket.onEmit = (_eventName, args) => {
      const acknowledgement = args.at(-1);
      if (typeof acknowledgement !== 'function') return;
      syncAttempts += 1;
      acknowledgement(null, {
        ok: true,
        sync: syncAttempts === 1 ? 'REPLAY_AVAILABLE' : 'UP_TO_DATE'
      });
    };

    socket.trigger('connect');
    socket.trigger('connection.ready', { sync: 'UP_TO_DATE' });
    await vi.advanceTimersByTimeAsync(150);

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(syncAttempts).toBe(1);
    expect(statuses).not.toContain('online');

    await vi.advanceTimersByTimeAsync(150);

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(syncAttempts).toBe(2);
    expect(statuses.at(-1)).toBe('online');
  });

  it('treats an inactive-device heartbeat response as an authentication failure', async () => {
    const onAuthFailure = vi.fn<() => void>();
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(403, { error: { code: 'DEVICE_INACTIVE' } }));
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { visibilityState: 'visible' } });

    mountRealtime({
      onEvent: async () => ({ synchronized: true }),
      onAuthFailure,
      onStatus: () => undefined,
      deviceToken: 'device-token',
      heartbeatIntervalMs: 10
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(onAuthFailure).toHaveBeenCalledOnce();
  });
});

interface RealtimeTestOptions {
  onEvent: (eventName?: string) => RealtimeRefreshResult | void | Promise<RealtimeRefreshResult | void>;
  onAuthFailure: () => void;
  onStatus: (status: ConnectionStatus) => void;
  deviceToken?: string;
  heartbeatIntervalMs?: number;
}

function mountRealtime(options: RealtimeTestOptions): FakeSocket {
  const socket = new FakeSocket();
  vi.mocked(io).mockReturnValue(socket as unknown as Socket);
  useRealtimeConnection({
    enabled: true,
    hasSnapshot: true,
    onEvent: options.onEvent,
    onAuthFailure: options.onAuthFailure,
    onStatus: options.onStatus,
    ...(options.deviceToken === undefined ? {} : { deviceToken: options.deviceToken }),
    ...(options.heartbeatIntervalMs === undefined ? {} : { heartbeatIntervalMs: options.heartbeatIntervalMs })
  });
  return socket;
}

function acknowledgeSync(_eventName: string, args: unknown[]): void {
  const acknowledgement = args.at(-1);
  if (typeof acknowledgement === 'function') acknowledgement(null, { ok: true, sync: 'UP_TO_DATE' });
}

type FakeHandler = (...args: unknown[]) => void;

class FakeSocket {
  public connected = false;
  public auth: unknown;
  public onEmit: ((eventName: string, args: unknown[]) => void) | undefined;
  private anyHandler: ((eventName: string, payload: unknown) => void) | undefined;
  private readonly handlers = new Map<string, FakeHandler>();

  public on(eventName: string, handler: FakeHandler): this {
    this.handlers.set(eventName, handler);
    return this;
  }

  public onAny(handler: (eventName: string, payload: unknown) => void): this {
    this.anyHandler = handler;
    return this;
  }

  public emit(eventName: string, ...args: unknown[]): void {
    this.onEmit?.(eventName, args);
  }

  public timeout(_timeoutMs: number): { emit: (eventName: string, ...args: unknown[]) => void } {
    return { emit: this.emit.bind(this) };
  }

  public disconnect(): void {
    this.connected = false;
  }

  public trigger(eventName: string, ...args: unknown[]): void {
    this.handlers.get(eventName)?.(...args);
  }

  public triggerAny(eventName: string, payload: unknown): void {
    this.anyHandler?.(eventName, payload);
  }
}

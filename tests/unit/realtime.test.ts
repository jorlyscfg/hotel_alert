import { describe, expect, it } from 'vitest';
import {
  buildRealtimeAuth,
  canCommitMutation,
  commitRealtimeEventCandidates,
  createRealtimeEventDeduplicator,
  resolveHeartbeatIntervalMs,
  isReactiveRealtimeEvent,
  resolveRealtimeStatus,
  resolveSyncRetryDelayMs,
  shouldProcessRealtimeEvent
} from '../../apps/web/src/realtime';

describe('web realtime handshake helpers', () => {
  it('includes the latest device cursor and configuration version', () => {
    expect(buildRealtimeAuth({
      clientInstanceId: 'client-1',
      deviceId: 'device-1',
      deviceToken: 'htl_secret',
      deviceConfigVersion: 4,
      lastSeenEventSequence: 19
    })).toEqual({
      clientInstanceId: 'client-1',
      clientVersion: '0.1.0',
      deviceId: 'device-1',
      deviceToken: 'htl_secret',
      deviceConfigVersion: 4,
      lastSeenEventSequence: 19
    });
  });

  it('omits device credentials from an administrator handshake', () => {
    expect(buildRealtimeAuth({ clientInstanceId: 'admin-client' })).toEqual({
      clientInstanceId: 'admin-client',
      clientVersion: '0.1.0'
    });
  });

  it('deduplicates durable events and enforces monotonic event sequences', () => {
    const state = createRealtimeEventDeduplicator(10);
    const event = { eventId: 'event-11', eventSequence: 11 };

    expect(shouldProcessRealtimeEvent(event, state)).toBe(true);
    expect(state.lastSeenEventSequence).toBe(10);
    expect(shouldProcessRealtimeEvent(event, state)).toBe(false);
    expect(shouldProcessRealtimeEvent({ eventId: 'event-10', eventSequence: 10 }, state)).toBe(false);
    expect(shouldProcessRealtimeEvent({ eventId: 'event-12', eventSequence: 12 }, state)).toBe(true);
  });

  it('rejects a new event with a sequence older than a pending candidate', () => {
    const state = createRealtimeEventDeduplicator(10);

    expect(shouldProcessRealtimeEvent({ eventId: 'event-11', eventSequence: 11 }, state)).toBe(true);
    expect(shouldProcessRealtimeEvent({ eventId: 'event-13', eventSequence: 13 }, state)).toBe(true);
    expect(shouldProcessRealtimeEvent({ eventId: 'event-12-copy', eventSequence: 12 }, state)).toBe(false);
  });

  it('commits pending event cursors only after a synchronized refresh', () => {
    const state = createRealtimeEventDeduplicator(10);
    const event = { eventId: 'event-11', eventSequence: 11 };

    expect(shouldProcessRealtimeEvent(event, state)).toBe(true);
    commitRealtimeEventCandidates(state, { synchronized: false, lastSeenEventSequence: 11 });
    expect(state.lastSeenEventSequence).toBe(10);
    expect(shouldProcessRealtimeEvent(event, state)).toBe(false);

    commitRealtimeEventCandidates(state, { synchronized: true, lastSeenEventSequence: 11 });
    expect(state.lastSeenEventSequence).toBe(11);
    expect(shouldProcessRealtimeEvent(event, state)).toBe(false);
  });

  it('ignores stale aggregate versions while accepting newer versions', () => {
    const state = createRealtimeEventDeduplicator(10);

    expect(shouldProcessRealtimeEvent({ eventId: 'request-v2', eventSequence: 11, aggregateType: 'REQUEST', aggregateId: 'request-1', aggregateVersion: 2 }, state)).toBe(true);
    expect(shouldProcessRealtimeEvent({ eventId: 'request-v1', eventSequence: 12, aggregateType: 'REQUEST', aggregateId: 'request-1', aggregateVersion: 1 }, state)).toBe(false);
    expect(state.highestObservedEventSequence).toBe(12);
    expect(shouldProcessRealtimeEvent({ eventId: 'request-v2-copy', eventSequence: 13, aggregateType: 'REQUEST', aggregateId: 'request-1', aggregateVersion: 2 }, state)).toBe(false);
    expect(shouldProcessRealtimeEvent({ eventId: 'request-v3', eventSequence: 14, aggregateType: 'REQUEST', aggregateId: 'request-1', aggregateVersion: 3 }, state)).toBe(true);
  });

  it('uses the server heartbeat interval when configured', () => {
    expect(resolveHeartbeatIntervalMs(5000)).toBe(5000);
    expect(resolveHeartbeatIntervalMs(undefined)).toBe(15000);
  });

  it('uses bounded exponential delays for synchronization retries', () => {
    expect(resolveSyncRetryDelayMs(0)).toBe(250);
    expect(resolveSyncRetryDelayMs(1)).toBe(500);
    expect(resolveSyncRetryDelayMs(2)).toBe(1000);
    expect(resolveSyncRetryDelayMs(20)).toBe(10_000);
    expect(resolveSyncRetryDelayMs(-1)).toBe(250);
  });

  it('distinguishes synchronized, connecting, stale, and unavailable states', () => {
    expect(resolveRealtimeStatus({ enabled: true, hasSnapshot: true, transportConnected: true, synchronized: true })).toBe('online');
    expect(resolveRealtimeStatus({ enabled: true, hasSnapshot: true, transportConnected: true, synchronized: false })).toBe('connecting');
    expect(resolveRealtimeStatus({ enabled: true, hasSnapshot: true, transportConnected: true, synchronized: true, refreshFailed: true })).toBe('stale');
    expect(resolveRealtimeStatus({ enabled: true, hasSnapshot: true, transportConnected: false, synchronized: true })).toBe('offline');
    expect(resolveRealtimeStatus({ enabled: true, hasSnapshot: true, transportConnected: false, synchronized: false })).toBe('offline');
    expect(resolveRealtimeStatus({ enabled: true, hasSnapshot: false, transportConnected: true, synchronized: true })).toBe('offline');
    expect(resolveRealtimeStatus({ enabled: false, hasSnapshot: false, transportConnected: false, synchronized: false })).toBe('offline');
  });

  it('allows server mutations only after synchronization is online', () => {
    expect(canCommitMutation('online')).toBe(true);
    expect(canCommitMutation('connecting')).toBe(false);
    expect(canCommitMutation('stale')).toBe(false);
    expect(canCommitMutation('offline')).toBe(false);
  });

  it('treats room updates as refresh-triggering realtime events', () => {
    expect(isReactiveRealtimeEvent('room.updated')).toBe(true);
    expect(isReactiveRealtimeEvent('room.deleted')).toBe(false);
  });
});

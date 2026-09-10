import { describe, expect, it } from 'vitest';
import {
  discardExpiredRoomRequests,
  enqueueRoomRequest,
  flushRoomRequestQueue,
  getRoomRequestQueue,
  type QueueStorage
} from '../../apps/web/src/offline-queue';

class MemoryStorage implements QueueStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('offline room request queue', () => {
  const queuedAt = new Date('2026-08-31T12:00:00.000Z');

  it('persists a request with its idempotency key and prevents duplicate queue entries', () => {
    const storage = new MemoryStorage();
    const input = { deviceId: 'device-1', serviceId: 'service-1', idempotencyKey: 'request-1' };

    expect(enqueueRoomRequest(input, { storage, now: queuedAt, ttlMs: 60_000 }).status).toBe('queued');
    expect(enqueueRoomRequest(input, { storage, now: queuedAt, ttlMs: 60_000 }).status).toBe('duplicate');
    expect(getRoomRequestQueue({ storage, now: queuedAt })).toEqual([{
      ...input,
      queuedAt: queuedAt.toISOString(),
      expiresAt: '2026-08-31T12:01:00.000Z',
      status: 'PENDING'
    }]);
  });

  it('marks expired entries as unsent and excludes them from automatic flushes', async () => {
    const storage = new MemoryStorage();
    enqueueRoomRequest({ deviceId: 'device-1', serviceId: 'service-1', idempotencyKey: 'request-expired' }, {
      storage,
      now: queuedAt,
      ttlMs: 60_000
    });

    const expired = getRoomRequestQueue({ storage, now: new Date('2026-08-31T12:01:00.001Z'), deviceId: 'device-1' });
    expect(expired[0]?.status).toBe('EXPIRED_UNSENT');

    const submit = async () => undefined;
    const result = await flushRoomRequestQueue(submit, {
      storage,
      now: new Date('2026-08-31T12:01:00.001Z'),
      deviceId: 'device-1'
    });
    expect(result.attempted).toBe(0);
    expect(getRoomRequestQueue({ storage, now: new Date('2026-08-31T12:01:00.001Z') })).toHaveLength(1);

    expect(discardExpiredRoomRequests({ storage, now: new Date('2026-08-31T12:01:00.001Z'), deviceId: 'device-1' })).toBe(1);
    expect(getRoomRequestQueue({ storage, now: new Date('2026-08-31T12:01:00.001Z') })).toEqual([]);
  });

  it('keeps the queue bounded without silently dropping existing entries', () => {
    const storage = new MemoryStorage();
    const options = { storage, now: queuedAt, ttlMs: 60_000, maxItems: 2 };

    expect(enqueueRoomRequest({ deviceId: 'device-1', serviceId: 'service-1', idempotencyKey: 'request-1' }, options).status).toBe('queued');
    expect(enqueueRoomRequest({ deviceId: 'device-1', serviceId: 'service-2', idempotencyKey: 'request-2' }, options).status).toBe('queued');
    expect(enqueueRoomRequest({ deviceId: 'device-1', serviceId: 'service-3', idempotencyKey: 'request-3' }, options).status).toBe('full');
    expect(getRoomRequestQueue({ storage, now: queuedAt })).toHaveLength(2);
  });

  it('removes successfully submitted entries but retains retryable failures with the same key', async () => {
    const storage = new MemoryStorage();
    enqueueRoomRequest({ deviceId: 'device-1', serviceId: 'service-1', idempotencyKey: 'request-success' }, { storage, now: queuedAt, ttlMs: 60_000 });
    enqueueRoomRequest({ deviceId: 'device-1', serviceId: 'service-2', idempotencyKey: 'request-retry' }, { storage, now: queuedAt, ttlMs: 60_000 });
    const submitted: string[] = [];

    const result = await flushRoomRequestQueue(async (entry) => {
      submitted.push(entry.idempotencyKey);
      if (entry.idempotencyKey === 'request-retry') throw new Error('network unavailable');
    }, { storage, now: queuedAt, deviceId: 'device-1' });

    expect(result).toEqual({ attempted: 2, succeeded: 1, failed: 1, discarded: 0 });
    expect(submitted).toEqual(['request-success', 'request-retry']);
    expect(getRoomRequestQueue({ storage, now: queuedAt })).toHaveLength(1);
    expect(getRoomRequestQueue({ storage, now: queuedAt })[0]?.idempotencyKey).toBe('request-retry');
  });

  it('discards a server-rejected entry and stops before sending later entries', async () => {
    const storage = new MemoryStorage();
    enqueueRoomRequest({ deviceId: 'device-1', serviceId: 'service-1', idempotencyKey: 'request-rejected' }, { storage, now: queuedAt, ttlMs: 60_000 });
    enqueueRoomRequest({ deviceId: 'device-1', serviceId: 'service-2', idempotencyKey: 'request-after-rejected' }, { storage, now: queuedAt, ttlMs: 60_000 });
    const submitted: string[] = [];

    const result = await flushRoomRequestQueue(async (entry) => {
      submitted.push(entry.idempotencyKey);
      throw new Error('invalid request');
    }, {
      storage,
      now: queuedAt,
      deviceId: 'device-1',
      shouldRetry: () => false,
      stopOnError: () => true
    });

    expect(result).toEqual({ attempted: 1, succeeded: 0, failed: 1, discarded: 1 });
    expect(submitted).toEqual(['request-rejected']);
    expect(getRoomRequestQueue({ storage, now: queuedAt })[0]?.idempotencyKey).toBe('request-after-rejected');
  });
});

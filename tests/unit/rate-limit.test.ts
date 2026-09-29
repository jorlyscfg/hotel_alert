import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../apps/server/src/errors';
import { createRateLimiter } from '../../apps/server/src/http/rate-limit';

describe('rate-limit middleware', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('bounds buckets and evicts expired keys before admitting a new key', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T12:00:00.000Z'));
    const limiter = createRateLimiter({
      name: 'test',
      limit: 1,
      windowMs: 1_000,
      maxBuckets: 1,
      key: (request) => request.ip ?? 'unknown'
    });

    const first = invoke(limiter, 'client-a');
    const second = invoke(limiter, 'client-b');

    expect(first.next).toHaveBeenCalledWith();
    expect(second.next).toHaveBeenCalledOnce();
    expect(second.next.mock.calls[0]?.[0]).toBeInstanceOf(AppError);
    expect((second.next.mock.calls[0]?.[0] as AppError).code).toBe('RATE_LIMITED');

    vi.advanceTimersByTime(1_000);
    const afterExpiry = invoke(limiter, 'client-b');

    expect(afterExpiry.next).toHaveBeenCalledWith();
  });
});

function invoke(limiter: ReturnType<typeof createRateLimiter>, ip: string) {
  const next = vi.fn();
  const response = { setHeader: vi.fn() } as unknown as Response;
  limiter({ ip } as Request, response, next);
  return { next, response };
}

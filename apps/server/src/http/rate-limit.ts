import type { Request, RequestHandler } from 'express';
import { AppError } from '../errors';
import type { Principal } from '../security/principal';

interface RateLimitOptions {
  name: string;
  limit: number;
  windowMs: number;
  maxBuckets?: number;
  key: (request: Request) => string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const DEFAULT_MAX_BUCKETS = 10_000;

export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();
  const maxBuckets = options.maxBuckets ?? DEFAULT_MAX_BUCKETS;

  return (request, response, next) => {
    const now = Date.now();
    const key = `${options.name}:${options.key(request)}`;
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }

    const current = buckets.get(key);
    if (current === undefined && buckets.size >= maxBuckets) {
      const earliestResetAt = Math.min(...Array.from(buckets.values(), (bucket) => bucket.resetAt));
      const retryAfterSeconds = Math.max(1, Math.ceil((earliestResetAt - now) / 1000));
      response.setHeader('Retry-After', retryAfterSeconds.toString());
      next(new AppError('RATE_LIMITED', 'Too many requests. Try again later.', 429, { retryAfterSeconds }));
      return;
    }

    const bucket = current ?? { count: 0, resetAt: now + options.windowMs };

    if (bucket.count >= options.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      response.setHeader('Retry-After', retryAfterSeconds.toString());
      next(new AppError('RATE_LIMITED', 'Too many requests. Try again later.', 429, { retryAfterSeconds }));
      return;
    }

    bucket.count += 1;
    buckets.set(key, bucket);
    next();
  };
}

export function sourceIpKey(request: Request): string {
  return request.ip ?? 'unknown';
}

export function principalKey(request: Request): string {
  const principal = request.principal;
  if (principal === undefined) return sourceIpKey(request);
  return principalIdentity(principal);
}

function principalIdentity(principal: Principal): string {
  switch (principal.kind) {
    case 'ADMIN':
      return `admin:${principal.adminId}`;
    case 'DEVICE':
      return `device:${principal.deviceId}`;
    case 'SYSTEM':
      return 'system';
  }
}

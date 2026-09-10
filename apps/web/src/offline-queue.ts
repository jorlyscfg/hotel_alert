export const ROOM_REQUEST_QUEUE_STORAGE_KEY = 'hotel-local-room-request-queue';
export const DEFAULT_ROOM_REQUEST_QUEUE_TTL_MS = 48 * 60 * 60 * 1000;
export const DEFAULT_ROOM_REQUEST_QUEUE_MAX_ITEMS = 100;

export type QueuedRoomRequestStatus = 'PENDING' | 'EXPIRED_UNSENT';

export interface QueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface QueuedRoomRequest {
  deviceId: string;
  serviceId: string;
  idempotencyKey: string;
  queuedAt: string;
  expiresAt: string;
  status: QueuedRoomRequestStatus;
}

interface StoredRoomRequest {
  deviceId: string;
  serviceId: string;
  idempotencyKey: string;
  queuedAt: string;
  expiresAt: string;
}

interface StoredQueue {
  version: 1;
  items: StoredRoomRequest[];
}

interface QueueReadOptions {
  storage?: QueueStorage | null;
  now?: Date;
  deviceId?: string;
}

export interface EnqueueRoomRequestInput {
  deviceId: string;
  serviceId: string;
  idempotencyKey: string;
}

export interface EnqueueRoomRequestOptions extends QueueReadOptions {
  ttlMs?: number;
  maxItems?: number;
}

export type EnqueueRoomRequestResult =
  | { status: 'queued'; item: QueuedRoomRequest }
  | { status: 'duplicate'; item: QueuedRoomRequest }
  | { status: 'full' }
  | { status: 'unavailable' };

export interface FlushRoomRequestQueueOptions extends QueueReadOptions {
  shouldRetry?: (error: unknown) => boolean;
  stopOnError?: (error: unknown) => boolean;
}

export interface FlushRoomRequestQueueResult {
  attempted: number;
  succeeded: number;
  failed: number;
  discarded: number;
}

export function getRoomRequestQueue(options: QueueReadOptions = {}): QueuedRoomRequest[] {
  const storage = resolveStorage(options.storage);
  if (storage === null) return [];
  try {
    return toQueuedRequests(readStoredQueue(storage), options.now ?? new Date(), options.deviceId);
  } catch {
    return [];
  }
}

export function enqueueRoomRequest(input: EnqueueRoomRequestInput, options: EnqueueRoomRequestOptions = {}): EnqueueRoomRequestResult {
  const storage = resolveStorage(options.storage);
  if (storage === null) return { status: 'unavailable' };

  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? DEFAULT_ROOM_REQUEST_QUEUE_TTL_MS;
  const maxItems = options.maxItems ?? DEFAULT_ROOM_REQUEST_QUEUE_MAX_ITEMS;
  if (!isValidRequestInput(input) || !Number.isFinite(ttlMs) || ttlMs <= 0 || !Number.isInteger(maxItems) || maxItems < 1) {
    return { status: 'unavailable' };
  }

  try {
    const stored = readStoredQueue(storage);
    const existing = stored.find((item) => item.idempotencyKey === input.idempotencyKey);
    if (existing !== undefined) {
      return { status: 'duplicate', item: toQueuedRequest(existing, now) };
    }
    if (stored.length >= maxItems) return { status: 'full' };

    const item: StoredRoomRequest = {
      ...input,
      queuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString()
    };
    writeStoredQueue(storage, { version: 1, items: [...stored, item] });
    return { status: 'queued', item: toQueuedRequest(item, now) };
  } catch {
    return { status: 'unavailable' };
  }
}

export function discardRoomRequest(idempotencyKey: string, options: QueueReadOptions = {}): boolean {
  const storage = resolveStorage(options.storage);
  if (storage === null) return false;
  try {
    const stored = readStoredQueue(storage);
    const remaining = stored.filter((item) => item.idempotencyKey !== idempotencyKey);
    if (remaining.length === stored.length) return false;
    writeStoredQueue(storage, { version: 1, items: remaining });
    return true;
  } catch {
    return false;
  }
}

export function discardExpiredRoomRequests(options: QueueReadOptions = {}): number {
  const storage = resolveStorage(options.storage);
  if (storage === null) return 0;
  const now = options.now ?? new Date();
  try {
    const stored = readStoredQueue(storage);
    const expired = stored.filter((item) => {
      const matchesDevice = options.deviceId === undefined || item.deviceId === options.deviceId;
      return matchesDevice && toQueuedRequest(item, now).status === 'EXPIRED_UNSENT';
    });
    if (expired.length === 0) return 0;
    const expiredKeys = new Set(expired.map((item) => item.idempotencyKey));
    writeStoredQueue(storage, { version: 1, items: stored.filter((item) => !expiredKeys.has(item.idempotencyKey)) });
    return expired.length;
  } catch {
    return 0;
  }
}

export async function flushRoomRequestQueue(
  submit: (item: QueuedRoomRequest) => Promise<unknown>,
  options: FlushRoomRequestQueueOptions = {}
): Promise<FlushRoomRequestQueueResult> {
  const queue = getRoomRequestQueue(options);
  const result: FlushRoomRequestQueueResult = { attempted: 0, succeeded: 0, failed: 0, discarded: 0 };
  for (const item of queue) {
    if (item.status !== 'PENDING') continue;
    result.attempted += 1;
    try {
      await submit(item);
      if (discardRoomRequest(item.idempotencyKey, options)) result.succeeded += 1;
    } catch (error) {
      result.failed += 1;
      if (options.shouldRetry?.(error) === false && discardRoomRequest(item.idempotencyKey, options)) {
        result.discarded += 1;
      }
      if (options.stopOnError?.(error) === true) break;
    }
  }
  return result;
}

function resolveStorage(storage: QueueStorage | null | undefined): QueueStorage | null {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function readStoredQueue(storage: QueueStorage): StoredRoomRequest[] {
  const raw = storage.getItem(ROOM_REQUEST_QUEUE_STORAGE_KEY);
  if (raw === null) return [];
  const parsed: unknown = JSON.parse(raw) as unknown;
  if (!isStoredQueue(parsed)) return [];
  return parsed.items;
}

function writeStoredQueue(storage: QueueStorage, queue: StoredQueue): void {
  storage.setItem(ROOM_REQUEST_QUEUE_STORAGE_KEY, JSON.stringify(queue));
}

function toQueuedRequests(items: StoredRoomRequest[], now: Date, deviceId: string | undefined): QueuedRoomRequest[] {
  return items
    .filter((item) => deviceId === undefined || item.deviceId === deviceId)
    .map((item) => toQueuedRequest(item, now));
}

function toQueuedRequest(item: StoredRoomRequest, now: Date): QueuedRoomRequest {
  return {
    ...item,
    status: new Date(item.expiresAt).getTime() <= now.getTime() ? 'EXPIRED_UNSENT' : 'PENDING'
  };
}

function isValidRequestInput(input: EnqueueRoomRequestInput): boolean {
  return input.deviceId.trim().length > 0 && input.serviceId.trim().length > 0 && input.idempotencyKey.trim().length > 0;
}

function isStoredQueue(value: unknown): value is StoredQueue {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { version?: unknown; items?: unknown };
  return candidate.version === 1 && Array.isArray(candidate.items) && candidate.items.every(isStoredRoomRequest);
}

function isStoredRoomRequest(value: unknown): value is StoredRoomRequest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StoredRoomRequest>;
  return typeof candidate.deviceId === 'string'
    && typeof candidate.serviceId === 'string'
    && typeof candidate.idempotencyKey === 'string'
    && typeof candidate.queuedAt === 'string'
    && typeof candidate.expiresAt === 'string'
    && Number.isFinite(new Date(candidate.queuedAt).getTime())
    && Number.isFinite(new Date(candidate.expiresAt).getTime());
}

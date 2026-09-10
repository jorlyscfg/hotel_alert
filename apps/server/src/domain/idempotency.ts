import { AppError } from '../errors';

export function validateIdempotencyKey(value: string | undefined): string {
  if (value === undefined || value.length < 1 || value.length > 128) {
    throw new AppError('VALIDATION_ERROR', 'Idempotency-Key must contain 1 to 128 characters.', 422);
  }
  return value;
}

export function assertIdempotencyKeyMatches(
  storedOperation: string,
  storedRequestHash: string,
  operation: string,
  requestHash: string
): void {
  if (storedOperation !== operation || storedRequestHash !== requestHash) {
    throw new AppError('IDEMPOTENCY_KEY_REUSE_MISMATCH', 'Idempotency key reuse does not match the original request.', 409);
  }
}

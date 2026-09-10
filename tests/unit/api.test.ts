import { describe, expect, it } from 'vitest';
import {
  acknowledgeDeviceTokenRotation,
  ApiError,
  claimDeviceTokenRotation,
  errorMessage,
  getSafeRequestId,
  getSafeRequestReference,
  isDeviceAuthFailure,
  isDeviceInvalidationError,
  startupErrorMessage
} from '../../apps/web/src/api';

describe('web API error helpers', () => {
  it('uses the authenticated device token rotation endpoints', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ path: string; method: string | undefined; authorization: string | null; body: string }> = [];
    globalThis.fetch = async (input, init) => {
      const path = String(input);
      const headers = new Headers(init?.headers);
      requests.push({
        path,
        method: init?.method,
        authorization: headers.get('authorization'),
        body: String(init?.body ?? '')
      });
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => path.endsWith('/claim')
          ? { data: { rotationId: 'rotation-1', deviceToken: 'replacement-token', tokenPrefix: 'replacem' }, requestId: 'req-claim' }
          : { data: { rotationId: 'rotation-1', acknowledged: true }, requestId: 'req-ack' }
      } as Response;
    };

    try {
      await expect(claimDeviceTokenRotation('rotation-1', 'current-token')).resolves.toEqual({
        rotationId: 'rotation-1',
        deviceToken: 'replacement-token',
        tokenPrefix: 'replacem'
      });
      await expect(acknowledgeDeviceTokenRotation('rotation-1', 'replacement-token')).resolves.toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests).toEqual([
      {
        path: '/api/v1/device/token-rotation/claim',
        method: 'POST',
        authorization: 'Bearer current-token',
        body: JSON.stringify({ rotationId: 'rotation-1' })
      },
      {
        path: '/api/v1/device/token-rotation/acknowledge',
        method: 'POST',
        authorization: 'Bearer replacement-token',
        body: JSON.stringify({ rotationId: 'rotation-1' })
      }
    ]);
  });

  it('recognizes only HTTP 403 DEVICE_INACTIVE as device invalidation', () => {
    expect(isDeviceInvalidationError(new ApiError(403, { error: { code: 'DEVICE_INACTIVE' } }))).toBe(true);
    expect(isDeviceInvalidationError(new ApiError(403, { error: { code: 'FORBIDDEN_ASSIGNMENT' } }))).toBe(false);
    expect(isDeviceInvalidationError(new ApiError(401, { error: { code: 'DEVICE_INACTIVE' } }))).toBe(false);
  });

  it('treats 401 and only the inactive-device 403 as device auth failures', () => {
    expect(isDeviceAuthFailure(new ApiError(401, { error: { code: 'DEVICE_TOKEN_REVOKED' } }))).toBe(true);
    expect(isDeviceAuthFailure(new ApiError(403, { error: { code: 'DEVICE_INACTIVE' } }))).toBe(true);
    expect(isDeviceAuthFailure(new ApiError(403, { error: { code: 'FORBIDDEN_ASSIGNMENT' } }))).toBe(false);
    expect(isDeviceAuthFailure(new ApiError(500, { error: { code: 'INTERNAL_ERROR' } }))).toBe(false);
  });

  it('adds only a safe API request reference to the shared error message', () => {
    const error = new ApiError(500, {
      error: {
        message: 'The operation could not be completed.',
        requestId: 'req_123',
        details: { token: 'secret-token', headers: { authorization: 'Bearer secret-token' }, stack: 'private stack' }
      }
    });

    expect(getSafeRequestReference(error)).toBe('req_123');
    expect(errorMessage(error)).toBe('The operation could not be completed. Reference ID: req_123.');
    expect(errorMessage(error)).not.toContain('secret-token');
    expect(errorMessage(error)).not.toContain('private stack');
  });

  it('preserves API messages when no safe request reference exists', () => {
    const error = new ApiError(500, { error: { message: 'Try again later.', requestId: 'req 123' } });

    expect(getSafeRequestReference(error)).toBeNull();
    expect(errorMessage(error)).toBe('Try again later.');
  });

  it('localizes the request reference suffix without exposing unsafe identifiers', () => {
    const error = new ApiError(500, {
      error: {
        message: 'No se pudo completar la operación.',
        requestId: 'req_123'
      }
    });

    expect(errorMessage(error, 'Inténtalo de nuevo.', 'es')).toBe('Algo salió mal. Inténtalo de nuevo. ID de referencia: req_123.');
    expect(startupErrorMessage(error, 'es')).toBe('El servicio local no está disponible. El reintento automático continuará con una espera limitada. ID de referencia: req_123.');
    expect(getSafeRequestId('req_123')).toBe('req_123');
    expect(getSafeRequestId('req 123')).toBeNull();
    expect(getSafeRequestId('<script>')).toBeNull();
  });

  it('keeps startup failures generic while adding only an opaque reference', () => {
    const error = new ApiError(503, {
      error: {
        message: 'Database connection details',
        requestId: 'req_bootstrap',
        details: { connectionString: 'private' }
      }
    });

    expect(startupErrorMessage(error)).toBe('The local service is unavailable. Automatic retry will continue with bounded backoff. Reference ID: req_bootstrap.');
    expect(startupErrorMessage(new Error('stack trace with secret-token'))).toBe('The local service is unavailable. Automatic retry will continue with bounded backoff.');
  });

  it('does not expose arbitrary client error messages', () => {
    expect(errorMessage(new Error('stack trace with secret-token'), 'Try again safely.')).toBe('Try again safely.');
  });
});

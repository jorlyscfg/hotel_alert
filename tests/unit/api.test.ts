import { describe, expect, it } from 'vitest';
import {
  acknowledgeDeviceTokenRotation,
  api,
  ApiError,
  claimDeviceTokenRotation,
  deleteInformationImage,
  errorMessage,
  fetchDeviceInformationImageContent,
  getInformationImages,
  getSafeRequestId,
  getSafeRequestReference,
  isDeviceAuthFailure,
  isDeviceInvalidationError,
  repairInformationImageVariants,
  reorderInformationImages,
  startupErrorMessage,
  uploadInformationImage
} from '../../apps/web/src/api';

describe('web API error helpers', () => {
  it('sends cookies only for cookie-authenticated API calls', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ path: string; credentials: RequestCredentials | undefined; authorization: string | null }> = [];
    globalThis.fetch = async (input, init) => {
      const path = String(input);
      requests.push({
        path,
        credentials: init?.credentials,
        authorization: new Headers(init?.headers).get('authorization')
      });
      if (path.includes('/content')) {
        return { ok: true, status: 200, headers: new Headers(), blob: async () => new Blob(['image']) } as Response;
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ data: {}, requestId: 'req-auth' }) } as Response;
    };

    try {
      await api.get('/admin/session');
      await api.get('/device/session', { token: 'device-token' });
      await fetchDeviceInformationImageContent('image-1', 'device-token');
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests).toEqual([
      { path: '/api/v1/admin/session', credentials: 'include', authorization: null },
      { path: '/api/v1/device/session', credentials: 'omit', authorization: 'Bearer device-token' },
      { path: '/api/v1/device/information/images/image-1/content', credentials: 'omit', authorization: 'Bearer device-token' }
    ]);
  });

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

  it('uses multipart uploads and typed information image mutations', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ path: string; method: string | undefined; contentType: string | null; body: string }> = [];
    globalThis.fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      requests.push({
        path: String(input),
        method: init?.method,
        contentType: headers.get('content-type'),
        body: init?.body instanceof FormData ? 'form-data' : String(init?.body ?? '')
      });
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ data: [], requestId: 'req-information' })
      } as Response;
    };

    try {
      await uploadInformationImage(new Blob([Buffer.from('image')], { type: 'image/png' }), { headers: { 'X-CSRF-Token': 'csrf', 'Idempotency-Key': 'upload' } });
      await getInformationImages({ headers: { 'X-CSRF-Token': 'csrf', 'Idempotency-Key': 'list' } });
      await reorderInformationImages(['image-1'], { headers: { 'X-CSRF-Token': 'csrf', 'Idempotency-Key': 'order' } });
      await deleteInformationImage('image-1', { headers: { 'X-CSRF-Token': 'csrf', 'Idempotency-Key': 'delete' } });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests).toEqual([
      { path: '/api/v1/information/images', method: 'POST', contentType: null, body: 'form-data' },
      { path: '/api/v1/information/images', method: 'GET', contentType: null, body: '' },
      { path: '/api/v1/information/images/order', method: 'PATCH', contentType: 'application/json', body: JSON.stringify({ ids: ['image-1'] }) },
      { path: '/api/v1/information/images/image-1', method: 'DELETE', contentType: null, body: '' }
    ]);
  });

  it('uploads named image variants and requests a selected device variant', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ path: string; fields: string[] }> = [];
    globalThis.fetch = async (input, init) => {
      const body = init?.body;
      requests.push({
        path: String(input),
        fields: body instanceof FormData ? Array.from(body.keys()) : []
      });
      if (String(input).includes('/content')) {
        return { ok: true, status: 200, headers: new Headers(), blob: async () => new Blob(['image'], { type: 'image/png' }) } as Response;
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ data: {}, requestId: 'req-variants' }) } as Response;
    };

    try {
      await uploadInformationImage({
        square480: new Blob(['square'], { type: 'image/png' }),
        wide: new Blob(['wide'], { type: 'image/png' })
      });
      await fetchDeviceInformationImageContent('image-1', 'device-token', { variant: 'square480' });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests).toEqual([
      { path: '/api/v1/information/images', fields: ['square480', 'wide'] },
      { path: '/api/v1/device/information/images/image-1/content?variant=square480', fields: [] }
    ]);
  });

  it('uploads language-tagged carousel assets, repairs a missing English asset, and requests locale plus size', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ path: string; method: string | undefined; fields: string[] }> = [];
    globalThis.fetch = async (input, init) => {
      const body = init?.body;
      requests.push({
        path: String(input),
        method: init?.method,
        fields: body instanceof FormData ? Array.from(body.keys()) : []
      });
      if (String(input).includes('/content')) {
        return { ok: true, status: 200, headers: new Headers(), blob: async () => new Blob(['image'], { type: 'image/png' }) } as Response;
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ data: {}, requestId: 'req-localized-images' }) } as Response;
    };

    try {
      await uploadInformationImage({
        'en-square480': new Blob(['en compact'], { type: 'image/png' }),
        'en-wide': new Blob(['en wide'], { type: 'image/png' }),
        'es-wide': new Blob(['es wide'], { type: 'image/png' })
      });
      await repairInformationImageVariants('image-1', { 'en-wide': new Blob(['fixed en'], { type: 'image/png' }) });
      await fetchDeviceInformationImageContent('image-1', 'device-token', { language: 'en', variant: 'square480' });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests).toEqual([
      { path: '/api/v1/information/images', method: 'POST', fields: ['en-square480', 'en-wide', 'es-wide'] },
      { path: '/api/v1/information/images/image-1/variants', method: 'POST', fields: ['en-wide'] },
      { path: '/api/v1/device/information/images/image-1/content?variant=square480&language=en', method: 'GET', fields: [] }
    ]);
  });

  it('recognizes confirmed inactive and revoked device credentials as invalidation', () => {
    expect(isDeviceInvalidationError(new ApiError(403, { error: { code: 'DEVICE_INACTIVE' } }))).toBe(true);
    expect(isDeviceInvalidationError(new ApiError(403, { error: { code: 'FORBIDDEN_ASSIGNMENT' } }))).toBe(false);
    expect(isDeviceInvalidationError(new ApiError(401, { error: { code: 'DEVICE_INACTIVE' } }))).toBe(false);
    expect(isDeviceInvalidationError(new ApiError(401, { error: { code: 'DEVICE_TOKEN_REVOKED' } }))).toBe(true);
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

  it('localizes native request command failures instead of showing a generic error', () => {
    expect(errorMessage(new Error('REQUEST_VERSION_CONFLICT'), 'Fallback', 'es'))
      .toBe('Esta pantalla está desactualizada. Actualiza e inténtalo de nuevo.');
    expect(errorMessage(new Error('POST_NOTIFICATIONS_DENIED'), 'Fallback', 'es'))
      .toContain('notificaciones de Android');
  });
});

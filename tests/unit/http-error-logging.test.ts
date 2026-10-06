import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestStartSchema } from '@hotel/shared';
import { AppError } from '../../apps/server/src/errors';
import { createBodyValidationError, createHttpErrorHandler } from '../../apps/server/src/http/app';

describe('HTTP error diagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs safe metadata for expected client errors without request or personal data', () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = createResponse();
    const handler = createHttpErrorHandler();
    const req = createRequest();

    handler(new AppError('VALIDATION_ERROR', 'Responsible Isabel failed validation.', 422), req, response, () => undefined);

    expect(log).toHaveBeenCalledOnce();
    const record = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(record).toEqual({
      event: 'http.error',
      requestId: 'http_test_12345678',
      method: 'POST',
      route: '/requests/:requestId/start',
      status: 422,
      code: 'VALIDATION_ERROR',
      errorClass: 'AppError',
      severity: 'warn'
    });
    expect(JSON.stringify(record)).not.toContain('Isabel');
    expect(JSON.stringify(record)).not.toContain('tablet-secret');
    expect(JSON.stringify(record)).not.toContain('actual-request-id');
    expect(record).not.toHaveProperty('body');
    expect(record).not.toHaveProperty('headers');
    expect(record).not.toHaveProperty('message');
    expect(record).not.toHaveProperty('stack');
    expect(response.status).toHaveBeenCalledWith(422);
  });

  it('logs unexpected server errors without their message or stack', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = createResponse();
    const handler = createHttpErrorHandler();
    const req = createRequest();

    handler(new Error('database token=tablet-secret for Isabel'), req, response, () => undefined);

    expect(log).toHaveBeenCalledOnce();
    const record = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(record).toEqual({
      event: 'http.error',
      requestId: 'http_test_12345678',
      method: 'POST',
      route: '/requests/:requestId/start',
      status: 500,
      code: 'INTERNAL_ERROR',
      errorClass: 'Error',
      severity: 'error'
    });
    expect(JSON.stringify(record)).not.toContain('tablet-secret');
    expect(JSON.stringify(record)).not.toContain('Isabel');
    expect(JSON.stringify(record)).not.toContain('database');
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected server error occurred.',
        requestId: 'http_test_12345678'
      }
    });
  });

  it('logs allowlisted validation paths and issue categories without submitted values', () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = createResponse();
    const handler = createHttpErrorHandler();
    const req = createRequest();
    const result = requestStartSchema.safeParse({
      expectedVersion: 'submitted-version-secret',
      responsibleName: '   ',
      'unknown-field-secret': 'unknown-value-secret'
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected schema validation to fail.');

    handler(createBodyValidationError(result.error), req, response, () => undefined);

    expect(log).toHaveBeenCalledOnce();
    const record = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(record).toMatchObject({
      code: 'VALIDATION_ERROR',
      validation: {
        issueCount: 3,
        issues: expect.arrayContaining([
          { fieldPath: 'expectedVersion', code: 'invalid_type', category: 'type' },
          { fieldPath: 'responsibleName', code: 'too_small', category: 'minimum' },
          { fieldPath: 'requestBody', code: 'unrecognized_keys', category: 'unknown_fields' }
        ])
      }
    });
    const serialized = JSON.stringify(record);
    for (const secret of [
      'Isabel',
      'submitted-version-secret',
      'unknown-field-secret',
      'unknown-value-secret',
      'tablet-secret',
      'actual-request-id'
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(record).not.toHaveProperty('body');
    expect(record).not.toHaveProperty('headers');
    expect(response.status).toHaveBeenCalledWith(422);
    expect(response.json).toHaveBeenCalledWith({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request body failed validation.',
        details: result.error.flatten(),
        requestId: 'http_test_12345678'
      }
    });
  });

  it.each([
    {
      message: 'Idempotency-Key must contain 1 to 128 characters.',
      fieldPath: 'headers.idempotency-key',
      code: 'length_1_to_128',
      category: 'constraint'
    },
    {
      message: 'A responsible name is required when starting a request.',
      fieldPath: 'responsibleName',
      code: 'required',
      category: 'required'
    },
    {
      message: 'A responsible name must contain between 1 and 120 characters.',
      fieldPath: 'responsibleName',
      code: 'length_1_to_120',
      category: 'constraint'
    }
  ])('logs safe diagnostics for known request-start validation: $fieldPath/$code', ({ message, fieldPath, code, category }) => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = createResponse();
    const handler = createHttpErrorHandler();
    const req = createRequest();
    const error = new AppError('VALIDATION_ERROR', message, 422, {
      responsibleName: 'Isabel private-name-secret',
      idempotencyKey: 'tablet-secret',
      dynamicFieldSecret: 'dynamic-value-secret'
    });

    handler(error, req, response, () => undefined);

    expect(log).toHaveBeenCalledOnce();
    const record = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(record).toMatchObject({
      code: 'VALIDATION_ERROR',
      validation: {
        issueCount: 1,
        omittedIssueCount: 0,
        issues: [{ fieldPath, code, category }]
      }
    });
    const serialized = JSON.stringify(record);
    for (const secret of [
      'Idempotency-Key must contain',
      'A responsible name',
      'Isabel',
      'private-name-secret',
      'tablet-secret',
      'dynamicFieldSecret',
      'dynamic-value-secret',
      'actual-request-id'
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(record).not.toHaveProperty('details');
    expect(record).not.toHaveProperty('headers');
    expect(record).not.toHaveProperty('body');
    expect(record).not.toHaveProperty('stack');
    expect(response.status).toHaveBeenCalledWith(422);
    expect(response.json).toHaveBeenCalledWith({
      error: {
        code: 'VALIDATION_ERROR',
        message,
        details: error.details,
        requestId: 'http_test_12345678'
      }
    });
  });

  it('logs a safe route-parameter diagnostic without the request ID value', () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = createResponse();
    const handler = createHttpErrorHandler();
    const req = createRequest();
    const error = new AppError('VALIDATION_ERROR', 'requestId is required.', 422, { requestId: 'actual-request-id' });

    handler(error, req, response, () => undefined);

    expect(log).toHaveBeenCalledOnce();
    const record = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(record).toMatchObject({
      code: 'VALIDATION_ERROR',
      validation: {
        issueCount: 1,
        omittedIssueCount: 0,
        issues: [{ fieldPath: 'routeParams.requestId', code: 'required', category: 'required' }]
      }
    });
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain('actual-request-id');
    expect(serialized).not.toContain('requestId is required.');
    expect(record).not.toHaveProperty('details');
    expect(record).not.toHaveProperty('body');
    expect(record).not.toHaveProperty('headers');
    expect(record).not.toHaveProperty('stack');
    expect(response.status).toHaveBeenCalledWith(422);
    expect(response.json).toHaveBeenCalledWith({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'requestId is required.',
        details: error.details,
        requestId: 'http_test_12345678'
      }
    });
  });
});

function createRequest(): Request {
  return {
    requestId: 'http_test_12345678',
    method: 'POST',
    route: { path: '/requests/:requestId/start' },
    originalUrl: '/api/v1/requests/actual-request-id/start?token=tablet-secret',
    headers: { authorization: 'Bearer tablet-secret' },
    body: { responsibleName: 'Isabel' }
  } as unknown as Request;
}

function createResponse(): Response {
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis()
  };
  return response as unknown as Response;
}

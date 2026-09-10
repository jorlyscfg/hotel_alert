import type { ErrorCode } from '@hotel/shared';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details: unknown;

  public constructor(code: ErrorCode, message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function notFound(resource: string): AppError {
  return new AppError('RESOURCE_NOT_FOUND', `${resource} was not found.`, 404);
}

export function validationError(message: string, details?: unknown): AppError {
  return new AppError('VALIDATION_ERROR', message, 422, details);
}

export function conflictError(message: string, details?: unknown): AppError {
  return new AppError('RESOURCE_CONFLICT', message, 409, details);
}

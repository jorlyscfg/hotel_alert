import { createTranslator, type Locale, type MessageKey } from './i18n';
import { INFORMATION_IMAGE_LANGUAGES, INFORMATION_IMAGE_VARIANTS, type ClaimedTokenResult, type InformationImageDTO, type InformationImageLanguage, type InformationImageVariant } from '@hotel/shared';

export interface ApiEnvelope<T> {
  data: T;
  requestId: string;
  idempotentReplay?: boolean;
  configurationRevision?: number;
  page?: { nextCursor: string | null; hasMore: boolean };
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
    requestId?: string;
  };
}

export interface RequestOptions {
  token?: string;
  headers?: HeadersInit;
  signal?: AbortSignal;
  cache?: RequestCache;
}

const SAFE_REQUEST_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LOCAL_SERVICE_UNAVAILABLE_MESSAGE = 'The local service is unavailable. Automatic retry will continue with bounded backoff.';

const API_ERROR_MESSAGE_KEYS: Record<string, MessageKey> = {
  AUTH_REQUIRED: 'errors.authRequired',
  AUTH_INVALID: 'errors.authInvalid',
  AUTH_LOCKED: 'errors.authLocked',
  FORBIDDEN_ASSIGNMENT: 'errors.forbiddenAssignment',
  DEVICE_INACTIVE: 'errors.deviceInactive',
  DEVICE_CONTROL_NOT_CONFIGURED: 'errors.serviceUnavailable',
  DEVICE_CONTROL_UNAVAILABLE: 'errors.serviceUnavailable',
  DEVICE_CONTROL_REJECTED: 'errors.internal',
  DEVICE_CONTROL_INVALID_RESPONSE: 'errors.internal',
  DEVICE_TOKEN_REVOKED: 'errors.deviceTokenRevoked',
  AUTH_AMBIGUOUS_CREDENTIALS: 'errors.authInvalid',
  INACTIVE_DEPENDENCY: 'errors.inactiveDependency',
  ACTIVE_DEPENDENCIES: 'errors.activeDependencies',
  VERSION_CONFLICT: 'errors.versionConflict',
  TOKEN_ROTATION_EXPIRED: 'errors.tokenRotationExpired',
  TOKEN_ROTATION_MISMATCH: 'errors.tokenRotationMismatch',
  SETTING_INVALID: 'errors.settingInvalid',
  VALIDATION_ERROR: 'errors.validation',
  RESOURCE_NOT_FOUND: 'errors.notFound',
  RESOURCE_CONFLICT: 'errors.resourceConflict',
  REQUEST_INVALID_TRANSITION: 'errors.invalidTransition',
  REQUEST_VERSION_CONFLICT: 'errors.versionConflict',
  IDEMPOTENCY_KEY_REUSE_MISMATCH: 'errors.idempotencyMismatch',
  RATE_LIMITED: 'errors.rateLimited',
  DATABASE_UNAVAILABLE: 'errors.databaseUnavailable',
  INTERNAL_ERROR: 'errors.internal'
};

const NATIVE_ERROR_MESSAGE_KEYS: Record<string, MessageKey> = {
  NATIVE_DEVICE_COMMANDS_UNAVAILABLE: 'device.nativeDeviceCommandsUnavailable',
  INVALID_REQUEST_COMMAND: 'errors.requestUpdateFailed',
  NATIVE_REQUEST_COMMAND_REJECTED: 'errors.requestUpdateFailed',
  NATIVE_REQUEST_COMMAND_FAILED: 'errors.requestUpdateFailed',
  NATIVE_REQUEST_COMMAND_TIMEOUT: 'errors.serviceUnavailable',
  INVALID_NATIVE_REQUEST_COMMAND_STATUS: 'errors.requestUpdateFailed',
  UNKNOWN_REQUEST_COMMAND: 'errors.requestUpdateFailed',
  DEVICE_INACTIVE: 'errors.deviceInactive',
  DEVICE_TOKEN_REVOKED: 'errors.deviceTokenRevoked',
  FORBIDDEN_ASSIGNMENT: 'errors.forbiddenAssignment',
  REQUEST_VERSION_CONFLICT: 'errors.versionConflict',
  REQUEST_INVALID_TRANSITION: 'errors.invalidTransition',
  IDEMPOTENCY_KEY_REUSE_MISMATCH: 'errors.idempotencyMismatch',
  POST_NOTIFICATIONS_DENIED: 'errors.notificationPermissionDenied'
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly details: unknown;

  constructor(status: number, body: ApiErrorBody | null) {
    const message = body?.error?.message ?? `Request failed with status ${status}.`;
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error?.code ?? 'INTERNAL_ERROR';
    this.requestId = body?.error?.requestId;
    this.details = body?.error?.details;
  }
}

export function isApiError(error: unknown, status?: number): error is ApiError {
  return error instanceof ApiError && (status === undefined || error.status === status);
}

export function isDeviceInvalidationError(error: unknown): error is ApiError {
  return isApiError(error) && (
    (error.status === 403 && error.code === 'DEVICE_INACTIVE')
    || (error.status === 401 && error.code === 'DEVICE_TOKEN_REVOKED')
  );
}

export function isDeviceAuthFailure(error: unknown): error is ApiError {
  return isApiError(error, 401) || isDeviceInvalidationError(error);
}

export function getSafeRequestReference(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  return getSafeRequestId(error.requestId);
}

export function getSafeRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const requestId = value.trim();
  return SAFE_REQUEST_REFERENCE_PATTERN.test(requestId) ? requestId : null;
}

export function shortSafeRequestId(value: unknown): string | null {
  const requestId = getSafeRequestId(value);
  return requestId === null ? null : requestId.length > 8 ? requestId.slice(-8) : requestId;
}

export function startupErrorMessage(error: unknown, locale: Locale = 'en'): string {
  const message = locale === 'en' ? LOCAL_SERVICE_UNAVAILABLE_MESSAGE : createTranslator(locale)('errors.serviceUnavailable');
  return appendRequestReference(message, error, locale);
}

async function request<T>(path: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<ApiEnvelope<T>> {
  const headers = new Headers(init.headers ?? options.headers);
  if (init.body !== undefined && !headers.has('content-type') && !(typeof FormData !== 'undefined' && init.body instanceof FormData)) {
    headers.set('content-type', 'application/json');
  }
  if (options.token !== undefined) {
    headers.set('authorization', `Bearer ${options.token}`);
  }

  const requestInit: RequestInit = {
    ...init,
    credentials: options.token === undefined ? 'include' : 'omit',
    headers
  };
  if (options.signal !== undefined) requestInit.signal = options.signal;
  if (options.cache !== undefined) requestInit.cache = options.cache;
  const response = await fetch(`/api/v1${path}`, requestInit);

  if (response.status === 204) {
    return { data: undefined as T, requestId: response.headers.get('x-request-id') ?? 'no-content' };
  }

  const body = await response.json().catch(() => null) as ApiEnvelope<T> | ApiErrorBody | null;
  if (!response.ok) {
    throw new ApiError(response.status, body as ApiErrorBody | null);
  }
  return body as ApiEnvelope<T>;
}

export const api = {
  get<T>(path: string, options?: RequestOptions): Promise<ApiEnvelope<T>> {
    return request<T>(path, { method: 'GET' }, options);
  },
  post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<ApiEnvelope<T>> {
    return request<T>(path, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, options);
  },
  patch<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<ApiEnvelope<T>> {
    return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }, options);
  },
  delete<T>(path: string, options: RequestOptions = {}): Promise<ApiEnvelope<T>> {
    return request<T>(path, { method: 'DELETE' }, options);
  }
};

export type InformationImageUploadField = InformationImageVariant | `${InformationImageLanguage}-${InformationImageVariant}`;
export type InformationImageUploadSet = Partial<Record<InformationImageUploadField, Blob>>;

export function uploadInformationImage(file: Blob | InformationImageUploadSet, options: RequestOptions = {}): Promise<ApiEnvelope<InformationImageDTO>> {
  const formData = createInformationImageFormData(file);
  return request<InformationImageDTO>('/information/images', { method: 'POST', body: formData }, options);
}

export function uploadRoomBackgroundImage(file: Blob, options: RequestOptions = {}): Promise<ApiEnvelope<{ updated: true }>> {
  const formData = new FormData();
  formData.append('image', file, 'room-background');
  return request<{ updated: true }>('/settings/room-background', { method: 'POST', body: formData }, options);
}

export function repairInformationImageVariants(id: string, files: InformationImageUploadSet, options: RequestOptions = {}): Promise<ApiEnvelope<InformationImageDTO>> {
  const formData = createInformationImageFormData(files);
  return request<InformationImageDTO>(`/information/images/${encodeURIComponent(id)}/variants`, { method: 'POST', body: formData }, options);
}

export function getInformationImages(options: RequestOptions = {}): Promise<ApiEnvelope<InformationImageDTO[]>> {
  return api.get<InformationImageDTO[]>('/information/images', options);
}

export function reorderInformationImages(ids: string[], options: RequestOptions = {}): Promise<ApiEnvelope<InformationImageDTO[]>> {
  return api.patch<InformationImageDTO[]>('/information/images/order', { ids }, options);
}

export function deleteInformationImage(id: string, options: RequestOptions = {}): Promise<ApiEnvelope<{ deleted: true }>> {
  return api.delete<{ deleted: true }>(`/information/images/${encodeURIComponent(id)}`, options);
}

export function getDeviceInformationImages(token: string, options: RequestOptions = {}): Promise<ApiEnvelope<InformationImageDTO[]>> {
  return api.get<InformationImageDTO[]>('/device/information/images', { ...options, token });
}

export function setDeviceInformationScreensaver(enabled: boolean, token: string, options: RequestOptions = {}): Promise<ApiEnvelope<{ command: 'screenSaverOff' | 'screenSaverOn'; executed: true }>> {
  return api.post(`/device/information/screensaver/${enabled ? 'on' : 'off'}`, undefined, { ...options, token });
}

export interface InformationImageContentOptions extends RequestOptions {
  variant?: InformationImageVariant;
  language?: InformationImageLanguage;
}

export async function fetchDeviceInformationImageContent(id: string, token: string, options: InformationImageContentOptions = {}): Promise<Blob> {
  const headers = new Headers(options.headers);
  headers.set('authorization', `Bearer ${token}`);
  const query = new URLSearchParams();
  if (options.variant !== undefined) query.set('variant', options.variant);
  if (options.language !== undefined) query.set('language', options.language);
  const queryString = query.size === 0 ? '' : `?${query.toString()}`;
  const requestInit: RequestInit = {
    method: 'GET',
    credentials: 'omit',
    headers
  };
  if (options.signal !== undefined) requestInit.signal = options.signal;
  if (options.cache !== undefined) requestInit.cache = options.cache;
  const response = await fetch(`/api/v1/device/information/images/${encodeURIComponent(id)}/content${queryString}`, requestInit);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as ApiErrorBody | null;
    throw new ApiError(response.status, body);
  }
  return response.blob();
}

function createInformationImageFormData(file: Blob | InformationImageUploadSet): FormData {
  const formData = new FormData();
  if (file instanceof Blob) {
    const fileName = 'name' in file && typeof file.name === 'string' ? file.name : 'information-image';
    formData.append('image', file, fileName);
    return formData;
  }
  INFORMATION_IMAGE_VARIANTS.forEach((variant) => appendInformationImageVariant(formData, variant, file[variant]));
  INFORMATION_IMAGE_LANGUAGES.forEach((language) => INFORMATION_IMAGE_VARIANTS.forEach((variant) => {
    const field = `${language}-${variant}` as const;
    appendInformationImageVariant(formData, field, file[field]);
  }));
  return formData;
}

function appendInformationImageVariant(formData: FormData, variant: InformationImageUploadField, file: Blob | undefined): void {
  if (file === undefined) return;
  const fileName = 'name' in file && typeof file.name === 'string' ? file.name : `information-${variant}`;
  formData.append(variant, file, fileName);
}

export async function claimDeviceTokenRotation(rotationId: string, currentToken: string): Promise<ClaimedTokenResult> {
  const result = await api.post<ClaimedTokenResult>('/device/token-rotation/claim', { rotationId }, { token: currentToken });
  return result.data;
}

export async function acknowledgeDeviceTokenRotation(rotationId: string, replacementToken: string): Promise<void> {
  await api.post('/device/token-rotation/acknowledge', { rotationId }, { token: replacementToken });
}

export function errorMessage(error: unknown, fallback = 'Something went wrong. Try again.', locale?: Locale): string {
  if (error instanceof ApiError) {
    if (locale !== undefined) {
      const translate = createTranslator(locale);
      const key = API_ERROR_MESSAGE_KEYS[error.code];
      const message = key === undefined ? fallback : translate(key);
      return appendRequestReference(message, error, locale);
    }
    if (error.code === 'VERSION_CONFLICT' || error.code === 'REQUEST_VERSION_CONFLICT' || error.code === 'RESOURCE_CONFLICT') {
      return appendRequestReference('This screen is out of date. Refresh and try again.', error, 'en');
    }
    return appendRequestReference(error.message, error, 'en');
  }
  if (error instanceof Error) {
    if (locale !== undefined) {
      const key = NATIVE_ERROR_MESSAGE_KEYS[error.message];
      if (key !== undefined) return createTranslator(locale)(key);
    }
    return fallback;
  }
  return fallback;
}

function appendRequestReference(message: string, error: unknown, locale: Locale): string {
  const requestId = getSafeRequestReference(error);
  if (requestId === null) return message;
  const reference = createTranslator(locale)('errors.requestReference', { requestId });
  return `${message} ${reference}`;
}

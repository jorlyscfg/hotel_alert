import * as Shared from '@hotel/shared';
import type { AdminLoginResult, DeviceAssignmentMode, DeviceSyncSnapshot, PendingTokenRotation } from '@hotel/shared';
import type { Locale } from './i18n';

const { isRoomBackgroundValue } = Shared;

export type DeviceMode = DeviceAssignmentMode;

const STARTUP_RETRY_BASE_DELAY_MS = 250;
const STARTUP_RETRY_MAX_DELAY_MS = 10_000;

export interface DeviceAssignmentPayload {
  assignmentMode: DeviceAssignmentMode;
  roomId: string | null;
  areaId: string | null;
  expectedDeviceConfigVersion: number;
  reason: string;
}

export function mutationSucceeded<T>(result: { data: T } | null): result is { data: T } {
  return result !== null;
}

export function resolveStartupRetryDelayMs(attempt: number): number {
  const normalizedAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return Math.min(STARTUP_RETRY_MAX_DELAY_MS, STARTUP_RETRY_BASE_DELAY_MS * 2 ** normalizedAttempt);
}

export function shouldRetryStartup(attempt: number): boolean {
  return Number.isFinite(attempt) && Number.isInteger(attempt) && attempt >= 0;
}

export const DEVICE_TOKEN_STORAGE_KEY = 'hotel-local-device-token';
export const ADMIN_SESSION_STORAGE_KEY = 'hotel-local-admin-session';
export const DEVICE_PENDING_TOKEN_ROTATION_STORAGE_KEY = 'hotel-local-pending-token-rotation';
export const DEVICE_ID_STORAGE_KEY = 'hotel-local-device-id';
export const DEVICE_SYNC_STATE_STORAGE_KEY = 'hotel-local-device-sync-state';
export const DEVICE_SNAPSHOT_STORAGE_KEY = 'hotel-local-device-snapshot';
const INSTALLATION_ID_STORAGE_KEY = 'hotel-local-installation-id';
const CLIENT_INSTANCE_ID_STORAGE_KEY = 'hotel-local-client-instance-id';

export interface LocalDeviceSyncState {
  deviceId: string;
  lastSeenEventSequence: number;
  configurationRevision: number;
  deviceConfigVersion: number;
}

export interface LocalAdminSession {
  result: AdminLoginResult;
  installationId: string | null;
}

export interface PendingDeviceTokenRotation {
  rotationId: string;
  deviceToken: string;
}

export interface DeviceTokenRotationClient {
  claim(rotationId: string, currentToken: string): Promise<PendingDeviceTokenRotation>;
  acknowledge(rotationId: string, replacementToken: string): Promise<void>;
}

export function formatElapsed(value: string, now = new Date(), locale: Locale = 'en'): string {
  const elapsedMs = Math.max(0, now.getTime() - new Date(value).getTime());
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return locale === 'es' ? 'ahora' : 'just now';
  const hours = Math.floor(minutes / 60);
  if (locale === 'en') {
    if (hours === 0) return `${minutes}m`;
    return `${hours}h ${minutes % 60}m`;
  }
  if (hours === 0) return `${minutes} min`;
  return `${hours} h ${minutes % 60} min`;
}

export function formatElapsedWithAgo(value: string, now: Date, locale: Locale, ago: string): string {
  const elapsed = formatElapsed(value, now, locale);
  if (elapsed === 'just now' || elapsed === 'ahora') return elapsed;
  return locale === 'es' ? `${ago} ${elapsed}` : `${elapsed} ${ago}`;
}

export function getDeviceMode(device: Pick<{ assignmentMode: DeviceAssignmentMode }, 'assignmentMode'>): DeviceMode {
  return device.assignmentMode;
}

export function buildDeviceAssignmentPayload(device: Pick<{ deviceConfigVersion: number }, 'deviceConfigVersion'>, values: { assignmentMode: DeviceAssignmentMode; roomId: string; areaId: string; reason: string }): DeviceAssignmentPayload {
  return {
    assignmentMode: values.assignmentMode,
    roomId: values.assignmentMode === 'ROOM' ? values.roomId : null,
    areaId: values.assignmentMode === 'AREA' ? values.areaId : null,
    expectedDeviceConfigVersion: device.deviceConfigVersion,
    reason: values.reason
  };
}

export function buildLocalDeviceSyncState(deviceId: string, values: Omit<LocalDeviceSyncState, 'deviceId'>): LocalDeviceSyncState {
  return { deviceId, ...values };
}

export function serializeLocalDeviceSyncState(state: LocalDeviceSyncState): string {
  return JSON.stringify(state);
}

export function serializeLocalDeviceSnapshot(snapshot: DeviceSyncSnapshot): string {
  return JSON.stringify(snapshot);
}

export function serializeAdminSession(session: LocalAdminSession): string {
  return JSON.stringify(session);
}

export function parseAdminSession(raw: string): LocalAdminSession | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || !isRecord(value['result'])) return null;
    const result = value['result'];
    if (!isRecord(result['admin'])) return null;
    const admin = result['admin'];
    const csrfToken = result['csrfToken'];
    const adminId = admin['id'];
    const username = admin['username'];
    const expiresAt = admin['expiresAt'];
    const installationId = value['installationId'];
    if (!isNonEmptyString(csrfToken) || !isNonEmptyString(adminId) || !isNonEmptyString(username) || !isNonEmptyString(expiresAt) || !isNullableString(installationId)) return null;
    return {
      result: {
        admin: { id: adminId, username, expiresAt },
        csrfToken
      },
      installationId
    };
  } catch {
    return null;
  }
}

export function parseLocalDeviceSnapshot(raw: string, expectedDeviceId: string): DeviceSyncSnapshot | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isDeviceSyncSnapshot(value) || value.device.id !== expectedDeviceId) return null;
    return value;
  } catch {
    return null;
  }
}

export interface LocalStorageReader {
  getItem(key: string): string | null;
}

export interface LocalStorageWriter extends LocalStorageReader {
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export async function completeDeviceTokenRotation(
  rotation: Pick<PendingTokenRotation, 'rotationId'>,
  currentToken: string,
  client: DeviceTokenRotationClient,
  storage: LocalStorageWriter
): Promise<string> {
  const stored = readPendingDeviceTokenRotation(storage);
  const replacementValue: unknown = stored?.rotationId === rotation.rotationId
    ? stored
    : await client.claim(rotation.rotationId, currentToken);

  if (!isRecord(replacementValue) || !isNonEmptyString(replacementValue['rotationId']) || !isNonEmptyString(replacementValue['deviceToken']) || replacementValue['rotationId'] !== rotation.rotationId) {
    throw new Error('The device token rotation response is invalid.');
  }
  const replacement: PendingDeviceTokenRotation = {
    rotationId: replacementValue['rotationId'],
    deviceToken: replacementValue['deviceToken']
  };

  if (stored?.rotationId !== rotation.rotationId) {
    storage.setItem(DEVICE_PENDING_TOKEN_ROTATION_STORAGE_KEY, serializePendingDeviceTokenRotation(replacement));
  }
  await client.acknowledge(rotation.rotationId, replacement.deviceToken);
  storage.setItem(DEVICE_TOKEN_STORAGE_KEY, replacement.deviceToken);
  storage.removeItem(DEVICE_PENDING_TOKEN_ROTATION_STORAGE_KEY);
  return replacement.deviceToken;
}

export function serializePendingDeviceTokenRotation(rotation: PendingDeviceTokenRotation): string {
  return JSON.stringify(rotation);
}

export function parsePendingDeviceTokenRotation(raw: string): PendingDeviceTokenRotation | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || !isNonEmptyString(value['rotationId']) || !isNonEmptyString(value['deviceToken'])) return null;
    return { rotationId: value['rotationId'], deviceToken: value['deviceToken'] };
  } catch {
    return null;
  }
}

export function readPendingDeviceTokenRotation(storage: LocalStorageReader): PendingDeviceTokenRotation | null {
  try {
    const raw = storage.getItem(DEVICE_PENDING_TOKEN_ROTATION_STORAGE_KEY);
    return raw === null ? null : parsePendingDeviceTokenRotation(raw);
  } catch {
    return null;
  }
}

export function readLocalDeviceSnapshot(storage: LocalStorageReader, expectedDeviceId: string | null): DeviceSyncSnapshot | null {
  if (expectedDeviceId === null) return null;
  try {
    const raw = storage.getItem(DEVICE_SNAPSHOT_STORAGE_KEY);
    return raw === null ? null : parseLocalDeviceSnapshot(raw, expectedDeviceId);
  } catch {
    return null;
  }
}

export function parseLocalDeviceSyncState(raw: string, expectedDeviceId: string): LocalDeviceSyncState | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isLocalDeviceSyncState(value) || value.deviceId !== expectedDeviceId) return null;
    return value;
  } catch {
    return null;
  }
}

export function makeMutationKey(operation: string): string {
  return `${operation}-${createBrowserUuid()}`;
}

export function getOrCreateInstallationId(): string {
  return getOrCreateBrowserId(INSTALLATION_ID_STORAGE_KEY, 'install');
}

export function getOrCreateClientInstanceId(): string {
  return getOrCreateBrowserId(CLIENT_INSTANCE_ID_STORAGE_KEY, 'client');
}

function getOrCreateBrowserId(storageKey: string, prefix: string): string {
  const existing = localStorage.getItem(storageKey);
  if (existing !== null && existing.length > 0) return existing;
  const value = `${prefix}-${createBrowserUuid()}`;
  localStorage.setItem(storageKey, value);
  return value;
}

function createBrowserUuid(): string {
  const browserCrypto = globalThis.crypto;
  if (typeof browserCrypto.randomUUID === 'function') return browserCrypto.randomUUID();

  const bytes = new Uint8Array(16);
  browserCrypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isLocalDeviceSyncState(value: unknown): value is LocalDeviceSyncState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['deviceId'] === 'string'
    && candidate['deviceId'].length > 0
    && isNonNegativeInteger(candidate['lastSeenEventSequence'])
    && isNonNegativeInteger(candidate['configurationRevision'])
    && isNonNegativeInteger(candidate['deviceConfigVersion']);
}

function isDeviceSyncSnapshot(value: unknown): value is DeviceSyncSnapshot {
  if (!isRecord(value) || !isRecord(value['device']) || !isRecord(value['config']) || !Array.isArray(value['activeRequests'])) return false;
  const device = value['device'];
  const config = value['config'];
  return isNonNegativeInteger(value['snapshotSequence'])
    && isNonNegativeInteger(value['currentEventSequence'])
    && isNonNegativeInteger(value['configurationRevision'])
    && isNonNegativeInteger(value['deviceConfigVersion'])
    && typeof value['serverTime'] === 'string'
    && isDeviceSnapshotDevice(device)
    && device['deviceConfigVersion'] === value['deviceConfigVersion']
    && isDeviceSnapshotConfig(config)
     && config['mode'] === device['assignmentMode']
     && value['activeRequests'].every(isDeviceSnapshotRequest)
     && (value['activeDoNotDisturbRooms'] === undefined || (Array.isArray(value['activeDoNotDisturbRooms']) && value['activeDoNotDisturbRooms'].every(isCompactRoomReference)))
     && (value['pendingTokenRotation'] === null || isDeviceSnapshotTokenRotation(value['pendingTokenRotation']));
}

function isDeviceSnapshotDevice(value: Record<string, unknown>): boolean {
  return isNonEmptyString(value['id'])
    && isNonEmptyString(value['installationId'])
    && isNonEmptyString(value['displayName'])
    && (value['assignmentMode'] === 'ROOM' || value['assignmentMode'] === 'AREA')
    && isNullableString(value['roomId'])
    && isNullableString(value['areaId'])
    && typeof value['active'] === 'boolean'
    && isNonNegativeInteger(value['deviceConfigVersion'])
    && isNullableString(value['lastHeartbeatAt'])
    && isDevicePresence(value['presence'])
    && (value['assignmentMode'] === 'ROOM' ? typeof value['roomId'] === 'string' && value['areaId'] === null : value['roomId'] === null && typeof value['areaId'] === 'string');
}

function isDeviceSnapshotConfig(value: Record<string, unknown>): boolean {
  return (value['mode'] === 'ROOM' || value['mode'] === 'AREA')
    && (value['room'] === null || isCompactRoomReference(value['room']))
    && (value['area'] === null || isCompactReference(value['area']))
     && isNonEmptyString(value['hotelName'])
     && isNullableString(value['hotelLogo'])
      && isRoomBackgroundValue(value['roomBackground'])
     && (value['clockFormat'] === '12h' || value['clockFormat'] === '24h')
    && Array.isArray(value['services'])
    && value['services'].every(isDeviceSnapshotService)
    && (value['areas'] === undefined || (Array.isArray(value['areas']) && value['areas'].every(isCompactReference)))
    && isPositiveInteger(value['offlineQueueTtlHours'])
    && isPositiveInteger(value['heartbeatIntervalMs'])
    && isPositiveInteger(value['heartbeatStaleAfterMs'])
    && isPositiveInteger(value['heartbeatOfflineAfterMs'])
    && isPositiveInteger(value['pendingAlertIntervalMs']);
}

function isDeviceSnapshotService(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value['id'])
    && isNonEmptyString(value['code'])
    && isNonEmptyString(value['displayName'])
    && isNullableString(value['description'])
    && isNullableString(value['iconKey'])
    && isNonEmptyString(value['areaId'])
    && typeof value['active'] === 'boolean'
    && isNonNegativeInteger(value['displayOrder'])
    && typeof value['createdAt'] === 'string'
    && typeof value['updatedAt'] === 'string';
}

function isDeviceSnapshotRequest(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value['id'])
    && isNonEmptyString(value['roomId'])
    && isNonEmptyString(value['serviceId'])
    && isNonEmptyString(value['responsibleAreaId'])
    && isCompactRoomReference(value['room'])
     && isCompactServiceReference(value['service'])
    && isCompactReference(value['responsibleArea'])
    && isRequestStatus(value['status'])
    && isNonNegativeInteger(value['version'])
    && isNullableString(value['acceptedAt'])
    && isNullableString(value['inProgressAt'])
    && isNullableString(value['completedAt'])
    && typeof value['createdAt'] === 'string'
    && typeof value['updatedAt'] === 'string';
}

function isDeviceSnapshotTokenRotation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value['rotationId'])
    && (value['state'] === 'ROTATION_PENDING' || value['state'] === 'CLAIMED')
    && typeof value['graceExpiresAt'] === 'string';
}

function isCompactReference(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value['id']) && isNonEmptyString(value['code']) && isNonEmptyString(value['displayName']);
}

function isCompactRoomReference(value: unknown): boolean {
  return isCompactReference(value) && isRecord(value) && typeof value['doNotDisturb'] === 'boolean';
}

function isCompactServiceReference(value: unknown): boolean {
  return isCompactReference(value) && isRecord(value) && isNullableString(value['iconKey']);
}

function isDevicePresence(value: unknown): boolean {
  return value === 'ONLINE' || value === 'STALE' || value === 'OFFLINE' || value === 'DISABLED';
}

function isRequestStatus(value: unknown): boolean {
  return value === 'PENDING' || value === 'ACCEPTED' || value === 'IN_PROGRESS' || value === 'COMPLETED';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

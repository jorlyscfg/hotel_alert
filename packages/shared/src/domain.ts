export const APP_MODES = ['ROOM', 'AREA', 'ADMIN'] as const;
export type AppMode = (typeof APP_MODES)[number];

export const DEVICE_ASSIGNMENT_MODES = ['ROOM', 'AREA'] as const;
export type DeviceAssignmentMode = (typeof DEVICE_ASSIGNMENT_MODES)[number];

export const REQUEST_STATUSES = ['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const DEVICE_PRESENCE = ['ONLINE', 'STALE', 'OFFLINE', 'DISABLED'] as const;
export type DevicePresence = (typeof DEVICE_PRESENCE)[number];

export const INFORMATION_IMAGE_VARIANTS = ['square480', 'wide'] as const;
export type InformationImageVariant = (typeof INFORMATION_IMAGE_VARIANTS)[number];
export const INFORMATION_IMAGE_LANGUAGES = ['en', 'es'] as const;
export type InformationImageLanguage = (typeof INFORMATION_IMAGE_LANGUAGES)[number];

export const ACTOR_TYPES = ['ADMIN', 'DEVICE', 'SYSTEM'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const ICON_KEYS = ['towels', 'food', 'drink', 'housekeeping', 'maintenance', 'concierge', 'spa', 'bell'] as const;
export type IconKey = (typeof ICON_KEYS)[number];

export const LEGAL_REQUEST_TRANSITIONS: Readonly<Record<RequestStatus, readonly RequestStatus[]>> = {
  // ACCEPTED is retained for records created by older server versions. New
  // AREA consoles move a request directly from pending to in-process.
  PENDING: ['ACCEPTED', 'IN_PROGRESS'],
  ACCEPTED: ['IN_PROGRESS'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: []
};

export function isLegalRequestTransition(from: RequestStatus, to: RequestStatus): boolean {
  return LEGAL_REQUEST_TRANSITIONS[from].includes(to);
}

export interface SettingValues {
  'heartbeat.intervalMs': number;
  'heartbeat.staleAfterMs': number;
  'heartbeat.offlineAfterMs': number;
  'alerts.pendingRepeatMs': number;
  'realtime.replayMinMinutes': number;
  'realtime.replayMaxEvents': number;
  'requests.pageSizeDefault': number;
  'requests.historyRetentionDays': number;
  'idempotency.retentionHours': number;
  'client.offlineQueueTtlHours': number;
  'audit.retentionDays': number;
  hotelName: string;
  /** Explicit ROOM-facing English value; empty on legacy settings until manually completed. */
  hotelNameEn: string;
  hotelLogo: string | null;
  roomBackground: RoomBackgroundValue;
  clockFormat: '12h' | '24h';
  'information.idleTimeoutSeconds': number;
  'information.slideIntervalSeconds': number;
}

export interface RoomBackgroundVariants {
  square480: string;
  tablet: string;
}

export type RoomBackgroundValue = string | RoomBackgroundVariants | null;

export type SettingKey = keyof SettingValues;
export type SettingValue = SettingValues[SettingKey];
export type SettingChangeSet = Partial<SettingValues>;

export const DEFAULT_SETTINGS: SettingValues = {
  'heartbeat.intervalMs': 15000,
  'heartbeat.staleAfterMs': 45000,
  'heartbeat.offlineAfterMs': 90000,
  'alerts.pendingRepeatMs': 5000,
  'realtime.replayMinMinutes': 60,
  'realtime.replayMaxEvents': 100000,
  'requests.pageSizeDefault': 50,
  'requests.historyRetentionDays': 365,
  'idempotency.retentionHours': 72,
  'client.offlineQueueTtlHours': 48,
  'audit.retentionDays': 180,
  hotelName: 'Hotel Local',
  hotelNameEn: '',
  hotelLogo: null,
  roomBackground: null,
  clockFormat: '12h',
  'information.idleTimeoutSeconds': 5,
  'information.slideIntervalSeconds': 5
};

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingKey[];
export const MAX_HOTEL_LOGO_LENGTH = 60 * 1024;
export const MAX_ROOM_BACKGROUND_LENGTH = 120 * 1024;
const LOCAL_IMAGE_PATTERN = /^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;

const NUMERIC_SETTING_BOUNDS: Readonly<Record<Exclude<SettingKey, 'hotelName' | 'hotelNameEn' | 'hotelLogo' | 'roomBackground' | 'clockFormat'>, readonly [number, number]>> = {
  'heartbeat.intervalMs': [5000, 60000],
  'heartbeat.staleAfterMs': [15000, 300000],
  'heartbeat.offlineAfterMs': [15000, 3600000],
  'alerts.pendingRepeatMs': [1000, 60000],
  'realtime.replayMinMinutes': [60, 10080],
  'realtime.replayMaxEvents': [100000, 10000000],
  'requests.pageSizeDefault': [10, 100],
  'requests.historyRetentionDays': [7, 3650],
  'idempotency.retentionHours': [24, 720],
  'client.offlineQueueTtlHours': [1, 719],
  'audit.retentionDays': [30, 3650],
  'information.idleTimeoutSeconds': [1, 300],
  'information.slideIntervalSeconds': [1, 300]
};

type NumericSettingKey = keyof typeof NUMERIC_SETTING_BOUNDS;

export function isSettingKey(value: string): value is SettingKey {
  return SETTING_KEYS.includes(value as SettingKey);
}

export interface SettingValidationFailure {
  key: string;
  message: string;
}

export interface SettingValidationSuccess {
  ok: true;
  values: SettingValues;
}

export interface SettingValidationError {
  ok: false;
  errors: SettingValidationFailure[];
}

export type SettingValidationResult = SettingValidationSuccess | SettingValidationError;

export function isValidSettingValue(key: SettingKey, value: unknown): value is SettingValue {
  const parsed = parseSettingValue(key, value);
  if (parsed === undefined) return false;
  return !isNumericSettingKey(key) || isWithinBounds(key, parsed);
}

export function validateSettings(changes: Record<string, unknown>, current: SettingValues): SettingValidationResult {
  const next: SettingValues = { ...current };
  const errors: SettingValidationFailure[] = [];

  for (const [key, value] of Object.entries(changes)) {
    if (!isSettingKey(key)) {
      errors.push({ key, message: 'Unknown setting key.' });
      continue;
    }
    const parsed = parseSettingValue(key, value);
    if (parsed === undefined) {
      errors.push({ key, message: settingValueErrorMessage(key) });
      continue;
    }
    Object.assign(next, { [key]: parsed });
  }

  for (const key of Object.keys(NUMERIC_SETTING_BOUNDS) as NumericSettingKey[]) {
    const value = next[key];
    const [minimum, maximum] = NUMERIC_SETTING_BOUNDS[key];
    if (value < minimum || value > maximum) {
      errors.push({ key, message: `Value must be between ${minimum} and ${maximum}.` });
    }
  }

  if (('hotelName' in changes || 'hotelNameEn' in changes) && (next.hotelName.trim().length === 0 || next.hotelNameEn.trim().length === 0)) {
    errors.push({ key: 'hotelNameEn', message: 'Provide both Spanish and English hotel names.' });
  }

  if (next['heartbeat.staleAfterMs'] < next['heartbeat.intervalMs']) {
    errors.push({ key: 'heartbeat.staleAfterMs', message: 'Stale threshold must be at least the heartbeat interval.' });
  }
  if (next['heartbeat.offlineAfterMs'] < next['heartbeat.staleAfterMs']) {
    errors.push({ key: 'heartbeat.offlineAfterMs', message: 'Offline threshold must be at least the stale threshold.' });
  }
  if (next['client.offlineQueueTtlHours'] >= next['idempotency.retentionHours']) {
    errors.push({ key: 'client.offlineQueueTtlHours', message: 'Offline queue TTL must be shorter than idempotency retention.' });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, values: next };
}

function parseSettingValue(key: SettingKey, value: unknown): SettingValue | undefined {
  if (isNumericSettingKey(key)) return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
  if (key === 'hotelName') {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    return normalized.length > 0 && normalized.length <= 120 ? normalized : undefined;
  }
  if (key === 'hotelNameEn') {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    return normalized.length > 0 && normalized.length <= 120 ? normalized : undefined;
  }
  if (key === 'hotelLogo') {
    if (value === null) return null;
    return isLocalImageDataUrl(value, MAX_HOTEL_LOGO_LENGTH) ? value : undefined;
  }
  if (key === 'roomBackground') {
    return isRoomBackgroundValue(value) ? value : undefined;
  }
  return value === '12h' || value === '24h' ? value : undefined;
}

export function isRoomBackgroundValue(value: unknown): value is RoomBackgroundValue {
  if (value === null) return true;
  if (isLocalImageDataUrl(value, MAX_HOTEL_LOGO_LENGTH)) return true;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const variants = value as Record<string, unknown>;
  return Object.keys(variants).length === 2
    && isLocalImageDataUrl(variants['square480'], MAX_ROOM_BACKGROUND_LENGTH)
    && isLocalImageDataUrl(variants['tablet'], MAX_ROOM_BACKGROUND_LENGTH)
    && typeof variants['square480'] === 'string'
    && typeof variants['tablet'] === 'string'
    && variants['square480'].length + variants['tablet'].length < MAX_ROOM_BACKGROUND_LENGTH;
}

function isLocalImageDataUrl(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length < maximumLength && LOCAL_IMAGE_PATTERN.test(value);
}

function isNumericSettingKey(key: SettingKey): key is NumericSettingKey {
  return key in NUMERIC_SETTING_BOUNDS;
}

function isWithinBounds(key: NumericSettingKey, value: SettingValue): boolean {
  if (typeof value !== 'number') return false;
  const [minimum, maximum] = NUMERIC_SETTING_BOUNDS[key];
  return value >= minimum && value <= maximum;
}

function settingValueErrorMessage(key: SettingKey): string {
  if (isNumericSettingKey(key)) return 'Setting value must be an integer.';
  if (key === 'hotelName') return 'Hotel name must be a non-empty string of at most 120 characters.';
  if (key === 'hotelNameEn') return 'English hotel name must be a non-empty string of at most 120 characters.';
  if (key === 'hotelLogo') return `Hotel logo must be a local base64 image under ${MAX_HOTEL_LOGO_LENGTH / 1024} KB or null.`;
  if (key === 'roomBackground') return `Room background must be a legacy local base64 image under ${MAX_HOTEL_LOGO_LENGTH / 1024} KB, two local base64 variants under ${MAX_ROOM_BACKGROUND_LENGTH / 1024} KB total, or null.`;
  return 'Clock format must be 12h or 24h.';
}

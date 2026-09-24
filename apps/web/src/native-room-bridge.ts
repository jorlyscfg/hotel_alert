export type NativeRoomPresenceState = 'IDLE' | 'STARTING' | 'CONNECTING' | 'ONLINE' | 'RETRYING' | 'INVALIDATED' | 'STOPPED';

export interface NativeRoomSessionPayload {
  deviceId: string;
  deviceToken: string;
}

export interface NativeRoomPresenceBridge {
  getCapabilities: () => string;
  pairDevice: (payload: string) => string;
  getPairingStatus: (requestId: string) => string;
  getSnapshot: () => string;
  getReceiverState: () => string;
  setRoomSession?: (payload: string) => string;
  stageRoomSessionToken?: (token: string) => string;
  clearRoomSession?: () => string;
  getRoomPresenceState?: () => string;
}

type SupportedRoomPresenceBridge = NativeRoomPresenceBridge & Required<Pick<NativeRoomPresenceBridge,
  'setRoomSession' | 'stageRoomSessionToken' | 'clearRoomSession' | 'getRoomPresenceState'>>;

export function getNativeRoomPresenceBridge(): NativeRoomPresenceBridge | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { HotelAlertNative?: unknown }).HotelAlertNative;
  if (!hasBridgeMethods(candidate)) return null;
  try {
    return isSupportedCapabilities(candidate.getCapabilities()) ? candidate : null;
  } catch {
    return null;
  }
}

export async function configureNativeRoomSession(
  bridge: NativeRoomPresenceBridge,
  payload: NativeRoomSessionPayload
): Promise<void> {
  if (!supportsNativeRoomPresence(bridge)) throw new Error('NATIVE_ROOM_PRESENCE_UNAVAILABLE');
  assertNativeOperationAccepted(bridge.setRoomSession(JSON.stringify(payload)), 'NATIVE_ROOM_SESSION_REJECTED');
}

export function stageNativeRoomToken(bridge: NativeRoomPresenceBridge, token: string): void {
  if (!supportsNativeRoomPresence(bridge)) throw new Error('NATIVE_ROOM_PRESENCE_UNAVAILABLE');
  assertNativeOperationAccepted(bridge.stageRoomSessionToken(token), 'NATIVE_ROOM_TOKEN_STAGE_FAILED');
}

export function clearNativeRoomSession(bridge: NativeRoomPresenceBridge | null): void {
  if (!supportsNativeRoomPresence(bridge)) return;
  assertNativeOperationAccepted(bridge.clearRoomSession(), 'NATIVE_ROOM_SESSION_CLEAR_FAILED');
}

export function readNativeRoomPresenceState(bridge: NativeRoomPresenceBridge | null): NativeRoomPresenceState {
  if (!supportsNativeRoomPresence(bridge)) return 'IDLE';
  const state = bridge.getRoomPresenceState();
  return state === 'STARTING' || state === 'CONNECTING' || state === 'ONLINE'
    || state === 'RETRYING' || state === 'INVALIDATED' || state === 'STOPPED'
    ? state
    : 'IDLE';
}

export function supportsNativeRoomPresence(bridge: NativeRoomPresenceBridge | null): bridge is SupportedRoomPresenceBridge {
  return bridge !== null
    && typeof bridge.setRoomSession === 'function'
    && typeof bridge.stageRoomSessionToken === 'function'
    && typeof bridge.clearRoomSession === 'function'
    && typeof bridge.getRoomPresenceState === 'function';
}

function hasBridgeMethods(value: unknown): value is NativeRoomPresenceBridge {
  if (!isRecord(value)) return false;
  return typeof value['getCapabilities'] === 'function'
    && typeof value['pairDevice'] === 'function'
    && typeof value['getPairingStatus'] === 'function'
    && typeof value['getSnapshot'] === 'function'
    && typeof value['getReceiverState'] === 'function';
}

function isSupportedCapabilities(raw: string): boolean {
  const capabilities = parseJson(raw);
  return isRecord(capabilities)
    && capabilities['bridgeVersion'] === 1
    && capabilities['nativeReceiver'] === true
    && capabilities['pairing'] === true
    && capabilities['snapshot'] === true
    && typeof capabilities['deviceCommands'] === 'boolean';
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function assertNativeOperationAccepted(raw: string, errorCode: string): void {
  const result = parseJson(raw);
  if (isRecord(result) && result['accepted'] === true) return;
  throw new Error(isRecord(result) && isNonEmptyString(result['errorCode']) ? result['errorCode'] : errorCode);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

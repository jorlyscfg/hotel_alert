import type { DeviceSyncSnapshot } from '@hotel/shared';
import { parseDeviceSyncSnapshot } from './app-model';
import type { ConnectionStatus } from './realtime';

export interface NativeWebViewCapabilities {
  bridgeVersion: 1;
  nativeReceiver: true;
  pairing: true;
  snapshot: true;
  deviceCommands: boolean;
}

export interface NativePairingPayload {
  deviceId: string;
  deviceToken: string;
}

export type NativeRoomSessionPayload = NativePairingPayload;

export type NativeRoomPresenceState = 'IDLE' | 'STARTING' | 'CONNECTING' | 'ONLINE' | 'RETRYING' | 'INVALIDATED' | 'STOPPED';
export type NativeRoomScreensaverButtonAction = 'TOGGLE_DO_NOT_DISTURB';
export type NativeRoomScreensaverSignalResult =
  | 'window-unavailable'
  | 'bridge-unavailable'
  | 'method-unavailable'
  | 'accepted'
  | 'rejected'
  | 'invalid-acknowledgment'
  | 'call-failed-typeerror'
  | 'call-failed-error'
  | 'call-failed-unknown';

export const NATIVE_ROOM_SCREENSAVER_BUTTON_EVENT = 'hotel-alert-room-screensaver-button';

export interface NativeWebViewBridge {
  getCapabilities: () => string;
  pairDevice: (payload: string) => string;
  getPairingStatus: (requestId: string) => string;
  getSnapshot: () => string;
  getReceiverState: () => string;
  setRoomSession?: (payload: string) => string;
  stageRoomSessionToken?: (token: string) => string;
  clearRoomSession?: () => string;
  getRoomPresenceState?: () => string;
  setRoomScreensaverActive?: (active: boolean) => boolean;
  transitionRequest?: (payload: string) => string;
  getCommandStatus?: (requestId: string) => string;
}

export interface NativePairingOptions {
  wait?: (milliseconds: number) => Promise<void>;
  pollIntervalMs?: number;
  maxAttempts?: number;
}

export interface NativeRequestTransitionPayload {
  requestId: string;
  targetStatus: 'ACCEPTED' | 'IN_PROGRESS' | 'COMPLETED';
  expectedVersion: number;
  idempotencyKey: string;
  responsibleName?: string;
}

export interface NativeCommandOptions {
  wait?: (milliseconds: number) => Promise<void>;
  pollIntervalMs?: number;
  maxAttempts?: number;
}

export class NativeRequestCommandError extends Error {
  readonly serverRequestId: string | undefined;

  constructor(errorCode: string, serverRequestId: unknown) {
    super(errorCode);
    this.name = 'NativeRequestCommandError';
    this.serverRequestId = isSafeServerRequestId(serverRequestId) ? serverRequestId : undefined;
  }
}

declare global {
  interface Window {
    HotelAlertNative?: NativeWebViewBridge;
  }
}

export function getNativeWebViewBridge(): NativeWebViewBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = window.HotelAlertNative;
  if (bridge === undefined || !hasBridgeMethods(bridge)) return null;
  return isSupportedCapabilities(bridge.getCapabilities()) ? bridge : null;
}

export function setNativeRoomScreensaverActive(active: boolean): NativeRoomScreensaverSignalResult {
  if (typeof window === 'undefined') return 'window-unavailable';
  const bridge = window.HotelAlertNative;
  if (bridge === undefined) return 'bridge-unavailable';
  try {
    if (typeof bridge.setRoomScreensaverActive !== 'function') return 'method-unavailable';
    // Keep the bridge as the receiver for Android's injected JavaScript-interface method.
    const acknowledgment: unknown = bridge.setRoomScreensaverActive(active);
    if (acknowledgment === true) return 'accepted';
    if (acknowledgment === false) return 'rejected';
    return 'invalid-acknowledgment';
  } catch (error) {
    if (error instanceof TypeError) return 'call-failed-typeerror';
    if (error instanceof Error) return 'call-failed-error';
    return 'call-failed-unknown';
  }
}

export function subscribeToNativeRoomScreensaverButtons(
  onButton: (action: NativeRoomScreensaverButtonAction) => void
): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const listener = (event: Event): void => {
    const action: unknown = (event as CustomEvent<unknown>).detail;
    if (action === 'TOGGLE_DO_NOT_DISTURB') onButton(action);
  };
  window.addEventListener(NATIVE_ROOM_SCREENSAVER_BUTTON_EVENT, listener);
  return () => window.removeEventListener(NATIVE_ROOM_SCREENSAVER_BUTTON_EVENT, listener);
}

export function readNativeSnapshot(bridge: NativeWebViewBridge): DeviceSyncSnapshot | null {
  try {
    return parseDeviceSyncSnapshot(bridge.getSnapshot());
  } catch {
    return null;
  }
}

export function resolveNativeReceiverStatus(state: string, hasSnapshot: boolean): ConnectionStatus {
  if (!hasSnapshot) return 'offline';
  if (state === 'SYNCHRONIZED' || state === 'CONNECTED') return 'online';
  if (state === 'FETCHING_SNAPSHOT' || state === 'CONNECTING' || state === 'SYNCHRONIZING') return 'connecting';
  if (state === 'ERROR') return 'stale';
  return 'offline';
}

export async function pairNativeDevice(
  bridge: NativeWebViewBridge,
  payload: NativePairingPayload,
  options: NativePairingOptions = {}
): Promise<void> {
  const accepted = parseJson(bridge.pairDevice(JSON.stringify(payload)));
  if (!isRecord(accepted) || accepted['accepted'] !== true || !isNonEmptyString(accepted['requestId'])) {
    throw new Error('NATIVE_PAIRING_REJECTED');
  }
  const requestId = accepted['requestId'];
  const wait = options.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const maxAttempts = options.maxAttempts ?? 120;
  const pollIntervalMs = options.pollIntervalMs ?? 250;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = parseJson(bridge.getPairingStatus(requestId));
    if (!isRecord(status) || status['requestId'] !== requestId || !isNonEmptyString(status['state'])) {
      throw new Error('INVALID_NATIVE_PAIRING_STATUS');
    }
    if (status['state'] === 'SUCCEEDED') return;
    if (status['state'] === 'FAILED') {
      throw new Error(isNonEmptyString(status['errorCode']) ? status['errorCode'] : 'NATIVE_PAIRING_FAILED');
    }
    if (status['state'] !== 'PENDING') throw new Error('INVALID_NATIVE_PAIRING_STATUS');
    await wait(pollIntervalMs);
  }
  throw new Error('NATIVE_PAIRING_TIMEOUT');
}

export async function configureNativeRoomSession(
  bridge: NativeWebViewBridge,
  payload: NativeRoomSessionPayload
): Promise<void> {
  if (!supportsNativeRoomPresence(bridge)) throw new Error('NATIVE_ROOM_PRESENCE_UNAVAILABLE');
  assertNativeOperationAccepted(bridge.setRoomSession!(JSON.stringify(payload)), 'NATIVE_ROOM_SESSION_REJECTED');
}

export function stageNativeRoomToken(bridge: NativeWebViewBridge, token: string): void {
  if (!supportsNativeRoomPresence(bridge)) throw new Error('NATIVE_ROOM_PRESENCE_UNAVAILABLE');
  assertNativeOperationAccepted(bridge.stageRoomSessionToken!(token), 'NATIVE_ROOM_TOKEN_STAGE_FAILED');
}

export function clearNativeRoomSession(bridge: NativeWebViewBridge): void {
  if (!supportsNativeRoomPresence(bridge)) return;
  assertNativeOperationAccepted(bridge.clearRoomSession!(), 'NATIVE_ROOM_SESSION_CLEAR_FAILED');
}

export function readNativeRoomPresenceState(bridge: NativeWebViewBridge | null): NativeRoomPresenceState {
  if (bridge === null || !supportsNativeRoomPresence(bridge)) return 'IDLE';
  const state = bridge.getRoomPresenceState!();
  return state === 'STARTING' || state === 'CONNECTING' || state === 'ONLINE'
    || state === 'RETRYING' || state === 'INVALIDATED' || state === 'STOPPED'
    ? state
    : 'IDLE';
}

export function supportsNativeRoomPresence(bridge: NativeWebViewBridge | null): bridge is NativeWebViewBridge & Required<Pick<NativeWebViewBridge,
  'setRoomSession' | 'stageRoomSessionToken' | 'clearRoomSession' | 'getRoomPresenceState'>> {
  return bridge !== null
    && typeof bridge.setRoomSession === 'function'
    && typeof bridge.stageRoomSessionToken === 'function'
    && typeof bridge.clearRoomSession === 'function'
    && typeof bridge.getRoomPresenceState === 'function';
}

export async function transitionNativeRequest(
  bridge: NativeWebViewBridge,
  payload: NativeRequestTransitionPayload,
  options: NativeCommandOptions = {}
): Promise<void> {
  if (payload.targetStatus === 'IN_PROGRESS') {
    const responsibleName = payload.responsibleName?.trim();
    if (responsibleName === undefined || responsibleName.length === 0 || responsibleName.length > 120) {
      throw new Error('RESPONSIBLE_NAME_REQUIRED');
    }
  }
  if (typeof bridge.transitionRequest !== 'function' || typeof bridge.getCommandStatus !== 'function') {
    throw new Error('NATIVE_DEVICE_COMMANDS_UNAVAILABLE');
  }
  const accepted = parseJson(bridge.transitionRequest(JSON.stringify(payload)));
  if (!isRecord(accepted) || accepted['accepted'] !== true || !isNonEmptyString(accepted['requestId'])) {
    throw new Error('NATIVE_REQUEST_COMMAND_REJECTED');
  }
  const requestId = accepted['requestId'];
  const wait = options.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const maxAttempts = options.maxAttempts ?? 120;
  const pollIntervalMs = options.pollIntervalMs ?? 250;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = parseJson(bridge.getCommandStatus(requestId));
    if (!isRecord(status) || status['requestId'] !== requestId || !isNonEmptyString(status['state'])) {
      throw new Error('INVALID_NATIVE_REQUEST_COMMAND_STATUS');
    }
    if (status['state'] === 'SUCCEEDED') return;
    if (status['state'] === 'FAILED') {
      throw new NativeRequestCommandError(
        isNonEmptyString(status['errorCode']) ? status['errorCode'] : 'NATIVE_REQUEST_COMMAND_FAILED',
        status['serverRequestId']
      );
    }
    if (status['state'] !== 'PENDING') throw new Error('INVALID_NATIVE_REQUEST_COMMAND_STATUS');
    await wait(pollIntervalMs);
  }
  throw new Error('NATIVE_REQUEST_COMMAND_TIMEOUT');
}

export function supportsNativeDeviceCommands(bridge: NativeWebViewBridge | null): boolean {
  if (bridge === null || typeof bridge.transitionRequest !== 'function' || typeof bridge.getCommandStatus !== 'function') return false;
  const capabilities = parseJson(bridge.getCapabilities());
  return isRecord(capabilities) && capabilities['deviceCommands'] === true;
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

function hasBridgeMethods(value: NativeWebViewBridge): boolean {
  return typeof value.getCapabilities === 'function'
    && typeof value.pairDevice === 'function'
    && typeof value.getPairingStatus === 'function'
    && typeof value.getSnapshot === 'function'
    && typeof value.getReceiverState === 'function';
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
  if (!isRecord(result) || result['accepted'] !== true) {
    throw new Error(isRecord(result) && isNonEmptyString(result['errorCode']) ? result['errorCode'] : errorCode);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSafeServerRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

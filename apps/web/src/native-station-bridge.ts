import type { DeviceSyncSnapshot } from '@hotel/shared';
import { parseDeviceSyncSnapshot } from './app-model';
import type { ConnectionStatus } from './realtime';

export interface NativeStationBridge {
  getCapabilities: () => string;
  pairDevice: (payload: string) => string;
  getPairingStatus: (requestId: string) => string;
  getSnapshot: () => string;
  getReceiverState: () => string;
}

export interface NativeStationPairingPayload {
  deviceId: string;
  deviceToken: string;
}

export interface NativeStationPairingOptions {
  wait?: (milliseconds: number) => Promise<void>;
  pollIntervalMs?: number;
  maxAttempts?: number;
}

export function getNativeStationBridge(): NativeStationBridge | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { HotelAlertNative?: unknown }).HotelAlertNative;
  if (!hasBridgeMethods(candidate)) return null;
  try {
    return isSupportedCapabilities(candidate.getCapabilities()) ? candidate : null;
  } catch {
    return null;
  }
}

export function readNativeStationSnapshot(bridge: NativeStationBridge): DeviceSyncSnapshot | null {
  try {
    return parseDeviceSyncSnapshot(bridge.getSnapshot());
  } catch {
    return null;
  }
}

export function resolveNativeStationReceiverStatus(state: string, hasSnapshot: boolean): ConnectionStatus {
  if (!hasSnapshot) return 'offline';
  if (state === 'SYNCHRONIZED' || state === 'CONNECTED') return 'online';
  if (state === 'FETCHING_SNAPSHOT' || state === 'CONNECTING' || state === 'SYNCHRONIZING') return 'connecting';
  if (state === 'ERROR') return 'stale';
  return 'offline';
}

export async function pairNativeStation(
  bridge: NativeStationBridge,
  payload: NativeStationPairingPayload,
  options: NativeStationPairingOptions = {}
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

function hasBridgeMethods(value: unknown): value is NativeStationBridge {
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
    && capabilities['snapshot'] === true;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

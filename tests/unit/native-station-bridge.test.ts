import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceSyncSnapshot } from '@hotel/shared';
import {
  getNativeStationBridge,
  pairNativeStation,
  readNativeStationSnapshot,
  resolveNativeStationReceiverStatus,
  type NativeStationBridge
} from '../../apps/web/src/native-station-bridge';

describe('native station bridge', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts a versioned base station bridge without AREA command capabilities', () => {
    const bridge = createBridge({
      getCapabilities: () => JSON.stringify({ bridgeVersion: 1, nativeReceiver: true, pairing: true, snapshot: true })
    });
    vi.stubGlobal('window', { HotelAlertNative: bridge });

    expect(getNativeStationBridge()).toBe(bridge);
    expect('transitionRequest' in bridge).toBe(false);
  });

  it('rejects missing base methods and incompatible capabilities', () => {
    const bridge = createBridge();
    delete (bridge as Partial<NativeStationBridge>).getSnapshot;
    vi.stubGlobal('window', { HotelAlertNative: bridge });
    expect(getNativeStationBridge()).toBeNull();

    vi.stubGlobal('window', {
      HotelAlertNative: createBridge({
        getCapabilities: () => JSON.stringify({ bridgeVersion: 2, nativeReceiver: true, pairing: true, snapshot: true })
      })
    });
    expect(getNativeStationBridge()).toBeNull();
  });

  it('validates station snapshots before exposing them to App', () => {
    const snapshot = createSnapshot();

    expect(readNativeStationSnapshot(createBridge({ getSnapshot: () => JSON.stringify(snapshot) }))).toEqual(snapshot);
    expect(readNativeStationSnapshot(createBridge({ getSnapshot: () => '{"snapshotSequence":1}' }))).toBeNull();
  });

  it('pairs asynchronously and surfaces native pairing failures', async () => {
    const statuses = [
      JSON.stringify({ requestId: 'pair-1', state: 'PENDING' }),
      JSON.stringify({ requestId: 'pair-1', state: 'SUCCEEDED' })
    ];
    const pairDevice = vi.fn(() => JSON.stringify({ requestId: 'pair-1', accepted: true }));
    const getPairingStatus = vi.fn(() => statuses.shift() ?? JSON.stringify({ requestId: 'pair-1', state: 'PENDING' }));
    const bridge = createBridge({ pairDevice, getPairingStatus });

    await pairNativeStation(bridge, { deviceId: 'station-1', deviceToken: 'native-secret' }, { wait: async () => undefined });

    expect(pairDevice).toHaveBeenCalledWith(JSON.stringify({ deviceId: 'station-1', deviceToken: 'native-secret' }));
    expect(getPairingStatus).toHaveBeenCalledTimes(2);
    await expect(pairNativeStation(createBridge({
      getPairingStatus: () => JSON.stringify({ requestId: 'pair-1', state: 'FAILED', errorCode: 'TOKEN_INVALID' })
    }), { deviceId: 'station-1', deviceToken: 'native-secret' }, { wait: async () => undefined })).rejects.toThrow('TOKEN_INVALID');
  });

  it('maps native receiver lifecycle to station connection status', () => {
    expect(resolveNativeStationReceiverStatus('SYNCHRONIZED', true)).toBe('online');
    expect(resolveNativeStationReceiverStatus('CONNECTING', true)).toBe('connecting');
    expect(resolveNativeStationReceiverStatus('ERROR', true)).toBe('stale');
    expect(resolveNativeStationReceiverStatus('IDLE', false)).toBe('offline');
  });
});

function createBridge(overrides: Partial<NativeStationBridge> = {}): NativeStationBridge {
  return {
    getCapabilities: () => JSON.stringify({ bridgeVersion: 1, nativeReceiver: true, pairing: true, snapshot: true }),
    pairDevice: () => JSON.stringify({ requestId: 'pair-1', accepted: true }),
    getPairingStatus: () => JSON.stringify({ requestId: 'pair-1', state: 'SUCCEEDED' }),
    getSnapshot: () => JSON.stringify(createSnapshot()),
    getReceiverState: () => 'SYNCHRONIZED',
    ...overrides
  };
}

function createSnapshot(): DeviceSyncSnapshot {
  return {
    snapshotSequence: 1,
    currentEventSequence: 2,
    configurationRevision: 3,
    deviceConfigVersion: 4,
    serverTime: '2026-09-20T00:00:00.000Z',
    device: {
      id: 'device-1',
      installationId: 'installation-1',
      displayName: 'Area tablet',
      assignmentMode: 'AREA',
      roomId: null,
      areaId: 'area-1',
      active: true,
      deviceConfigVersion: 4,
      lastHeartbeatAt: '2026-09-20T00:00:00.000Z',
      presence: 'ONLINE'
    },
    config: {
      mode: 'AREA',
      room: null,
      area: { id: 'area-1', code: 'housekeeping', displayName: 'Housekeeping' },
      services: [],
      hotelName: 'Hotel Local',
      hotelLogo: null,
      roomBackground: null,
      clockFormat: '12h',
      offlineQueueTtlHours: 24,
      heartbeatIntervalMs: 15_000,
      heartbeatStaleAfterMs: 45_000,
      heartbeatOfflineAfterMs: 120_000,
      pendingAlertIntervalMs: 5_000
    },
    activeRequests: [],
    activeDoNotDisturbRooms: [],
    pendingTokenRotation: null
  };
}

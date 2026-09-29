import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceSyncSnapshot } from '@hotel/shared';
import { clearNativeRoomSession, configureNativeRoomSession, getNativeWebViewBridge, pairNativeDevice, readNativeRoomPresenceState, readNativeSnapshot, resolveNativeReceiverStatus, stageNativeRoomToken, supportsNativeDeviceCommands, supportsNativeRoomPresence, transitionNativeRequest, type NativeWebViewBridge } from '../../apps/web/src/native-bridge';

describe('native WebView bridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts only the versioned native bridge with pairing and snapshot support', () => {
    const bridge = createBridge({
      getCapabilities: () => JSON.stringify({ bridgeVersion: 1, nativeReceiver: true, pairing: true, snapshot: true, deviceCommands: false })
    });
    vi.stubGlobal('window', { HotelAlertNative: bridge });

    expect(getNativeWebViewBridge()).toBe(bridge);

    vi.stubGlobal('window', { HotelAlertNative: { getCapabilities: () => '{"bridgeVersion":1,"nativeReceiver":true}' } });
    expect(getNativeWebViewBridge()).toBeNull();
  });

  it('validates a native snapshot before exposing it to the application', () => {
    const snapshot = createSnapshot();
    const bridge = createBridge({ getSnapshot: () => JSON.stringify(snapshot) });

    expect(readNativeSnapshot(bridge)).toEqual(snapshot);
    expect(readNativeSnapshot(createBridge({ getSnapshot: () => '{"snapshotSequence":1}' }))).toBeNull();
  });

  it('pairs through the native bridge without storing the token in browser state', async () => {
    const statuses = [
      JSON.stringify({ requestId: 'pair-1', state: 'PENDING' }),
      JSON.stringify({ requestId: 'pair-1', state: 'SUCCEEDED', deviceId: 'device-1' })
    ];
    const pairDevice = vi.fn(() => JSON.stringify({ requestId: 'pair-1', accepted: true }));
    const bridge = createBridge({
      pairDevice,
      getPairingStatus: vi.fn(() => statuses.shift() ?? JSON.stringify({ requestId: 'pair-1', state: 'PENDING' }))
    });

    await pairNativeDevice(bridge, { deviceId: 'device-1', deviceToken: 'secret-token' }, { wait: async () => undefined });

    expect(pairDevice).toHaveBeenCalledWith(JSON.stringify({ deviceId: 'device-1', deviceToken: 'secret-token' }));
    expect(bridge.getPairingStatus).toHaveBeenCalledTimes(2);
  });

  it('surfaces a native pairing error without falling back silently', async () => {
    const bridge = createBridge({
      pairDevice: () => JSON.stringify({ requestId: 'pair-1', accepted: true }),
      getPairingStatus: () => JSON.stringify({ requestId: 'pair-1', state: 'FAILED', errorCode: 'TOKEN_INVALID' })
    });

    await expect(pairNativeDevice(bridge, { deviceId: 'device-1', deviceToken: 'secret-token' }, { wait: async () => undefined }))
      .rejects.toThrow('TOKEN_INVALID');
  });

  it('hands ROOM bootstrap credentials to the dedicated native presence session', async () => {
    const setRoomSession = vi.fn(() => '{"accepted":true}');
    const stageRoomSessionToken = vi.fn(() => '{"accepted":true}');
    const clearRoomSession = vi.fn(() => '{"accepted":true}');
    const bridge = createBridge({
      setRoomSession,
      stageRoomSessionToken,
      clearRoomSession,
      getRoomPresenceState: () => 'ONLINE'
    });

    expect(supportsNativeRoomPresence(bridge)).toBe(true);
    await configureNativeRoomSession(bridge, { deviceId: 'room-device', deviceToken: 'private-token' });
    stageNativeRoomToken(bridge, 'replacement-token');
    clearNativeRoomSession(bridge);

    expect(setRoomSession).toHaveBeenCalledWith(JSON.stringify({ deviceId: 'room-device', deviceToken: 'private-token' }));
    expect(stageRoomSessionToken).toHaveBeenCalledWith('replacement-token');
    expect(clearRoomSession).toHaveBeenCalledOnce();
    expect(readNativeRoomPresenceState(bridge)).toBe('ONLINE');
  });

  it('does not treat an incomplete legacy bridge as ROOM presence capable', () => {
    const bridge = createBridge({ getRoomPresenceState: () => 'INVALIDATED' });

    expect(supportsNativeRoomPresence(bridge)).toBe(false);
    expect(readNativeRoomPresenceState(bridge)).toBe('IDLE');
  });

  it('maps native receiver lifecycle state to the existing console status model', () => {
    expect(resolveNativeReceiverStatus('SYNCHRONIZED', true)).toBe('online');
    expect(resolveNativeReceiverStatus('CONNECTING', true)).toBe('connecting');
    expect(resolveNativeReceiverStatus('ERROR', true)).toBe('stale');
    expect(resolveNativeReceiverStatus('AUTH_FAILED', true)).toBe('offline');
    expect(resolveNativeReceiverStatus('IDLE', false)).toBe('offline');
  });

  it('polls an AREA request transition without exposing the device token', async () => {
    const statuses = [
      JSON.stringify({ requestId: 'command-1', state: 'PENDING' }),
      JSON.stringify({ requestId: 'command-1', state: 'SUCCEEDED', responseJson: '{"ok":true}' })
    ];
    const bridge = createBridge({
      getCapabilities: () => JSON.stringify({ bridgeVersion: 1, nativeReceiver: true, pairing: true, snapshot: true, deviceCommands: true }),
      transitionRequest: vi.fn(() => JSON.stringify({ requestId: 'command-1', accepted: true })),
      getCommandStatus: vi.fn(() => statuses.shift() ?? JSON.stringify({ requestId: 'command-1', state: 'PENDING' }))
    });

    expect(supportsNativeDeviceCommands(bridge)).toBe(true);
    await transitionNativeRequest(bridge, {
      requestId: 'req-1',
      targetStatus: 'IN_PROGRESS',
      expectedVersion: 2,
      idempotencyKey: 'transition-1'
    }, { wait: async () => undefined });
    expect(bridge.transitionRequest).toHaveBeenCalledWith(JSON.stringify({
      requestId: 'req-1', targetStatus: 'IN_PROGRESS', expectedVersion: 2, idempotencyKey: 'transition-1'
    }));
  });
});

function createBridge(overrides: Partial<NativeWebViewBridge>): NativeWebViewBridge {
  return {
    getCapabilities: () => JSON.stringify({ bridgeVersion: 1, nativeReceiver: true, pairing: true, snapshot: true, deviceCommands: false }),
    pairDevice: () => JSON.stringify({ requestId: 'pair-1', accepted: true }),
    getPairingStatus: () => JSON.stringify({ requestId: 'pair-1', state: 'SUCCEEDED', deviceId: 'device-1' }),
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

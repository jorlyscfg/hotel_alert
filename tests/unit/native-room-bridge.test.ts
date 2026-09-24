import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearNativeRoomSession,
  configureNativeRoomSession,
  getNativeRoomPresenceBridge,
  readNativeRoomPresenceState,
  stageNativeRoomToken,
  supportsNativeRoomPresence,
  type NativeRoomPresenceBridge
} from '../../apps/web/src/native-room-bridge';

const CAPABILITIES = JSON.stringify({
  bridgeVersion: 1,
  nativeReceiver: true,
  pairing: true,
  snapshot: true,
  deviceCommands: false
});

describe('native ROOM presence bridge', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('validates the versioned base bridge without requiring AREA command methods', () => {
    const bridge = createBridge();
    vi.stubGlobal('window', { HotelAlertNative: bridge });

    expect(getNativeRoomPresenceBridge()).toBe(bridge);
    expect(supportsNativeRoomPresence(getNativeRoomPresenceBridge())).toBe(true);
    expect('transitionRequest' in bridge).toBe(false);
  });

  it('rejects incomplete or incompatible native bridges', () => {
    const missingBaseMethod = createBridge();
    delete (missingBaseMethod as Partial<NativeRoomPresenceBridge>).getSnapshot;
    vi.stubGlobal('window', { HotelAlertNative: missingBaseMethod });
    expect(getNativeRoomPresenceBridge()).toBeNull();

    const incompatibleVersion = createBridge({
      getCapabilities: () => JSON.stringify({ bridgeVersion: 2, nativeReceiver: true, pairing: true, snapshot: true, deviceCommands: false })
    });
    vi.stubGlobal('window', { HotelAlertNative: incompatibleVersion });
    expect(getNativeRoomPresenceBridge()).toBeNull();
  });

  it('hands credentials to ROOM presence, stages rotation tokens, and clears the native session', async () => {
    const setRoomSession = vi.fn(() => '{"accepted":true}');
    const stageRoomSessionToken = vi.fn(() => '{"accepted":true}');
    const clearRoomSession = vi.fn(() => '{"accepted":true}');
    const bridge = createBridge({ setRoomSession, stageRoomSessionToken, clearRoomSession });

    await configureNativeRoomSession(bridge, { deviceId: 'room-7', deviceToken: 'room-token' });
    stageNativeRoomToken(bridge, 'replacement-token');
    clearNativeRoomSession(bridge);

    expect(setRoomSession).toHaveBeenCalledWith(JSON.stringify({ deviceId: 'room-7', deviceToken: 'room-token' }));
    expect(stageRoomSessionToken).toHaveBeenCalledWith('replacement-token');
    expect(clearRoomSession).toHaveBeenCalledOnce();
  });

  it('surfaces native rejection codes and treats absent ROOM methods as unavailable', async () => {
    const rejectedBridge = createBridge({ setRoomSession: () => '{"accepted":false,"errorCode":"ROOM_SESSION_REJECTED"}' });
    await expect(configureNativeRoomSession(rejectedBridge, { deviceId: 'room-7', deviceToken: 'room-token' }))
      .rejects.toThrow('ROOM_SESSION_REJECTED');

    const baseOnlyBridge = createBridge();
    delete (baseOnlyBridge as Partial<NativeRoomPresenceBridge>).setRoomSession;
    delete (baseOnlyBridge as Partial<NativeRoomPresenceBridge>).stageRoomSessionToken;
    delete (baseOnlyBridge as Partial<NativeRoomPresenceBridge>).clearRoomSession;
    delete (baseOnlyBridge as Partial<NativeRoomPresenceBridge>).getRoomPresenceState;
    expect(supportsNativeRoomPresence(baseOnlyBridge)).toBe(false);
    expect(readNativeRoomPresenceState(baseOnlyBridge)).toBe('IDLE');
    expect(() => clearNativeRoomSession(baseOnlyBridge)).not.toThrow();
    expect(() => stageNativeRoomToken(baseOnlyBridge, 'token')).toThrow('NATIVE_ROOM_PRESENCE_UNAVAILABLE');
  });

  it('exposes only known ROOM presence states', () => {
    expect(readNativeRoomPresenceState(createBridge({ getRoomPresenceState: () => 'INVALIDATED' }))).toBe('INVALIDATED');
    expect(readNativeRoomPresenceState(createBridge({ getRoomPresenceState: () => 'UNKNOWN' }))).toBe('IDLE');
  });
});

function createBridge(overrides: Partial<NativeRoomPresenceBridge> = {}): NativeRoomPresenceBridge {
  return {
    getCapabilities: () => CAPABILITIES,
    pairDevice: () => '{"accepted":true}',
    getPairingStatus: () => '{"state":"SUCCEEDED"}',
    getSnapshot: () => '{}',
    getReceiverState: () => 'CONNECTED',
    setRoomSession: () => '{"accepted":true}',
    stageRoomSessionToken: () => '{"accepted":true}',
    clearRoomSession: () => '{"accepted":true}',
    getRoomPresenceState: () => 'ONLINE',
    ...overrides
  };
}

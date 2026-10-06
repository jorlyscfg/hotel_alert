import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceSyncSnapshot } from '@hotel/shared';
import { clearNativeRoomSession, configureNativeRoomSession, getNativeWebViewBridge, pairNativeDevice, readNativeRoomPresenceState, readNativeSnapshot, resolveNativeReceiverStatus, setNativeRoomScreensaverActive, stageNativeRoomToken, subscribeToNativeRoomScreensaverButtons, supportsNativeDeviceCommands, supportsNativeRoomPresence, transitionNativeRequest, type NativeWebViewBridge } from '../../apps/web/src/native-bridge';

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

  it('reports saver phase changes to a supporting native ROOM bridge', () => {
    const setRoomScreensaverActive = vi.fn(() => true);
    vi.stubGlobal('window', { HotelAlertNative: createBridge({ setRoomScreensaverActive }) });

    expect(setNativeRoomScreensaverActive(true)).toBe('accepted');
    expect(setNativeRoomScreensaverActive(false)).toBe('accepted');

    expect(setRoomScreensaverActive).toHaveBeenNthCalledWith(1, true);
    expect(setRoomScreensaverActive).toHaveBeenNthCalledWith(2, false);
  });

  it('preserves the JavaScript-interface receiver while calling the native saver method', () => {
    const bridge = createBridge({
      setRoomScreensaverActive: function (this: NativeWebViewBridge) {
        return this === bridge;
      }
    });
    vi.stubGlobal('window', { HotelAlertNative: bridge });

    expect(setNativeRoomScreensaverActive(true)).toBe('accepted');
  });

  it('distinguishes a missing native bridge from a missing screensaver method', () => {
    vi.stubGlobal('window', undefined);
    expect(setNativeRoomScreensaverActive(true)).toBe('window-unavailable');

    vi.stubGlobal('window', {});
    expect(setNativeRoomScreensaverActive(true)).toBe('bridge-unavailable');

    vi.stubGlobal('window', { HotelAlertNative: createBridge({}) });
    expect(setNativeRoomScreensaverActive(true)).toBe('method-unavailable');
  });

  it('reports a false native acknowledgment and safely classifies bridge call failures', () => {
    vi.stubGlobal('window', {
      HotelAlertNative: createBridge({ setRoomScreensaverActive: () => false })
    });
    expect(setNativeRoomScreensaverActive(true)).toBe('rejected');

    vi.stubGlobal('window', {
      HotelAlertNative: createBridge({ setRoomScreensaverActive: () => { throw new TypeError('private bridge detail'); } })
    });
    expect(setNativeRoomScreensaverActive(true)).toBe('call-failed-typeerror');

    vi.stubGlobal('window', {
      HotelAlertNative: createBridge({ setRoomScreensaverActive: () => { throw new Error('private bridge detail'); } })
    });
    expect(setNativeRoomScreensaverActive(true)).toBe('call-failed-error');

    vi.stubGlobal('window', {
      HotelAlertNative: createBridge({ setRoomScreensaverActive: () => { throw 'private bridge detail'; } })
    });
    expect(setNativeRoomScreensaverActive(true)).toBe('call-failed-unknown');
  });

  it('rejects a native screensaver call that returns no boolean acknowledgment', () => {
    vi.stubGlobal('window', {
      HotelAlertNative: createBridge({ setRoomScreensaverActive: (() => undefined) as unknown as () => boolean })
    });

    expect(setNativeRoomScreensaverActive(true)).toBe('invalid-acknowledgment');
  });

  it('accepts only the native left-button DND action event and removes its listener on cleanup', () => {
    const target = new EventTarget();
    const add = vi.spyOn(target, 'addEventListener');
    const remove = vi.spyOn(target, 'removeEventListener');
    vi.stubGlobal('window', target);
    const onButton = vi.fn();
    const cleanup = subscribeToNativeRoomScreensaverButtons(onButton);

    target.dispatchEvent(new CustomEvent('hotel-alert-room-screensaver-button', { detail: 'TOGGLE_DO_NOT_DISTURB' }));
    target.dispatchEvent(new CustomEvent('hotel-alert-room-screensaver-button', { detail: 'TOGGLE_DISPLAY_BLACKOUT' }));
    expect(onButton).toHaveBeenCalledTimes(1);
    expect(onButton).toHaveBeenCalledWith('TOGGLE_DO_NOT_DISTURB');

    cleanup();
    expect(add).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
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
      idempotencyKey: 'transition-1',
      responsibleName: 'Taylor Morgan'
    }, { wait: async () => undefined });
    expect(bridge.transitionRequest).toHaveBeenCalledWith(JSON.stringify({
      requestId: 'req-1', targetStatus: 'IN_PROGRESS', expectedVersion: 2, idempotencyKey: 'transition-1', responsibleName: 'Taylor Morgan'
    }));
  });

  it('rejects native start commands without a non-blank responsible name', async () => {
    const bridge = createBridge({
      getCapabilities: () => JSON.stringify({ bridgeVersion: 1, nativeReceiver: true, pairing: true, snapshot: true, deviceCommands: true }),
      transitionRequest: vi.fn(() => JSON.stringify({ requestId: 'command-1', accepted: true })),
      getCommandStatus: vi.fn(() => JSON.stringify({ requestId: 'command-1', state: 'SUCCEEDED' }))
    });

    await expect(transitionNativeRequest(bridge, {
      requestId: 'req-1', targetStatus: 'IN_PROGRESS', expectedVersion: 2, idempotencyKey: 'transition-1'
    }, { wait: async () => undefined })).rejects.toThrow('RESPONSIBLE_NAME_REQUIRED');
  });

  it('preserves a safe server request reference separately from the native command id', async () => {
    const bridge = createBridge({
      getCapabilities: () => JSON.stringify({ bridgeVersion: 1, nativeReceiver: true, pairing: true, snapshot: true, deviceCommands: true }),
      transitionRequest: () => JSON.stringify({ requestId: 'native-command-1', accepted: true }),
      getCommandStatus: () => JSON.stringify({
        requestId: 'native-command-1',
        state: 'FAILED',
        errorCode: 'INTERNAL_ERROR',
        serverRequestId: 'server-request-12345678',
        message: 'private server detail must not be forwarded'
      })
    });

    const error = await transitionNativeRequest(bridge, {
      requestId: 'req-1', targetStatus: 'IN_PROGRESS', expectedVersion: 2,
      idempotencyKey: 'transition-1', responsibleName: 'Taylor Morgan'
    }, { wait: async () => undefined }).catch((cause: unknown) => cause as Error & { serverRequestId?: string });

    expect(error).toMatchObject({ message: 'INTERNAL_ERROR', serverRequestId: 'server-request-12345678' });
    expect(error.message).not.toContain('private server detail');
    expect(error.message).not.toContain('native-command-1');
  });

  it('discards unsafe or overlong server request references from native failures', async () => {
    const bridge = createBridge({
      getCapabilities: () => JSON.stringify({ bridgeVersion: 1, nativeReceiver: true, pairing: true, snapshot: true, deviceCommands: true }),
      transitionRequest: () => JSON.stringify({ requestId: 'native-command-2', accepted: true }),
      getCommandStatus: () => JSON.stringify({
        requestId: 'native-command-2', state: 'FAILED', errorCode: 'INTERNAL_ERROR',
        serverRequestId: 'secret token that must not be displayed'
      })
    });

    const error = await transitionNativeRequest(bridge, {
      requestId: 'req-2', targetStatus: 'IN_PROGRESS', expectedVersion: 2,
      idempotencyKey: 'transition-2', responsibleName: 'Taylor Morgan'
    }, { wait: async () => undefined }).catch((cause: unknown) => cause as Error & { serverRequestId?: string });

    expect(error).toMatchObject({ message: 'INTERNAL_ERROR' });
    expect(error.serverRequestId).toBeUndefined();

    const overlongBridge = createBridge({
      getCapabilities: () => JSON.stringify({ bridgeVersion: 1, nativeReceiver: true, pairing: true, snapshot: true, deviceCommands: true }),
      transitionRequest: () => JSON.stringify({ requestId: 'native-command-3', accepted: true }),
      getCommandStatus: () => JSON.stringify({
        requestId: 'native-command-3', state: 'FAILED', errorCode: 'INTERNAL_ERROR',
        serverRequestId: `r${'e'.repeat(128)}`
      })
    });
    const overlongError = await transitionNativeRequest(overlongBridge, {
      requestId: 'req-3', targetStatus: 'IN_PROGRESS', expectedVersion: 2,
      idempotencyKey: 'transition-3', responsibleName: 'Taylor Morgan'
    }, { wait: async () => undefined }).catch((cause: unknown) => cause as Error & { serverRequestId?: string });

    expect(overlongError.serverRequestId).toBeUndefined();
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

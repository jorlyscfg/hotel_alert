import type * as React from 'react';
import type { DeviceSyncSnapshot } from '@hotel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionStatus, RealtimeRefreshResult } from '../../apps/web/src/realtime';

interface RealtimeOptionsForTest {
  enabled: boolean;
  hasSnapshot: boolean;
  onEvent: (eventName?: string, payload?: unknown) => Promise<RealtimeRefreshResult | void>;
  onStatus: (status: ConnectionStatus) => void;
}

interface DeviceScreenPropsForTest {
  deviceCommandsSupported?: boolean;
  deviceToken?: string;
  nativeBridge?: unknown;
  roomRequestNotificationsUnread?: boolean;
  onClearRoomRequestNotifications?: () => void;
}

interface AdminScreenPropsForTest {
  csrfToken?: string;
  installationId?: string | null;
  connectionStatus?: ConnectionStatus;
  onUseDeviceToken?: (pairing: { deviceId: string; deviceToken: string; assignmentMode: 'ROOM' | 'AREA' }) => Promise<void>;
  onChangePassword?: (currentPassword: string, newPassword: string) => Promise<void>;
}

interface BootstrapScreenPropsForTest {
  onRetry?: () => void;
  onAdminLogin?: (result: { admin: { id: string; username: string; expiresAt: string; mustChangePassword?: boolean }; csrfToken: string }, role: 'ADMIN' | 'ROOM' | 'AREA') => Promise<void>;
}

interface AssignmentScreenPropsForTest {
  role?: 'ROOM' | 'AREA';
  snapshot?: { rooms?: unknown[]; areas?: unknown[] };
  onSelect?: (target: unknown) => void;
  onAdmin?: () => void;
  error?: string | null;
}

interface TestElement {
  type: unknown;
  props: {
    children?: unknown;
    roomRequestNotificationsUnread?: boolean;
    onClearRoomRequestNotifications?: () => void;
    csrfToken?: string;
    installationId?: string | null;
    connectionStatus?: ConnectionStatus;
  onRetry?: () => void;
  onChangePassword?: (currentPassword: string, newPassword: string) => Promise<void>;
  error?: string | null;
  };
}

const hookHarness = vi.hoisted(() => ({
  hookIndex: 0,
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown } | undefined>,
  callbacks: [] as Array<{ value: unknown; deps: readonly unknown[] } | undefined>,
  effects: [] as Array<{ cleanup: (() => void) | undefined; deps: readonly unknown[] | undefined } | undefined>,
  realtimeOptions: undefined as unknown,
  reset: (): void => undefined
}));

hookHarness.reset = (): void => {
  hookHarness.hookIndex = 0;
  hookHarness.states = [];
  hookHarness.refs = [];
  hookHarness.callbacks = [];
  hookHarness.effects = [];
  hookHarness.realtimeOptions = undefined;
};

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn()
}));

const appLocale = vi.hoisted(() => ({ value: 'es' as 'en' | 'es' }));

const errorMessageMock = vi.hoisted(() => vi.fn((_error: unknown, fallback: string) => fallback));

const nativeBridgeMocks = vi.hoisted(() => ({
  getNativeWebViewBridge: vi.fn(() => null),
  pairNativeDevice: vi.fn(async () => undefined),
  configureNativeRoomSession: vi.fn(async () => undefined),
  stageNativeRoomToken: vi.fn(),
  clearNativeRoomSession: vi.fn(),
  supportsNativeRoomPresence: vi.fn((bridge: { setRoomSession?: unknown } | null) => bridge !== null && typeof bridge.setRoomSession === 'function'),
  readNativeRoomPresenceState: vi.fn((bridge: { getRoomPresenceState?: () => string } | null) => bridge?.getRoomPresenceState?.() ?? 'IDLE'),
  readNativeSnapshot: vi.fn(() => null),
  resolveNativeReceiverStatus: vi.fn(() => 'offline' as const),
  supportsNativeDeviceCommands: vi.fn(() => false)
}));
const nativeRoomBridgeGetter = vi.hoisted(() => ({ get: vi.fn(() => null as unknown) }));

let sessionValues = new Map<string, string>();
const windowEventListeners = new Map<string, Set<(event: unknown) => void>>();
const intervalCallbacks: Array<() => void> = [];

const roomAudioMocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  oscillator: undefined as FakeOscillator | undefined,
  gain: undefined as FakeGain | undefined
}));

vi.mock('../../apps/web/node_modules/react', async (importOriginal) => {
  const actual = await importOriginal<typeof React>();
  return {
    ...actual,
    useState: <T>(initialState: T | (() => T)): [T, (nextState: T | ((currentState: T) => T)) => void] => {
      const index = hookHarness.hookIndex++;
      if (hookHarness.states[index] === undefined) {
        hookHarness.states[index] = typeof initialState === 'function'
          ? (initialState as () => T)()
          : initialState;
      }
      const setState = (nextState: T | ((currentState: T) => T)): void => {
        const currentState = hookHarness.states[index] as T;
        hookHarness.states[index] = typeof nextState === 'function'
          ? (nextState as (currentState: T) => T)(currentState)
          : nextState;
      };
      return [hookHarness.states[index] as T, setState];
    },
    useRef: <T>(initialValue: T): { current: T } => {
      const index = hookHarness.hookIndex++;
      if (hookHarness.refs[index] === undefined) hookHarness.refs[index] = { current: initialValue };
      return hookHarness.refs[index] as { current: T };
    },
    useCallback: <T>(callback: T, deps: readonly unknown[]): T => {
      const index = hookHarness.hookIndex++;
      const previous = hookHarness.callbacks[index];
      if (previous === undefined || !sameDependencies(previous.deps, deps)) {
        hookHarness.callbacks[index] = { value: callback, deps };
        return callback;
      }
      return previous.value as T;
    },
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]): void => {
      const index = hookHarness.hookIndex++;
      const previous = hookHarness.effects[index];
      if (previous !== undefined && deps !== undefined && sameDependencies(previous.deps ?? [], deps)) return;
      previous?.cleanup?.();
      const cleanup = effect();
      hookHarness.effects[index] = { cleanup: typeof cleanup === 'function' ? cleanup : undefined, deps };
    }
  };
});

vi.mock('../../apps/web/src/api', () => ({
  api: apiMocks,
  acknowledgeDeviceTokenRotation: vi.fn(),
  claimDeviceTokenRotation: vi.fn(),
  errorMessage: errorMessageMock,
  isApiError: (error: unknown, status?: number) => {
    if (typeof error !== 'object' || error === null || (error as { _apiError?: boolean })._apiError !== true) return false;
    return status === undefined || (error as { status?: number }).status === status;
  },
  isDeviceInvalidationError: (error: unknown) => typeof error === 'object' && error !== null
    && (error as { _apiError?: boolean })._apiError === true
    && (((error as { status?: number; code?: string }).status === 403 && (error as { code?: string }).code === 'DEVICE_INACTIVE')
      || ((error as { status?: number; code?: string }).status === 401 && (error as { code?: string }).code === 'DEVICE_TOKEN_REVOKED')),
  startupErrorMessage: () => 'Local service unavailable.'
}));

vi.mock('../../apps/web/src/app-model', () => ({
  ADMIN_SESSION_STORAGE_KEY: 'hotel-local-admin-session',
  DEVICE_ID_STORAGE_KEY: 'hotel-local-device-id',
  DEVICE_PENDING_TOKEN_ROTATION_STORAGE_KEY: 'hotel-local-pending-token-rotation',
  DEVICE_SNAPSHOT_STORAGE_KEY: 'hotel-local-device-snapshot',
  DEVICE_SYNC_STATE_STORAGE_KEY: 'hotel-local-device-sync-state',
  DEVICE_TOKEN_STORAGE_KEY: 'hotel-local-device-token',
  clearPersistedDeviceState: (storage: { removeItem: (key: string) => void }) => {
    for (const key of [
      'hotel-local-device-token',
      'hotel-local-device-id',
      'hotel-local-pending-token-rotation',
      'hotel-local-device-sync-state',
      'hotel-local-device-snapshot',
      'hotel-local-installation-id',
      'hotel-local-client-instance-id',
      'hotel-local-room-request-queue',
      'hotel-local-locale'
    ]) storage.removeItem(key);
  },
  buildLocalDeviceSyncState: (deviceId: string, values: Record<string, unknown>) => ({ deviceId, ...values }),
  completeDeviceTokenRotation: vi.fn(),
  getOrCreateInstallationId: () => 'installation-1',
  rotateInstallationId: () => 'installation-2',
  makeMutationKey: () => 'mutation-1',
  parseAdminSession: (raw: string) => JSON.parse(raw),
  readLocalDeviceSnapshot: () => null,
  readPendingDeviceTokenRotation: (storage: { getItem: (key: string) => string | null }) => {
    const raw = storage.getItem('hotel-local-pending-token-rotation');
    if (raw === null) return null;
    try {
      const rotation: unknown = JSON.parse(raw);
      return typeof rotation === 'object' && rotation !== null
        && typeof (rotation as { rotationId?: unknown }).rotationId === 'string'
        && typeof (rotation as { deviceToken?: unknown }).deviceToken === 'string'
        ? rotation
        : null;
    } catch {
      return null;
    }
  },
  resolveStartupRetryDelayMs: () => 250,
  serializeLocalDeviceSnapshot: (snapshot: DeviceSyncSnapshot) => JSON.stringify(snapshot),
  serializeLocalDeviceSyncState: (state: unknown) => JSON.stringify(state),
  serializeAdminSession: (session: unknown) => JSON.stringify(session),
  shouldRetryStartup: () => true
}));

vi.mock('../../apps/web/src/i18n', () => ({
  useI18n: () => ({ locale: appLocale.value, t: (key: string) => key }),
  createTranslator: (locale: string) => (key: string) => locale === 'es'
    ? ({
      'errors.serviceUnavailable': 'El servicio local no está disponible. El reintento automático continuará con una espera limitada.',
      'errors.deviceProvisionFailed': 'No se pudo registrar la estación. Revisa el destino seleccionado e inténtalo de nuevo.',
      'errors.internal': 'Algo salió mal. Inténtalo de nuevo.'
    } as Record<string, string>)[key] ?? key
    : ({
      'errors.internal': 'Something went wrong. Try again.'
    } as Record<string, string>)[key] ?? key,
  SpanishI18nProvider: ({ children }: { children: React.ReactNode }) => children
}));

vi.mock('../../apps/web/src/realtime', () => ({
  shouldWebViewSendRestHeartbeat: (input: { isRoomDevice: boolean; nativeRoomPresenceSupported: boolean }) => !input.isRoomDevice || !input.nativeRoomPresenceSupported,
  useRealtimeConnection: (options: unknown) => {
    hookHarness.realtimeOptions = options;
  }
}));

vi.mock('../../apps/web/src/native-station-bridge', () => ({
  getNativeStationBridge: () => nativeBridgeMocks.getNativeWebViewBridge(),
  pairNativeStation: nativeBridgeMocks.pairNativeDevice,
  readNativeStationSnapshot: nativeBridgeMocks.readNativeSnapshot,
  resolveNativeStationReceiverStatus: nativeBridgeMocks.resolveNativeReceiverStatus
}));
vi.mock('../../apps/web/src/native-bridge', () => ({
  getNativeWebViewBridge: nativeBridgeMocks.getNativeWebViewBridge,
  supportsNativeDeviceCommands: nativeBridgeMocks.supportsNativeDeviceCommands
}));
vi.mock('../../apps/web/src/native-room-bridge', () => ({
  getNativeRoomPresenceBridge: () => nativeRoomBridgeGetter.get(),
  clearNativeRoomSession: nativeBridgeMocks.clearNativeRoomSession,
  configureNativeRoomSession: nativeBridgeMocks.configureNativeRoomSession,
  readNativeRoomPresenceState: nativeBridgeMocks.readNativeRoomPresenceState,
  stageNativeRoomToken: nativeBridgeMocks.stageNativeRoomToken,
  supportsNativeRoomPresence: nativeBridgeMocks.supportsNativeRoomPresence
}));

vi.mock('../../apps/web/src/components/LanguageSelector', () => ({ LanguageSelector: 'language-selector' }));
vi.mock('../../apps/web/src/components/Modal', () => ({ Modal: 'modal' }));
vi.mock('../../apps/web/src/features/auth/AdminLoginForm', () => ({ AdminLoginForm: 'admin-login-form' }));
vi.mock('../../apps/web/src/features/admin/AdminScreen', () => ({
  AdminPasswordChangeScreen: 'admin-password-change-screen',
  AdminScreen: 'admin-screen'
}));
vi.mock('../../apps/web/src/features/bootstrap/BootstrapScreen', () => ({ BootstrapScreen: 'bootstrap-screen' }));
vi.mock('../../apps/web/src/features/bootstrap/DeviceRoleAssignmentScreen', () => ({
  DeviceRoleAssignmentScreen: 'device-role-assignment-screen',
  buildDeviceBootstrapInput: (installationId: string, role: 'ROOM' | 'AREA', target: { id: string; displayName: string }) => ({
    installationId,
    displayName: target.displayName,
    assignmentMode: role,
    roomId: role === 'ROOM' ? target.id : null,
    areaId: role === 'AREA' ? target.id : null
  })
}));
vi.mock('../../apps/web/src/features/device/DeviceScreen', () => ({ DeviceScreen: 'device-screen' }));

const { App } = await import('../../apps/web/src/App');

describe('App room request notification lifecycle', () => {
  beforeEach(() => {
    hookHarness.reset();
    appLocale.value = 'es';
    errorMessageMock.mockClear();
    const audioContext = createFakeAudioContext();
    roomAudioMocks.constructor.mockImplementation(() => audioContext);
    sessionValues = new Map();
    windowEventListeners.clear();
    intervalCallbacks.length = 0;
    vi.stubGlobal('window', {
      AudioContext: roomAudioMocks.constructor,
      addEventListener: (eventName: string, listener: (event: unknown) => void): void => {
        const listeners = windowEventListeners.get(eventName) ?? new Set<(event: unknown) => void>();
        listeners.add(listener);
        windowEventListeners.set(eventName, listeners);
      },
      removeEventListener: (eventName: string, listener: (event: unknown) => void): void => {
        windowEventListeners.get(eventName)?.delete(listener);
      },
      setInterval: (callback: () => void): number => {
        intervalCallbacks.push(callback);
        return intervalCallbacks.length;
      },
      clearInterval: vi.fn(),
      sessionStorage: {
        getItem: (key: string): string | null => sessionValues.get(key) ?? null,
        setItem: (key: string, value: string): void => { sessionValues.set(key, value); },
        removeItem: (key: string): void => { sessionValues.delete(key); }
      }
    });
    const values = new Map<string, string>([
      ['hotel-local-device-token', 'device-token'],
      ['hotel-local-device-id', 'device-1']
    ]);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string): string | null => values.get(key) ?? null,
        setItem: (key: string, value: string): void => { values.set(key, value); },
        removeItem: (key: string): void => { values.delete(key); }
      }
    });
    apiMocks.get.mockResolvedValue({ data: createRoomSnapshot(), requestId: 'request-1' });
  });

  afterEach(() => {
    for (const effect of hookHarness.effects) effect?.cleanup?.();
    windowEventListeners.clear();
    intervalCallbacks.length = 0;
    hookHarness.reset();
    apiMocks.get.mockReset();
    apiMocks.post.mockReset();
    apiMocks.patch.mockReset();
    nativeBridgeMocks.getNativeWebViewBridge.mockReset().mockReturnValue(null);
    nativeBridgeMocks.pairNativeDevice.mockReset().mockResolvedValue(undefined);
    nativeBridgeMocks.configureNativeRoomSession.mockReset().mockResolvedValue(undefined);
    nativeBridgeMocks.stageNativeRoomToken.mockReset();
    nativeBridgeMocks.clearNativeRoomSession.mockReset();
    nativeBridgeMocks.supportsNativeRoomPresence.mockReset().mockImplementation((bridge) => bridge !== null && typeof bridge.setRoomSession === 'function');
    nativeBridgeMocks.readNativeRoomPresenceState.mockReset().mockImplementation((bridge) => bridge?.getRoomPresenceState?.() ?? 'IDLE');
    nativeBridgeMocks.readNativeSnapshot.mockReset().mockReturnValue(null);
    nativeBridgeMocks.resolveNativeReceiverStatus.mockReset().mockReturnValue('offline');
    nativeBridgeMocks.supportsNativeDeviceCommands.mockReset().mockReturnValue(false);
    nativeRoomBridgeGetter.get.mockReset().mockImplementation(() => nativeBridgeMocks.getNativeWebViewBridge());
    roomAudioMocks.constructor.mockReset();
    roomAudioMocks.oscillator = undefined;
    roomAudioMocks.gain = undefined;
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('keeps the bell read after initial snapshot hydration', async () => {
    await mountHydratedRoomApp();
    const realtime = getRealtimeOptions();

    await realtime.onEvent();
    const props = getDeviceScreenProps(renderApp());

    expect(props.roomRequestNotificationsUnread).toBe(false);
    expect(roomAudioMocks.constructor).not.toHaveBeenCalled();
  });

  it('restores an admin session before attempting device startup', async () => {
    sessionValues.set('hotel-local-admin-session', JSON.stringify({
      result: {
        admin: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' },
        csrfToken: 'csrf-token'
      },
      installationId: 'installation-1'
    }));
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path === '/auth/admin/me') return { data: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' }, requestId: 'request-admin-me' };
      if (path === '/system/snapshot') return { data: {}, requestId: 'request-admin-snapshot' };
      return { data: createRoomSnapshot(), requestId: 'request-device' };
    });

    renderApp();
    await flushPromises();

    const admin = getAdminScreenProps(renderApp());
    expect(admin).toMatchObject({ csrfToken: 'csrf-token', installationId: 'installation-1' });
    expect(apiMocks.get.mock.calls.map(([path]) => path)).toEqual(['/auth/admin/me', '/system/snapshot']);
  });

  it('does not load the admin snapshot after an admin login that requires a password change', async () => {
    const rendered = await completeFreshAdminLogin(true);

    expect(apiMocks.get.mock.calls.filter(([path]) => path === '/system/snapshot')).toHaveLength(0);
    expect(() => getAdminScreenProps(rendered)).toThrow('The AdminScreen was not rendered.');
  });

  it('renders an actionable password-change screen after a pending admin login', async () => {
    const rendered = await completeFreshAdminLogin(true);

    expect(getPasswordChangeHandler(rendered)).toBeTypeOf('function');
  });

  it('submits a forced password change securely and returns to fresh login after session revocation', async () => {
    apiMocks.post.mockResolvedValue({ data: {}, requestId: 'request-password-change' });
    const rendered = await completeFreshAdminLogin(true);
    const changePassword = getPasswordChangeHandler(rendered);

    await changePassword('admin', 'new-secret-passphrase');

    expect(apiMocks.post).toHaveBeenCalledWith('/auth/admin/change-password', {
      currentPassword: 'admin',
      newPassword: 'new-secret-passphrase'
    }, {
      headers: {
        'x-csrf-token': 'csrf-token',
        'Idempotency-Key': expect.any(String)
      }
    });
    expect(sessionValues.has('hotel-local-admin-session')).toBe(false);
    expect(getBootstrapScreenProps(renderApp())).toBeDefined();
    expect(apiMocks.get.mock.calls.filter(([path]) => path === '/system/snapshot')).toHaveLength(0);
  });

  it.each([
    ['es', 'Algo salió mal. Inténtalo de nuevo.'],
    ['en', 'Something went wrong. Try again.']
  ] as const)('shows forced password-change API errors in the selected %s locale', async (locale, expectedMessage) => {
    appLocale.value = locale;
    apiMocks.post.mockRejectedValue(new Error('password update unavailable'));
    const rendered = await completeFreshAdminLogin(true);
    const changePassword = getPasswordChangeHandler(rendered);

    await changePassword('admin', 'replacement-password');

    expect(sessionValues.has('hotel-local-admin-session')).toBe(true);
    expect(getPasswordChangeError(renderApp())).toBe(expectedMessage);
    expect(errorMessageMock).toHaveBeenCalledWith(expect.any(Error), expectedMessage, locale);
    expect(apiMocks.get.mock.calls.filter(([path]) => path === '/system/snapshot')).toHaveLength(0);
  });

  it('restores a pending admin session without fetching the admin snapshot', async () => {
    clearBrowserDeviceCredentials();
    sessionValues.set('hotel-local-admin-session', JSON.stringify({
      result: {
        admin: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' },
        csrfToken: 'csrf-token'
      },
      installationId: 'installation-1'
    }));
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path === '/auth/admin/me') return { data: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z', mustChangePassword: true }, requestId: 'request-admin-me' };
      if (path === '/system/snapshot') return { data: {}, requestId: 'request-admin-snapshot' };
      if (path.startsWith('/devices/bootstrap-state')) return { data: { installationId: 'installation-1', configured: false, displayHint: null }, requestId: 'request-bootstrap-state' };
      return { data: createRoomSnapshot(), requestId: 'request-device' };
    });

    renderApp();
    await flushPromises();
    const rendered = renderApp();

    expect(apiMocks.get.mock.calls.filter(([path]) => path === '/system/snapshot')).toHaveLength(0);
    expect(() => getAdminScreenProps(rendered)).toThrow('The AdminScreen was not rendered.');
  });

  it('exposes the password-change action to a restored non-pending admin and requires a fresh login after success', async () => {
    clearBrowserDeviceCredentials();
    sessionValues.set('hotel-local-admin-session', JSON.stringify({
      result: {
        admin: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' },
        csrfToken: 'csrf-token'
      },
      installationId: 'installation-1'
    }));
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path === '/auth/admin/me') return { data: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z', mustChangePassword: false }, requestId: 'request-admin-me' };
      if (path === '/system/snapshot') return { data: {}, requestId: 'request-admin-snapshot' };
      if (path.startsWith('/devices/bootstrap-state')) return { data: { installationId: 'installation-1', configured: false, displayHint: null }, requestId: 'request-bootstrap-state' };
      return { data: createRoomSnapshot(), requestId: 'request-device' };
    });
    apiMocks.post.mockResolvedValue({ data: {}, requestId: 'request-password-change' });

    renderApp();
    await flushPromises();
    const admin = getAdminScreenProps(renderApp());
    const snapshotRequestCount = apiMocks.get.mock.calls.filter(([path]) => path === '/system/snapshot').length;

    await admin.onChangePassword?.('current-secret', 'replacement-secret');

    expect(apiMocks.post).toHaveBeenCalledWith('/auth/admin/change-password', {
      currentPassword: 'current-secret',
      newPassword: 'replacement-secret'
    }, {
      headers: {
        'x-csrf-token': 'csrf-token',
        'Idempotency-Key': expect.any(String)
      }
    });
    expect(sessionValues.has('hotel-local-admin-session')).toBe(false);
    expect(getBootstrapScreenProps(renderApp())).toBeDefined();
    expect(apiMocks.get.mock.calls.filter(([path]) => path === '/system/snapshot')).toHaveLength(snapshotRequestCount);
  });

  it('keeps admin realtime browser-owned while native device realtime stays disabled', async () => {
    const nativeBridge = { getReceiverState: vi.fn(() => 'SYNCHRONIZED') };
    nativeBridgeMocks.getNativeWebViewBridge.mockReturnValue(nativeBridge);
    nativeBridgeMocks.readNativeSnapshot.mockReturnValue(createAreaSnapshot());
    nativeBridgeMocks.resolveNativeReceiverStatus.mockReturnValue('online');
    sessionValues.set('hotel-local-admin-session', JSON.stringify({
      result: {
        admin: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' },
        csrfToken: 'csrf-token'
      },
      installationId: 'installation-1'
    }));
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path === '/auth/admin/me') return { data: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' }, requestId: 'request-admin-me' };
      return { data: {}, requestId: 'request-admin-snapshot' };
    });

    renderApp();
    await flushPromises();
    renderApp();

    const adminRealtime = getRealtimeOptions();
    expect(adminRealtime).toMatchObject({ enabled: true, hasSnapshot: true });
    adminRealtime.onStatus('online');
    expect(getAdminScreenProps(renderApp()).connectionStatus).toBe('online');

    const admin = getAdminScreenProps(renderApp());
    await admin.onUseDeviceToken?.({ deviceId: 'device-1', deviceToken: 'native-secret', assignmentMode: 'AREA' });
    renderApp();

    expect(getDeviceScreenProps(renderApp())).toMatchObject({
      deviceCommandsSupported: false,
      deviceToken: '',
      nativeBridge
    });
    expect(nativeBridgeMocks.supportsNativeDeviceCommands).toHaveBeenCalledWith(nativeBridge);
    expect(getRealtimeOptions()).toMatchObject({ enabled: false, hasSnapshot: true });
  });

  it('hydrates a paired native snapshot without starting the browser device realtime client', async () => {
    clearBrowserDeviceCredentials();
    const nativeBridge = { getReceiverState: vi.fn(() => 'SYNCHRONIZED') };
    nativeBridgeMocks.getNativeWebViewBridge.mockReturnValue(nativeBridge);
    nativeBridgeMocks.readNativeSnapshot.mockReturnValue(createAreaSnapshot());
    nativeBridgeMocks.resolveNativeReceiverStatus.mockReturnValue('online');
    nativeBridgeMocks.supportsNativeDeviceCommands.mockReturnValue(true);

    renderApp();
    await flushPromises();
    renderApp();

    expect(getDeviceScreenProps(renderApp())).toMatchObject({
      deviceCommandsSupported: true,
      deviceToken: '',
      nativeBridge
    });
    expect(nativeBridgeMocks.supportsNativeDeviceCommands).toHaveBeenCalledWith(nativeBridge);
    expect(getRealtimeOptions()).toMatchObject({ enabled: false, hasSnapshot: true });
    expect(localStorage.getItem('hotel-local-device-token')).toBeNull();
  });

  it('keeps browser API request commands available for browser-only AREA stations', async () => {
    apiMocks.get.mockResolvedValue({ data: createAreaSnapshot(), requestId: 'request-area' });

    renderApp();
    await flushPromises();

    expect(getDeviceScreenProps(renderApp())).toMatchObject({
      deviceCommandsSupported: true,
      deviceToken: 'device-token',
      nativeBridge: null
    });
    expect(nativeBridgeMocks.supportsNativeDeviceCommands).not.toHaveBeenCalled();
  });

  it('does not fall back to browser device credentials when native snapshot is unavailable', async () => {
    clearBrowserDeviceCredentials();
    const nativeBridge = { getReceiverState: vi.fn(() => 'FETCHING_SNAPSHOT') };
    nativeBridgeMocks.getNativeWebViewBridge.mockReturnValue(nativeBridge);
    nativeBridgeMocks.readNativeSnapshot.mockReturnValue(null);

    renderApp();
    await flushPromises();
    await flushPromises();
    const rendered = renderApp() as TestElement;
    const bootstrap = rendered.props.children as TestElement;

    expect(bootstrap.type).toBe('bootstrap-screen');
    expect(getBootstrapScreenProps(rendered).error).toBeNull();
    expect(apiMocks.get).not.toHaveBeenCalledWith('/device/session', expect.anything());
    expect(getRealtimeOptions()).toMatchObject({ enabled: false, hasSnapshot: false });
  });

  it('keeps the generic startup error for real bootstrap API failures without a native bridge', async () => {
    clearBrowserDeviceCredentials();
    apiMocks.get.mockRejectedValue(new Error('bootstrap API unavailable'));

    renderApp();
    await flushPromises();
    await flushPromises();

    expect(getBootstrapScreenProps(renderApp()).error).toBe('Local service unavailable.');
  });

  it('routes the selected login role to station assignment before provisioning', async () => {
    clearBrowserDeviceCredentials();
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.startsWith('/devices/bootstrap-state')) return { data: { installationId: 'installation-1', configured: false, displayHint: null }, requestId: 'request-bootstrap-state' };
      if (path === '/system/snapshot') return { data: {}, requestId: 'request-admin-snapshot' };
      return { data: createRoomSnapshot(), requestId: 'request-device' };
    });

    renderApp();
    await flushPromises();
    await flushPromises();
    const bootstrap = getBootstrapScreenProps(renderApp());
    await bootstrap.onAdminLogin?.({
      admin: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' },
      csrfToken: 'csrf-token'
    }, 'ROOM');

    const assignmentProvider = renderApp() as TestElement;
    const assignment = assignmentProvider.props.children as TestElement;
    expect(assignment.type).toBe('device-role-assignment-screen');
    expect((assignment.props as AssignmentScreenPropsForTest).role).toBe('ROOM');
    expect(JSON.parse(sessionValues.get('hotel-local-admin-session') ?? '{}').pendingStationRole).toBe('ROOM');

    (assignment.props as AssignmentScreenPropsForTest).onAdmin?.();
    expect(getAdminScreenProps(renderApp())).toBeDefined();
    expect(JSON.parse(sessionValues.get('hotel-local-admin-session') ?? '{}')).not.toHaveProperty('pendingStationRole');
  });

  it('restores a pending AREA station assignment instead of opening Admin', async () => {
    sessionValues.set('hotel-local-admin-session', JSON.stringify({
      result: {
        admin: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' },
        csrfToken: 'csrf-token'
      },
      installationId: 'installation-1',
      pendingStationRole: 'AREA'
    }));
    const activeArea = {
      id: 'area-2', code: 'housekeeping', displayName: 'Housekeeping', description: null,
      displayOrder: 1, active: true, createdAt: '', updatedAt: ''
    };
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path === '/auth/admin/me') return { data: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' }, requestId: 'request-admin-me' };
      if (path === '/system/snapshot') return { data: { ...createAreaSnapshot(), areas: [] }, requestId: 'request-admin-snapshot' };
      if (path === '/areas') return { data: [activeArea], requestId: 'request-areas' };
      return { data: createAreaSnapshot(), requestId: 'request-device' };
    });

    renderApp();
    await flushPromises();
    await flushPromises();
    const assignment = (renderApp() as TestElement).props.children as TestElement;
    const props = assignment.props as AssignmentScreenPropsForTest;
    expect(assignment.type).toBe('device-role-assignment-screen');
    expect(props.role).toBe('AREA');
    expect(props.snapshot?.areas).toHaveLength(1);
  });

  it('restores a pending AREA assignment with a Spanish error when ROOM preference is English', async () => {
    sessionValues.set('hotel-local-admin-session', JSON.stringify({
      result: {
        admin: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' },
        csrfToken: 'csrf-token'
      },
      installationId: 'installation-1',
      pendingStationRole: 'AREA'
    }));
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path === '/auth/admin/me') return { data: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' }, requestId: 'request-admin-me' };
      if (path === '/system/snapshot') return { data: { ...createAreaSnapshot(), areas: [] }, requestId: 'request-admin-snapshot' };
      if (path === '/areas') throw new Error('areas endpoint unavailable');
      return { data: createAreaSnapshot(), requestId: 'request-device' };
    });

    renderApp();
    await flushPromises();
    await flushPromises();

    const assignment = (renderApp() as TestElement).props.children as TestElement;
    const props = assignment.props as AssignmentScreenPropsForTest;
    const expectedMessage = 'El servicio local no está disponible. El reintento automático continuará con una espera limitada.';
    expect(assignment.type).toBe('device-role-assignment-screen');
    expect(props.error).toBe(expectedMessage);
    expect(errorMessageMock).toHaveBeenCalledWith(expect.any(Error), expectedMessage, 'es');
  });

  it('hydrates missing AREA targets from the authenticated areas endpoint', async () => {
    clearBrowserDeviceCredentials();
    const activeArea = {
      id: 'area-2',
      code: 'housekeeping',
      displayName: 'Housekeeping',
      description: null,
      displayOrder: 1,
      active: true,
      createdAt: '',
      updatedAt: ''
    };
    const incompleteSnapshot = { ...createAreaSnapshot(), areas: [{ ...activeArea, active: false }] };
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.startsWith('/devices/bootstrap-state')) return { data: { installationId: 'installation-1', configured: false, displayHint: null }, requestId: 'request-bootstrap-state' };
      if (path === '/system/snapshot') return { data: incompleteSnapshot, requestId: 'request-admin-snapshot' };
      if (path === '/areas') return { data: [activeArea], requestId: 'request-areas' };
      return { data: createAreaSnapshot(), requestId: 'request-device' };
    });

    renderApp();
    await flushPromises();
    await flushPromises();
    const bootstrap = getBootstrapScreenProps(renderApp());
    await bootstrap.onAdminLogin?.({
      admin: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' },
      csrfToken: 'csrf-token'
    }, 'AREA');

    const assignment = (renderApp() as TestElement).props.children as TestElement;
    const props = assignment.props as AssignmentScreenPropsForTest;
    expect(apiMocks.get).toHaveBeenCalledWith('/areas', { cache: 'no-store' });
    expect(props.snapshot?.areas).toHaveLength(1);
    expect(props.snapshot?.areas?.[0]).toEqual(activeArea);
  });

  it('keeps the AREA assignment picker actionable when target hydration fails', async () => {
    clearBrowserDeviceCredentials();
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.startsWith('/devices/bootstrap-state')) return { data: { installationId: 'installation-1', configured: false, displayHint: null }, requestId: 'request-bootstrap-state' };
      if (path === '/system/snapshot') return { data: { ...createAreaSnapshot(), areas: [] }, requestId: 'request-admin-snapshot' };
      if (path === '/areas') throw new Error('areas endpoint unavailable');
      return { data: createAreaSnapshot(), requestId: 'request-device' };
    });

    renderApp();
    await flushPromises();
    await flushPromises();
    const bootstrap = getBootstrapScreenProps(renderApp());
    await bootstrap.onAdminLogin?.({
      admin: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' },
      csrfToken: 'csrf-token'
    }, 'AREA');

    const assignment = (renderApp() as TestElement).props.children as TestElement;
    expect(assignment.type).toBe('device-role-assignment-screen');
    expect((assignment.props as AssignmentScreenPropsForTest).error).toBe('El servicio local no está disponible. El reintento automático continuará con una espera limitada.');
  });

  it('normalizes missing AREA targets when hydration fails', async () => {
    clearBrowserDeviceCredentials();
    const { areas: _areas, ...snapshotWithoutAreas } = createAreaSnapshot();
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.startsWith('/devices/bootstrap-state')) return { data: { installationId: 'installation-1', configured: false, displayHint: null }, requestId: 'request-bootstrap-state' };
      if (path === '/system/snapshot') return { data: snapshotWithoutAreas, requestId: 'request-admin-snapshot' };
      if (path === '/areas') throw new Error('areas endpoint unavailable');
      return { data: createAreaSnapshot(), requestId: 'request-device' };
    });

    renderApp();
    await flushPromises();
    await flushPromises();
    const bootstrap = getBootstrapScreenProps(renderApp());
    await bootstrap.onAdminLogin?.({
      admin: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' },
      csrfToken: 'csrf-token'
    }, 'AREA');

    const assignment = (renderApp() as TestElement).props.children as TestElement;
    const props = assignment.props as AssignmentScreenPropsForTest;
    expect(assignment.type).toBe('device-role-assignment-screen');
    expect(props.snapshot?.areas).toEqual([]);
    expect(props.error).toBe('El servicio local no está disponible. El reintento automático continuará con una espera limitada.');
  });

  it('does not replace the AREA assignment picker while native pairing is unpaired', async () => {
    clearBrowserDeviceCredentials();
    const nativeBridge = { getReceiverState: vi.fn(() => 'FETCHING_SNAPSHOT') };
    nativeBridgeMocks.getNativeWebViewBridge.mockReturnValue(nativeBridge);
    nativeBridgeMocks.readNativeSnapshot.mockReturnValue(null);
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.startsWith('/devices/bootstrap-state')) return { data: { installationId: 'installation-1', configured: false, displayHint: null }, requestId: 'request-bootstrap-state' };
      if (path === '/system/snapshot') return { data: {}, requestId: 'request-admin-snapshot' };
      return { data: createAreaSnapshot(), requestId: 'request-device' };
    });

    renderApp();
    await flushPromises();
    await flushPromises();
    const bootstrap = getBootstrapScreenProps(renderApp());
    await bootstrap.onAdminLogin?.({
      admin: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' },
      csrfToken: 'csrf-token'
    }, 'AREA');

    renderApp();
    const refreshNativeSnapshot = intervalCallbacks.at(-1);
    if (refreshNativeSnapshot === undefined) throw new Error('Native refresh interval was not registered.');
    refreshNativeSnapshot();

    const rendered = renderApp() as TestElement;
    const assignment = rendered.props.children as TestElement;
    expect(assignment.type).toBe('device-role-assignment-screen');
    expect((assignment.props as AssignmentScreenPropsForTest).role).toBe('AREA');
  });

  it('keeps the AREA assignment picker when a pending native startup retry fires', async () => {
    vi.useFakeTimers();
    try {
      clearBrowserDeviceCredentials();
      const nativeBridge = { getReceiverState: vi.fn(() => 'FETCHING_SNAPSHOT') };
      nativeBridgeMocks.getNativeWebViewBridge.mockReturnValue(nativeBridge);
      nativeBridgeMocks.readNativeSnapshot.mockReturnValue(null);
      apiMocks.get.mockImplementation(async (path: string) => {
        if (path === '/system/snapshot') return { data: {}, requestId: 'request-admin-snapshot' };
        if (path === '/auth/admin/me') return { data: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' }, requestId: 'request-admin-me' };
        return { data: { configured: false, installationId: 'installation-1', displayHint: null }, requestId: 'request-bootstrap-state' };
      });

      renderApp();
      await flushPromises();
      const bootstrap = getBootstrapScreenProps(renderApp());
      await bootstrap.onAdminLogin?.({
        admin: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' },
        csrfToken: 'csrf-token'
      }, 'AREA');
      const assignmentBeforeRetry = renderApp() as TestElement;
      expect((assignmentBeforeRetry.props.children as TestElement).type).toBe('device-role-assignment-screen');

      vi.advanceTimersByTime(250);
      await flushPromises();
      const rendered = renderApp() as TestElement;
      const assignment = rendered.props.children as TestElement;
      expect(assignment.type).toBe('device-role-assignment-screen');
      expect((assignment.props as AssignmentScreenPropsForTest).role).toBe('AREA');
    } finally {
      vi.useRealTimers();
    }
  });

  it('auto-registers a selected room through the shared device bootstrap endpoint', async () => {
    clearBrowserDeviceCredentials();
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.startsWith('/devices/bootstrap-state')) return { data: { installationId: 'installation-1', configured: false, displayHint: null }, requestId: 'request-bootstrap-state' };
      if (path === '/system/snapshot') return { data: {}, requestId: 'request-admin-snapshot' };
      if (path === '/device/session') return { data: createRoomSnapshot(), requestId: 'request-room-session' };
      return { data: createRoomSnapshot(), requestId: 'request-device' };
    });
    apiMocks.post.mockImplementation(async (path: string) => {
      if (path === '/devices/bootstrap') {
        return { data: { device: { id: 'device-room-2', assignmentMode: 'ROOM' }, deviceToken: 'room-secret' }, requestId: 'request-bootstrap' };
      }
      return { data: {}, requestId: 'request-logout' };
    });

    renderApp();
    await flushPromises();
    await flushPromises();
    const bootstrap = getBootstrapScreenProps(renderApp());
    await bootstrap.onAdminLogin?.({
      admin: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' },
      csrfToken: 'csrf-token'
    }, 'ROOM');
    const assignment = (renderApp() as TestElement).props.children as TestElement;
    const assignmentProps = assignment.props as AssignmentScreenPropsForTest;
    assignmentProps.onSelect?.({ id: 'room-2', displayName: 'Room 102' });
    await flushPromises();
    await flushPromises();

    expect(apiMocks.post).toHaveBeenCalledWith('/devices/bootstrap', {
      installationId: 'installation-1',
      displayName: 'Room 102',
      assignmentMode: 'ROOM',
      roomId: 'room-2',
      areaId: null
    }, expect.anything());
    const bootstrapCall = apiMocks.post.mock.calls.find(([path]) => path === '/devices/bootstrap');
    expect(bootstrapCall?.[2]).toMatchObject({
      headers: { 'Idempotency-Key': 'station-onboarding-ROOM-installation-1-room-2' }
    });
    expect(localStorage.getItem('hotel-local-device-token')).toBe('room-secret');
    expect(sessionValues.get('hotel-local-admin-session')).toBeUndefined();
    expect(getDeviceScreenProps(renderApp())).toBeDefined();
  });

  it('replays the same AREA bootstrap mutation after native handoff fails', async () => {
    clearBrowserDeviceCredentials();
    const nativeBridge = { getReceiverState: vi.fn(() => 'IDLE') };
    nativeBridgeMocks.getNativeWebViewBridge.mockReturnValue(nativeBridge);
    nativeBridgeMocks.readNativeSnapshot.mockReturnValue(null);
    let pairAttempts = 0;
    nativeBridgeMocks.pairNativeDevice.mockImplementation(async () => {
      pairAttempts += 1;
      if (pairAttempts === 1) throw new Error('PAIRING_START_FAILED');
      nativeBridgeMocks.readNativeSnapshot.mockReturnValue(createAreaSnapshot());
    });
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.startsWith('/devices/bootstrap-state')) return { data: { installationId: 'installation-1', configured: false, displayHint: null }, requestId: 'request-bootstrap-state' };
      if (path === '/system/snapshot') return { data: createAreaSnapshot(), requestId: 'request-admin-snapshot' };
      return { data: createAreaSnapshot(), requestId: 'request-device' };
    });
    apiMocks.post.mockImplementation(async (path: string) => {
      if (path === '/devices/bootstrap') return { data: { device: { id: 'device-area-2', assignmentMode: 'AREA' }, deviceToken: 'area-secret' }, requestId: 'request-bootstrap' };
      return { data: {}, requestId: 'request-logout' };
    });

    renderApp();
    await flushPromises();
    await flushPromises();
    await getBootstrapScreenProps(renderApp()).onAdminLogin?.({
      admin: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' },
      csrfToken: 'csrf-token'
    }, 'AREA');
    const firstAssignment = (renderApp() as TestElement).props.children as TestElement;
    (firstAssignment.props as AssignmentScreenPropsForTest).onSelect?.({ id: 'area-2', displayName: 'Housekeeping' });
    await flushPromises();
    await flushPromises();

    const retryAssignment = (renderApp() as TestElement).props.children as TestElement;
    expect((retryAssignment.props as AssignmentScreenPropsForTest).error).toBe('No se pudo registrar la estación. Revisa el destino seleccionado e inténtalo de nuevo.');
    (retryAssignment.props as AssignmentScreenPropsForTest).onSelect?.({ id: 'area-2', displayName: 'Housekeeping' });
    await flushPromises();
    await flushPromises();

    const bootstrapCalls = apiMocks.post.mock.calls.filter(([path]) => path === '/devices/bootstrap');
    expect(bootstrapCalls).toHaveLength(2);
    expect((bootstrapCalls[0]?.[2] as { headers: { 'Idempotency-Key': string } }).headers['Idempotency-Key'])
      .toBe('station-onboarding-AREA-installation-1-area-2');
    expect((bootstrapCalls[1]?.[2] as { headers: { 'Idempotency-Key': string } }).headers['Idempotency-Key'])
      .toBe('station-onboarding-AREA-installation-1-area-2');
    expect(getDeviceScreenProps(renderApp())).toBeDefined();
  });

  it.each([
    ['ROOM', 'room-2', 'Room 102', createRoomSnapshot],
    ['AREA', 'area-2', 'Housekeeping', createAreaSnapshot]
  ] as const)('rotates a retired installation before retrying %s provisioning', async (role, targetId, displayName, snapshotFactory) => {
    clearBrowserDeviceCredentials();
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.startsWith('/devices/bootstrap-state')) return { data: { installationId: 'installation-1', configured: false, displayHint: null }, requestId: 'request-bootstrap-state' };
      if (path === '/system/snapshot') return { data: {}, requestId: 'request-admin-snapshot' };
      if (path === '/device/session') return { data: snapshotFactory(), requestId: 'request-device-session' };
      return { data: snapshotFactory(), requestId: 'request-device' };
    });
    apiMocks.post.mockImplementation(async (path: string, body?: { installationId?: string }) => {
      if (path === '/devices/bootstrap' && body?.installationId === 'installation-1') {
        throw { _apiError: true, status: 409, code: 'RESOURCE_CONFLICT', details: { reason: 'RETIRED_INSTALLATION' } };
      }
      if (path === '/devices/bootstrap') {
        return { data: { device: { id: `device-${role.toLowerCase()}`, assignmentMode: role }, deviceToken: `${role.toLowerCase()}-secret` }, requestId: 'request-bootstrap-retry' };
      }
      return { data: {}, requestId: 'request-logout' };
    });

    renderApp();
    await flushPromises();
    await flushPromises();
    await getBootstrapScreenProps(renderApp()).onAdminLogin?.({
      admin: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' },
      csrfToken: 'csrf-token'
    }, role);
    const assignment = (renderApp() as TestElement).props.children as TestElement;
    (assignment.props as AssignmentScreenPropsForTest).onSelect?.({ id: targetId, displayName });
    await flushPromises();
    await flushPromises();

    const bootstrapCalls = apiMocks.post.mock.calls.filter(([path]) => path === '/devices/bootstrap');
    expect(bootstrapCalls).toHaveLength(2);
    expect(bootstrapCalls[0]?.[1]).toMatchObject({ installationId: 'installation-1' });
    expect(bootstrapCalls[1]?.[1]).toMatchObject({ installationId: 'installation-2' });
    expect(getDeviceScreenProps(renderApp())).toBeDefined();
  });

  it('does not rotate or retry an active installation conflict', async () => {
    clearBrowserDeviceCredentials();
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.startsWith('/devices/bootstrap-state')) return { data: { installationId: 'installation-1', configured: false, displayHint: null }, requestId: 'request-bootstrap-state' };
      if (path === '/system/snapshot') return { data: {}, requestId: 'request-admin-snapshot' };
      return { data: createRoomSnapshot(), requestId: 'request-device' };
    });
    apiMocks.post.mockImplementation(async (path: string) => {
      if (path === '/devices/bootstrap') throw { _apiError: true, status: 409, code: 'RESOURCE_CONFLICT' };
      return { data: {}, requestId: 'request-logout' };
    });

    renderApp();
    await flushPromises();
    await flushPromises();
    await getBootstrapScreenProps(renderApp()).onAdminLogin?.({
      admin: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' },
      csrfToken: 'csrf-token'
    }, 'ROOM');
    const assignment = (renderApp() as TestElement).props.children as TestElement;
    (assignment.props as AssignmentScreenPropsForTest).onSelect?.({ id: 'room-2', displayName: 'Room 102' });
    await flushPromises();
    await flushPromises();

    expect(apiMocks.post.mock.calls.filter(([path]) => path === '/devices/bootstrap')).toHaveLength(1);
    const finalAssignment = (renderApp() as TestElement).props.children as TestElement;
    expect((finalAssignment.props as AssignmentScreenPropsForTest).error).toBe('No se pudo registrar la estación. Revisa el destino seleccionado e inténtalo de nuevo.');
  });

  it('recovers the native device view when a snapshot becomes available after an empty read', async () => {
    clearBrowserDeviceCredentials();
    const nativeBridge = { getReceiverState: vi.fn(() => 'SYNCHRONIZED') };
    nativeBridgeMocks.getNativeWebViewBridge.mockReturnValue(nativeBridge);
    nativeBridgeMocks.readNativeSnapshot
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(createAreaSnapshot());

    renderApp();
    await flushPromises();
    await flushPromises();
    const initial = renderApp() as TestElement;
    expect((initial.props.children as TestElement).type).toBe('bootstrap-screen');

    const refreshNativeSnapshot = intervalCallbacks[0];
    if (refreshNativeSnapshot === undefined) throw new Error('Native refresh interval was not registered.');
    refreshNativeSnapshot();
    const recovered = renderApp();

    expect(getDeviceScreenProps(recovered)).toBeDefined();
    expect(getRealtimeOptions()).toMatchObject({ enabled: false, hasSnapshot: true });
    expect(apiMocks.get).not.toHaveBeenCalledWith('/device/session', expect.anything());
  });

  it('re-enters native initialization from bootstrap retry when the bridge is present', async () => {
    clearBrowserDeviceCredentials();
    const nativeBridge = { getReceiverState: vi.fn(() => 'SYNCHRONIZED') };
    nativeBridgeMocks.getNativeWebViewBridge.mockReturnValue(nativeBridge);
    nativeBridgeMocks.readNativeSnapshot
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(createAreaSnapshot());

    renderApp();
    await flushPromises();
    await flushPromises();
    const bootstrap = getBootstrapScreenProps(renderApp());

    bootstrap.onRetry?.();
    await flushPromises();
    await flushPromises();

    expect(getDeviceScreenProps(renderApp())).toBeDefined();
    expect(apiMocks.get).not.toHaveBeenCalledWith('/devices/bootstrap-state?installationId=installation-1');
    expect(apiMocks.get).not.toHaveBeenCalledWith('/device/session', expect.anything());
  });

  it('clears the stale native device view when refresh finds no snapshot', async () => {
    clearBrowserDeviceCredentials();
    const nativeBridge = { getReceiverState: vi.fn(() => 'SYNCHRONIZED') };
    nativeBridgeMocks.getNativeWebViewBridge.mockReturnValue(nativeBridge);
    nativeBridgeMocks.readNativeSnapshot.mockReturnValue(createAreaSnapshot());

    renderApp();
    await flushPromises();
    renderApp();
    expect(getDeviceScreenProps(renderApp())).toBeDefined();

    nativeBridgeMocks.readNativeSnapshot.mockReturnValue(null);
    const refreshNativeSnapshot = intervalCallbacks[0];
    if (refreshNativeSnapshot === undefined) throw new Error('Native refresh interval was not registered.');
    refreshNativeSnapshot();
    const rendered = renderApp() as TestElement;
    const bootstrap = rendered.props.children as TestElement;

    expect(bootstrap.type).toBe('bootstrap-screen');
    expect(getBootstrapScreenProps(rendered).error).toBeNull();
    expect(getRealtimeOptions()).toMatchObject({ enabled: false, hasSnapshot: false });
    expect(apiMocks.get).not.toHaveBeenCalled();
  });

  it('clears browser assignment state and rotates installation after native station invalidation', async () => {
    clearBrowserDeviceCredentials();
    localStorage.setItem('hotel-local-device-snapshot', JSON.stringify(createAreaSnapshot()));
    localStorage.setItem('hotel-local-device-sync-state', JSON.stringify({ deviceId: 'device-1', lastSeenEventSequence: 3 }));
    localStorage.setItem('hotel-local-pending-token-rotation', JSON.stringify({ rotationId: 'rotation-1', deviceToken: 'next-token' }));
    const nativeBridge = { getReceiverState: vi.fn(() => 'AUTH_FAILED') };
    nativeBridgeMocks.getNativeWebViewBridge.mockReturnValue(nativeBridge);
    nativeBridgeMocks.readNativeSnapshot.mockReturnValue(createAreaSnapshot());

    renderApp();
    await flushPromises();
    renderApp();
    expect(getDeviceScreenProps(renderApp())).toBeDefined();
    sessionValues.set('hotel-local-admin-session', JSON.stringify({ result: {}, installationId: 'installation-1' }));

    nativeBridgeMocks.readNativeSnapshot.mockReturnValue(null);
    const refreshNativeSnapshot = intervalCallbacks[0];
    if (refreshNativeSnapshot === undefined) throw new Error('Native refresh interval was not registered.');
    refreshNativeSnapshot();
    const rendered = renderApp() as TestElement;
    const bootstrap = rendered.props.children as TestElement;

    expect(bootstrap.type).toBe('bootstrap-screen');
    expect((bootstrap.props as { installationId?: string }).installationId).toBe('installation-2');
    expect(localStorage.getItem('hotel-local-device-token')).toBeNull();
    expect(localStorage.getItem('hotel-local-device-id')).toBeNull();
    expect(localStorage.getItem('hotel-local-device-snapshot')).toBeNull();
    expect(localStorage.getItem('hotel-local-device-sync-state')).toBeNull();
    expect(localStorage.getItem('hotel-local-pending-token-rotation')).toBeNull();
    expect(sessionValues.get('hotel-local-admin-session')).toBeUndefined();
  });

  it('clears a ROOM assignment after the native runtime confirms revocation', async () => {
    localStorage.setItem('hotel-local-device-snapshot', JSON.stringify(createRoomSnapshot()));
    const nativeBridge = {
      setRoomSession: vi.fn(),
      clearRoomSession: vi.fn(),
      getRoomPresenceState: vi.fn(() => 'INVALIDATED')
    };
    nativeBridgeMocks.getNativeWebViewBridge.mockReturnValue(null);
    nativeRoomBridgeGetter.get.mockReturnValue(nativeBridge);
    nativeBridgeMocks.readNativeRoomPresenceState.mockReturnValue('INVALIDATED');

    renderApp();
    await flushPromises();

    const rendered = renderApp() as TestElement;
    const bootstrap = rendered.props.children as TestElement;
    expect(bootstrap.type).toBe('bootstrap-screen');
    expect((bootstrap.props as { installationId?: string }).installationId).toBe('installation-2');
    expect(localStorage.getItem('hotel-local-device-token')).toBeNull();
    expect(localStorage.getItem('hotel-local-device-id')).toBeNull();
    expect(localStorage.getItem('hotel-local-device-snapshot')).toBeNull();
    expect(nativeBridgeMocks.clearNativeRoomSession).toHaveBeenCalledWith(nativeBridge);
  });

  it('recovers a ROOM reload from a revoked browser token using the persisted rotation replacement', async () => {
    localStorage.setItem('hotel-local-pending-token-rotation', JSON.stringify({ rotationId: 'rotation-1', deviceToken: 'replacement-token' }));
    const nativeBridge = { setRoomSession: vi.fn() };
    nativeBridgeMocks.getNativeWebViewBridge.mockReturnValue(null);
    nativeRoomBridgeGetter.get.mockReturnValue(nativeBridge);
    apiMocks.get.mockImplementation(async (path: string, options?: { token?: string }) => {
      if (path === '/device/session' && options?.token === 'device-token') {
        throw Object.assign(new Error('revoked'), { _apiError: true, status: 401, code: 'DEVICE_TOKEN_REVOKED' });
      }
      if (path === '/device/session') return { data: createRoomSnapshot(), requestId: 'request-room-recovered' };
      return { data: createRoomSnapshot(), requestId: 'request-device' };
    });

    renderApp();
    await flushPromises();
    renderApp();

    expect(localStorage.getItem('hotel-local-device-token')).toBe('replacement-token');
    expect(localStorage.getItem('hotel-local-pending-token-rotation')).toBeNull();
    expect(nativeBridgeMocks.configureNativeRoomSession).toHaveBeenCalledWith(nativeBridge, {
      deviceId: 'device-1', deviceToken: 'replacement-token'
    });
    expect(nativeBridgeMocks.pairNativeDevice).not.toHaveBeenCalled();
  });

  it('hands an administrator pairing token to native without persisting browser device credentials', async () => {
    const nativeBridge = { getReceiverState: vi.fn(() => 'SYNCHRONIZED') };
    nativeBridgeMocks.getNativeWebViewBridge.mockReturnValue(nativeBridge);
    nativeBridgeMocks.readNativeSnapshot.mockReturnValue(createAreaSnapshot());
    nativeBridgeMocks.resolveNativeReceiverStatus.mockReturnValue('online');
    sessionValues.set('hotel-local-admin-session', JSON.stringify({
      result: {
        admin: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' },
        csrfToken: 'csrf-token'
      },
      installationId: 'installation-1'
    }));
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path === '/auth/admin/me') return { data: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' }, requestId: 'request-admin-me' };
      return { data: {}, requestId: 'request-admin-snapshot' };
    });

    renderApp();
    await flushPromises();
    const admin = getAdminScreenProps(renderApp());

    await admin.onUseDeviceToken?.({ deviceId: 'device-1', deviceToken: 'native-secret', assignmentMode: 'AREA' });
    renderApp();

    expect(nativeBridgeMocks.pairNativeDevice).toHaveBeenCalledWith(nativeBridge, { deviceId: 'device-1', deviceToken: 'native-secret' });
    expect(nativeBridgeMocks.configureNativeRoomSession).not.toHaveBeenCalled();
    expect(apiMocks.post).toHaveBeenCalledWith('/auth/admin/logout', undefined, expect.anything());
    expect(localStorage.getItem('hotel-local-device-token')).toBeNull();
    expect(getRealtimeOptions()).toMatchObject({ enabled: false, hasSnapshot: true });
  });

  it('waits for the native AREA snapshot after pairing succeeds', async () => {
    const nativeBridge = { getReceiverState: vi.fn(() => 'SYNCHRONIZED') };
    nativeBridgeMocks.getNativeWebViewBridge.mockReturnValue(nativeBridge);
    nativeBridgeMocks.readNativeSnapshot
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(createAreaSnapshot());
    nativeBridgeMocks.resolveNativeReceiverStatus.mockReturnValue('online');
    sessionValues.set('hotel-local-admin-session', JSON.stringify({
      result: {
        admin: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' },
        csrfToken: 'csrf-token'
      },
      installationId: 'installation-1'
    }));
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path === '/auth/admin/me') return { data: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' }, requestId: 'request-admin-me' };
      return { data: {}, requestId: 'request-admin-snapshot' };
    });

    renderApp();
    await flushPromises();
    const admin = getAdminScreenProps(renderApp());

    await admin.onUseDeviceToken?.({ deviceId: 'device-1', deviceToken: 'native-secret', assignmentMode: 'AREA' });
    const rendered = renderApp();
    const children = Array.isArray((rendered as TestElement).props.children)
      ? (rendered as TestElement).props.children
      : [(rendered as TestElement).props.children];

    expect(getDeviceScreenProps(rendered)).toBeDefined();
    expect(children).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'device-role-assignment-screen' })]));
    expect(children).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'bootstrap-screen' })]));
    expect(nativeBridgeMocks.readNativeSnapshot).toHaveBeenCalledTimes(2);
  });

  it('restores stored browser ROOM credentials before a native snapshot on reload', async () => {
    const nativeBridge = { getReceiverState: vi.fn(() => 'SYNCHRONIZED') };
    nativeBridgeMocks.getNativeWebViewBridge.mockReturnValue(nativeBridge);
    nativeBridgeMocks.readNativeSnapshot.mockReturnValue(createAreaSnapshot());
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path === '/device/session') return { data: createRoomSnapshot(), requestId: 'request-room-session' };
      return { data: createRoomSnapshot(), requestId: 'request-device' };
    });

    renderApp();
    await flushPromises();
    renderApp();

    expect(getDeviceScreenProps(renderApp())).not.toHaveProperty('deviceCommandsSupported');
    expect(getDeviceScreenProps(renderApp())).not.toHaveProperty('nativeBridge');
    expect(getRealtimeOptions()).toMatchObject({ enabled: true, hasSnapshot: true, deviceId: 'device-1', deviceToken: 'device-token' });
    expect(nativeBridgeMocks.readNativeSnapshot).not.toHaveBeenCalled();
    expect(intervalCallbacks).toHaveLength(0);
  });

  it('keeps ROOM provisioning in the browser even when the native bridge is present', async () => {
    const nativeBridge = {
      getReceiverState: vi.fn(() => 'SYNCHRONIZED'),
      setRoomSession: vi.fn()
    };
    nativeBridgeMocks.getNativeWebViewBridge.mockReturnValue(nativeBridge);
    nativeRoomBridgeGetter.get.mockReturnValue(nativeBridge);
    nativeBridgeMocks.readNativeSnapshot.mockReturnValue(createAreaSnapshot());
    sessionValues.set('hotel-local-admin-session', JSON.stringify({
      result: {
        admin: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' },
        csrfToken: 'csrf-token'
      },
      installationId: 'installation-1'
    }));
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path === '/auth/admin/me') return { data: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z' }, requestId: 'request-admin-me' };
      if (path === '/system/snapshot') return { data: {}, requestId: 'request-admin-snapshot' };
      if (path === '/device/session') return { data: createRoomSnapshot(), requestId: 'request-room-session' };
      return { data: createRoomSnapshot(), requestId: 'request-device' };
    });

    renderApp();
    await flushPromises();
    const admin = getAdminScreenProps(renderApp());

    await admin.onUseDeviceToken?.({ deviceId: 'device-1', deviceToken: 'room-secret', assignmentMode: 'ROOM' });
    renderApp();

    expect(nativeBridgeMocks.pairNativeDevice).not.toHaveBeenCalled();
    expect(nativeBridgeMocks.configureNativeRoomSession).toHaveBeenCalledWith(nativeBridge, {
      deviceId: 'device-1', deviceToken: 'room-secret'
    });
    expect(nativeBridgeMocks.readNativeSnapshot).not.toHaveBeenCalled();
    expect(localStorage.getItem('hotel-local-device-token')).toBe('room-secret');
    expect(getDeviceScreenProps(renderApp())).not.toHaveProperty('deviceCommandsSupported');
    expect(getDeviceScreenProps(renderApp())).not.toHaveProperty('nativeBridge');
    expect(getRealtimeOptions()).toMatchObject({ enabled: true, hasSnapshot: true, deviceToken: 'room-secret' });
    expect(intervalCallbacks).toHaveLength(1);
  });

  it('marks the bell unread for room-scoped request creation and update events', async () => {
    await mountHydratedRoomApp();
    const roomRequestEvent = { payload: { request: { roomId: 'room-1' } } };

    for (const eventName of ['request.created', 'request.updated']) {
      await getRealtimeOptions().onEvent(eventName, roomRequestEvent);
      const props = getDeviceScreenProps(renderApp());
      expect(props.roomRequestNotificationsUnread).toBe(true);

      props.onClearRoomRequestNotifications?.();
      getDeviceScreenProps(renderApp());
    }
  });

  it('plays one room arrival tone for a genuinely new realtime request event', async () => {
    await mountHydratedRoomApp();
    const roomRequestEvent = {
      eventId: 'event-2',
      eventSequence: 2,
      payload: { request: { roomId: 'room-1' } }
    };

    await getRealtimeOptions().onEvent('request.created', roomRequestEvent);
    renderApp();
    await getRealtimeOptions().onEvent('request.created', { ...roomRequestEvent, payload: { request: { roomId: 'room-1' } } });

    expect(roomAudioMocks.oscillator?.start).toHaveBeenCalledTimes(1);
  });

  it('plays one tone for a room-scoped request status transition', async () => {
    await mountHydratedRoomApp();
    const statusEvent = {
      eventId: 'event-status-1',
      eventSequence: 2,
      payload: {
        request: { roomId: 'room-1' },
        transition: { from: 'PENDING', to: 'ACCEPTED' }
      }
    };

    await getRealtimeOptions().onEvent('request.updated', statusEvent);
    await getRealtimeOptions().onEvent('request.updated', statusEvent);

    expect(roomAudioMocks.oscillator?.start).toHaveBeenCalledTimes(1);
    expect(roomAudioMocks.oscillator?.stop).toHaveBeenCalledTimes(1);
  });

  it('unlocks a suspended room context during a user gesture without playing a tone', async () => {
    const audioContext = createFakeAudioContext('suspended');
    const oscillator = roomAudioMocks.oscillator;
    if (oscillator === undefined) throw new Error('The fake oscillator was not created.');
    roomAudioMocks.constructor.mockImplementation(() => audioContext);
    await mountHydratedRoomApp();

    triggerWindowEvent('pointerdown');
    await flushPromises();

    expect(audioContext.resume).toHaveBeenCalledTimes(1);
    expect(oscillator.start).not.toHaveBeenCalled();

    await getRealtimeOptions().onEvent('request.updated', {
      eventId: 'event-status-1',
      eventSequence: 2,
      payload: {
        request: { roomId: 'room-1' },
        transition: { from: 'PENDING', to: 'ACCEPTED' }
      }
    });

    expect(oscillator.start).toHaveBeenCalledTimes(1);
  });

  it('keeps the visual unread fallback when browser audio is unavailable', async () => {
    roomAudioMocks.constructor.mockImplementation(() => {
      throw new Error('AudioContext unavailable');
    });
    await mountHydratedRoomApp();

    await expect(getRealtimeOptions().onEvent('request.created', {
      eventId: 'event-2',
      eventSequence: 2,
      payload: { request: { roomId: 'room-1' } }
    })).resolves.toMatchObject({ synchronized: true });

    expect(getDeviceScreenProps(renderApp()).roomRequestNotificationsUnread).toBe(true);
  });

  it('clears the bell when the request-status navbar UI opens', async () => {
    await mountHydratedRoomApp();
    await getRealtimeOptions().onEvent('request.created', { payload: { request: { roomId: 'room-1' } } });
    const unreadProps = getDeviceScreenProps(renderApp());
    expect(unreadProps.roomRequestNotificationsUnread).toBe(true);

    unreadProps.onClearRoomRequestNotifications?.();
    const clearedProps = getDeviceScreenProps(renderApp());

    expect(clearedProps.roomRequestNotificationsUnread).toBe(false);
  });

  it('keeps the bell read for a different room and unrelated realtime events', async () => {
    await mountHydratedRoomApp();

    await getRealtimeOptions().onEvent('request.updated', {
      eventId: 'event-other-room',
      eventSequence: 2,
      payload: {
        request: { roomId: 'room-2' },
        transition: { from: 'PENDING', to: 'ACCEPTED' }
      }
    });
    expect(getDeviceScreenProps(renderApp()).roomRequestNotificationsUnread).toBe(false);
    expect(roomAudioMocks.constructor).not.toHaveBeenCalled();

    await getRealtimeOptions().onEvent('service.catalog.changed', { payload: { request: { roomId: 'room-1' } } });
    expect(getDeviceScreenProps(renderApp()).roomRequestNotificationsUnread).toBe(false);
  });
});

async function mountHydratedRoomApp(): Promise<void> {
  renderApp();
  await flushPromises();
  renderApp();
}

function renderApp(): unknown {
  hookHarness.hookIndex = 0;
  return App();
}

async function completeFreshAdminLogin(mustChangePassword: boolean): Promise<unknown> {
  clearBrowserDeviceCredentials();
  apiMocks.get.mockImplementation(async (path: string) => {
    if (path.startsWith('/devices/bootstrap-state')) return { data: { installationId: 'installation-1', configured: false, displayHint: null }, requestId: 'request-bootstrap-state' };
    if (path === '/system/snapshot') return { data: {}, requestId: 'request-admin-snapshot' };
    return { data: createRoomSnapshot(), requestId: 'request-device' };
  });

  renderApp();
  await flushPromises();
  await flushPromises();
  await getBootstrapScreenProps(renderApp()).onAdminLogin?.({
    admin: { id: 'admin-1', username: 'admin', expiresAt: '2026-09-01T00:00:00.000Z', mustChangePassword },
    csrfToken: 'csrf-token'
  }, 'ADMIN');

  return renderApp();
}

function getRealtimeOptions(): RealtimeOptionsForTest {
  if (hookHarness.realtimeOptions === undefined) throw new Error('Realtime options were not captured.');
  return hookHarness.realtimeOptions as RealtimeOptionsForTest;
}

function getDeviceScreenProps(rendered: unknown): DeviceScreenPropsForTest {
  const root = rendered as TestElement;
  const children = Array.isArray(root.props.children) ? root.props.children : [root.props.children];
  const device = children.find((child): child is TestElement => {
    if (typeof child !== 'object' || child === null) return false;
    return (child as TestElement).type === 'device-screen';
  });
  if (device === undefined) throw new Error('The room DeviceScreen was not rendered.');
  return device.props;
}

function getAdminScreenProps(rendered: unknown): AdminScreenPropsForTest {
  const root = rendered as TestElement;
  const children = Array.isArray(root.props.children) ? root.props.children : [root.props.children];
  const admin = children.find((child): child is TestElement => {
    if (typeof child !== 'object' || child === null) return false;
    return (child as TestElement).type === 'admin-screen';
  });
  if (admin === undefined) throw new Error('The AdminScreen was not rendered.');
  return admin.props;
}

function getBootstrapScreenProps(rendered: unknown): BootstrapScreenPropsForTest {
  const root = rendered as TestElement;
  const children = Array.isArray(root.props.children) ? root.props.children : [root.props.children];
  const bootstrap = children.find((child): child is TestElement => {
    if (typeof child !== 'object' || child === null) return false;
    return (child as TestElement).type === 'bootstrap-screen';
  });
  if (bootstrap === undefined) throw new Error('The BootstrapScreen was not rendered.');
  return bootstrap.props;
}

function getPasswordChangeHandler(rendered: unknown): (currentPassword: string, newPassword: string) => Promise<void> {
  const pending: unknown[] = Array.isArray(rendered) ? [...rendered] : [rendered];
  while (pending.length > 0) {
    const current = pending.shift();
    if (typeof current !== 'object' || current === null) continue;
    const element = current as TestElement;
    if (typeof element.props?.onChangePassword === 'function') return element.props.onChangePassword;
    const children = element.props?.children;
    if (Array.isArray(children)) pending.push(...children);
    else if (children !== undefined) pending.push(children);
  }
  throw new Error('The password-change screen was not rendered.');
}

function getPasswordChangeError(rendered: unknown): string | null {
  const pending: unknown[] = Array.isArray(rendered) ? [...rendered] : [rendered];
  while (pending.length > 0) {
    const current = pending.shift();
    if (typeof current !== 'object' || current === null) continue;
    const element = current as TestElement;
    if (typeof element.props?.onChangePassword === 'function') return element.props.error ?? null;
    const children = element.props?.children;
    if (Array.isArray(children)) pending.push(...children);
    else if (children !== undefined) pending.push(children);
  }
  throw new Error('The password-change screen was not rendered.');
}

function sameDependencies(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function triggerWindowEvent(eventName: string): void {
  for (const listener of windowEventListeners.get(eventName) ?? []) listener({ type: eventName });
}

function createRoomSnapshot(): DeviceSyncSnapshot {
  return {
    snapshotSequence: 1,
    currentEventSequence: 1,
    configurationRevision: 1,
    deviceConfigVersion: 1,
    serverTime: '2026-08-31T12:05:00.000Z',
    device: {
      id: 'device-1',
      installationId: 'installation-1',
      displayName: 'Room tablet',
      assignmentMode: 'ROOM',
      roomId: 'room-1',
      areaId: null,
      active: true,
      deviceConfigVersion: 1,
      lastHeartbeatAt: '2026-08-31T12:05:00.000Z',
      presence: 'ONLINE'
    },
    config: {
      mode: 'ROOM',
      room: { id: 'room-1', code: '101', displayName: 'Room 101' },
      area: null,
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
    pendingTokenRotation: null
  };
}

function clearBrowserDeviceCredentials(): void {
  localStorage.removeItem('hotel-local-device-token');
  localStorage.removeItem('hotel-local-device-id');
}

function createAreaSnapshot(): DeviceSyncSnapshot {
  const snapshot = createRoomSnapshot();
  return {
    ...snapshot,
    device: { ...snapshot.device, assignmentMode: 'AREA', roomId: null, areaId: 'area-1' },
    config: { ...snapshot.config, mode: 'AREA', room: null, area: { id: 'area-1', code: 'housekeeping', displayName: 'Housekeeping' } }
  };
}

interface FakeOscillator {
  type: string;
  frequency: { setValueAtTime: ReturnType<typeof vi.fn> };
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

interface FakeGain {
  gain: {
    setValueAtTime: ReturnType<typeof vi.fn>;
    exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
}

function createFakeAudioContext(state: 'running' | 'suspended' = 'running'): {
  state: 'running' | 'suspended';
  currentTime: number;
  destination: object;
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  createOscillator: ReturnType<typeof vi.fn>;
  createGain: ReturnType<typeof vi.fn>;
} {
  const oscillator: FakeOscillator = {
    type: '',
    frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn()
  };
  const gain: FakeGain = {
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn()
    },
    connect: vi.fn()
  };
  roomAudioMocks.oscillator = oscillator;
  roomAudioMocks.gain = gain;
  const context = {
    state,
    currentTime: 0,
    destination: {},
    resume: vi.fn(),
    close: vi.fn(),
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn(() => gain)
  };
  context.resume.mockImplementation(async () => {
    context.state = 'running';
  });
  context.close.mockImplementation(async () => {
    context.state = 'suspended';
  });
  return context;
}

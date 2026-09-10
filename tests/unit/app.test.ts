import type * as React from 'react';
import type { DeviceSyncSnapshot } from '@hotel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RealtimeRefreshResult } from '../../apps/web/src/realtime';

interface RealtimeOptionsForTest {
  onEvent: (eventName?: string, payload?: unknown) => Promise<RealtimeRefreshResult | void>;
}

interface DeviceScreenPropsForTest {
  roomRequestNotificationsUnread?: boolean;
  onClearRoomRequestNotifications?: () => void;
}

interface AdminScreenPropsForTest {
  csrfToken?: string;
  installationId?: string | null;
}

interface TestElement {
  type: unknown;
  props: {
    children?: unknown;
    roomRequestNotificationsUnread?: boolean;
    onClearRoomRequestNotifications?: () => void;
    csrfToken?: string;
    installationId?: string | null;
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

let sessionValues = new Map<string, string>();
const windowEventListeners = new Map<string, Set<(event: unknown) => void>>();

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
  isApiError: () => false,
  isDeviceInvalidationError: () => false,
  startupErrorMessage: () => 'Local service unavailable.'
}));

vi.mock('../../apps/web/src/app-model', () => ({
  ADMIN_SESSION_STORAGE_KEY: 'hotel-local-admin-session',
  DEVICE_ID_STORAGE_KEY: 'hotel-local-device-id',
  DEVICE_PENDING_TOKEN_ROTATION_STORAGE_KEY: 'hotel-local-pending-token-rotation',
  DEVICE_SNAPSHOT_STORAGE_KEY: 'hotel-local-device-snapshot',
  DEVICE_SYNC_STATE_STORAGE_KEY: 'hotel-local-device-sync-state',
  DEVICE_TOKEN_STORAGE_KEY: 'hotel-local-device-token',
  buildLocalDeviceSyncState: (deviceId: string, values: Record<string, unknown>) => ({ deviceId, ...values }),
  completeDeviceTokenRotation: vi.fn(),
  getOrCreateInstallationId: () => 'installation-1',
  makeMutationKey: () => 'mutation-1',
  parseAdminSession: (raw: string) => JSON.parse(raw),
  readLocalDeviceSnapshot: () => null,
  resolveStartupRetryDelayMs: () => 250,
  serializeLocalDeviceSnapshot: (snapshot: DeviceSyncSnapshot) => JSON.stringify(snapshot),
  serializeLocalDeviceSyncState: (state: unknown) => JSON.stringify(state),
  serializeAdminSession: (session: unknown) => JSON.stringify(session),
  shouldRetryStartup: () => true
}));

vi.mock('../../apps/web/src/i18n', () => ({
  useI18n: () => ({ locale: 'en', t: (key: string) => key }),
  SpanishI18nProvider: ({ children }: { children: React.ReactNode }) => children
}));

vi.mock('../../apps/web/src/realtime', () => ({
  useRealtimeConnection: (options: unknown) => {
    hookHarness.realtimeOptions = options;
  }
}));

vi.mock('../../apps/web/src/components/LanguageSelector', () => ({ LanguageSelector: 'language-selector' }));
vi.mock('../../apps/web/src/components/Modal', () => ({ Modal: 'modal' }));
vi.mock('../../apps/web/src/features/auth/AdminLoginForm', () => ({ AdminLoginForm: 'admin-login-form' }));
vi.mock('../../apps/web/src/features/admin/AdminScreen', () => ({ AdminScreen: 'admin-screen' }));
vi.mock('../../apps/web/src/features/bootstrap/BootstrapScreen', () => ({ BootstrapScreen: 'bootstrap-screen' }));
vi.mock('../../apps/web/src/features/device/DeviceScreen', () => ({ DeviceScreen: 'device-screen' }));

const { App } = await import('../../apps/web/src/App');

describe('App room request notification lifecycle', () => {
  beforeEach(() => {
    hookHarness.reset();
    const audioContext = createFakeAudioContext();
    roomAudioMocks.constructor.mockImplementation(() => audioContext);
    sessionValues = new Map();
    windowEventListeners.clear();
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
    hookHarness.reset();
    apiMocks.get.mockReset();
    apiMocks.post.mockReset();
    apiMocks.patch.mockReset();
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

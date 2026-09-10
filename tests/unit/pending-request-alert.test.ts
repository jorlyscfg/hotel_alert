import type * as React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

interface PendingRequestAlertState {
  soundEnabled: boolean;
  enableSound: () => void;
}

interface PendingRequestAlertModule {
  usePendingRequestAlert?: (pendingRequestCount: number, intervalMs: number) => PendingRequestAlertState;
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

const hookHarness = vi.hoisted(() => ({
  hookIndex: 0,
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown } | undefined>,
  callbacks: [] as Array<{ value: unknown; deps: readonly unknown[] } | undefined>,
  effects: [] as Array<{ cleanup: (() => void) | undefined; deps: readonly unknown[] | undefined } | undefined>,
  reset: (): void => undefined
}));

hookHarness.reset = (): void => {
  hookHarness.hookIndex = 0;
  hookHarness.states = [];
  hookHarness.refs = [];
  hookHarness.callbacks = [];
  hookHarness.effects = [];
};

const audioMocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  oscillator: undefined as FakeOscillator | undefined,
  gain: undefined as FakeGain | undefined,
  timerCallbacks: [] as Array<() => void>,
  setInterval: vi.fn(),
  clearInterval: vi.fn()
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

const deviceScreenModule = await import('../../apps/web/src/features/device/DeviceScreen');

describe('AREA pending request alert lifecycle', () => {
  beforeEach(() => {
    hookHarness.reset();
    audioMocks.constructor.mockImplementation(() => createFakeAudioContext());
    audioMocks.timerCallbacks = [];
    audioMocks.setInterval.mockImplementation((callback: () => void) => {
      audioMocks.timerCallbacks.push(callback);
      return audioMocks.timerCallbacks.length;
    });
    audioMocks.clearInterval.mockReset();
    vi.stubGlobal('window', {
      AudioContext: audioMocks.constructor,
      setInterval: audioMocks.setInterval,
      clearInterval: audioMocks.clearInterval
    });
  });

  afterEach(() => {
    for (const effect of hookHarness.effects) effect?.cleanup?.();
    hookHarness.reset();
    audioMocks.constructor.mockReset();
    audioMocks.setInterval.mockReset();
    audioMocks.clearInterval.mockReset();
    audioMocks.oscillator = undefined;
    audioMocks.gain = undefined;
    vi.unstubAllGlobals();
  });

  it('plays immediately when a new pending request arrives after sound is enabled', () => {
    const usePendingRequestAlert = getPendingRequestAlertHook();

    renderHook(usePendingRequestAlert, 0);
    const disabledState = renderHook(usePendingRequestAlert, 1);
    disabledState.enableSound();
    renderHook(usePendingRequestAlert, 1);

    expect(audioMocks.oscillator?.start).toHaveBeenCalledTimes(1);
  });

  it('does not replay immediately when the pending count is unchanged', () => {
    const usePendingRequestAlert = getPendingRequestAlertHook();

    renderHook(usePendingRequestAlert, 0);
    const disabledState = renderHook(usePendingRequestAlert, 1);
    disabledState.enableSound();
    renderHook(usePendingRequestAlert, 1);
    renderHook(usePendingRequestAlert, 1);

    expect(audioMocks.oscillator?.start).toHaveBeenCalledTimes(1);
    expect(audioMocks.setInterval).toHaveBeenCalledTimes(1);
  });

  it('stops repeating after the bounded repeat budget and cleans up the timer', () => {
    const usePendingRequestAlert = getPendingRequestAlertHook();

    renderHook(usePendingRequestAlert, 0);
    const disabledState = renderHook(usePendingRequestAlert, 1);
    disabledState.enableSound();
    renderHook(usePendingRequestAlert, 1);
    const timerCallback = audioMocks.timerCallbacks[0];
    if (timerCallback === undefined) throw new Error('Expected a pending alert timer.');

    for (let index = 0; index < 4; index += 1) timerCallback();

    expect(audioMocks.oscillator?.start).toHaveBeenCalledTimes(4);
    expect(audioMocks.clearInterval).toHaveBeenCalledTimes(1);

    renderHook(usePendingRequestAlert, 0);
    expect(audioMocks.clearInterval).toHaveBeenCalledTimes(2);
  });
});

function getPendingRequestAlertHook(): (pendingRequestCount: number, intervalMs: number) => PendingRequestAlertState {
  const hook = (deviceScreenModule as PendingRequestAlertModule).usePendingRequestAlert;
  expect(typeof hook).toBe('function');
  if (hook === undefined) throw new Error('Pending request alert hook is not exported.');
  return hook;
}

function renderHook(
  usePendingRequestAlert: (pendingRequestCount: number, intervalMs: number) => PendingRequestAlertState,
  pendingRequestCount: number
): PendingRequestAlertState {
  hookHarness.hookIndex = 0;
  return usePendingRequestAlert(pendingRequestCount, 1_000);
}

function sameDependencies(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
}

function createFakeAudioContext(): {
  state: 'running';
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
  audioMocks.oscillator = oscillator;
  audioMocks.gain = gain;
  return {
    state: 'running',
    currentTime: 0,
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn(() => gain)
  };
}

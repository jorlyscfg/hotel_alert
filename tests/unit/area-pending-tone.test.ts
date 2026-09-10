import type * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceSyncSnapshot, RequestDTO } from '@hotel/shared';
import type * as I18nModule from '../../apps/web/src/i18n';

interface HookEffect {
  cleanup: (() => void) | undefined;
  deps: readonly unknown[] | undefined;
}

interface TestElement {
  type: unknown;
  props: Record<string, unknown>;
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

interface FakeAudioContext {
  state: 'running' | 'suspended' | 'closed';
  currentTime: number;
  destination: object;
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  createOscillator: ReturnType<typeof vi.fn>;
  createGain: ReturnType<typeof vi.fn>;
  oscillator: FakeOscillator;
  gain: FakeGain;
}

const hookHarness = vi.hoisted(() => ({
  hookIndex: 0,
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown } | undefined>,
  effects: [] as Array<HookEffect | undefined>,
  reset: (): void => undefined
}));

hookHarness.reset = (): void => {
  hookHarness.hookIndex = 0;
  hookHarness.states = [];
  hookHarness.refs = [];
  hookHarness.effects = [];
};

vi.mock('../../apps/web/node_modules/react', async (importOriginal) => {
  const actual = await importOriginal<typeof React>();
  return {
    ...actual,
    useState: <T>(initialState: T | (() => T)): [T, (next: T | ((current: T) => T)) => void] => {
      const index = hookHarness.hookIndex++;
      if (hookHarness.states[index] === undefined) {
        hookHarness.states[index] = typeof initialState === 'function'
          ? (initialState as () => T)()
          : initialState;
      }
      const setState = (next: T | ((current: T) => T)): void => {
        const current = hookHarness.states[index] as T;
        hookHarness.states[index] = typeof next === 'function'
          ? (next as (current: T) => T)(current)
          : next;
      };
      return [hookHarness.states[index] as T, setState];
    },
    useRef: <T>(initialValue: T): { current: T } => {
      const index = hookHarness.hookIndex++;
      if (hookHarness.refs[index] === undefined) hookHarness.refs[index] = { current: initialValue };
      return hookHarness.refs[index] as { current: T };
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

vi.mock('../../apps/web/src/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof I18nModule>();
  return {
    ...actual,
    useI18n: () => ({ locale: 'en', t: actual.createTranslator('en'), setLocale: () => undefined })
  };
});

const { DeviceScreen } = await import('../../apps/web/src/features/device/DeviceScreen');

describe('AREA pending-request modal tone', () => {
  beforeEach(() => {
    hookHarness.reset();
  });

  afterEach(() => {
    for (const effect of hookHarness.effects) effect?.cleanup?.();
    hookHarness.reset();
    vi.unstubAllGlobals();
  });

  it('keeps retrying after a failed interaction and replaces non-running contexts', async () => {
    const firstContext = createFakeAudioContext('suspended');
    const secondContext = createFakeAudioContext('suspended');
    const successfulContext = createFakeAudioContext('running');
    firstContext.resume.mockRejectedValue(new Error('autoplay blocked'));
    secondContext.resume.mockRejectedValue(new Error('autoplay blocked'));
    const constructor = installAudioContexts([firstContext, secondContext, successfulContext]);
    const area = getAreaDisplayElement(createAreaSnapshot());

    renderAreaDisplay(area);
    await flushPromises();
    let retry = findSoundRetryButton(renderAreaDisplay(area));
    expect(retry).not.toBeUndefined();

    retry?.props['onClick']?.();
    await flushPromises();
    retry = findSoundRetryButton(renderAreaDisplay(area));
    expect(retry).not.toBeUndefined();

    retry?.props['onClick']?.();
    await flushPromises();
    const settled = renderAreaDisplay(area);

    expect(constructor).toHaveBeenCalledTimes(3);
    expect(firstContext.close).toHaveBeenCalledTimes(1);
    expect(secondContext.close).toHaveBeenCalledTimes(1);
    expect(successfulContext.createOscillator).toHaveBeenCalledTimes(1);
    expect(successfulContext.createGain).toHaveBeenCalledTimes(1);
    expect(successfulContext.oscillator.start).toHaveBeenCalledTimes(1);
    expect(findSoundRetryButton(settled)).toBeUndefined();
  });

  it('does not render the retry control after successful automatic playback', async () => {
    const context = createFakeAudioContext('running');
    const constructor = installAudioContexts([context]);
    const area = getAreaDisplayElement(createAreaSnapshot());

    renderAreaDisplay(area);
    await flushPromises();
    const settled = renderAreaDisplay(area);

    expect(constructor).toHaveBeenCalledTimes(1);
    expect(context.createOscillator).toHaveBeenCalledTimes(1);
    expect(context.createGain).toHaveBeenCalledTimes(1);
    expect(context.oscillator.start).toHaveBeenCalledTimes(1);
    expect(findSoundRetryButton(settled)).toBeUndefined();
  });
});

function installAudioContexts(contexts: FakeAudioContext[]): ReturnType<typeof vi.fn> {
  const constructor = vi.fn(() => {
    const context = contexts.shift();
    if (context === undefined) throw new Error('No fake audio context remains.');
    return context;
  });
  vi.stubGlobal('window', {
    AudioContext: constructor,
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn()
  });
  return constructor;
}

function getAreaDisplayElement(snapshot: DeviceSyncSnapshot): TestElement {
  hookHarness.reset();
  hookHarness.hookIndex = 0;
  const rendered = DeviceScreen({
    snapshot,
    deviceToken: 'device-token',
    connectionStatus: 'online',
    onRefresh: async () => undefined,
    onOpenAdmin: () => undefined,
    onAuthFailure: () => undefined
  }) as unknown as TestElement;
  const mainChildren = toElements(rendered.props['children']);
  const content = mainChildren.find((child) => child.props['className'] === 'device-content');
  if (content === undefined) throw new Error('The device content was not rendered.');
  const area = toElements(content.props['children'])[0];
  if (area === undefined) throw new Error('The AREA display was not rendered.');
  hookHarness.reset();
  return area;
}

function renderAreaDisplay(area: TestElement): TestElement {
  hookHarness.hookIndex = 0;
  return (area.type as (props: Record<string, unknown>) => TestElement)(area.props);
}

function findSoundRetryButton(root: TestElement): TestElement | undefined {
  if (root.type === 'button' && typeof root.props['className'] === 'string' && root.props['className'].includes('area-pending-confirmation__sound-retry')) return root;
  for (const child of toElements(root.props['children'])) {
    const button = findSoundRetryButton(child);
    if (button !== undefined) return button;
  }
  return undefined;
}

function toElements(value: unknown): TestElement[] {
  const values = Array.isArray(value) ? value : [value];
  return values.filter((candidate): candidate is TestElement => isTestElement(candidate));
}

function isTestElement(value: unknown): value is TestElement {
  return typeof value === 'object' && value !== null && 'type' in value && 'props' in value;
}

function sameDependencies(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

function createFakeAudioContext(state: FakeAudioContext['state']): FakeAudioContext {
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
  const context = {
    state,
    currentTime: 0,
    destination: {},
    resume: vi.fn(),
    close: vi.fn(),
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn(() => gain),
    oscillator,
    gain
  };
  context.close.mockImplementation(async () => {
    context.state = 'closed';
  });
  return context;
}

function createAreaSnapshot(): DeviceSyncSnapshot {
  const request: RequestDTO = {
    id: 'request-1',
    roomId: 'room-1',
    serviceId: 'service-1',
    responsibleAreaId: 'area-1',
    room: { id: 'room-1', code: '101', displayName: 'Room 101' },
    service: { id: 'service-1', code: 'towels', displayName: 'Fresh towels', iconKey: 'towels' },
    responsibleArea: { id: 'area-1', code: 'housekeeping', displayName: 'Housekeeping' },
    status: 'PENDING',
    version: 1,
    createdAt: '2026-08-31T12:05:00.000Z',
    acceptedAt: null,
    inProgressAt: null,
    completedAt: null,
    updatedAt: '2026-08-31T12:05:00.000Z'
  };
  return {
    snapshotSequence: 1,
    currentEventSequence: 1,
    configurationRevision: 1,
    deviceConfigVersion: 1,
    serverTime: '2026-08-31T12:05:00.000Z',
    device: {
      id: 'device-1',
      installationId: 'installation-1',
      displayName: 'Area console',
      assignmentMode: 'AREA',
      roomId: null,
      areaId: 'area-1',
      active: true,
      deviceConfigVersion: 1,
      lastHeartbeatAt: '2026-08-31T12:05:00.000Z',
      presence: 'ONLINE'
    },
    config: {
      mode: 'AREA',
      room: null,
      area: { id: 'area-1', code: 'housekeeping', displayName: 'Housekeeping' },
      hotelName: 'Hotel Local',
      hotelLogo: null,
      roomBackground: null,
      clockFormat: '12h',
      services: [],
      offlineQueueTtlHours: 24,
      heartbeatIntervalMs: 15_000,
      heartbeatStaleAfterMs: 45_000,
      heartbeatOfflineAfterMs: 120_000,
      pendingAlertIntervalMs: 5_000
    },
    activeRequests: [request],
    pendingTokenRotation: null
  };
}

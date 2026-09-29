import type * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompactRoom, DeviceSyncSnapshot } from '@hotel/shared';
import type * as I18nModule from '../../apps/web/src/i18n';

interface HookEffect {
  cleanup: (() => void) | undefined;
  deps: readonly unknown[] | undefined;
}

interface TestElement {
  type: unknown;
  props: Record<string, unknown>;
}

const hookHarness = vi.hoisted(() => ({
  hookIndex: 0,
  states: [] as unknown[],
  stateIndexes: new Set<number>(),
  refs: [] as Array<{ current: unknown } | undefined>,
  effects: [] as Array<HookEffect | undefined>,
  locale: 'en' as 'en' | 'es',
  reset: (): void => undefined
}));

hookHarness.reset = (): void => {
  hookHarness.hookIndex = 0;
  hookHarness.states = [];
  hookHarness.stateIndexes = new Set<number>();
  hookHarness.refs = [];
  hookHarness.effects = [];
  hookHarness.locale = 'en';
};

vi.mock('../../apps/web/node_modules/react', async (importOriginal) => {
  const actual = await importOriginal<typeof React>();
  return {
    ...actual,
    useState: <T>(initialState: T | (() => T)): [T, (next: T | ((current: T) => T)) => void] => {
      const index = hookHarness.hookIndex++;
      if (!hookHarness.stateIndexes.has(index)) {
        hookHarness.states[index] = typeof initialState === 'function'
          ? (initialState as () => T)()
          : initialState;
        hookHarness.stateIndexes.add(index);
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
    useI18n: () => ({ locale: hookHarness.locale, t: actual.createTranslator(hookHarness.locale), setLocale: () => undefined })
  };
});

const { DeviceScreen } = await import('../../apps/web/src/features/device/DeviceScreen');

describe('AREA DND transition notifications', () => {
  afterEach(() => {
    for (const effect of hookHarness.effects) effect?.cleanup?.();
    hookHarness.reset();
    vi.unstubAllGlobals();
  });

  it('treats the first DND list after a legacy snapshot as baseline, then alerts on a real transition', async () => {
    hookHarness.reset();
    const context = createFakeAudioContext();
    const audioContextConstructor = vi.fn(() => context);
    vi.stubGlobal('window', {
      AudioContext: audioContextConstructor,
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    });

    const legacySnapshot = createAreaSnapshot([]);
    delete legacySnapshot.activeDoNotDisturbRooms;
    const area = getAreaDisplayElement(legacySnapshot);
    renderAreaDisplay(area, legacySnapshot);
    await flushPromises();

    const hydratedSnapshot = {
      ...legacySnapshot,
      activeDoNotDisturbRooms: [createDoNotDisturbRoom('room-1', '101')]
    };
    renderAreaDisplay(area, hydratedSnapshot);
    await flushPromises();
    expect(audioContextConstructor).not.toHaveBeenCalled();

    const changedSnapshot = {
      ...hydratedSnapshot,
      activeDoNotDisturbRooms: [...hydratedSnapshot.activeDoNotDisturbRooms, createDoNotDisturbRoom('room-2', '202')]
    };
    renderAreaDisplay(area, changedSnapshot);
    await flushPromises();
    expect(audioContextConstructor).toHaveBeenCalledOnce();
    expect(context.frequencies).toEqual([698, 523]);
    expect(context.oscillator.start).toHaveBeenCalledTimes(2);
  });

  it('shows the existing room grid only in the No molestar tab and updates its badge from each snapshot', () => {
    hookHarness.reset();
    hookHarness.locale = 'es';
    stubWindow();
    const firstRoom = createDoNotDisturbRoom('room-1', '101');
    const secondRoom = createDoNotDisturbRoom('room-2', '202');
    const initialSnapshot = createAreaSnapshot([firstRoom, secondRoom], [createAreaPendingRequest()]);
    const area = getAreaDisplayElement(initialSnapshot);

    const defaultView = renderAreaDisplay(area, initialSnapshot);
    expect(findElementByClassName(defaultView, 'queue-board')).toBeDefined();
    expect(findElementByClassName(defaultView, 'area-dnd-strip')).toBeUndefined();
    const dndTab = findDoNotDisturbTab(defaultView);
    expect(dndTab).toBeDefined();
    const selectDndTab = dndTab?.props['onClick'];
    if (typeof selectDndTab !== 'function') throw new Error('The No molestar tab should be interactive.');
    selectDndTab();

    const selectedView = renderAreaDisplay(area, initialSnapshot);
    expect(findElementByClassName(selectedView, 'queue-board')).toBeUndefined();
    expect(collectText(findElementByClassName(selectedView, 'area-dnd-tab-count'))).toBe('2');
    expect(collectText(findElementByClassName(selectedView, 'area-dnd-strip'))).toContain('101');
    expect(collectText(findElementByClassName(selectedView, 'area-dnd-strip'))).toContain('202');
    expect(findElementByClassName(selectedView, 'area-dnd-room')).toBeDefined();

    const oneRoomSnapshot = { ...initialSnapshot, activeDoNotDisturbRooms: [firstRoom] };
    const oneRoomView = renderAreaDisplay(area, oneRoomSnapshot);
    expect(collectText(findElementByClassName(oneRoomView, 'area-dnd-tab-count'))).toBe('1');
    expect(collectText(findElementByClassName(oneRoomView, 'area-dnd-strip'))).toContain('101');
    expect(collectText(findElementByClassName(oneRoomView, 'area-dnd-strip'))).not.toContain('202');

    const noRoomsSnapshot = { ...oneRoomSnapshot, activeDoNotDisturbRooms: [] };
    const noRoomsView = renderAreaDisplay(area, noRoomsSnapshot);
    expect(findDoNotDisturbTab(noRoomsView)).toBeDefined();
    expect(findElementByClassName(noRoomsView, 'area-dnd-tab-count')).toBeUndefined();
    expect(findElementByClassName(noRoomsView, 'area-dnd-strip')).toBeUndefined();
  });

  it('plays one shared tone for each DND room-set change, but not the initial or unrelated snapshot', async () => {
    hookHarness.reset();
    const context = createFakeAudioContext();
    const audioContextConstructor = vi.fn(() => context);
    vi.stubGlobal('window', {
      AudioContext: audioContextConstructor,
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    });

    const initialRooms = [createDoNotDisturbRoom('room-1', '101')];
    const initialSnapshot = createAreaSnapshot(initialRooms);
    const area = getAreaDisplayElement(initialSnapshot);
    const initialArea = renderAreaDisplay(area, initialSnapshot);
    selectDoNotDisturbTab(initialArea);
    renderAreaDisplay(area, initialSnapshot);
    await flushPromises();
    expect(audioContextConstructor).not.toHaveBeenCalled();

    const unrelatedSnapshot = {
      ...initialSnapshot,
      currentEventSequence: initialSnapshot.currentEventSequence + 1,
      serverTime: '2026-08-31T12:06:00.000Z',
      activeDoNotDisturbRooms: [{ ...initialRooms[0]!, displayName: 'Updated room name' }]
    };
    renderAreaDisplay(area, unrelatedSnapshot);
    await flushPromises();
    expect(audioContextConstructor).not.toHaveBeenCalled();

    const activatedSnapshot = {
      ...unrelatedSnapshot,
      currentEventSequence: unrelatedSnapshot.currentEventSequence + 1,
      activeDoNotDisturbRooms: [...unrelatedSnapshot.activeDoNotDisturbRooms, createDoNotDisturbRoom('room-2', '202')]
    };
    renderAreaDisplay(area, activatedSnapshot);
    await flushPromises();
    expect(audioContextConstructor).toHaveBeenCalledTimes(1);
    expect(context.frequencies).toEqual([698, 523]);
    expect(context.oscillator.start).toHaveBeenCalledTimes(2);

    const replayedSnapshot = { ...activatedSnapshot, currentEventSequence: activatedSnapshot.currentEventSequence + 1 };
    renderAreaDisplay(area, replayedSnapshot);
    await flushPromises();
    expect(context.oscillator.start).toHaveBeenCalledTimes(2);

    const deactivatedSnapshot = {
      ...replayedSnapshot,
      currentEventSequence: replayedSnapshot.currentEventSequence + 1,
      activeDoNotDisturbRooms: unrelatedSnapshot.activeDoNotDisturbRooms
    };
    renderAreaDisplay(area, deactivatedSnapshot);
    await flushPromises();
    expect(context.frequencies).toEqual([698, 523, 523, 698]);
    expect(context.oscillator.start).toHaveBeenCalledTimes(4);
  });

  it('keeps the active-room grid in its tab and transition tones without showing a DND popup', async () => {
    hookHarness.reset();
    const context = createFakeAudioContext();
    vi.stubGlobal('window', {
      AudioContext: vi.fn(() => context),
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    });

    const firstRoom = createDoNotDisturbRoom('room-1', '101');
    const initialSnapshot = createAreaSnapshot([firstRoom]);
    const area = getAreaDisplayElement(initialSnapshot);
    const initialArea = renderAreaDisplay(area, initialSnapshot);
    expect(findElementByClassName(initialArea, 'area-dnd-notification-modal')).toBeUndefined();
    expect(findElementByClassName(initialArea, 'area-dnd-strip')).toBeUndefined();
    selectDoNotDisturbTab(initialArea);
    const selectedInitialArea = renderAreaDisplay(area, initialSnapshot);
    expect(collectText(findElementByClassName(selectedInitialArea, 'area-dnd-strip'))).toContain('Room 101');

    const duplicateSnapshot = { ...initialSnapshot, activeDoNotDisturbRooms: [firstRoom, firstRoom] };
    renderAreaDisplay(area, duplicateSnapshot);
    expect(findElementByClassName(renderAreaDisplay(area, duplicateSnapshot), 'area-dnd-notification-modal')).toBeUndefined();

    const renamedSnapshot = {
      ...duplicateSnapshot,
      activeDoNotDisturbRooms: [{ ...firstRoom, displayName: 'Updated room name' }]
    };
    renderAreaDisplay(area, renamedSnapshot);
    expect(findElementByClassName(renderAreaDisplay(area, renamedSnapshot), 'area-dnd-notification-modal')).toBeUndefined();

    const secondRoom = createDoNotDisturbRoom('room-2', '202');
    const activatedSnapshot = {
      ...renamedSnapshot,
      activeDoNotDisturbRooms: [...renamedSnapshot.activeDoNotDisturbRooms, secondRoom]
    };
    renderAreaDisplay(area, activatedSnapshot);
    const activatedArea = renderAreaDisplay(area, activatedSnapshot);
    await flushPromises();
    expect(findElementByClassName(activatedArea, 'area-dnd-notification-modal')).toBeUndefined();
    expect(collectText(findElementByClassName(activatedArea, 'area-dnd-strip'))).toContain('Room 202');

    const deactivatedSnapshot = { ...activatedSnapshot, activeDoNotDisturbRooms: [renamedSnapshot.activeDoNotDisturbRooms[0]!] };
    renderAreaDisplay(area, deactivatedSnapshot);
    const deactivatedArea = renderAreaDisplay(area, deactivatedSnapshot);
    await flushPromises();
    expect(findElementByClassName(deactivatedArea, 'area-dnd-notification-modal')).toBeUndefined();
    expect(collectText(findElementByClassName(deactivatedArea, 'area-dnd-strip'))).not.toContain('Room 202');
    expect(context.frequencies).toEqual([698, 523, 523, 698]);
    expect(context.oscillator.start).toHaveBeenCalledTimes(4);
  });

  it('keeps the service-request modal independent from DND transition popups', () => {
    hookHarness.reset();
    stubWindow();
    const pendingRequest = createAreaPendingRequest();
    const initialSnapshot = createAreaSnapshot([createDoNotDisturbRoom('room-1', '101')], [pendingRequest]);
    const area = getAreaDisplayElement(initialSnapshot);
    selectDoNotDisturbTab(renderAreaDisplay(area, initialSnapshot));
    renderAreaDisplay(area, initialSnapshot);

    const activatedSnapshot = {
      ...initialSnapshot,
      activeDoNotDisturbRooms: [
        ...initialSnapshot.activeDoNotDisturbRooms!,
        createDoNotDisturbRoom('room-2', '202')
      ]
    };
    renderAreaDisplay(area, activatedSnapshot);
    const pendingArea = renderAreaDisplay(area, activatedSnapshot);
    expect(findElementByClassName(pendingArea, 'area-pending-confirmation-modal')).toBeDefined();
    expect(findElementByClassName(pendingArea, 'area-dnd-notification-modal')).toBeUndefined();

    const pendingModal = findElementByClassName(pendingArea, 'area-pending-confirmation-modal');
    (pendingModal?.props['onClose'] as () => void)();
    const afterDismissal = renderAreaDisplay(area, activatedSnapshot);
    expect(findElementByClassName(afterDismissal, 'area-pending-confirmation-modal')).toBeUndefined();
    expect(findElementByClassName(afterDismissal, 'area-dnd-notification-modal')).toBeUndefined();
    expect(collectText(findElementByClassName(afterDismissal, 'area-dnd-strip'))).toContain('Room 202');
  });

  it('does not show a DND popup for Spanish locale transitions', () => {
    hookHarness.reset();
    stubWindow();
    const initialSnapshot = createAreaSnapshot([createDoNotDisturbRoom('room-1', '101')]);
    const area = getAreaDisplayElement(initialSnapshot);
    hookHarness.locale = 'es';
    selectDoNotDisturbTab(renderAreaDisplay(area, initialSnapshot));
    renderAreaDisplay(area, initialSnapshot);
    const activatedSnapshot = {
      ...initialSnapshot,
      activeDoNotDisturbRooms: [...initialSnapshot.activeDoNotDisturbRooms!, createDoNotDisturbRoom('room-2', '202')]
    };
    renderAreaDisplay(area, activatedSnapshot);
    const activatedArea = renderAreaDisplay(area, activatedSnapshot);
    expect(findElementByClassName(activatedArea, 'area-dnd-notification-modal')).toBeUndefined();
    expect(collectText(findElementByClassName(activatedArea, 'area-dnd-strip'))).toContain('Room 202');
  });
});

function getAreaDisplayElement(snapshot: DeviceSyncSnapshot): TestElement {
  const rendered = DeviceScreen({
    snapshot,
    deviceToken: 'device-token',
    connectionStatus: 'online',
    onRefresh: async () => undefined,
    onOpenAdmin: () => undefined,
    onAuthFailure: () => undefined
  }) as unknown as TestElement;
  const content = findElementByClassName(rendered, 'device-content');
  if (content === undefined) throw new Error('The device content was not rendered.');
  const area = toElements(content.props['children'])[0];
  if (area === undefined) throw new Error('The AREA display was not rendered.');
  hookHarness.reset();
  return area;
}

function renderAreaDisplay(area: TestElement, snapshot: DeviceSyncSnapshot): TestElement {
  hookHarness.hookIndex = 0;
  return (area.type as (props: Record<string, unknown>) => TestElement)({ ...area.props, snapshot });
}

function findElementByClassName(root: TestElement, className: string): TestElement | undefined {
  if (typeof root.props['className'] === 'string' && root.props['className'].split(/\s+/).includes(className)) return root;
  for (const child of toElements(root.props['children'])) {
    const match = findElementByClassName(child, className);
    if (match !== undefined) return match;
  }
  return undefined;
}

function selectDoNotDisturbTab(root: TestElement): void {
  const button = findDoNotDisturbTab(root);
  const onClick = button?.props['onClick'];
  if (typeof onClick !== 'function') throw new Error('The No molestar tab should be interactive.');
  onClick();
}

function findDoNotDisturbTab(root: TestElement): TestElement | undefined {
  const buttons = toElements(root.props['children']).flatMap((child) => findButtons(child));
  return buttons.find((candidate) => {
    const label = collectText(candidate);
    return label.includes('No molestar') || label.includes('Do not disturb');
  });
}

function findButtons(root: TestElement): TestElement[] {
  const button = root.type === 'button' ? [root] : [];
  return [...button, ...toElements(root.props['children']).flatMap((child) => findButtons(child))];
}

function toElements(value: unknown): TestElement[] {
  const values = Array.isArray(value) ? value : [value];
  return values.filter((candidate): candidate is TestElement => isTestElement(candidate));
}

function isTestElement(value: unknown): value is TestElement {
  return typeof value === 'object' && value !== null && 'type' in value && 'props' in value;
}

function collectText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(collectText).join(' ');
  return isTestElement(value) ? collectText(value.props['children']) : '';
}

function sameDependencies(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

function createFakeAudioContext() {
  const frequencies: number[] = [];
  const oscillator = {
    type: '',
    frequency: { setValueAtTime: vi.fn((frequency: number) => frequencies.push(frequency)) },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn()
  };
  const gain = {
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn()
    },
    connect: vi.fn()
  };
  return {
    state: 'running' as const,
    currentTime: 0,
    destination: {},
    resume: vi.fn(),
    close: vi.fn(async () => undefined),
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn(() => gain),
    oscillator,
    frequencies,
    gain
  };
}

function stubWindow(): void {
  vi.stubGlobal('window', {
    AudioContext: vi.fn(() => createFakeAudioContext()),
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  });
}

function createDoNotDisturbRoom(id: string, code: string): CompactRoom {
  return { id, code, displayName: `Room ${code}`, doNotDisturb: true };
}

function createAreaSnapshot(activeDoNotDisturbRooms: CompactRoom[], activeRequests: DeviceSyncSnapshot['activeRequests'] = []): DeviceSyncSnapshot {
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
    activeRequests,
    activeDoNotDisturbRooms,
    pendingTokenRotation: null
  };
}

function createAreaPendingRequest(): DeviceSyncSnapshot['activeRequests'][number] {
  return {
    id: 'request-pending',
    roomId: 'room-1',
    serviceId: 'service-1',
    responsibleAreaId: 'area-1',
    room: { id: 'room-1', code: '101', displayName: 'Room 101', doNotDisturb: false },
    service: { id: 'service-1', code: 'towels', displayName: 'Clean towels', iconKey: 'towels' },
    responsibleArea: { id: 'area-1', code: 'housekeeping', displayName: 'Housekeeping' },
    status: 'PENDING',
    version: 1,
    createdAt: '2026-08-31T12:05:00.000Z',
    acceptedAt: null,
    inProgressAt: null,
    completedAt: null,
    updatedAt: '2026-08-31T12:05:00.000Z'
  };
}

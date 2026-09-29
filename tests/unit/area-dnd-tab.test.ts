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

const hooks = vi.hoisted(() => ({
  hookIndex: 0,
  states: [] as unknown[],
  stateIndexes: new Set<number>(),
  refs: [] as Array<{ current: unknown } | undefined>,
  effects: [] as Array<HookEffect | undefined>,
  locale: 'en' as 'en' | 'es',
  reset: (): void => undefined
}));

hooks.reset = (): void => {
  hooks.hookIndex = 0;
  hooks.states = [];
  hooks.stateIndexes = new Set<number>();
  hooks.refs = [];
  hooks.effects = [];
  hooks.locale = 'en';
};

vi.mock('../../apps/web/node_modules/react', async (importOriginal) => {
  const actual = await importOriginal<typeof React>();
  return {
    ...actual,
    useState: <T>(initialState: T | (() => T)): [T, (next: T | ((current: T) => T)) => void] => {
      const index = hooks.hookIndex++;
      if (!hooks.stateIndexes.has(index)) {
        hooks.states[index] = typeof initialState === 'function'
          ? (initialState as () => T)()
          : initialState;
        hooks.stateIndexes.add(index);
      }
      const setState = (next: T | ((current: T) => T)): void => {
        const current = hooks.states[index] as T;
        hooks.states[index] = typeof next === 'function'
          ? (next as (current: T) => T)(current)
          : next;
      };
      return [hooks.states[index] as T, setState];
    },
    useRef: <T>(initialValue: T): { current: T } => {
      const index = hooks.hookIndex++;
      if (hooks.refs[index] === undefined) hooks.refs[index] = { current: initialValue };
      return hooks.refs[index] as { current: T };
    },
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]): void => {
      const index = hooks.hookIndex++;
      const previous = hooks.effects[index];
      if (previous !== undefined && deps !== undefined && sameDependencies(previous.deps ?? [], deps)) return;
      previous?.cleanup?.();
      const cleanup = effect();
      hooks.effects[index] = { cleanup: typeof cleanup === 'function' ? cleanup : undefined, deps };
    }
  };
});

vi.mock('../../apps/web/src/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof I18nModule>();
  return {
    ...actual,
    useI18n: () => ({
      locale: hooks.locale,
      t: actual.createTranslator(hooks.locale),
      setLocale: () => undefined
    })
  };
});

const { DeviceScreen } = await import('../../apps/web/src/features/device/DeviceScreen');

describe('AREA No molestar tab', () => {
  afterEach(() => {
    for (const effect of hooks.effects) effect?.cleanup?.();
    hooks.reset();
    vi.unstubAllGlobals();
  });

  it('moves the unchanged room grid into its tab and updates the count from each snapshot', () => {
    hooks.reset();
    hooks.locale = 'es';
    vi.stubGlobal('window', {
      AudioContext: undefined,
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    });

    const firstRoom = createRoom('room-1', '101', '2026-08-31T11:06:00.000Z');
    const secondRoom = createRoom('room-2', '202', null);
    const initialSnapshot = createAreaSnapshot([firstRoom, secondRoom]);
    const area = getAreaDisplayElement(initialSnapshot);
    hooks.locale = 'es';
    const defaultView = renderAreaDisplay(area, initialSnapshot);

    expect(findElementByClassName(defaultView, 'queue-board')).toBeDefined();
    expect(findElementByClassName(defaultView, 'area-dnd-strip')).toBeUndefined();

    const dndTab = findDoNotDisturbTab(defaultView);
    expect(dndTab).toBeDefined();
    const selectDndTab = dndTab?.props['onClick'];
    if (typeof selectDndTab !== 'function') throw new Error('The No molestar tab should be interactive.');
    selectDndTab();

    const selectedView = renderAreaDisplay(area, initialSnapshot);
    const selectedGrid = findElementByClassName(selectedView, 'area-dnd-strip');
    expect(findElementByClassName(selectedView, 'queue-board')).toBeUndefined();
    expect(collectText(findElementByClassName(selectedView, 'area-dnd-tab-count'))).toBe('2');
    expect(findElementByClassName(selectedView, 'area-dnd-tab-count')?.props['className']).toContain('area-dnd-tab-count--green');
    expect(collectText(selectedGrid)).toContain('101');
    expect(collectText(selectedGrid)).toContain('202');
    const timedRoomBadge = findElementByClassName(selectedGrid!, 'area-dnd-room--green');
    const unknownRoomBadge = findElementByClassName(selectedGrid!, 'area-dnd-room--unknown');
    expect(timedRoomBadge).toBeDefined();
    expect(collectText(timedRoomBadge)).toContain('Activo desde hace 59 min');
    expect(unknownRoomBadge).toBeDefined();
    expect(collectText(unknownRoomBadge)).toContain('Tiempo no disponible');

    const atOneHour = renderAreaDisplay(area, initialSnapshot, new Date('2026-08-31T12:06:00.000Z'));
    expect(findElementByClassName(atOneHour, 'area-dnd-tab-count')?.props['className']).toContain('area-dnd-tab-count--yellow');
    expect(findElementByClassName(atOneHour, 'area-dnd-room--yellow')).toBeDefined();

    const atThreeHours = renderAreaDisplay(area, initialSnapshot, new Date('2026-08-31T14:06:00.000Z'));
    expect(findElementByClassName(atThreeHours, 'area-dnd-tab-count')?.props['className']).toContain('area-dnd-tab-count--red');
    expect(findElementByClassName(atThreeHours, 'area-dnd-room--red')).toBeDefined();

    const oneRoomSnapshot = { ...initialSnapshot, activeDoNotDisturbRooms: [firstRoom] };
    const oneRoomView = renderAreaDisplay(area, oneRoomSnapshot);
    const oneRoomGrid = findElementByClassName(oneRoomView, 'area-dnd-strip');
    expect(collectText(findElementByClassName(oneRoomView, 'area-dnd-tab-count'))).toBe('1');
    expect(collectText(oneRoomGrid)).toContain('101');
    expect(collectText(oneRoomGrid)).not.toContain('202');

    const noRoomsSnapshot = { ...oneRoomSnapshot, activeDoNotDisturbRooms: [] };
    const noRoomsView = renderAreaDisplay(area, noRoomsSnapshot);
    expect(findDoNotDisturbTab(noRoomsView)).toBeDefined();
    expect(findElementByClassName(noRoomsView, 'area-dnd-tab-count')).toBeUndefined();
    expect(findElementByClassName(noRoomsView, 'area-dnd-strip')).toBeUndefined();

    const onlyUnknownSnapshot = { ...initialSnapshot, activeDoNotDisturbRooms: [secondRoom] };
    const onlyUnknownView = renderAreaDisplay(area, onlyUnknownSnapshot);
    expect(findElementByClassName(onlyUnknownView, 'area-dnd-tab-count')?.props['className']).toContain('area-dnd-tab-count--unknown');
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
  hooks.reset();
  return area;
}

function renderAreaDisplay(area: TestElement, snapshot: DeviceSyncSnapshot, currentTime?: Date): TestElement {
  hooks.hookIndex = 0;
  return (area.type as (props: Record<string, unknown>) => TestElement)({ ...area.props, snapshot, ...(currentTime === undefined ? {} : { currentTime }) });
}

function findElementByClassName(root: TestElement, className: string): TestElement | undefined {
  if (typeof root.props['className'] === 'string' && root.props['className'].split(/\s+/).includes(className)) return root;
  for (const child of toElements(root.props['children'])) {
    const match = findElementByClassName(child, className);
    if (match !== undefined) return match;
  }
  return undefined;
}

function findDoNotDisturbTab(root: TestElement): TestElement | undefined {
  return findButtons(root).find((button) => {
    const label = collectText(button);
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

function createRoom(id: string, code: string, doNotDisturbActivatedAt: string | null): CompactRoom {
  return { id, code, displayName: `Room ${code}`, doNotDisturb: true, doNotDisturbActivatedAt };
}

function createAreaSnapshot(activeDoNotDisturbRooms: CompactRoom[]): DeviceSyncSnapshot {
  return {
    snapshotSequence: 1,
    currentEventSequence: 1,
    configurationRevision: 1,
    deviceConfigVersion: 1,
    serverTime: '2026-08-31T12:05:00.000Z',
    device: {
      id: 'area-device',
      installationId: 'area-installation',
      displayName: 'Area tablet',
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
    activeDoNotDisturbRooms,
    pendingTokenRotation: null
  };
}

import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import * as deviceScreenModule from '../../apps/web/src/features/device/DeviceScreen';
import {
  DeviceScreen,
  CompletedRequestsEmptyState,
  CompletedRequestsToolbar,
  RoomAreaServices,
  chunkServices,
  filterAreaRequests,
  filterAndSortCompletedAreaRequests,
  formatAreaRequestAge,
  formatRoomRequestAge,
  formatClock,
  formatRoomScreensaverDate,
  resolveDeviceTimeZone,
  groupRoomServicesByArea,
  resolveRoomAreaOverflow,
  resolveRoomServicePageSize,
  resolveRoomRequestSubmissionMode,
  resolveDeviceConnectionMessage,
  resolveInformationCarouselTiming,
  resolvePendingAlertIntervalMs,
  resolveRoomBackgroundStyle,
  performRoomDoNotDisturbToggle
} from '../../apps/web/src/features/device/DeviceScreen';
import { RoomScreensaver } from '../../apps/web/src/features/device/RoomScreensaver';
import { ApiError, isDeviceAuthFailure, isDeviceInvalidationError } from '../../apps/web/src/api';
import { I18nProvider, SpanishI18nProvider } from '../../apps/web/src/i18n';
import type { DeviceSyncSnapshot, RequestDTO, ServiceDTO } from '@hotel/shared';

type RoomSwipePageResolver = (
  startPage: number,
  deltaX: number,
  pageCount: number,
  viewportWidth: number
) => number;

type RoomServicePagePositionResolver = (
  pageIndex: number,
  activePage: number
) => 'previous' | 'active' | 'next';

type RoomAreaOverflowResolver = (
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number
) => { canScrollPrevious: boolean; canScrollNext: boolean };

type ServiceRequestDialogProps = {
  service: ServiceDTO | null;
  deviceToken: string;
  deviceId: string;
  connectionStatus: 'online' | 'connecting' | 'stale' | 'offline';
  offlineQueueTtlHours: number;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onAuthFailure: () => void;
  onQueueChange: () => void;
  onQueueError: (message: string) => void;
};

describe('device pending alert helpers', () => {
  it('renders a deliberate read-only capability error for native AREA consoles', () => {
    const markup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot: createAreaSnapshot(),
      deviceToken: '',
      deviceCommandsSupported: false,
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));

    expect(markup).toContain('Device actions are unavailable in the Android console. Use the web console to manage requests.');
    expect(markup).not.toContain('draggable="true"');
    expect(markup).toContain('disabled=""');
  });

  it('continues the AREA request age from createdAt when reopening an offline stale snapshot', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T15:05:00.000Z'));
    const snapshot = createAreaSnapshot();
    snapshot.serverTime = '2026-08-31T12:05:00.000Z';
    const request = snapshot.activeRequests[0];
    if (request === undefined) throw new Error('Expected the AREA snapshot to include a request.');
    request.createdAt = '2026-08-31T12:05:00.000Z';

    try {
      const render = (connectionStatus: 'online' | 'offline') => renderToStaticMarkup(createElement(DeviceScreen, {
        snapshot,
        deviceToken: 'device-token',
        connectionStatus,
        onRefresh: async () => undefined,
        onOpenAdmin: () => undefined,
        onAuthFailure: () => undefined
      }));

      expect(render('offline')).toContain('3h 0m');
      expect(render('online')).toContain('just now');
    } finally {
      vi.useRealTimers();
    }
  });

  it('creates a readable room background style only for a configured image', () => {
    const roomBackground = 'data:image/png;base64,AAAA';
    const responsiveRoomBackground = {
      square480: 'data:image/webp;base64,SQUARE',
      tablet: 'data:image/webp;base64,TABLET'
    };

    expect(resolveRoomBackgroundStyle(null)).toEqual({
      '--room-background-square': 'url("/fondo-playa.jpg")',
      '--room-background-tablet': 'url("/fondo-playa-tablet.jpg")'
    });
    expect(resolveRoomBackgroundStyle(roomBackground)).toEqual({
      '--room-background-square': `url("${roomBackground}")`,
      '--room-background-tablet': `url("${roomBackground}")`
    });
    expect(resolveRoomBackgroundStyle(responsiveRoomBackground)).toEqual({
      '--room-background-square': `url("${responsiveRoomBackground.square480}")`,
      '--room-background-tablet': `url("${responsiveRoomBackground.tablet}")`
    });
    expect(resolveRoomBackgroundStyle('https://example.com/background.jpg')).toEqual(resolveRoomBackgroundStyle(null));
    expect(resolveRoomBackgroundStyle('not-an-image')).toEqual(resolveRoomBackgroundStyle(null));

    const roomSnapshot = createRoomSnapshot();
    roomSnapshot.config.roomBackground = roomBackground;
    const roomMarkup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot: roomSnapshot,
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));
    const areaSnapshot = createAreaSnapshot();
    areaSnapshot.config.roomBackground = roomBackground;
    const areaMarkup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot: areaSnapshot,
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));

    expect(roomMarkup).toContain('data:image/png;base64,AAAA');
    expect(roomMarkup).not.toContain('data-room-screensaver="true"');
    expect(areaMarkup).not.toContain('data:image/png;base64,AAAA');
    expect(areaMarkup).not.toContain('data-room-screensaver="true"');
  });

  it('queues room requests immediately unless the connection is online', () => {
    expect(resolveRoomRequestSubmissionMode('connecting')).toBe('queue');
    expect(resolveRoomRequestSubmissionMode('stale')).toBe('queue');
    expect(resolveRoomRequestSubmissionMode('offline')).toBe('queue');
    expect(resolveRoomRequestSubmissionMode('online')).toBe('post');
  });

  it('uses the configured pending alert interval', () => {
    expect(resolvePendingAlertIntervalMs(1000)).toBe(1000);
    expect(resolvePendingAlertIntervalMs(undefined)).toBe(5000);
  });

  it('uses carousel timing from the device config and defaults legacy snapshots', () => {
    expect(resolveInformationCarouselTiming({})).toEqual({ inactivityMs: 5_000, slideIntervalMs: 5_000 });
    expect(resolveInformationCarouselTiming({ informationIdleTimeoutSeconds: 12, informationSlideIntervalSeconds: 18 })).toEqual({ inactivityMs: 12_000, slideIntervalMs: 18_000 });
  });

  it('describes every connection state with the last synchronized time', () => {
    expect(resolveDeviceConnectionMessage('online', '12:05 PM')).toBe('Last synchronized at 12:05 PM.');
    expect(resolveDeviceConnectionMessage('connecting', '12:05 PM')).toBe('Synchronizing latest data. Last synchronized at 12:05 PM.');
    expect(resolveDeviceConnectionMessage('stale', '12:05 PM')).toBe('Showing the last synchronized data. Last synchronized at 12:05 PM.');
    expect(resolveDeviceConnectionMessage('offline', '12:05 PM')).toBe('Connection unavailable. Last synchronized at 12:05 PM.');
  });

  it('formats the authoritative server clock for the station header', () => {
    expect(formatClock(new Date('2026-08-31T09:05:00.000Z'), 'en-US', 'UTC')).toBe('9:05 AM');
    expect(formatClock(new Date('2026-08-31T09:05:00.000Z'), 'en-US', 'UTC', '24h')).toBe('09:05');
  });

  it('keeps the configured clock cycle independent of locale hour-cycle preferences', () => {
    const noon = new Date('2026-10-04T17:12:00.000Z');
    const midnight = new Date('2026-10-05T05:12:00.000Z');

    expect(formatClock(noon, 'es-u-hc-h11', 'America/Cancun', '12h')).toBe('12:12 p. m.');
    expect(formatClock(noon, 'en-US', 'America/Cancun', '12h')).toBe('12:12 PM');
    expect(formatClock(noon, 'es-u-hc-h11', 'America/Cancun', '24h')).toBe('12:12');
    expect(formatClock(midnight, 'es-u-hc-h11', 'America/Cancun', '24h')).toBe('00:12');
  });

  it('formats ROOM and AREA display times in the configured shared zone without changing UTC instants', () => {
    const authoritativeTime = new Date('2026-10-01T02:15:00.000Z');
    const timeZone = resolveDeviceTimeZone('America/Cancun');

    expect(formatClock(authoritativeTime, 'en-US', timeZone)).toBe('9:15 PM');
    expect(formatRoomScreensaverDate(authoritativeTime, 'en', timeZone)).toContain('September 30, 2026');
    expect(authoritativeTime.toISOString()).toBe('2026-10-01T02:15:00.000Z');

    const snapshot = createAreaSnapshot();
    snapshot.serverTime = authoritativeTime.toISOString();
    snapshot.config.timeZone = timeZone;
    for (const request of snapshot.activeRequests) request.createdAt = authoritativeTime.toISOString();
    const markup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot,
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));

    expect(markup).toContain('>9:15 PM</time>');
    expect(markup).toContain('Last synchronized at 9:15 PM.');
    expect(markup).toContain('Created: 9:15 PM');
  });

  it('uses deterministic UTC for a cached device snapshot without a timezone', () => {
    expect(resolveDeviceTimeZone(undefined)).toBe('UTC');
    expect(formatClock(new Date('2026-10-01T02:15:00.000Z'), 'en-US', resolveDeviceTimeZone(undefined))).toBe('2:15 AM');
  });

  it('renders localized screensaver date and clock with no fabricated sensor readings', () => {
    const currentTime = new Date('2026-09-30T13:45:00.000Z');
    const date = formatRoomScreensaverDate(currentTime, 'es');
    const markup = renderToStaticMarkup(createElement(RoomScreensaver, {
      label: 'Salvapantallas de la habitación',
      time: formatClock(currentTime, 'es', 'UTC', '24h'),
      date,
      dateTime: currentTime.toISOString()
    }));

    expect(markup).toContain('aria-label="Salvapantallas de la habitación"');
    expect(markup).toContain('data-room-screensaver="true"');
    expect(markup).toContain('>13:45</time>');
    expect(date).toContain(' de ');
    expect(date).toMatch(/20\d{2}/);
    expect(markup).toContain(date);
    expect(markup).not.toMatch(/temperature|humidity|temperatura|humedad/i);
  });

  it('uses the configured clock format for synchronization but keeps AREA card creation times in AM/PM', () => {
    const baseSnapshot = createAreaSnapshot();
    const snapshot: DeviceSyncSnapshot = {
      ...baseSnapshot,
      serverTime: '2026-08-31T09:05:00.000Z',
      config: { ...baseSnapshot.config, clockFormat: '24h' },
      activeRequests: baseSnapshot.activeRequests.map((request) => ({
        ...request,
        createdAt: '2026-08-31T09:04:00.000Z',
        updatedAt: '2026-08-31T09:04:00.000Z'
      }))
    };
    const markup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot,
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));

    expect(markup).toMatch(/<time class="station-clock"[^>]*>\d{2}:\d{2}<\/time>/);
    expect(markup).toMatch(/Last synchronized at \d{2}:\d{2}\./);
    expect(markup).toMatch(/Created: \d{1,2}:\d{2} [AP]M/);
  });

  it('formats area request age from the supplied server time', () => {
    expect(formatAreaRequestAge(
      '2026-08-31T12:03:00.000Z',
      new Date('2026-08-31T12:05:00.000Z')
    )).toBe('2m');
  });

  it('formats room request age from the supplied server time', () => {
    expect(formatRoomRequestAge(
      '2026-08-31T12:03:00.000Z',
      new Date('2026-08-31T12:05:00.000Z'),
      'es'
    )).toBe('2 min');
  });

  it('groups accepted and in-process requests while keeping completed requests out of the active view', () => {
    const requests = [
      { id: 'pending', status: 'PENDING' },
      { id: 'accepted', status: 'ACCEPTED' },
      { id: 'completed', status: 'COMPLETED' }
    ] as RequestDTO[];

    expect(filterAreaRequests(requests, 'ALL').map((request) => request.id)).toEqual(['pending', 'accepted']);
    expect(filterAreaRequests(requests, 'IN_PROGRESS').map((request) => request.id)).toEqual(['accepted']);
    expect(filterAreaRequests(requests, 'COMPLETED').map((request) => request.id)).toEqual(['completed']);
  });

  it('searches completed requests using conjunctive, case-insensitive substrings across fields', () => {
    const first = {
      ...createRoomRequest(),
      id: 'request-alpha-21',
      status: 'COMPLETED' as const,
      room: { id: 'room-1', code: '205', displayName: 'Garden Suite', doNotDisturb: false },
      service: { ...createRoomRequest().service, code: 'late-checkout', displayName: 'Late Checkout' },
      responsibleArea: { id: 'area-1', code: 'front-desk', displayName: 'Front Desk' },
      completedAt: '2026-08-31T12:30:00.000Z'
    };
    const second = {
      ...first,
      id: 'request-beta-22',
      room: { ...first.room, code: '206', displayName: 'Garden Room' },
      service: { ...first.service, code: 'extra-pillows', displayName: 'Extra Pillows' },
      responsibleArea: { ...first.responsibleArea, code: 'housekeeping', displayName: 'Housekeeping' }
    };

    expect(filterAndSortCompletedAreaRequests([first, second], 'GARDEN checkout', 'completed-newest', 'en').map(({ id }) => id)).toEqual([first.id]);
    expect(filterAndSortCompletedAreaRequests([first, second], 'garden housekeeping', 'completed-newest', 'en').map(({ id }) => id)).toEqual([second.id]);
    expect(filterAndSortCompletedAreaRequests([first, second], '205 front', 'completed-newest', 'en').map(({ id }) => id)).toEqual([first.id]);
    expect(filterAndSortCompletedAreaRequests([first, second], 'not-found', 'completed-newest', 'en')).toEqual([]);
    expect(filterAndSortCompletedAreaRequests([first, second], '', 'completed-newest', 'en')).toHaveLength(2);
  });

  it('renders accessible completed-only controls and localized no-results feedback', () => {
    const onSearchQueryChange = vi.fn();
    const onOrderChange = vi.fn();
    const controls = createElement(CompletedRequestsToolbar, {
      searchQuery: 'garden',
      order: 'completed-newest',
      onSearchQueryChange,
      onOrderChange
    });
    const english = renderToStaticMarkup(controls);
    const spanish = renderToStaticMarkup(createElement(SpanishI18nProvider, { children: controls }));
    const spanishNoResults = renderToStaticMarkup(createElement(SpanishI18nProvider, {
      children: createElement(CompletedRequestsEmptyState, { searchActive: true })
    }));

    expect(english).toContain('type="search"');
    expect(english).toContain('aria-label="Search completed requests"');
    expect(english).toContain('Room, service, area, or request ID');
    expect(english).toContain('<summary>Order by</summary>');
    expect(english.match(/type="radio"/g)).toHaveLength(4);
    expect(english).toContain('Completion — newest first');
    expect(spanish).toContain('aria-label="Buscar solicitudes completadas"');
    expect(spanish).toContain('placeholder="Habitación, servicio, área o ID de solicitud"');
    expect(spanish).toContain('<summary>Ordenar por</summary>');
    expect(spanish).toContain('Servicio — de A a Z');
    expect(renderToStaticMarkup(createElement(CompletedRequestsEmptyState, { searchActive: true }))).toContain('No completed requests match your search.');
    expect(spanishNoResults).toContain('Ninguna solicitud completada coincide con la búsqueda.');
    expect(renderToStaticMarkup(createElement(CompletedRequestsEmptyState, { searchActive: false }))).toContain('Clear');
  });

  it('orders completed requests by completion, numeric-aware room, and service with a creation-time fallback', () => {
    const request = createRoomRequest();
    const late = {
      ...request,
      id: 'late',
      status: 'COMPLETED' as const,
      room: { ...request.room, code: '12' },
      service: { ...request.service, id: 'service-zulu', displayName: 'Zulu' },
      createdAt: '2026-08-31T12:01:00.000Z',
      completedAt: '2026-08-31T12:40:00.000Z'
    };
    const early = {
      ...request,
      id: 'early',
      status: 'COMPLETED' as const,
      room: { ...request.room, code: '2' },
      service: { ...request.service, id: 'service-alpha', displayName: 'Alpha' },
      createdAt: '2026-08-31T12:02:00.000Z',
      completedAt: '2026-08-31T12:10:00.000Z'
    };
    const legacy = {
      ...request,
      id: 'legacy',
      status: 'COMPLETED' as const,
      room: { ...request.room, code: '101' },
      service: { ...request.service, id: 'service-beta', displayName: 'Beta' },
      createdAt: '2026-08-31T12:20:00.000Z',
      completedAt: null
    };
    const completed = [early, legacy, late];

    expect(filterAndSortCompletedAreaRequests(completed, '', undefined, 'en').map(({ id }) => id)).toEqual(['late', 'legacy', 'early']);
    expect(filterAndSortCompletedAreaRequests(completed, '', 'completed-newest', 'en').map(({ id }) => id)).toEqual(['late', 'legacy', 'early']);
    expect(filterAndSortCompletedAreaRequests(completed, '', 'completed-oldest', 'en').map(({ id }) => id)).toEqual(['early', 'legacy', 'late']);
    expect(filterAndSortCompletedAreaRequests(completed, '', 'room-asc', 'en').map(({ id }) => id)).toEqual(['early', 'late', 'legacy']);
    expect(filterAndSortCompletedAreaRequests(completed, '', 'service-asc', 'en').map(({ id }) => id)).toEqual(['early', 'legacy', 'late']);
  });

  it('only invalidates device auth for 401 or HTTP 403 DEVICE_INACTIVE', () => {
    expect(isDeviceAuthFailure(new ApiError(401, { error: { code: 'DEVICE_TOKEN_REVOKED' } }))).toBe(true);
    expect(isDeviceInvalidationError(new ApiError(401, { error: { code: 'DEVICE_TOKEN_REVOKED' } }))).toBe(true);
    expect(isDeviceAuthFailure(new ApiError(403, { error: { code: 'DEVICE_INACTIVE' } }))).toBe(true);
    expect(isDeviceAuthFailure(new ApiError(403, { error: { code: 'FORBIDDEN_ASSIGNMENT' } }))).toBe(false);
  });

  it('removes the second ROOM request success state', () => {
    expect(Reflect.get(deviceScreenModule, 'RequestSuccess')).toBeUndefined();
  });

  it('floats AREA status notices without rendering drag-and-drop UI', () => {
    const markup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot: createAreaSnapshot(),
      deviceToken: 'device-token',
      connectionStatus: 'offline',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));

    expect(markup).toContain('class="area-status-stack"');
    expect(markup).toContain('Connection unavailable');
    expect(markup).not.toContain('class="queue-complete-drop-zone');
    expect(markup).not.toContain('queue-card__drag-handle');
    expect(markup).not.toContain('data-area-drop-status');
  });

  it('keeps ROOM service tiles centered on an icon and title without redundant tile content', () => {
    const snapshot = createRoomSnapshot();
    const markup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot,
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));

    expect(markup).toContain('topbar--room');
    expect(markup).toContain('room-request-button');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-controls="room-request-status-panel"');
    expect(markup).toContain('notification-bell');
    expect(markup).toContain('room-request-button__bell');
    expect(markup).toContain('service-tile__icon');
    expect(markup).toContain('<strong>Fresh towels</strong>');
    expect(markup).not.toContain('service-tile__subtitle');
    expect(markup).not.toContain('service-tile__arrow');
    expect(markup).not.toContain('lucide-arrow-up-right');
    expect(markup).not.toContain('display-hero');
    expect(markup).not.toContain('How can we help?');
    expect(markup).not.toContain('Tap a service and the team will take it from here.');
    expect(markup).not.toContain('class="request-list"');
    expect(markup).not.toContain('device-footer');
  });

  it('renders named service areas as icon-led service tiles while keeping legacy snapshots on the flat service fallback', () => {
    const groupedSnapshot = createRoomSnapshot();
    groupedSnapshot.config.areas = [{
      id: 'area_default_housekeeping',
      code: 'housekeeping',
      displayName: 'Housekeeping'
    }];
    const groupedMarkup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot: groupedSnapshot,
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));
    const legacyMarkup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot: createRoomSnapshot(),
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));

    expect(groupedMarkup).toContain('room-area-grid');
    expect(groupedMarkup).toContain('room-area-scroll-rail');
    expect(groupedMarkup).toContain('class="service-tile room-area-card room-area-card--amber"');
    expect(groupedMarkup).toContain('aria-haspopup="dialog"');
    expect(groupedMarkup).toContain('lucide-sparkles');
    expect(groupedMarkup).toContain('<strong>Housekeeping</strong>');
    expect(groupedMarkup).not.toContain('device.options');
    expect(groupedMarkup).not.toContain('room-area-card__index');
    expect(groupedMarkup).not.toContain('room-area-card__arrow');
    expect(groupedMarkup).not.toContain('service-page-rail');
    expect(legacyMarkup).toContain('service-page-rail');
    expect(legacyMarkup).toContain('<strong>Fresh towels</strong>');
  });

  it('disables ROOM service actions while do-not-disturb is active and restores them when disabled', () => {
    const renderDeviceScreen = (snapshot: DeviceSyncSnapshot): string => renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot,
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));
    const activeMarkup = renderDeviceScreen(createRoomSnapshot(true));
    const inactiveMarkup = renderDeviceScreen(createRoomSnapshot(false));
    const groupedSnapshot = createRoomSnapshot(true);
    groupedSnapshot.config.areas = [{
      id: 'area_default_housekeeping',
      code: 'housekeeping',
      displayName: 'Housekeeping'
    }];
    const groupedMarkup = renderDeviceScreen(groupedSnapshot);
    const service = groupedSnapshot.config.services[0];
    if (service === undefined) throw new Error('Expected the room snapshot to include a service.');
    const areaServicesMarkup = renderToStaticMarkup(createElement(RoomAreaServices, {
      services: [service],
      doNotDisturbEnabled: true,
      onSelect: () => undefined
    }));

    expect(activeMarkup).toMatch(/<button class="service-tile(?: [^"]*)?" type="button" aria-disabled="true"/);
    expect(activeMarkup).not.toMatch(/<button class="service-tile"[^>]* disabled=""/);
    expect(activeMarkup).not.toContain('room-area-card');
    expect(inactiveMarkup).not.toMatch(/<button class="service-tile"[^>]*aria-disabled="true"/);
    expect(groupedMarkup).toMatch(/<button class="service-tile room-area-card[^>]*aria-disabled="true"/);
    expect(areaServicesMarkup).toMatch(/<button class="service-tile(?: [^"]*)?" type="button" aria-disabled="true"/);
  });

  it('routes service and area taps to the DND explanation instead of opening the request flow', () => {
    type HandlerFactory = (doNotDisturbEnabled: boolean, onActivate: () => void, onBlockedTap: () => void) => () => void;
    const candidate = (deviceScreenModule as unknown as Record<string, unknown>)['createRoomServiceControlClickHandler'];
    expect(typeof candidate).toBe('function');
    if (typeof candidate !== 'function') return;

    const createHandler = candidate as HandlerFactory;
    const openRequest = vi.fn();
    const openArea = vi.fn();
    const showExplanation = vi.fn();

    createHandler(true, openRequest, showExplanation)();
    createHandler(true, openArea, showExplanation)();

    expect(showExplanation).toHaveBeenCalledTimes(2);
    expect(openRequest).not.toHaveBeenCalled();
    expect(openArea).not.toHaveBeenCalled();

    createHandler(false, openRequest, showExplanation)();
    expect(openRequest).toHaveBeenCalledOnce();
  });

  it('renders the DND request explanation in English and Spanish', () => {
    type NoticeProps = { open: boolean; onClose: () => void };
    const candidate = (deviceScreenModule as unknown as Record<string, unknown>)['RoomDoNotDisturbExplanation'];
    expect(typeof candidate).toBe('function');
    if (typeof candidate !== 'function') return;
    const Notice = candidate as ComponentType<NoticeProps>;
    const previousWindow = globalThis.window;
    let selectedLocale = 'en';
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: { getItem: () => selectedLocale, setItem: () => undefined } }
    });

    try {
      const render = () => renderToStaticMarkup(createElement(I18nProvider, {
        children: createElement(Notice, { open: true, onClose: () => undefined })
      }));
      const englishMarkup = render();
      selectedLocale = 'es';
      const spanishMarkup = render();

      const accessibleTitle = englishMarkup.match(/<h2 id="([^"]+)" class="visually-hidden">Requests are paused<\/h2>/);
      expect(accessibleTitle).not.toBeNull();
      expect(englishMarkup).toContain(`aria-labelledby="${accessibleTitle?.[1]}"`);
      expect(englishMarkup).toContain('Turn off &quot;Do not disturb&quot; to request services.');
      expect(englishMarkup).toContain('class="button button--primary"');
      expect(spanishMarkup).toContain('Desactive &quot;No molestar&quot; para poder solicitar servicios.');
    } finally {
      if (previousWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
    }
  });

  it('renders ROOM area groups inside explicit page wrappers', () => {
    const snapshot = createRoomSnapshot();
    const templateService = snapshot.config.services[0];
    if (templateService === undefined) throw new Error('Expected the room snapshot to include a service.');
    const areaCodes = Array.from({ length: 6 }, (_, index) => `area-${index + 1}`);

    snapshot.config.areas = areaCodes.map((code, index) => ({
      id: `area-${index + 1}`,
      code,
      displayName: code
    }));
    snapshot.config.services = areaCodes.map((_, index) => ({
      ...templateService,
      id: `service-${index + 1}`,
      areaId: `area-${index + 1}`
    }));

    const markup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot,
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));

    expect(markup.match(/<div class="room-area-page">/g)).toHaveLength(2);
    expect(markup).toContain('<div class="room-area-page"><button class="service-tile room-area-card room-area-card--amber"');
  });

  it('assigns deterministic amber, teal, coral, and blue tints to ordered ROOM area tiles', () => {
    const snapshot = createRoomSnapshot();
    const templateService = snapshot.config.services[0];
    if (templateService === undefined) throw new Error('Expected the room snapshot to include a service.');
    const areaCodes = ['housekeeping', 'food-beverage', 'front-desk', 'maintenance'];

    snapshot.config.areas = areaCodes.map((code, index) => ({
      id: `area-${index + 1}`,
      code,
      displayName: code
    }));
    snapshot.config.services = areaCodes.map((_, index) => ({
      ...templateService,
      id: `service-${index + 1}`,
      areaId: `area-${index + 1}`
    }));

    const markup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot,
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));
    const areaButtonTints = Array.from(markup.matchAll(/<button class="service-tile room-area-card room-area-card--(amber|teal|coral|blue)"[^>]*>/g), (match) => match[1]);

    expect(areaButtonTints).toEqual(['amber', 'teal', 'coral', 'blue']);
    expect(markup).not.toContain('room-area-card__index');
    expect(markup).not.toContain('room-area-card__arrow');
  });

  it('uses the matching service icon for default area codes', () => {
    const snapshot = createRoomSnapshot();
    const templateService = snapshot.config.services[0];
    if (templateService === undefined) throw new Error('Expected the room snapshot to include a service.');
    const areaCodes = ['front-desk', 'housekeeping', 'food-beverage'];
    snapshot.config.areas = areaCodes.map((code, index) => ({
      id: `area-${index}`,
      code,
      displayName: code
    }));
    snapshot.config.services = areaCodes.map((_, index) => ({
      ...templateService,
      id: `service-${index}`,
      areaId: `area-${index}`
    }));

    const markup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot,
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));

    expect(markup).toContain('lucide-bell');
    expect(markup).toContain('lucide-sparkles');
    expect(markup).toContain('lucide-utensils');
  });

  it('marks only the first area service as the modal autofocus target', () => {
    const candidate = Reflect.get(deviceScreenModule, 'RoomAreaServices');
    expect(typeof candidate).toBe('function');
    if (typeof candidate !== 'function') return;

    const services = [
      { id: 'service-first', code: 'first', displayName: 'First service', iconKey: 'towels' },
      { id: 'service-second', code: 'second', displayName: 'Second service', iconKey: 'food' },
      { id: 'service-third', code: 'third', displayName: 'Third service', iconKey: 'food' },
      { id: 'service-fourth', code: 'fourth', displayName: 'Fourth service', iconKey: 'food' },
      { id: 'service-fifth', code: 'fifth', displayName: 'Fifth service', iconKey: 'food' }
    ] as ServiceDTO[];
    const markup = renderToStaticMarkup(createElement(candidate as ComponentType<{
      services: ServiceDTO[];
      onSelect: (service: ServiceDTO) => void;
    }>, { services, onSelect: () => undefined }));
    const serviceButtons = markup.match(/<button[^>]*class="service-tile"[^>]*>/g) ?? [];

    expect(markup).toContain('class="room-area-services__viewport"');
    expect(markup.match(/class="room-area-services__page"/g)).toHaveLength(2);
    expect(serviceButtons).toHaveLength(5);
    expect(serviceButtons[0]).toContain('data-autofocus="true"');
    expect(serviceButtons[1]).not.toContain('data-autofocus');
  });

  it('renders the ROOM header as room number, request bell, and visual connection status only', () => {
    const markup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot: createRoomSnapshot(),
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));
    const headerEnd = markup.indexOf('</header>');
    const headerMarkup = markup.slice(0, headerEnd);
    const identityIndex = headerMarkup.indexOf('class="topbar__identity"');
    const brandIndex = headerMarkup.indexOf('class="brand-lockup"', identityIndex);
    const roomIdentityIndex = headerMarkup.indexOf('class="room-identity"', brandIndex);
    const roomNumberIndex = headerMarkup.indexOf('class="room-identity__code"', roomIdentityIndex);
    const actionsIndex = headerMarkup.indexOf('class="topbar__actions"');
    const connectionIndex = headerMarkup.indexOf('class="connection-badge');
    const languageIndex = headerMarkup.indexOf('language-selector');

    expect(identityIndex).toBeGreaterThanOrEqual(0);
    expect(brandIndex).toBeGreaterThan(identityIndex);
    expect(roomIdentityIndex).toBeGreaterThan(brandIndex);
    expect(roomNumberIndex).toBeGreaterThan(roomIdentityIndex);
    expect(actionsIndex).toBeGreaterThan(roomNumberIndex);
    expect(connectionIndex).toBeGreaterThan(actionsIndex);
    expect(languageIndex).toBeGreaterThan(connectionIndex);
    expect(headerMarkup).toContain('>101</span>');
    expect(headerMarkup).toContain('connection-badge__dot');
    expect(headerMarkup).not.toContain('Guest station');
    expect(headerMarkup).not.toContain('room-identity__title');
    expect(headerMarkup).not.toContain('station-clock');
    expect(headerMarkup).not.toContain('room-dnd-control');
    expect(headerMarkup).not.toContain('room-request-button');
    expect(headerMarkup).not.toContain('>Admin</button>');
    expect(headerMarkup).toContain('language-selector');
    expect(markup.slice(headerEnd)).not.toContain('language-selector');
  });

  it('covers the complete ROOM surface, including the header language selector, with activity cancellation', () => {
    const roomMarkup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot: createRoomSnapshot(),
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));
    const areaMarkup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot: createAreaSnapshot(),
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));
    const experienceIndex = roomMarkup.indexOf('class="information-experience"');
    const headerIndex = roomMarkup.indexOf('<header');
    const languageIndex = roomMarkup.indexOf('language-selector');
    const contentIndex = roomMarkup.indexOf('class="device-content"');

    expect(experienceIndex).toBeGreaterThanOrEqual(0);
    expect(experienceIndex).toBeLessThan(headerIndex);
    expect(experienceIndex).toBeLessThan(languageIndex);
    expect(experienceIndex).toBeLessThan(contentIndex);
    expect(areaMarkup).not.toContain('information-experience');
  });

  it('renders the localized online connection label in the ROOM header', () => {
    const previousWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: { getItem: () => 'es', setItem: () => undefined } }
    });

    try {
      const markup = renderToStaticMarkup(createElement(I18nProvider, {
        children: createElement(DeviceScreen, {
          snapshot: createRoomSnapshot(),
          deviceToken: 'device-token',
          connectionStatus: 'online',
          onRefresh: async () => undefined,
          onOpenAdmin: () => undefined,
          onAuthFailure: () => undefined
        })
      }));
      const headerMarkup = markup.slice(0, markup.indexOf('</header>'));

      expect(headerMarkup).toContain('<span class="connection-badge__label">En línea</span>');
    } finally {
      if (previousWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
    }
  });

  it('renders the selected hotel-name language in ROOM and safely falls back for legacy snapshots', () => {
    const previousWindow = globalThis.window;
    let selectedLocale = 'en';
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: { getItem: () => selectedLocale, setItem: () => undefined } }
    });

    try {
      const snapshot = createRoomSnapshot();
      snapshot.config.hotelNameVariants = { en: 'Aurora Guest Hotel', es: 'Hotel Aurora' };
      const render = () => renderToStaticMarkup(createElement(I18nProvider, {
        children: createElement(DeviceScreen, {
          snapshot,
          deviceToken: 'device-token',
          connectionStatus: 'online',
          onRefresh: async () => undefined,
          onOpenAdmin: () => undefined,
          onAuthFailure: () => undefined
        })
      }));

      expect(render()).toContain('Aurora Guest Hotel');
      selectedLocale = 'es';
      expect(render()).toContain('Hotel Aurora');
      selectedLocale = 'en';
      delete snapshot.config.hotelNameVariants;
      expect(render()).toContain('Hotel Local');
    } finally {
      if (previousWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
    }
  });

  it('orders ROOM bottom navigation as request status, do not disturb, and Admin', () => {
    const markup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot: createRoomSnapshot(),
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));
    const bottomNavigationStart = markup.indexOf('class="room-bottom-controls"');
    const bottomNavigation = markup.slice(bottomNavigationStart);
    const requestControlIndex = bottomNavigation.indexOf('class="room-request-control"');
    const bellIndex = bottomNavigation.indexOf('room-request-button__bell');
    const dndIndex = bottomNavigation.indexOf('class="room-dnd-control"');
    const adminIndex = bottomNavigation.indexOf('>Admin</button>');

    expect(bottomNavigationStart).toBeGreaterThanOrEqual(0);
    expect(requestControlIndex).toBeGreaterThanOrEqual(0);
    expect(bellIndex).toBeGreaterThan(requestControlIndex);
    expect(dndIndex).toBeGreaterThan(bellIndex);
    expect(adminIndex).toBeGreaterThan(dndIndex);
    expect(bottomNavigation).toContain('aria-controls="room-request-status-panel"');
  });

  it('moves ROOM do-not-disturb below the service grid while preserving its active state', () => {
    const freeMarkup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot: createRoomSnapshot(false),
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));
    const activeMarkup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot: createRoomSnapshot(true),
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));
    const servicesIndex = freeMarkup.indexOf('class="room-services-section"');
    const freeDndIndex = freeMarkup.indexOf('class="room-dnd-control"');
    const activeDndIndex = activeMarkup.indexOf('class="room-dnd-control"');

    expect(freeDndIndex).toBeGreaterThan(servicesIndex);
    expect(activeDndIndex).toBeGreaterThan(activeMarkup.indexOf('class="room-services-section"'));
    expect(freeMarkup).not.toContain('room-dnd-button--active');
    expect(activeMarkup).toContain('room-dnd-button--active');
  });

  it('toggles room DND online, refreshes the snapshot, and reports offline/auth failures', async () => {
    const update = vi.fn(async (_deviceToken: string, _enabled: boolean) => undefined);
    const onRefresh = vi.fn(async () => undefined);
    const onAuthFailure = vi.fn();
    const onError = vi.fn();

    await performRoomDoNotDisturbToggle({
      enabled: false,
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh,
      onAuthFailure,
      onError,
      actionPausedMessage: 'paused',
      getFailureMessage: () => 'failed',
      update
    });

    expect(update).toHaveBeenCalledWith('device-token', true);
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();

    update.mockClear();
    await performRoomDoNotDisturbToggle({
      enabled: false,
      deviceToken: 'device-token',
      connectionStatus: 'offline',
      onRefresh,
      onAuthFailure,
      onError,
      actionPausedMessage: 'paused',
      getFailureMessage: () => 'failed',
      update
    });
    expect(update).not.toHaveBeenCalled();
    expect(onError).toHaveBeenLastCalledWith('paused');

    const authFailure = new ApiError(401, { error: { code: 'DEVICE_TOKEN_REVOKED' } });
    update.mockRejectedValue(authFailure);
    await performRoomDoNotDisturbToggle({
      enabled: false,
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh,
      onAuthFailure,
      onError,
      actionPausedMessage: 'paused',
      getFailureMessage: () => 'failed',
      update
    });
    expect(onAuthFailure).toHaveBeenCalledWith(authFailure);
    expect(onError).toHaveBeenLastCalledWith('failed');
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('keeps non-online ROOM service content free of visible alerts with an accessible status fallback', () => {
    const markup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot: createRoomSnapshot(),
      deviceToken: 'device-token',
      connectionStatus: 'offline',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));

    expect(markup).not.toContain('inline-alert');
    expect(markup).toContain('<div class="visually-hidden" role="status" aria-live="polite">');
    expect(markup).toContain('Connection unavailable');
  });

  it('renders the active room do-not-disturb state in the kiosk navigation', () => {
    const markup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot: createRoomSnapshot(true),
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));

    expect(markup).toContain('room-dnd-button');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('Do not disturb');
    expect(markup).toContain('lucide-moon');
  });

  it('shows room do-not-disturb status on area request cards', () => {
    const markup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot: createAreaSnapshot(),
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));

    expect(markup).toContain('room-dnd-indicator');
    expect(markup).toContain('Do not disturb');
    expect(markup).toContain('lucide-moon');
  });

  it('shows only the room code, 12-hour creation time, and elapsed time beside the service icon', () => {
    const areaSnapshot = createAreaSnapshot();
    const createdAt = '2026-08-31T09:04:00.000Z';
    areaSnapshot.serverTime = '2026-08-31T09:06:00.000Z';
    areaSnapshot.config.clockFormat = '24h';
    areaSnapshot.activeRequests = [{
      ...createRoomRequest(true),
      createdAt,
      service: { id: 'svc_custom_towels', code: 'custom-towels', displayName: 'Fresh towels', iconKey: 'towels' }
    }];
    const markup = renderToStaticMarkup(createElement(SpanishI18nProvider, {
      children: createElement(DeviceScreen, {
        snapshot: areaSnapshot,
        deviceToken: 'device-token',
        connectionStatus: 'online',
        onRefresh: async () => undefined,
        onOpenAdmin: () => undefined,
        onAuthFailure: () => undefined
      })
    }));
    const cardMarkup = markup.match(/<article class="queue-card[^"]*"[^>]*>([\s\S]*?)<\/article>/)?.[1] ?? '';

    expect(cardMarkup).toContain('queue-card__room');
    expect(cardMarkup).toContain('>101</span>');
    expect(cardMarkup).toContain(`Creada: ${formatClock(new Date(createdAt), 'en-US', 'UTC', '12h')}`);
    expect(cardMarkup).toContain('Lleva: 2 min');
    expect(cardMarkup).toContain('room-dnd-indicator');
    expect(cardMarkup).not.toContain('Room 101');
    expect(cardMarkup.indexOf('Fresh towels')).toBeGreaterThan(cardMarkup.indexOf('queue-card__topline'));
    expect(cardMarkup).toContain('queue-card__action');
  });

  it('removes the redundant live-queue section heading and keeps filters beside operational requests', () => {
    const markup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot: createAreaSnapshot(),
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));

    expect(markup).not.toContain('display-hero');
    expect(markup).not.toContain('Keep the floor moving');
    expect(markup).not.toContain('Every request has an owner');
    expect(markup).not.toContain('Live queue');
    expect(markup).toContain('topbar--area');
    expect(markup).not.toContain('class="section-heading"');
    expect(markup).not.toContain('id="queue-title"');
    expect(markup).not.toContain('section-count');
    expect(markup).not.toContain('completed-requests-toolbar');
    expect(markup).toMatch(/class="filter-row"[^>]*>[\s\S]*?<\/div><div class="queue-board/);
    expect(markup).toContain('queue-card__action');
  });

  it('shows Pendientes, Completadas, and hides the empty No molestar badge', () => {
    const markup = renderToStaticMarkup(createElement(SpanishI18nProvider, {
      children: createElement(DeviceScreen, {
        snapshot: createAreaSnapshot(),
        deviceToken: 'device-token',
        connectionStatus: 'online',
        onRefresh: async () => undefined,
        onOpenAdmin: () => undefined,
        onAuthFailure: () => undefined
      })
    }));
    const filterRowMarkup = markup.match(/<div class="filter-row"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '';
    const buttonMarkup = [...filterRowMarkup.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(([button]) => button);

    expect(buttonMarkup).toHaveLength(3);
    expect(buttonMarkup[0]).toContain('Pendientes');
    expect(buttonMarkup[1]).toContain('Completadas');
    expect(buttonMarkup[2]).toContain('No molestar');
    expect(buttonMarkup[2]).not.toContain('area-dnd-tab-count');
    expect(buttonMarkup[0]).toMatch(/filter-pill--active/);
  });

  it('shows only operational AREA columns by default and keeps completed items for their filter', () => {
    const request = createRoomRequest();
    const pending = { ...request, id: 'pending', service: { ...request.service, displayName: 'Pending towels' } };
    const accepted = { ...request, id: 'accepted', status: 'ACCEPTED' as const, service: { ...request.service, displayName: 'Accepted towels' } };
    const inProgress = { ...request, id: 'in-progress', status: 'IN_PROGRESS' as const, service: { ...request.service, displayName: 'In-progress towels' } };
    const completed = { ...request, id: 'completed', status: 'COMPLETED' as const, service: { ...request.service, displayName: 'Completed towels' } };
    const requests = [pending, accepted, inProgress, completed];
    const markup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot: { ...createAreaSnapshot(), activeRequests: requests },
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));

    expect(markup.match(/class="queue-column /g)).toHaveLength(2);
    expect(markup).not.toContain('data-area-drop-status');
    expect(markup).not.toContain('queue-column--completed');
    expect(markup).not.toContain('Completed towels');
    expect(filterAreaRequests(requests, 'COMPLETED').map(({ id }) => id)).toEqual(['completed']);
  });

  it('derives the No molestar badge count from the current snapshot without showing its grid by default', () => {
    const snapshot = {
      ...createAreaSnapshot(),
      activeRequests: [],
      activeDoNotDisturbRooms: [
        { id: 'room-305', code: '305', displayName: 'Room 305', doNotDisturb: true },
        { id: 'room-101', code: '101', displayName: 'Executive Suite', doNotDisturb: true },
        { id: 'room-1305', code: '305', displayName: 'Room 1305', doNotDisturb: true }
      ]
    };
    const markup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot,
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));

    expect(markup).toMatch(/area-dnd-tab-count[^>]*>3<\/span>/);
    expect(markup).not.toContain('area-dnd-strip');
    expect(markup).not.toContain('Room 305');
    expect(markup).not.toContain('queue-card');
  });

  it('removes drag handles and drop targets while preserving explicit status actions', () => {
    const markup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot: createAreaSnapshot(),
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));
    expect(markup).not.toContain('queue-card__drag-handle');
    expect(markup).not.toContain('draggable=');
    expect(markup).not.toContain('data-area-drop-status');
    expect(markup).not.toContain('queue-complete-drop-zone');
    expect(markup).toContain('queue-card__action');
    expect(markup).toContain('Start request');
  });

  it('queues only newly observed pending request ids and removes advanced requests', () => {
    const candidate = Reflect.get(deviceScreenModule, 'reconcileAreaPendingRequestQueue');
    expect(typeof candidate).toBe('function');
    if (typeof candidate !== 'function') return;

    const first = candidate([], ['request-1'], ['request-1', 'request-2']) as { queue: string[]; knownPendingIds: string[] };
    expect(first.queue).toEqual(['request-2']);

    const dismissed = candidate([], first.knownPendingIds, ['request-1', 'request-2']) as { queue: string[]; knownPendingIds: string[] };
    expect(dismissed.queue).toEqual([]);

    const advanced = candidate(dismissed.queue, dismissed.knownPendingIds, ['request-2']) as { queue: string[]; knownPendingIds: string[] };
    expect(advanced.knownPendingIds).toEqual(['request-2']);
    expect(advanced.queue).toEqual([]);
  });

  it('seeds initial pending request ids into the AREA confirmation queue', () => {
    const candidate = Reflect.get(deviceScreenModule, 'seedAreaPendingModalQueue');
    expect(typeof candidate).toBe('function');
    if (typeof candidate !== 'function') return;

    expect(candidate(['request-1', 'request-2'])).toEqual(['request-1', 'request-2']);
  });

  it('shows an in-modal AREA sound retry control without a global sound control or inline sound alert', () => {
    const markup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot: createAreaSnapshot(),
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));
    const modalStart = markup.indexOf('class="surface-card modal-card area-pending-confirmation-modal"');
    const soundRetryControl = markup.indexOf('area-pending-confirmation__sound-retry');

    expect(markup).toContain('area-pending-confirmation-modal');
    expect(markup).toContain('New service request');
    expect(modalStart).toBeGreaterThanOrEqual(0);
    expect(soundRetryControl).toBeGreaterThan(modalStart);
    expect(markup).toContain('aria-label="Retry sound"');
    expect(markup).toContain('>Retry sound</button>');
    expect(markup).not.toContain('class="inline-alert');
    expect(markup).not.toContain('>Enable sound</button>');
  });

  it('uses a library icon for an empty room service catalog', () => {
    const snapshot = createRoomSnapshot();
    snapshot.config.services = [];
    const markup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot,
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));

    expect(markup).toContain('lucide-plus');
    expect(markup).not.toContain('>＋</span>');
  });

  it('renders the localized default service title without visible room service copy', () => {
    const previousWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: { getItem: () => 'es', setItem: () => undefined } }
    });

    try {
      const markup = renderToStaticMarkup(createElement(I18nProvider, {
        children: createElement(DeviceScreen, {
          snapshot: createRoomSnapshot(),
          deviceToken: 'device-token',
          connectionStatus: 'online',
          onRefresh: async () => undefined,
          onOpenAdmin: () => undefined,
          onAuthFailure: () => undefined
        })
      }));

      expect(markup).toContain('Toallas limpias');
      expect(markup).not.toContain('Toallas de baño limpias');
      expect(markup).not.toContain('Fresh bath towels');
      expect(markup).not.toContain('service-tile__subtitle');
    } finally {
      if (previousWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
    }
  });

  it('renders custom room service titles without descriptions or tile arrows', () => {
    const snapshot = createRoomSnapshot();
    const templateService = snapshot.config.services[0];
    if (templateService === undefined) throw new Error('Expected the room snapshot to include a service.');
    snapshot.config.services = [
      {
        ...templateService,
        id: 'svc_custom_late-checkout',
        code: 'late-checkout',
        displayName: 'Late checkout',
        description: 'A custom late checkout arrangement'
      },
      {
        ...templateService,
        id: 'svc_custom_empty-description',
        code: 'custom-empty-description',
        displayName: 'Custom service',
        description: '   '
      }
    ];
    const markup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot,
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));

    expect(markup).toContain('Late checkout');
    expect(markup).toContain('Custom service');
    expect(markup).not.toContain('A custom late checkout arrangement');
    expect(markup).not.toContain('Request this service from the front desk.');
    expect(markup).not.toContain('service-tile__subtitle');
    expect(markup).not.toContain('service-tile__arrow');
  });

  it('renders 13 services as complete horizontal pages with floating, non-interactive direction hints', () => {
    const snapshot = createRoomSnapshot();
    snapshot.config.services = Array.from({ length: 13 }, (_, index) => ({
      id: `svc_custom_service-${index + 1}`,
      code: `service-${index + 1}`,
      displayName: `Service ${String(index + 1).padStart(2, '0')}`,
      description: `Description ${index + 1}`,
      iconKey: 'bell',
      areaId: 'area-1',
      active: true,
      displayOrder: index + 1,
      createdAt: '2026-08-31T12:00:00.000Z',
      updatedAt: '2026-08-31T12:00:00.000Z'
    }));
    const markup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot,
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));
    const pages = markup.split(/<div class="service-page service-page--(?:previous|active|next)">/).slice(1);
    const tileCounts = pages.map((page) => (page.match(/class="service-tile"/g) ?? []).length);
    const gridCounts = pages.map((page) => (page.match(/class="service-grid"/g) ?? []).length);
    const servicePositions = Array.from({ length: 13 }, (_, index) => markup.indexOf(`<strong>Service ${String(index + 1).padStart(2, '0')}</strong>`));
    const hintTags = markup.match(/<[^>]+class="service-page-hint[^"]*"[^>]*>/g) ?? [];

    expect(pages).toHaveLength(2);
    expect(tileCounts).toEqual([9, 4]);
    expect(gridCounts).toEqual([1, 1]);
    expect(hintTags.length).toBeGreaterThan(0);
    expect(hintTags.every((tag) => !tag.startsWith('<button'))).toBe(true);
    expect(hintTags.every((tag) => tag.includes('aria-hidden="true"'))).toBe(true);
    expect(markup).toContain('lucide-arrow-right');
    expect(markup).toContain('aria-hidden="true" focusable="false"');
    expect(markup).not.toContain('&lt;');
    expect(markup).not.toContain('&gt;');
    expect(markup).toContain('service-page-hint--next');
    expect(markup).not.toContain('service-page-hint--previous');
    expect(markup).not.toContain('service-page-nav');
    expect(markup).not.toContain('service-tile__subtitle');
    expect(markup).not.toContain('service-tile__arrow');
    expect(markup).not.toContain('service-overflow');
    expect(markup).toContain('class="service-pages__track"');
    expect(servicePositions.every((position) => position >= 0)).toBe(true);
    expect(servicePositions).toEqual([...servicePositions].sort((left, right) => left - right));
    expect(markup).toContain('class="service-page service-page--active"');
  });

  it('centers the selected service confirmation around the registry icon and balanced actions', () => {
    const candidate = Reflect.get(deviceScreenModule, 'ServiceRequestDialog');
    expect(typeof candidate).toBe('function');
    if (typeof candidate !== 'function') return;

    const snapshot = createRoomSnapshot();
    const service = snapshot.config.services[0];
    if (service === undefined) throw new Error('Expected the room snapshot to include a service.');
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(candidate as ComponentType<ServiceRequestDialogProps>, {
        service,
        deviceToken: 'device-token',
        deviceId: 'device-1',
        connectionStatus: 'online',
        offlineQueueTtlHours: 24,
        onClose: () => undefined,
        onRefresh: async () => undefined,
        onAuthFailure: () => undefined,
        onQueueChange: () => undefined,
        onQueueError: () => undefined
      })
    }));

    expect(markup).toContain('room-service-confirmation-modal');
    expect(markup).toContain('room-service-confirmation');
    expect(markup).toContain('room-service-confirmation__icon');
    expect(markup).toContain('room-service-confirmation__service-icon');
    expect(markup).toContain('lucide-bath');
    expect(markup).not.toContain('service-tile__arrow');
  });

  it('exposes a pure room swipe resolver that moves at most one page and clamps boundaries', () => {
    const candidate = Reflect.get(deviceScreenModule, 'resolveRoomSwipePage');
    expect(typeof candidate).toBe('function');
    if (typeof candidate !== 'function') return;

    const resolveRoomSwipePage = candidate as RoomSwipePageResolver;
    expect(resolveRoomSwipePage(1, -900, 8, 480)).toBe(2);
    expect(resolveRoomSwipePage(3, 900, 8, 480)).toBe(2);
    expect(resolveRoomSwipePage(1, -48, 8, 480)).toBe(1);
    expect(resolveRoomSwipePage(1, 48, 8, 480)).toBe(1);
    expect(resolveRoomSwipePage(0, 900, 4, 480)).toBe(0);
    expect(resolveRoomSwipePage(3, -900, 4, 480)).toBe(3);
  });

});

describe('room service paging', () => {
  it('chunks five and six ROOM area groups into pages of four and a remainder', () => {
    const candidate = Reflect.get(deviceScreenModule, 'chunkRoomServiceAreas');
    expect(typeof candidate).toBe('function');
    if (typeof candidate !== 'function') return;

    for (const groupCount of [5, 6]) {
      const groups = Array.from({ length: groupCount }, (_, index) => ({
        area: { id: `area-${index + 1}`, code: `area-${index + 1}`, displayName: `Area ${index + 1}` },
        services: []
      }));
      const pages = candidate(groups, 4) as Array<Array<{ area: { id: string } }>>;

      expect(pages.map((page) => page.length)).toEqual(groupCount === 5 ? [4, 1] : [4, 2]);
      expect(pages.flat().map(({ area }) => area.id)).toEqual(groups.map(({ area }) => area.id));
    }
  });

  it('groups services by named areas and omits empty or unknown areas', () => {
    const areas = [
      { id: 'area-housekeeping', code: 'housekeeping', displayName: 'Housekeeping' },
      { id: 'area-empty', code: 'empty', displayName: 'Empty area' },
      { id: 'area-maintenance', code: 'maintenance', displayName: 'Maintenance' }
    ];
    const services = [
      { id: 'service-maintenance', code: 'repair', displayName: 'Room repair', areaId: 'area-maintenance' },
      { id: 'service-unknown', code: 'unknown', displayName: 'Unknown service', areaId: 'area-missing' },
      { id: 'service-housekeeping', code: 'towels', displayName: 'Fresh towels', areaId: 'area-housekeeping' }
    ] as ServiceDTO[];

    expect(groupRoomServicesByArea(areas, services)).toEqual([
      { area: areas[0], services: [services[2]] },
      { area: areas[2], services: [services[0]] }
    ]);
    expect(groupRoomServicesByArea(undefined, services)).toEqual([]);
  });

  it('uses four-service pages only for square kiosk viewports', () => {
    expect(resolveRoomServicePageSize(480, 480)).toBe(4);
    expect(resolveRoomServicePageSize(520, 520)).toBe(4);
    expect(resolveRoomServicePageSize(521, 520)).toBe(9);
    expect(resolveRoomServicePageSize(480, 521)).toBe(9);
  });

  it('places each service page before, at, or after the active page', () => {
    const candidate = Reflect.get(deviceScreenModule, 'resolveRoomServicePagePosition');
    expect(typeof candidate).toBe('function');
    if (typeof candidate !== 'function') return;

    const resolveRoomServicePagePosition = candidate as RoomServicePagePositionResolver;
    expect(resolveRoomServicePagePosition(1, 2)).toBe('previous');
    expect(resolveRoomServicePagePosition(2, 2)).toBe('active');
    expect(resolveRoomServicePagePosition(3, 2)).toBe('next');
  });

  it('chunks services according to the requested page size', () => {
    const services = Array.from({ length: 5 }, (_, index) => ({ id: `service-${index}` } as ServiceDTO));

    expect(chunkServices(services, 4).map((page) => page.length)).toEqual([4, 1]);
  });

  it('reports only real horizontal overflow for the ROOM area rail', () => {
    const resolveOverflow = resolveRoomAreaOverflow as RoomAreaOverflowResolver;

    expect(resolveOverflow(0, 480, 480)).toEqual({ canScrollPrevious: false, canScrollNext: false });
    expect(resolveOverflow(0, 960, 480)).toEqual({ canScrollPrevious: false, canScrollNext: true });
    expect(resolveOverflow(480, 960, 480)).toEqual({ canScrollPrevious: true, canScrollNext: false });
    expect(resolveOverflow(0, 960, 480)).not.toEqual({ canScrollPrevious: true, canScrollNext: true });
  });
});

function createRoomSnapshot(doNotDisturb = false): DeviceSyncSnapshot {
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
       room: { id: 'room-1', code: '101', displayName: 'Room 101', doNotDisturb },
      area: null,
      hotelName: 'Hotel Local',
      hotelLogo: null,
      roomBackground: null,
      clockFormat: '12h',
      services: [{
        id: 'svc_default_fresh-towels',
        code: 'fresh-towels',
        displayName: 'Fresh towels',
        description: 'Fresh bath towels',
        iconKey: 'towels',
        areaId: 'area_default_housekeeping',
        active: true,
        displayOrder: 30,
        createdAt: '2026-08-31T12:00:00.000Z',
        updatedAt: '2026-08-31T12:00:00.000Z'
      }],
      offlineQueueTtlHours: 24,
      heartbeatIntervalMs: 15_000,
      heartbeatStaleAfterMs: 45_000,
      heartbeatOfflineAfterMs: 120_000,
      pendingAlertIntervalMs: 5_000
    },
     activeRequests: [createRoomRequest(doNotDisturb)],
     pendingTokenRotation: null
   };
 }

function createRoomRequest(doNotDisturb = false): RequestDTO {
  return {
    id: 'request-123456789',
    roomId: 'room-1',
    serviceId: 'svc_default_fresh-towels',
    responsibleAreaId: 'area_default_housekeeping',
     room: { id: 'room-1', code: '101', displayName: 'Room 101', doNotDisturb },
     service: { id: 'svc_default_fresh-towels', code: 'fresh-towels', displayName: 'Fresh towels', iconKey: 'towels' },
    responsibleArea: { id: 'area_default_housekeeping', code: 'housekeeping', displayName: 'Housekeeping' },
    status: 'PENDING',
    version: 1,
    createdAt: '2026-08-31T12:05:00.000Z',
    acceptedAt: null,
    inProgressAt: null,
    completedAt: null,
     updatedAt: '2026-08-31T12:05:00.000Z'
   };
 }

function createAreaSnapshot(): DeviceSyncSnapshot {
  const snapshot = createRoomSnapshot(true);
  return {
    ...snapshot,
    device: {
      ...snapshot.device,
      assignmentMode: 'AREA',
      roomId: null,
      areaId: 'area-1'
    },
    config: {
      ...snapshot.config,
      mode: 'AREA',
      room: null,
      area: { id: 'area-1', code: 'housekeeping', displayName: 'Housekeeping' },
      services: []
    }
  };
}

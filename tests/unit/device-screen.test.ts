import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import * as deviceScreenModule from '../../apps/web/src/features/device/DeviceScreen';
import {
  DeviceScreen,
  RoomAreaServices,
  chunkServices,
  filterAreaRequests,
  formatAreaRequestAge,
  formatRoomRequestAge,
  formatClock,
  groupRoomServicesByArea,
  resolveRoomAreaOverflow,
  resolveRoomServicePageSize,
  resolveRoomRequestSubmissionMode,
  resolveDeviceConnectionMessage,
  resolvePendingAlertIntervalMs,
  resolveRoomBackgroundStyle
} from '../../apps/web/src/features/device/DeviceScreen';
import { ApiError, isDeviceAuthFailure } from '../../apps/web/src/api';
import { I18nProvider } from '../../apps/web/src/i18n';
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
    expect(areaMarkup).not.toContain('data:image/png;base64,AAAA');
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

  it('uses the configured clock format for synchronized and request timestamps', () => {
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
    expect(markup).toMatch(/Created \d{2}:\d{2}/);
    expect(markup).not.toMatch(/Created \d{1,2}:\d{2} [AP]M/);
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

  it('keeps completed requests out of the active area filters', () => {
    const requests = [
      { id: 'pending', status: 'PENDING' },
      { id: 'accepted', status: 'ACCEPTED' },
      { id: 'completed', status: 'COMPLETED' }
    ] as RequestDTO[];

    expect(filterAreaRequests(requests, 'ALL').map((request) => request.id)).toEqual(['pending', 'accepted']);
    expect(filterAreaRequests(requests, 'ACCEPTED').map((request) => request.id)).toEqual(['accepted']);
  });

  it('only invalidates device auth for 401 or HTTP 403 DEVICE_INACTIVE', () => {
    expect(isDeviceAuthFailure(new ApiError(401, { error: { code: 'DEVICE_TOKEN_REVOKED' } }))).toBe(true);
    expect(isDeviceAuthFailure(new ApiError(403, { error: { code: 'DEVICE_INACTIVE' } }))).toBe(true);
    expect(isDeviceAuthFailure(new ApiError(403, { error: { code: 'FORBIDDEN_ASSIGNMENT' } }))).toBe(false);
  });

  it('removes the second ROOM request success state', () => {
    expect(Reflect.get(deviceScreenModule, 'RequestSuccess')).toBeUndefined();
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

      expect(englishMarkup).toContain('Requests are paused');
      expect(englishMarkup).toContain('Turn off Do not disturb for this room before requesting a service.');
      expect(spanishMarkup).toContain('Solicitudes pausadas');
      expect(spanishMarkup).toContain('Desactiva «No molestar» en esta habitación para poder solicitar un servicio.');
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

  it('removes the AREA hero copy while keeping the live queue and explicit request actions', () => {
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
    expect(markup).toContain('class="section-heading"');
    expect(markup).toContain('queue-card__action');
  });

  it('renders active do-not-disturb rooms even when the AREA has no requests', () => {
    const snapshot = {
      ...createAreaSnapshot(),
      activeRequests: [],
      activeDoNotDisturbRooms: [
        { id: 'room-305', code: '305', displayName: 'Room 305', doNotDisturb: true },
        { id: 'room-101', code: '101', displayName: 'Room 101', doNotDisturb: true }
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

    expect(markup).toContain('area-dnd-strip');
    expect(markup).toContain('Room 305');
    expect(markup).toContain('Room 101');
    expect(markup).not.toContain('queue-card');
    expect(markup.indexOf('Room 305')).toBeLessThan(markup.indexOf('Room 101'));
  });

  it('renders a dedicated drag handle and legal drop targets for AREA requests', () => {
    const markup = renderToStaticMarkup(createElement(DeviceScreen, {
      snapshot: createAreaSnapshot(),
      deviceToken: 'device-token',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onOpenAdmin: () => undefined,
      onAuthFailure: () => undefined
    }));
    const candidate = Reflect.get(deviceScreenModule, 'resolveAreaDropTransition');

    expect(markup).toContain('queue-card__drag-handle');
    expect(markup).toContain('draggable="true"');
    expect(markup).toContain('data-area-drop-status="PENDING"');
    expect(markup).toContain('data-area-drop-status="ACCEPTED"');
    expect(markup).toContain('data-area-drop-status="IN_PROGRESS"');
    expect(typeof candidate).toBe('function');
    if (typeof candidate !== 'function') return;

    expect(candidate('PENDING', 'ACCEPTED')).toBe('ACCEPTED');
    expect(candidate('ACCEPTED', 'IN_PROGRESS')).toBe('IN_PROGRESS');
    expect(candidate('IN_PROGRESS', 'COMPLETED')).toBe('COMPLETED');
    expect(candidate('PENDING', 'IN_PROGRESS')).toBeNull();
    expect(candidate('IN_PROGRESS', 'PENDING')).toBeNull();
    expect(candidate('COMPLETED', 'PENDING')).toBeNull();
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

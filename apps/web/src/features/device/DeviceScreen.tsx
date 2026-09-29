import { useCallback, useEffect, useRef, useState, type CSSProperties, type TouchEvent as ReactTouchEvent } from 'react';
import { ArrowLeft, ArrowRight, Bell, Circle, CircleAlert, Moon, Plus } from 'lucide-react';
import * as Shared from '@hotel/shared';
import type { CompactArea, CompactRoom, DeviceConfig, DeviceSyncSnapshot, LocalizedTextVariants, RequestDTO, RequestStatus, RoomBackgroundValue, ServiceDTO } from '@hotel/shared';
import { api, errorMessage, isApiError, isDeviceAuthFailure } from '../../api';
import { formatElapsed, formatElapsedWithAgo, getDeviceMode, makeMutationKey } from '../../app-model';
import { ConnectionBadge } from '../../components/ConnectionBadge';
import { LanguageSelector } from '../../components/LanguageSelector';
import { Modal } from '../../components/Modal';
import { ServiceIcon } from '../../components/ServiceIcon';
import { useI18n, createTranslator, resolveAreaDisplayName, resolveLocalizedValue, resolveServiceDisplayName, type Locale, type MessageKey, formatNumber, translateCount } from '../../i18n';
import { canCommitMutation, type ConnectionStatus } from '../../realtime';
import {
  discardExpiredRoomRequests,
  enqueueRoomRequest,
  flushRoomRequestQueue,
  getRoomRequestQueue,
  type QueuedRoomRequest
} from '../../offline-queue';
import { closeNotificationAudioContext, createNotificationAudioContext, playDoNotDisturbTransitionTones, playNotificationTone, replaceNotificationAudioContext } from '../../notification-audio';
import { DEFAULT_INFORMATION_CAROUSEL_TIMING, InformationCarousel, type InformationCarouselTiming } from './InformationCarousel';
import { PendingRequestWarningController, resolveBrowserPendingWarningRequests } from './pending-request-warning';
import { transitionNativeRequest, type NativeWebViewBridge } from '../../native-bridge';

const { isRoomBackgroundValue } = Shared;

export { MAX_PENDING_ALERT_REPEATS, resolvePendingAlertIntervalMs, shouldPlayPendingAlertImmediately, usePendingRequestAlert } from './pending-request-alert';

interface DeviceScreenProps {
  snapshot: DeviceSyncSnapshot;
  deviceToken: string;
  deviceCommandsSupported?: boolean;
  nativeBridge?: NativeWebViewBridge | null;
  connectionStatus: ConnectionStatus;
  onRefresh: () => Promise<void>;
  onOpenAdmin: () => void;
  onAuthFailure: (error?: unknown) => void;
  onInformationCycleComplete?: () => void;
  roomRequestNotificationsUnread?: boolean;
  onClearRoomRequestNotifications?: (() => void) | undefined;
}

const STATUS_KEYS: Record<RequestStatus, MessageKey> = {
  PENDING: 'request.status.new',
  ACCEPTED: 'request.status.accepted',
  IN_PROGRESS: 'request.status.inProgress',
  COMPLETED: 'request.status.completed'
};

const STATUS_CLASS: Record<RequestStatus, string> = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  IN_PROGRESS: 'in-progress',
  COMPLETED: 'completed'
};

const NEXT_STATUS: Record<RequestStatus, RequestStatus | null> = {
  PENDING: 'IN_PROGRESS',
  ACCEPTED: 'IN_PROGRESS',
  IN_PROGRESS: 'COMPLETED',
  COMPLETED: null
};

const TRANSITION_PATH: Record<Exclude<RequestStatus, 'COMPLETED'>, string> = {
  PENDING: 'start',
  ACCEPTED: 'start',
  IN_PROGRESS: 'complete'
};

const AREA_FILTERS = ['ALL', 'PENDING', 'IN_PROGRESS', 'COMPLETED'] as const;
const AREA_FILTER_TABS = [
  ...AREA_FILTERS.filter((value): value is 'ALL' | 'COMPLETED' => value === 'ALL' || value === 'COMPLETED'),
  'DO_NOT_DISTURB'
] as const;
type AreaFilterTab = typeof AREA_FILTER_TABS[number];
type DoNotDisturbAgeSeverity = 'green' | 'yellow' | 'red' | 'unknown';
const DND_AGE_SEVERITY_RANK: Record<DoNotDisturbAgeSeverity, number> = {
  unknown: 0,
  green: 1,
  yellow: 2,
  red: 3
};
const DND_WARNING_THRESHOLD_MS = 60 * 60 * 1000;
const DND_CRITICAL_THRESHOLD_MS = 3 * 60 * 60 * 1000;
const ROOM_SERVICE_PAGE_SIZE = 9;
const ROOM_AREA_PAGE_SIZE = 4;
const ROOM_SQUARE_BREAKPOINT = 520;
const ROOM_AREA_TINTS = ['amber', 'teal', 'coral', 'blue'] as const;
type RoomAreaTint = typeof ROOM_AREA_TINTS[number];

const ROOM_BACKGROUND_DEFAULTS = {
  square480: '/fondo-playa.jpg',
  tablet: '/fondo-playa-tablet.jpg'
} as const;

export function resolveRoomBackgroundStyle(roomBackground: RoomBackgroundValue | undefined): CSSProperties {
  const configuredBackground = isRoomBackgroundValue(roomBackground) ? roomBackground : null;
  const variants = configuredBackground === null
    ? ROOM_BACKGROUND_DEFAULTS
    : typeof configuredBackground === 'string'
      ? { square480: configuredBackground, tablet: configuredBackground }
      : configuredBackground;

  return {
    '--room-background-square': `url("${variants.square480}")`,
    '--room-background-tablet': `url("${variants.tablet}")`
  } as CSSProperties;
}

export function resolveInformationCarouselTiming(config: Pick<DeviceConfig, 'informationIdleTimeoutSeconds' | 'informationSlideIntervalSeconds'>): InformationCarouselTiming {
  return {
    inactivityMs: resolveCarouselSeconds(config.informationIdleTimeoutSeconds, DEFAULT_INFORMATION_CAROUSEL_TIMING.inactivityMs / 1000) * 1000,
    slideIntervalMs: resolveCarouselSeconds(config.informationSlideIntervalSeconds, DEFAULT_INFORMATION_CAROUSEL_TIMING.slideIntervalMs / 1000) * 1000
  };
}

function resolveCarouselSeconds(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}

function resolveRoomAreaTint(areaIndex: number): RoomAreaTint {
  return ROOM_AREA_TINTS[areaIndex % ROOM_AREA_TINTS.length] ?? ROOM_AREA_TINTS[0];
}

const ACTION_KEYS: Record<Exclude<RequestStatus, 'COMPLETED'>, MessageKey> = {
  PENDING: 'request.action.accept',
  ACCEPTED: 'request.action.start',
  IN_PROGRESS: 'request.action.complete'
};

export function reconcileAreaPendingRequestQueue(
  queue: readonly string[],
  knownPendingIds: readonly string[],
  currentPendingIds: readonly string[]
): { queue: string[]; knownPendingIds: string[] } {
  const currentIds = new Set(currentPendingIds);
  const retainedKnownIds = knownPendingIds.filter((id) => currentIds.has(id));
  const retainedQueue = queue.filter((id, index) => currentIds.has(id) && queue.indexOf(id) === index);
  const knownIds = new Set(retainedKnownIds);
  const newlyPendingIds = currentPendingIds.filter((id) => !knownIds.has(id));
  return {
    queue: [...retainedQueue, ...newlyPendingIds],
    knownPendingIds: [...retainedKnownIds, ...newlyPendingIds]
  };
}

export function seedAreaPendingModalQueue(pendingIds: readonly string[]): string[] {
  return [...pendingIds];
}

function resolveLocalizedDisplayName(value: { displayName: string; displayNameVariants?: LocalizedTextVariants }, locale: Locale): string {
  return resolveLocalizedValue(value.displayName, locale, value.displayNameVariants) ?? value.displayName;
}

function localizedNameContainsRoomCode(displayName: string, roomCode: string, locale: Locale): boolean {
  const normalizedCode = roomCode.trim().toLocaleLowerCase(locale);
  if (normalizedCode.length === 0) return false;

  const escapedCode = normalizedCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const roomCodeToken = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapedCode}(?:$|[^\\p{L}\\p{N}])`, 'u');
  return roomCodeToken.test(displayName.toLocaleLowerCase(locale));
}

export type RoomRequestSubmissionMode = 'queue' | 'post';

export function resolveRoomRequestSubmissionMode(status: ConnectionStatus): RoomRequestSubmissionMode {
  return status === 'online' ? 'post' : 'queue';
}

export function createRoomServiceControlClickHandler(
  doNotDisturbEnabled: boolean,
  onActivate: () => void,
  onBlockedTap?: () => void
): () => void {
  return () => {
    if (doNotDisturbEnabled) {
      onBlockedTap?.();
      return;
    }
    onActivate();
  };
}

export type AreaQueueFilter = (typeof AREA_FILTERS)[number];

export function resolveRoomServicePageSize(width: number, height: number): number {
  return width <= ROOM_SQUARE_BREAKPOINT && height <= ROOM_SQUARE_BREAKPOINT ? 4 : ROOM_SERVICE_PAGE_SIZE;
}

export function chunkServices(services: readonly ServiceDTO[], pageSize = ROOM_SERVICE_PAGE_SIZE): ServiceDTO[][] {
  const pages: ServiceDTO[][] = [];
  for (let start = 0; start < services.length; start += pageSize) {
    pages.push(services.slice(start, start + pageSize));
  }
  return pages;
}

export interface RoomServiceAreaGroup {
  area: CompactArea;
  services: ServiceDTO[];
}

export function chunkRoomServiceAreas(areas: readonly RoomServiceAreaGroup[], pageSize = ROOM_AREA_PAGE_SIZE): RoomServiceAreaGroup[][] {
  const pages: RoomServiceAreaGroup[][] = [];
  for (let start = 0; start < areas.length; start += pageSize) {
    pages.push(areas.slice(start, start + pageSize));
  }
  return pages;
}

export function groupRoomServicesByArea(areas: readonly CompactArea[] | undefined, services: readonly ServiceDTO[]): RoomServiceAreaGroup[] {
  if (areas === undefined) return [];

  const servicesByArea = new Map<string, ServiceDTO[]>();
  for (const service of services) {
    const areaServices = servicesByArea.get(service.areaId);
    if (areaServices === undefined) {
      servicesByArea.set(service.areaId, [service]);
    } else {
      areaServices.push(service);
    }
  }

  return areas.flatMap((area) => {
    const areaServices = servicesByArea.get(area.id);
    return areaServices === undefined ? [] : [{ area, services: areaServices }];
  });
}

export function resolveRoomSwipePage(startPage: number, deltaX: number, pageCount: number, viewportWidth: number): number {
  const boundedPageCount = Number.isFinite(pageCount) ? Math.max(0, Math.floor(pageCount)) : 0;
  const lastPageIndex = Math.max(boundedPageCount - 1, 0);
  const currentPage = Number.isFinite(startPage)
    ? Math.max(0, Math.min(Math.floor(startPage), lastPageIndex))
    : 0;
  const swipeThreshold = Math.max(48, Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth * 0.2 : 48);

  if (!Number.isFinite(deltaX) || Math.abs(deltaX) <= swipeThreshold) return currentPage;

  const nextPage = currentPage + (deltaX < 0 ? 1 : -1);
  return Math.max(0, Math.min(nextPage, lastPageIndex));
}

export type RoomServicePagePosition = 'previous' | 'active' | 'next';

export function resolveRoomServicePagePosition(pageIndex: number, activePage: number): RoomServicePagePosition {
  if (pageIndex < activePage) return 'previous';
  if (pageIndex > activePage) return 'next';
  return 'active';
}

export type RoomAreaOverflow = {
  canScrollPrevious: boolean;
  canScrollNext: boolean;
};

export function resolveRoomAreaOverflow(scrollLeft: number, scrollWidth: number, clientWidth: number): RoomAreaOverflow {
  const safeScrollLeft = Number.isFinite(scrollLeft) ? scrollLeft : 0;
  const safeScrollWidth = Number.isFinite(scrollWidth) ? scrollWidth : 0;
  const safeClientWidth = Number.isFinite(clientWidth) ? clientWidth : 0;
  const maxScrollLeft = Math.max(0, safeScrollWidth - safeClientWidth);
  const boundedScrollLeft = Math.max(0, Math.min(safeScrollLeft, maxScrollLeft));
  const scrollTolerance = 1;

  return {
    canScrollPrevious: boundedScrollLeft > scrollTolerance,
    canScrollNext: maxScrollLeft - boundedScrollLeft > scrollTolerance
  };
}

export function resolveDeviceConnectionMessage(status: ConnectionStatus, lastSynchronizedAt: string, locale: Locale = 'en'): string {
  const t = createTranslator(locale);
  switch (status) {
    case 'online':
      return t('connection.lastSynchronized', { time: lastSynchronizedAt });
    case 'connecting':
      return t('connection.synchronizing', { time: lastSynchronizedAt });
    case 'stale':
      return t('connection.showingLastData', { time: lastSynchronizedAt });
    case 'offline':
      return t('connection.unavailable', { time: lastSynchronizedAt });
  }
}

export function resolveDeviceFooterMessage(status: ConnectionStatus, lastSynchronizedAt: string, locale: Locale = 'en'): string {
  return resolveDeviceConnectionMessage(status, lastSynchronizedAt, locale);
}

export function formatClock(value: Date, locale?: string, timeZone?: string, clockFormat: '12h' | '24h' = '12h'): string {
  return new Intl.DateTimeFormat(locale, {
    hour: clockFormat === '24h' ? '2-digit' : 'numeric',
    minute: '2-digit',
    hour12: clockFormat === '12h',
    ...(timeZone === undefined ? {} : { timeZone })
  }).format(value);
}

export function formatAreaRequestAge(createdAt: string, currentTime: Date, locale: Locale = 'en'): string {
  return formatElapsed(createdAt, currentTime, locale);
}

export function formatRoomRequestAge(createdAt: string, currentTime: Date, locale: Locale = 'en'): string {
  return formatElapsed(createdAt, currentTime, locale);
}

function resolveDoNotDisturbRoomAge(activatedAt: string | null | undefined, currentTime: Date, locale: Locale): { severity: DoNotDisturbAgeSeverity; elapsed: string | null } {
  if (activatedAt === undefined || activatedAt === null) return { severity: 'unknown', elapsed: null };

  const activatedAtTime = Date.parse(activatedAt);
  const rawElapsedMilliseconds = currentTime.getTime() - activatedAtTime;
  if (!Number.isFinite(activatedAtTime) || !Number.isFinite(rawElapsedMilliseconds)) {
    return { severity: 'unknown', elapsed: null };
  }

  const elapsedMilliseconds = Math.max(0, rawElapsedMilliseconds);
  let severity: DoNotDisturbAgeSeverity = 'green';
  if (elapsedMilliseconds >= DND_CRITICAL_THRESHOLD_MS) severity = 'red';
  else if (elapsedMilliseconds >= DND_WARNING_THRESHOLD_MS) severity = 'yellow';

  const totalMinutes = Math.floor(elapsedMilliseconds / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  let elapsed: string;
  if (locale === 'es') {
    if (hours > 0) elapsed = minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
    else elapsed = totalMinutes > 0 ? `${totalMinutes} min` : 'menos de 1 min';
  } else if (hours > 0) {
    elapsed = minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  } else {
    elapsed = totalMinutes > 0 ? `${totalMinutes}m` : 'under 1m';
  }

  return { severity, elapsed };
}

function resolveDoNotDisturbTabSeverity(rooms: readonly CompactRoom[], currentTime: Date, locale: Locale): DoNotDisturbAgeSeverity {
  return rooms.reduce<DoNotDisturbAgeSeverity>((highest, room) => {
    const next = resolveDoNotDisturbRoomAge(room.doNotDisturbActivatedAt, currentTime, locale).severity;
    return DND_AGE_SEVERITY_RANK[next] > DND_AGE_SEVERITY_RANK[highest] ? next : highest;
  }, 'unknown');
}

export function resolveAreaRequestBucket(status: RequestStatus): Exclude<AreaQueueFilter, 'ALL'> {
  if (status === 'PENDING') return 'PENDING';
  if (status === 'COMPLETED') return 'COMPLETED';
  return 'IN_PROGRESS';
}

export function filterAreaRequests(requests: RequestDTO[], filter: AreaQueueFilter): RequestDTO[] {
  return requests.filter((request) => filter === 'ALL'
    ? resolveAreaRequestBucket(request.status) !== 'COMPLETED'
    : resolveAreaRequestBucket(request.status) === filter);
}

export type CompletedRequestOrder = 'completed-newest' | 'completed-oldest' | 'room-asc' | 'service-asc';

export function filterAndSortCompletedAreaRequests(
  requests: readonly RequestDTO[],
  query: string,
  order: CompletedRequestOrder | undefined = 'completed-newest',
  locale: Locale = 'en'
): RequestDTO[] {
  const searchTerms = query.trim().toLocaleLowerCase(locale).split(/\s+/).filter(Boolean);
  const filtered = requests.filter((request) => {
    if (request.status !== 'COMPLETED') return false;
    if (searchTerms.length === 0) return true;

    const searchableValues = [
      request.id,
      request.room.code,
      resolveLocalizedDisplayName(request.room, locale),
      request.room.displayName,
      ...Object.values(request.room.displayNameVariants ?? {}),
      request.service.code,
      resolveServiceDisplayName(request.service, locale),
      request.service.displayName,
      ...Object.values(request.service.displayNameVariants ?? {}),
      request.responsibleArea.code,
      resolveAreaDisplayName(request.responsibleArea, locale),
      request.responsibleArea.displayName,
      ...Object.values(request.responsibleArea.displayNameVariants ?? {})
    ].filter((value): value is string => typeof value === 'string')
      .map((value) => value.toLocaleLowerCase(locale));

    return searchTerms.every((term) => searchableValues.some((value) => value.includes(term)));
  });

  const completionTime = (request: RequestDTO): number => {
    const completed = request.completedAt === null ? Number.NaN : Date.parse(request.completedAt);
    if (Number.isFinite(completed)) return completed;
    const created = Date.parse(request.createdAt);
    return Number.isFinite(created) ? created : 0;
  };

  return filtered.sort((left, right) => {
    if (order === 'room-asc') {
      return left.room.code.localeCompare(right.room.code, locale, { numeric: true, sensitivity: 'base' })
        || left.id.localeCompare(right.id, locale);
    }
    if (order === 'service-asc') {
      return resolveServiceDisplayName(left.service, locale).localeCompare(resolveServiceDisplayName(right.service, locale), locale, { sensitivity: 'base' })
        || left.id.localeCompare(right.id, locale);
    }

    const newestFirst = order !== 'completed-oldest';
    const completionDifference = completionTime(left) - completionTime(right);
    return (newestFirst ? -completionDifference : completionDifference) || left.id.localeCompare(right.id, locale);
  });
}

interface CompletedRequestsToolbarProps {
  searchQuery: string;
  order: CompletedRequestOrder;
  onSearchQueryChange: (query: string) => void;
  onOrderChange: (order: CompletedRequestOrder) => void;
}

export function CompletedRequestsToolbar({ searchQuery, order, onSearchQueryChange, onOrderChange }: CompletedRequestsToolbarProps) {
  const { t } = useI18n();

  return <div className="completed-requests-toolbar">
    <label className="completed-requests-toolbar__search">
      <span className="visually-hidden">{t('device.searchCompletedRequests')}</span>
      <input
        type="search"
        value={searchQuery}
        onChange={(event) => onSearchQueryChange(event.target.value)}
        placeholder={t('device.searchCompletedRequestsPlaceholder')}
        aria-label={t('device.searchCompletedRequests')}
      />
    </label>
    <details className="completed-requests-toolbar__sort">
      <summary>{t('device.orderBy')}</summary>
      <fieldset>
        <legend className="visually-hidden">{t('device.orderBy')}</legend>
        <label><input type="radio" name="completed-request-order" value="completed-newest" checked={order === 'completed-newest'} onChange={() => onOrderChange('completed-newest')} />{t('device.orderCompletedNewest')}</label>
        <label><input type="radio" name="completed-request-order" value="completed-oldest" checked={order === 'completed-oldest'} onChange={() => onOrderChange('completed-oldest')} />{t('device.orderCompletedOldest')}</label>
        <label><input type="radio" name="completed-request-order" value="room-asc" checked={order === 'room-asc'} onChange={() => onOrderChange('room-asc')} />{t('device.orderRoomAscending')}</label>
        <label><input type="radio" name="completed-request-order" value="service-asc" checked={order === 'service-asc'} onChange={() => onOrderChange('service-asc')} />{t('device.orderServiceAscending')}</label>
      </fieldset>
    </details>
  </div>;
}

export function CompletedRequestsEmptyState({ searchActive }: { searchActive: boolean }) {
  const { t } = useI18n();
  return <span className="queue-column__empty" role="status" aria-live="polite">
    {searchActive ? t('device.noCompletedSearchResults') : t('device.clear')}
  </span>;
}

function requestStatusLabel(status: RequestStatus, locale: Locale): string {
  return createTranslator(locale)(STATUS_KEYS[status === 'ACCEPTED' ? 'IN_PROGRESS' : status]);
}

function requestActionLabel(status: RequestStatus, locale: Locale): string {
  return status === 'COMPLETED' ? requestStatusLabel(status, locale) : createTranslator(locale)(ACTION_KEYS[status]);
}

function BrandLockup({ hotelName, hotelLogo, showContext = true }: { hotelName: string; hotelLogo: string | null; showContext?: boolean }) {
  const { t } = useI18n();

  return (
    <div className="brand-lockup">
      {hotelLogo === null ? <span className="brand-lockup__mark" aria-hidden="true">+</span> : <img className="brand-lockup__logo" src={hotelLogo} alt="" />}
      <div>
        <span className="brand-lockup__name">{hotelName}</span>
        {showContext && <span className="brand-lockup__context">{t('brand.operationsDesk')}</span>}
      </div>
    </div>
  );
}

export function DeviceScreen({ snapshot, deviceToken, deviceCommandsSupported = true, nativeBridge = null, connectionStatus, onRefresh, onOpenAdmin, onAuthFailure, onInformationCycleComplete, roomRequestNotificationsUnread = false, onClearRoomRequestNotifications }: DeviceScreenProps) {
  const { locale, t } = useI18n();
  const mode = getDeviceMode(snapshot.device);
  const hotelName = resolveLocalizedDisplayName({
    displayName: snapshot.config.hotelName,
    ...(snapshot.config.hotelNameVariants === undefined ? {} : { displayNameVariants: snapshot.config.hotelNameVariants })
  }, locale);
  const location = snapshot.config.room === null
    ? snapshot.config.area === null ? t('device.unassignedStation') : resolveAreaDisplayName(snapshot.config.area, locale)
    : resolveLocalizedDisplayName(snapshot.config.room, locale);
  const deviceDisplayName = resolveLocalizedDisplayName(snapshot.device, locale);
  const roomCode = snapshot.config.room?.code.trim() || t('device.unassignedStation');
  const currentTime = useServerClock(snapshot.serverTime, connectionStatus);
  const lastSynchronizedAt = formatSynchronizedAt(snapshot.serverTime, locale, snapshot.config.clockFormat);
  const roomBackgroundStyle = mode === 'ROOM' ? resolveRoomBackgroundStyle(snapshot.config.roomBackground) : undefined;
  const informationCarouselTiming = resolveInformationCarouselTiming(snapshot.config);

  const header = (
    <header className={`topbar${mode === 'ROOM' ? ' topbar--room' : ' topbar--area'}`}>
      {mode === 'ROOM' ? (
        <>
          <div className="topbar__identity">
            <BrandLockup hotelName={hotelName} hotelLogo={snapshot.config.hotelLogo} showContext={false} />
          </div>
          <div className="room-identity">
            <span className="room-identity__code">{roomCode}</span>
          </div>
          <div className="topbar__actions">
            <ConnectionBadge status={connectionStatus} />
            <LanguageSelector />
          </div>
        </>
      ) : (
        <>
          <BrandLockup hotelName={hotelName} hotelLogo={snapshot.config.hotelLogo} />
          <div className="topbar__right">
            <div className="station-context">
             <span className="station-context__name">{deviceDisplayName}</span>
              <span className="station-context__location">{location} · {t('device.areaConsole')}</span>
            </div>
             <ConnectionBadge status={connectionStatus} />
             <time className="station-clock" dateTime={currentTime.toISOString()}>{formatClock(currentTime, locale, undefined, snapshot.config.clockFormat)}</time>
             <button className="button button--ghost button--small" type="button" onClick={onOpenAdmin}>{t('common.admin')}</button>
          </div>
        </>
      )}
    </header>
  );

  const deviceContent = (
    <div className="device-content">
      {mode === 'ROOM' ? (
        <RoomDisplay
          snapshot={snapshot}
          deviceToken={deviceToken}
           connectionStatus={connectionStatus}
           currentTime={currentTime}
           onRefresh={onRefresh}
           onOpenAdmin={onOpenAdmin}
           onAuthFailure={onAuthFailure}
           roomRequestNotificationsUnread={roomRequestNotificationsUnread}
           onClearRoomRequestNotifications={onClearRoomRequestNotifications}
          />
      ) : (
        <AreaDisplay
          snapshot={snapshot}
          deviceToken={deviceToken}
          deviceCommandsSupported={deviceCommandsSupported}
          nativeBridge={nativeBridge}
           connectionStatus={connectionStatus}
           currentTime={currentTime}
           onRefresh={onRefresh}
           onOpenAdmin={onOpenAdmin}
           onAuthFailure={onAuthFailure}
         />
      )}
    </div>
  );

  return (
    <main className={`app-frame app-frame--device${mode === 'ROOM' ? ' app-frame--room' : ''}`} style={roomBackgroundStyle}>
      {mode === 'ROOM' ? (
        <InformationCarousel
          images={snapshot.config.informationImages ?? []}
          locale={locale}
          deviceToken={deviceToken}
          onAuthFailure={onAuthFailure}
          onCycleComplete={onInformationCycleComplete}
          inactivityMs={informationCarouselTiming.inactivityMs}
          slideIntervalMs={informationCarouselTiming.slideIntervalMs}
        >
          {header}
          {deviceContent}
        </InformationCarousel>
      ) : (
        <>
          {header}
          {deviceContent}
          <footer className="device-footer">
            <span>{t('device.stationConfig', { version: snapshot.deviceConfigVersion })}</span>
            <span>{t('device.syncSequence', { sequence: formatNumber(snapshot.currentEventSequence, locale) })}</span>
            <span>{resolveDeviceFooterMessage(connectionStatus, lastSynchronizedAt, locale)}</span>
            {snapshot.pendingTokenRotation !== null && <span className="footer-warning">{t('device.tokenRotationReady')}</span>}
          </footer>
        </>
      )}
    </main>
  );
}

function RoomDoNotDisturbControl({ enabled, deviceToken, connectionStatus, onRefresh, onAuthFailure }: { enabled: boolean; deviceToken: string; connectionStatus: ConnectionStatus; onRefresh: () => Promise<void>; onAuthFailure: (error?: unknown) => void }) {
  const { locale, t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleDoNotDisturb(): Promise<void> {
    if (!canCommitMutation(connectionStatus)) {
      setError(t('connection.actionsPaused'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.patch('/room/me/do-not-disturb', { doNotDisturb: !enabled }, { token: deviceToken, headers: { 'Idempotency-Key': makeMutationKey('room-dnd') } });
      await onRefresh();
    } catch (toggleError) {
      if (isDeviceAuthFailure(toggleError)) onAuthFailure(toggleError);
      setError(errorMessage(toggleError, t('errors.roomDoNotDisturbFailed'), locale));
    } finally {
      setBusy(false);
    }
  }

  return <div className="room-dnd-control">
    <button className={`room-dnd-button${enabled ? ' room-dnd-button--active' : ''}`} type="button" onClick={() => void toggleDoNotDisturb()} disabled={busy || !canCommitMutation(connectionStatus)} aria-pressed={enabled} aria-label={enabled ? t('device.disableDoNotDisturb') : t('device.enableDoNotDisturb')}>
        <span className="room-dnd-button__icon" aria-hidden="true"><Moon size={21} strokeWidth={1.8} /></span>
       <span className="room-dnd-button__label">{enabled ? t('device.doNotDisturbOn') : t('device.doNotDisturb')}</span>
    </button>
    {error !== null && <span className="room-dnd-control__error" role="alert">{error}</span>}
  </div>;
}

function RoomRequestStatusControl({ requests, currentTime, unread, onClearUnread }: { requests: RequestDTO[]; currentTime: Date; unread: boolean; onClearUnread: (() => void) | undefined }) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const sortedRequests = [...requests].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  function openRequestStatus(): void {
    setOpen(true);
    onClearUnread?.();
  }

  return (
    <>
      <button
        className="room-request-button"
        type="button"
        onClick={openRequestStatus}
        aria-label={unread ? t('device.unreadRequestStatus') : t('device.requestStatus')}
        aria-expanded={open}
        aria-controls="room-request-status-panel"
      >
         <Bell className={`notification-bell room-request-button__bell room-request-button__icon${unread ? ' room-request-button__icon--unread' : ''}`} aria-hidden="true" focusable="false" size={18} strokeWidth={1.8} />
        <span>{t('device.yourRequests')}</span>
        <span className="room-request-button__count">{formatNumber(sortedRequests.length, locale)}</span>
         {unread && <span className="room-request-button__badge" aria-hidden="true"><CircleAlert size={11} strokeWidth={2} /></span>}
      </button>
        <Modal open={open} title={t('device.yourRequests')} onClose={() => setOpen(false)} closeLabel={t('common.closeDialog')} className="room-modal room-request-status-modal" scrimClassName="room-request-status-scrim">
        <div id="room-request-status-panel" className="room-request-status-panel">
          <RequestList requests={sortedRequests} currentTime={currentTime} emptyCopy={t('device.requestsWillAppear')} />
        </div>
      </Modal>
    </>
  );
}

interface DeviceDisplayProps {
  snapshot: DeviceSyncSnapshot;
  deviceToken: string;
  deviceCommandsSupported?: boolean;
  nativeBridge?: NativeWebViewBridge | null;
  connectionStatus: ConnectionStatus;
  currentTime: Date;
  onRefresh: () => Promise<void>;
  onOpenAdmin: () => void;
  onAuthFailure: (error?: unknown) => void;
  roomRequestNotificationsUnread?: boolean;
  onClearRoomRequestNotifications?: (() => void) | undefined;
}

interface ViewportSize {
  width: number;
  height: number;
}

function useViewportSize(): ViewportSize | null {
  const [viewportSize, setViewportSize] = useState<ViewportSize | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const updateViewportSize = () => setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    updateViewportSize();
    window.addEventListener('resize', updateViewportSize);
    return () => window.removeEventListener('resize', updateViewportSize);
  }, []);

  return viewportSize;
}

function RoomDisplay({ snapshot, deviceToken, connectionStatus, currentTime, onRefresh, onOpenAdmin, onAuthFailure, roomRequestNotificationsUnread = false, onClearRoomRequestNotifications }: DeviceDisplayProps) {
  const { locale, t } = useI18n();
  const doNotDisturbEnabled = snapshot.config.room?.doNotDisturb ?? false;
  const [selectedService, setSelectedService] = useState<ServiceDTO | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [doNotDisturbExplanationOpen, setDoNotDisturbExplanationOpen] = useState(false);
  const [queuedRequests, setQueuedRequests] = useState<QueuedRoomRequest[]>(() => getRoomRequestQueue({ deviceId: snapshot.device.id }));
  const [queueError, setQueueError] = useState<string | null>(null);
  const [activePage, setActivePage] = useState(0);
  const [areaOverflow, setAreaOverflow] = useState<RoomAreaOverflow>({ canScrollPrevious: false, canScrollNext: false });
  const areaGridRef = useRef<HTMLDivElement | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartPageRef = useRef<number | null>(null);
  const viewportSize = useViewportSize();
  const pendingQueuedRequests = queuedRequests.filter((request) => request.status === 'PENDING');
  const expiredQueuedRequests = queuedRequests.filter((request) => request.status === 'EXPIRED_UNSENT');
  const roomServiceAreas = groupRoomServicesByArea(snapshot.config.areas, snapshot.config.services);
  const roomAreaPages = chunkRoomServiceAreas(roomServiceAreas);
  const selectedArea = roomServiceAreas.find((group) => group.area.id === selectedAreaId) ?? null;
  const shouldRenderAreaCards = roomServiceAreas.length > 0;
  const roomAreaLayoutKey = roomServiceAreas.map(({ area, services }) => `${area.id}:${services.length}`).join('|');
  const servicePageSize = resolveRoomServicePageSize(viewportSize?.width ?? Number.POSITIVE_INFINITY, viewportSize?.height ?? Number.POSITIVE_INFINITY);
  const servicePages = chunkServices(snapshot.config.services, servicePageSize);
  const lastPageIndex = Math.max(servicePages.length - 1, 0);
  const boundedActivePage = Math.min(activePage, lastPageIndex);

  useEffect(() => {
    if (doNotDisturbEnabled) {
      setSelectedAreaId(null);
      setSelectedService(null);
      return;
    }
    setDoNotDisturbExplanationOpen(false);
  }, [doNotDisturbEnabled]);

  const explainDoNotDisturbBlock = useCallback(() => setDoNotDisturbExplanationOpen(true), []);

  useEffect(() => {
    setActivePage((page) => Math.min(page, lastPageIndex));
  }, [lastPageIndex]);

  useEffect(() => {
    const areaGrid = areaGridRef.current;
    if (!shouldRenderAreaCards || areaGrid === null) {
      setAreaOverflow({ canScrollPrevious: false, canScrollNext: false });
      return undefined;
    }

    const updateAreaOverflow = () => {
      setAreaOverflow(resolveRoomAreaOverflow(areaGrid.scrollLeft, areaGrid.scrollWidth, areaGrid.clientWidth));
    };

    updateAreaOverflow();
    areaGrid.addEventListener('scroll', updateAreaOverflow, { passive: true });
    window.addEventListener('resize', updateAreaOverflow);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateAreaOverflow);
    resizeObserver?.observe(areaGrid);

    return () => {
      areaGrid.removeEventListener('scroll', updateAreaOverflow);
      window.removeEventListener('resize', updateAreaOverflow);
      resizeObserver?.disconnect();
    };
  }, [roomAreaLayoutKey, shouldRenderAreaCards]);

  const navigateToServicePage = useCallback((pageIndex: number) => {
    const nextPage = Math.max(0, Math.min(pageIndex, lastPageIndex));
    setActivePage(nextPage);
  }, [lastPageIndex]);

  const handleServiceTouchStart = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (touch === undefined) return;

    touchStartXRef.current = touch.clientX;
    const currentPage = boundedActivePage;
    touchStartPageRef.current = Math.max(0, Math.min(currentPage, lastPageIndex));
  }, [boundedActivePage, lastPageIndex]);

  const resetServiceTouch = useCallback(() => {
    touchStartXRef.current = null;
    touchStartPageRef.current = null;
  }, []);

  const handleServiceTouchEnd = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    const startX = touchStartXRef.current;
    const startPage = touchStartPageRef.current;
    const touch = event.changedTouches[0] ?? event.touches[0];
    resetServiceTouch();
    if (startX === null || startPage === null || touch === undefined) return;

    const rail = event.currentTarget;
    const nextPage = resolveRoomSwipePage(startPage, touch.clientX - startX, servicePages.length, rail.clientWidth);
    navigateToServicePage(nextPage);
  }, [navigateToServicePage, resetServiceTouch, servicePages.length]);

  const refreshQueue = useCallback(() => {
    setQueuedRequests(getRoomRequestQueue({ deviceId: snapshot.device.id, now: new Date() }));
  }, [snapshot.device.id]);

  function discardExpired() {
    discardExpiredRoomRequests({ deviceId: snapshot.device.id, now: new Date() });
    refreshQueue();
  }

  return (
     <div className="device-layout device-layout--room">
      {connectionStatus !== 'online' && (
        <div className="visually-hidden" role="status" aria-live="polite">
          {resolveDeviceConnectionMessage(connectionStatus, formatSynchronizedAt(snapshot.serverTime, locale, snapshot.config.clockFormat), locale)} {t('device.requestNotSentYet')}
        </div>
      )}
      {queueError !== null && <div className="visually-hidden" role="alert">{queueError}</div>}
      {queuedRequests.length > 0 && (
        <div className="visually-hidden" role="status" aria-live="polite">
          <span>
            {pendingQueuedRequests.length > 0 && `${translateCount(locale, 'requests.waitingToSend', pendingQueuedRequests.length)} `}
            {expiredQueuedRequests.length > 0 && translateCount(locale, 'requests.expiredUnsent', expiredQueuedRequests.length)}
          </span>
          {expiredQueuedRequests.length > 0 && <button className="text-button" type="button" onClick={discardExpired}>{t('device.discardExpired')}</button>}
        </div>
      )}

      <section className="room-services-section" aria-labelledby="services-title">
         <h2 className="visually-hidden" id="services-title">{t('device.guestServices')}</h2>
          {snapshot.config.services.length === 0 ? (
             <EmptyState title={t('device.noServicesAssigned')} copy={t('device.noServicesCopy')} />
           ) : shouldRenderAreaCards ? (
             <div className="room-area-scroll-rail">
               {areaOverflow.canScrollPrevious && (
                 <span className="room-area-scroll-hint room-area-scroll-hint--previous" aria-hidden="true"><ArrowLeft aria-hidden="true" focusable="false" size={28} strokeWidth={1.8} /></span>
               )}
              <div ref={areaGridRef} className="room-area-grid" role="group" aria-label={t('device.guestServices')}>
                {roomAreaPages.map((page, pageIndex) => (
                  <div className="room-area-page" key={`room-area-page-${pageIndex}`}>
                    {page.map(({ area }, areaIndex) => {
                      const tint = resolveRoomAreaTint(pageIndex * ROOM_AREA_PAGE_SIZE + areaIndex);
                      return (
                        <button
                          className={`service-tile room-area-card room-area-card--${tint}${doNotDisturbEnabled ? ' service-tile--disabled' : ''}`}
                          type="button"
                          key={area.id}
                          onClick={createRoomServiceControlClickHandler(
                            doNotDisturbEnabled,
                            () => setSelectedAreaId(area.id),
                            explainDoNotDisturbBlock
                          )}
                          aria-disabled={doNotDisturbEnabled || undefined}
                          aria-haspopup="dialog"
                          aria-expanded={selectedAreaId === area.id}
                        >
                          <span className="service-tile__icon"><ServiceIcon iconKey={area.code} size={27} /></span>
                          <span className="service-tile__body">
                            <strong>{resolveAreaDisplayName(area, locale)}</strong>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
               {areaOverflow.canScrollNext && (
                 <span className="room-area-scroll-hint room-area-scroll-hint--next" aria-hidden="true"><ArrowRight aria-hidden="true" focusable="false" size={28} strokeWidth={1.8} /></span>
               )}
             </div>
          ) : (
               <div className="service-page-rail">
                {boundedActivePage > 0 && (
                   <span className="service-page-hint service-page-hint--previous" aria-hidden="true"><ArrowLeft aria-hidden="true" focusable="false" size={28} strokeWidth={1.8} /></span>
                )}
                <div
                   id="room-service-pages"
                   className="service-pages"
                   role="region"
                   aria-label={t('device.guestServices')}
                   onTouchStart={handleServiceTouchStart}
                   onTouchEnd={handleServiceTouchEnd}
                   onTouchCancel={resetServiceTouch}
                 >
                    <div className="service-pages__track">
                      {servicePages.map((services, pageIndex) => (
                        <div className={`service-page service-page--${resolveRoomServicePagePosition(pageIndex, boundedActivePage)}`} key={services[0]?.id ?? 'service-page'}>
                          <div className="service-grid">
                            {services.map((service) => (
                              <ServiceTile
                                key={service.id}
                                service={service}
                                onSelect={setSelectedService}
                                doNotDisturbEnabled={doNotDisturbEnabled}
                                onDoNotDisturbTap={explainDoNotDisturbBlock}
                              />
                            ))}
                          </div>
                       </div>
                     ))}
                   </div>
                 </div>
                {boundedActivePage < lastPageIndex && (
                   <span className="service-page-hint service-page-hint--next" aria-hidden="true"><ArrowRight aria-hidden="true" focusable="false" size={28} strokeWidth={1.8} /></span>
                )}
              </div>
           )}
       </section>

        <div className="room-bottom-controls">
          <div className="room-request-control">
            <RoomRequestStatusControl
              requests={snapshot.activeRequests}
              currentTime={currentTime}
              unread={roomRequestNotificationsUnread}
              onClearUnread={onClearRoomRequestNotifications}
            />
          </div>
          <RoomDoNotDisturbControl
           enabled={doNotDisturbEnabled}
           deviceToken={deviceToken}
           connectionStatus={connectionStatus}
           onRefresh={onRefresh}
           onAuthFailure={onAuthFailure}
          />
          <div className="room-bottom-controls__actions">
            <button className="button button--ghost button--small" type="button" onClick={onOpenAdmin}>{t('common.admin')}</button>
          </div>
       </div>

       <ServiceRequestDialog
        service={doNotDisturbEnabled ? null : selectedService}
        deviceToken={deviceToken}
        deviceId={snapshot.device.id}
        connectionStatus={connectionStatus}
        offlineQueueTtlHours={snapshot.config.offlineQueueTtlHours}
        onClose={() => setSelectedService(null)}
        onRefresh={onRefresh}
        onAuthFailure={onAuthFailure}
        onQueueChange={refreshQueue}
         onQueueError={setQueueError}
       />
       <Modal
          open={selectedArea !== null && !doNotDisturbEnabled}
          title={selectedArea === null ? t('device.guestServices') : resolveAreaDisplayName(selectedArea.area, locale)}
          onClose={() => setSelectedAreaId(null)}
          closeLabel={t('common.closeDialog')}
          className="room-modal room-area-services-modal"
         >
           {selectedArea !== null && (
             <RoomAreaServices
               services={selectedArea.services}
               doNotDisturbEnabled={doNotDisturbEnabled}
               onDoNotDisturbTap={explainDoNotDisturbBlock}
               onSelect={(nextService) => {
                 if (doNotDisturbEnabled) return;
                 setSelectedAreaId(null);
                 setSelectedService(nextService);
               }}
             />
           )}
          </Modal>
        <RoomDoNotDisturbExplanation
          open={doNotDisturbExplanationOpen && doNotDisturbEnabled}
          onClose={() => setDoNotDisturbExplanationOpen(false)}
        />
      </div>
     );
}

export function RoomDoNotDisturbExplanation({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();

  return (
    <Modal
      open={open}
      title={t('device.doNotDisturbRequestTitle')}
      onClose={onClose}
      closeLabel={t('common.closeDialog')}
      className="room-modal room-dnd-explanation-modal"
      visuallyHideTitle
    >
      <p className="modal-card__copy">{t('device.doNotDisturbRequestCopy')}</p>
      <div className="form-actions">
        <button className="button button--primary" type="button" onClick={onClose} data-autofocus>{t('common.close')}</button>
      </div>
    </Modal>
  );
}

interface RoomAreaServicesProps {
  services: readonly ServiceDTO[];
  doNotDisturbEnabled?: boolean;
  onDoNotDisturbTap?: () => void;
  onSelect: (service: ServiceDTO) => void;
}

export function RoomAreaServices({ services, onSelect, doNotDisturbEnabled = false, onDoNotDisturbTap }: RoomAreaServicesProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState<RoomAreaOverflow>({ canScrollPrevious: false, canScrollNext: false });
  const servicePageKey = services.map((service) => service.id).join('|');
  const servicePages = chunkServices(services, ROOM_AREA_PAGE_SIZE);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return undefined;

    const updateOverflow = (): void => {
      setOverflow(resolveRoomAreaOverflow(viewport.scrollLeft, viewport.scrollWidth, viewport.clientWidth));
    };
    updateOverflow();
    viewport.addEventListener('scroll', updateOverflow, { passive: true });
    window.addEventListener('resize', updateOverflow);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(updateOverflow);
    resizeObserver?.observe(viewport);

    return () => {
      viewport.removeEventListener('scroll', updateOverflow);
      window.removeEventListener('resize', updateOverflow);
      resizeObserver?.disconnect();
    };
  }, [servicePageKey]);

  return <div className="room-area-services__rail">
    {overflow.canScrollPrevious && (
      <span className="room-area-scroll-hint room-area-scroll-hint--previous" aria-hidden="true"><ArrowLeft aria-hidden="true" focusable="false" size={24} strokeWidth={1.8} /></span>
    )}
    <div ref={viewportRef} className="room-area-services__viewport">
      <div className="room-area-services__grid">
        {servicePages.map((page, pageIndex) => (
          <div className="room-area-services__page" key={`room-area-service-page-${pageIndex}`}>
            {page.map((service, serviceIndex) => (
              <ServiceTile
                key={service.id}
                service={service}
                onSelect={onSelect}
                doNotDisturbEnabled={doNotDisturbEnabled}
                {...(onDoNotDisturbTap === undefined ? {} : { onDoNotDisturbTap })}
                autoFocus={pageIndex === 0 && serviceIndex === 0}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
    {overflow.canScrollNext && (
      <span className="room-area-scroll-hint room-area-scroll-hint--next" aria-hidden="true"><ArrowRight aria-hidden="true" focusable="false" size={24} strokeWidth={1.8} /></span>
    )}
  </div>;
}

interface ServiceTileProps {
  service: ServiceDTO;
  onSelect: (service: ServiceDTO) => void;
  doNotDisturbEnabled?: boolean;
  onDoNotDisturbTap?: () => void;
  autoFocus?: boolean;
}

function ServiceTile({ service, onSelect, doNotDisturbEnabled = false, onDoNotDisturbTap, autoFocus = false }: ServiceTileProps) {
  const { locale } = useI18n();
  const clickHandler = createRoomServiceControlClickHandler(
    doNotDisturbEnabled,
    () => onSelect(service),
    onDoNotDisturbTap
  );

  return <button className={`service-tile${doNotDisturbEnabled ? ' service-tile--disabled' : ''}`} type="button" onClick={clickHandler} aria-disabled={doNotDisturbEnabled || undefined} data-autofocus={autoFocus ? true : undefined}>
    <span className="service-tile__icon"><ServiceIcon iconKey={service.iconKey} size={27} /></span>
    <span className="service-tile__body">
      <strong>{resolveServiceDisplayName(service, locale)}</strong>
    </span>
  </button>;
}

function AreaDisplay({ snapshot, deviceToken, deviceCommandsSupported = true, nativeBridge = null, connectionStatus, currentTime, onRefresh, onAuthFailure }: DeviceDisplayProps) {
  const { locale, t } = useI18n();
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AreaFilterTab>('ALL');
  const [completedSearchQuery, setCompletedSearchQuery] = useState('');
  const [completedOrder, setCompletedOrder] = useState<CompletedRequestOrder>('completed-newest');
  const activeDoNotDisturbRooms = snapshot.activeDoNotDisturbRooms ?? [];
  const activeDoNotDisturbRoomCount = activeDoNotDisturbRooms.length;
  const activeDoNotDisturbTabSeverity = resolveDoNotDisturbTabSeverity(activeDoNotDisturbRooms, currentTime, locale);
  const activeDoNotDisturbRoomIdsKey = snapshot.activeDoNotDisturbRooms === undefined
    ? null
    : JSON.stringify([...new Set(snapshot.activeDoNotDisturbRooms.map((room) => room.id))].sort());
  const previousActiveDoNotDisturbRoomsRef = useRef<CompactRoom[] | null>(snapshot.activeDoNotDisturbRooms ?? null);
  const initialPendingModalQueue = seedAreaPendingModalQueue(snapshot.activeRequests.filter((request) => request.status === 'PENDING').map((request) => request.id));
  const [pendingModalQueue, setPendingModalQueue] = useState<string[]>(() => initialPendingModalQueue);
  const [pendingTonePlayed, setPendingTonePlayed] = useState(false);
  const [pendingToneUnavailable, setPendingToneUnavailable] = useState(false);
  const knownPendingIdsRef = useRef<string[]>(initialPendingModalQueue);
  const audioContextRef = useRef<AudioContext | null>(null);
  const pendingToneAttemptRef = useRef<{ requestId: string; played: boolean } | null>(null);
  const pendingRequestWarningControllerRef = useRef<PendingRequestWarningController | null>(null);
  const columns: Exclude<RequestStatus, 'ACCEPTED'>[] = filter === 'COMPLETED'
    ? ['COMPLETED']
    : filter === 'DO_NOT_DISTURB'
      ? []
      : ['PENDING', 'IN_PROGRESS'];
  const visibleRequests = filter === 'DO_NOT_DISTURB' ? [] : filterAreaRequests(snapshot.activeRequests, filter);
  const pendingRequestIdKey = snapshot.activeRequests.filter((request) => request.status === 'PENDING').map((request) => request.id).join('|');
  const pendingRequestWarningKey = snapshot.activeRequests
    .filter((request) => request.status === 'PENDING')
    .map((request) => `${request.id}:${request.createdAt}`)
    .sort()
    .join('|');
  const pendingModalRequest = pendingModalQueue
    .map((requestId) => snapshot.activeRequests.find((request) => request.id === requestId && request.status === 'PENDING'))
    .find((request): request is RequestDTO => request !== undefined) ?? null;
  const pendingToneNeedsRetry = pendingModalRequest !== null
    && (pendingToneAttemptRef.current?.requestId !== pendingModalRequest.id || !pendingTonePlayed);
  useEffect(() => {
    const currentPendingIds = snapshot.activeRequests.filter((request) => request.status === 'PENDING').map((request) => request.id);
    const nextQueue = reconcileAreaPendingRequestQueue(pendingModalQueue, knownPendingIdsRef.current, currentPendingIds);
    knownPendingIdsRef.current = nextQueue.knownPendingIds;
    setPendingModalQueue(nextQueue.queue);
  }, [pendingRequestIdKey]);

  useEffect(() => {
    const controller = new PendingRequestWarningController(() => {
      const existingContext = audioContextRef.current;
      const context = existingContext?.state === 'closed'
        ? createNotificationAudioContext()
        : existingContext ?? createNotificationAudioContext();
      if (context === null) return;
      audioContextRef.current = context;
      void playNotificationTone(context);
    });
    pendingRequestWarningControllerRef.current = controller;
    return () => {
      controller.dispose();
      if (pendingRequestWarningControllerRef.current === controller) pendingRequestWarningControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const controller = pendingRequestWarningControllerRef.current;
    if (controller === null) return;
    const nativeBridgeCandidate = typeof window === 'undefined'
      ? null
      : (window as Window & { HotelAlertNative?: unknown }).HotelAlertNative;
    controller.update(
      resolveBrowserPendingWarningRequests(snapshot.activeRequests, nativeBridgeCandidate !== null && nativeBridgeCandidate !== undefined),
      currentTime.getTime()
    );
  }, [currentTime, pendingRequestWarningKey, snapshot.activeRequests]);

  useEffect(() => {
    const currentRooms = snapshot.activeDoNotDisturbRooms;
    if (currentRooms === undefined) {
      previousActiveDoNotDisturbRoomsRef.current = null;
      return;
    }

    // Legacy AREA snapshots may omit the list; the first known set is only a baseline.
    const previousRooms = previousActiveDoNotDisturbRoomsRef.current;
    previousActiveDoNotDisturbRoomsRef.current = currentRooms;
    if (previousRooms === null) return;

    const previousRoomsById = new Map(previousRooms.map((room) => [room.id, room]));
    const currentRoomsById = new Map(currentRooms.map((room) => [room.id, room]));
    const activatedRooms = [...currentRoomsById]
      .filter(([roomId]) => !previousRoomsById.has(roomId))
      .sort(([leftId], [rightId]) => leftId.localeCompare(rightId));
    const deactivatedRooms = [...previousRoomsById]
      .filter(([roomId]) => !currentRoomsById.has(roomId))
      .sort(([leftId], [rightId]) => leftId.localeCompare(rightId));
    if (activatedRooms.length === 0 && deactivatedRooms.length === 0) return;

    const transitions = [
      ...activatedRooms.map(() => 'activated' as const),
      ...deactivatedRooms.map(() => 'deactivated' as const)
    ];

    const existingContext = audioContextRef.current;
    const context = existingContext?.state === 'closed'
      ? createNotificationAudioContext()
      : existingContext ?? createNotificationAudioContext();
    if (context === null) return;
    audioContextRef.current = context;
    void playDoNotDisturbTransitionTones(context, transitions);
  }, [activeDoNotDisturbRoomIdsKey, snapshot.activeDoNotDisturbRooms]);

  useEffect(() => {
    if (pendingModalRequest === null) return;
    if (pendingToneAttemptRef.current?.requestId === pendingModalRequest.id) return;
    pendingToneAttemptRef.current = { requestId: pendingModalRequest.id, played: false };
    setPendingTonePlayed(false);
    setPendingToneUnavailable(false);
    void attemptPendingTone(pendingModalRequest.id, false);
  }, [pendingModalRequest?.id]);

  useEffect(() => () => {
    closeNotificationAudioContext(audioContextRef.current);
  }, []);

  async function attemptPendingTone(requestId: string, fromInteraction: boolean): Promise<void> {
    const attempt = pendingToneAttemptRef.current;
    if (attempt === null || attempt.requestId !== requestId || attempt.played) return;
    const existingContext = audioContextRef.current;
    const context = fromInteraction
      ? replaceNotificationAudioContext(existingContext)
      : existingContext?.state === 'closed'
        ? createNotificationAudioContext()
        : existingContext ?? createNotificationAudioContext();
    if (context === null) {
      setPendingToneUnavailable(true);
      return;
    }
    audioContextRef.current = context;
    const played = await playNotificationTone(context);
    if (pendingToneAttemptRef.current?.requestId !== requestId) return;
    attempt.played = played;
    setPendingTonePlayed(played);
    setPendingToneUnavailable(!played);
  }

  async function advanceRequest(request: RequestDTO): Promise<boolean> {
    const nextStatus = NEXT_STATUS[request.status];
    if (request.status === 'COMPLETED' || nextStatus === null) return false;
    if (!deviceCommandsSupported) {
      setError(t('device.nativeDeviceCommandsUnavailable'));
      return false;
    }
    if (!canCommitMutation(connectionStatus)) {
      setError(t('connection.actionsPaused'));
      return false;
    }
    setBusyRequestId(request.id);
    setError(null);
    let mutationCompleted = false;
    try {
      const transition = {
        requestId: request.id,
        targetStatus: nextStatus as Exclude<RequestStatus, 'PENDING'>,
        expectedVersion: request.version,
        idempotencyKey: makeMutationKey('transition')
      } as const;
      if (nativeBridge !== null && deviceCommandsSupported) {
        await transitionNativeRequest(nativeBridge, transition);
      } else {
        await api.post<RequestDTO>(
          `/requests/${encodeURIComponent(request.id)}/${TRANSITION_PATH[request.status]}`,
          { expectedVersion: request.version },
          { token: deviceToken, headers: { 'Idempotency-Key': transition.idempotencyKey } }
        );
      }
      mutationCompleted = true;
    } catch (transitionError) {
       const nativeErrorCode = transitionError instanceof Error ? transitionError.message : null;
       if (isDeviceAuthFailure(transitionError) || nativeErrorCode === 'DEVICE_INACTIVE' || nativeErrorCode === 'DEVICE_TOKEN_REVOKED') {
         onAuthFailure(isDeviceAuthFailure(transitionError) ? transitionError : nativeErrorCode);
       }
       setError(errorMessage(transitionError, t('errors.requestUpdateFailed'), locale));
    } finally {
      setBusyRequestId(null);
    }
    if (!mutationCompleted) return false;
    try {
      await onRefresh();
    } catch {
      setError(t('errors.refreshFailed'));
    }
    return true;
  }

  function dismissPendingRequest(requestId: string): void {
    setPendingModalQueue((queue) => queue.filter((queuedId) => queuedId !== requestId));
    setError(null);
  }

  async function confirmPendingRequest(): Promise<void> {
    if (pendingModalRequest === null) return;
    const transitioned = await advanceRequest(pendingModalRequest);
    if (transitioned) dismissPendingRequest(pendingModalRequest.id);
  }

  function retryPendingToneOnInteraction(): void {
    if (pendingModalRequest !== null) void attemptPendingTone(pendingModalRequest.id, true);
  }

  return (
    <div className="device-layout device-layout--area">
      {(connectionStatus !== 'online' || !deviceCommandsSupported || error !== null) && (
        <div className="area-status-stack" aria-live="polite">
          {connectionStatus !== 'online' && (
            <div className="inline-alert inline-alert--stale" role="status">
              <span aria-hidden="true"><CircleAlert size={16} strokeWidth={1.8} /></span>
              <span>{resolveDeviceConnectionMessage(connectionStatus, formatSynchronizedAt(snapshot.serverTime, locale, snapshot.config.clockFormat), locale)} {t('connection.actionsPaused')}</span>
            </div>
          )}
          {!deviceCommandsSupported && <div className="inline-alert" role="status">{t('device.nativeDeviceCommandsUnavailable')}</div>}
          {error !== null && <div className="inline-alert" role="alert"><span aria-hidden="true"><CircleAlert size={16} strokeWidth={1.8} /></span><span>{error}</span></div>}
        </div>
      )}

       <section aria-label={t('device.serviceRequests')}>
        <div className="filter-row" role="group" aria-label={t('device.filterAreaRequests')}>
          {AREA_FILTER_TABS.map((value) => (
            <button className={`filter-pill${filter === value ? ' filter-pill--active' : ''}`} type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {value === 'DO_NOT_DISTURB' ? t('device.doNotDisturb') : requestStatusLabel(value === 'ALL' ? 'PENDING' : value, locale)}
              {value === 'DO_NOT_DISTURB' && activeDoNotDisturbRoomCount > 0 && (
                <span className={`area-dnd-tab-count area-dnd-tab-count--${activeDoNotDisturbTabSeverity}`} aria-live="polite">
                  {formatNumber(activeDoNotDisturbRoomCount, locale)}
                </span>
              )}
            </button>
          ))}
        </div>
         {filter === 'COMPLETED' && (
           <CompletedRequestsToolbar
             searchQuery={completedSearchQuery}
             order={completedOrder}
             onSearchQueryChange={setCompletedSearchQuery}
             onOrderChange={setCompletedOrder}
           />
         )}
         {filter === 'DO_NOT_DISTURB' ? (
           activeDoNotDisturbRooms.length > 0 && (
             <section className="area-dnd-strip" aria-label={t('device.activeDoNotDisturbRooms')}>
               <div className="area-dnd-strip__rooms" role="list">
                 {activeDoNotDisturbRooms.map((room) => {
                   const displayName = resolveLocalizedDisplayName(room, locale);
                   const nameIncludesRoomCode = localizedNameContainsRoomCode(displayName, room.code, locale);
                   const age = resolveDoNotDisturbRoomAge(room.doNotDisturbActivatedAt, currentTime, locale);
                   const elapsedLabel = age.elapsed === null
                     ? t('device.doNotDisturbTimeUnavailable')
                     : t('device.doNotDisturbActiveFor', { time: age.elapsed });

                   return <div className={`area-dnd-room area-dnd-room--${age.severity}`} role="listitem" key={room.id}>
                     <Moon size={16} aria-hidden="true" />
                     {nameIncludesRoomCode
                       ? <strong>{displayName}</strong>
                       : <><strong>{room.code}</strong><span>{displayName}</span></>}
                     <span className="area-dnd-room__age">{elapsedLabel}</span>
                   </div>;
                 })}
               </div>
             </section>
         )
         ) : (
         <>
         <div className={`queue-board${filter === 'COMPLETED' ? ' queue-board--completed' : ''}`}>
           {columns.map((status) => {
            const requests = status === 'COMPLETED'
              ? filterAndSortCompletedAreaRequests(visibleRequests, completedSearchQuery, completedOrder, locale)
              : visibleRequests
                .filter((request) => resolveAreaRequestBucket(request.status) === status)
                .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
             return (
             <div
               className={`queue-column queue-column--${STATUS_CLASS[status]}${status === 'PENDING' && requests.length > 0 ? ' queue-column--has-pending' : ''}`}
               key={status}
             >
                <div className="queue-column__heading">
                  <span>{requestStatusLabel(status, locale)}</span>
                  <span>{formatNumber(requests.length, locale)}</span>
                </div>
                <div className="queue-column__body">
                  {requests.length === 0 ? (
                    status === 'COMPLETED' ? <CompletedRequestsEmptyState searchActive={completedSearchQuery.trim().length > 0} /> : <span className="queue-column__empty">{t('device.clear')}</span>
                  ) : requests.map((request) => (
                    <article className={`queue-card${request.status === 'PENDING' ? ' queue-card--pending' : ''}`} key={request.id}>
                       <div className="queue-card__topline">
                          <span className="request-icon"><ServiceIcon iconKey={request.service.iconKey} size={17} /></span>
                          <span className="queue-card__room">{request.room.code}</span>
                          <div className="queue-card__metadata">
                            <span className="queue-card__created">{t('device.requestCreatedAt', { time: formatClock(new Date(request.createdAt), 'en-US', undefined, '12h') })}</span>
                            <span className="queue-card__age">{t('device.requestElapsed', { time: formatAreaRequestAge(request.createdAt, currentTime, locale) })}</span>
                          </div>
                          {request.room.doNotDisturb && <span className="room-dnd-indicator" role="status"><span aria-hidden="true"><Moon size={13} strokeWidth={1.8} /></span>{t('device.doNotDisturb')}</span>}
                       </div>
                      <h3>{resolveServiceDisplayName(request.service, locale)}</h3>
                      {NEXT_STATUS[request.status] !== null && (
                         <button className="button button--dark button--small queue-card__action" type="button" onClick={() => void advanceRequest(request)} disabled={busyRequestId === request.id || !deviceCommandsSupported || !canCommitMutation(connectionStatus)}>
                          {busyRequestId === request.id ? t('request.updating') : requestActionLabel(request.status, locale)}
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            );
           })}
         </div>
         </>
         )}
       </section>

       {pendingModalRequest !== null && (
         <Modal
           open
           title={t('device.pendingRequestTitle')}
           onClose={() => dismissPendingRequest(pendingModalRequest.id)}
           closeLabel={t('common.closeDialog')}
           className="area-pending-confirmation-modal"
         >
            <div className="area-pending-confirmation">
              <p className="modal-card__copy">
                {t('device.pendingRequestCopy', {
                  service: resolveServiceDisplayName(pendingModalRequest.service, locale),
                  room: resolveLocalizedDisplayName(pendingModalRequest.room, locale)
                })}
              </p>
              {pendingToneNeedsRetry && (
                <button
                  className="button button--ghost area-pending-confirmation__sound-retry"
                  type="button"
                  onClick={retryPendingToneOnInteraction}
                  aria-label={t('device.retryPendingRequestSound')}
                >
                  {t('device.retryPendingRequestSound')}
                </button>
              )}
              {pendingToneUnavailable && <p className="form-error" role="status">{t('device.pendingRequestSoundBlocked')}</p>}
             {error !== null && <p className="form-error" role="alert">{error}</p>}
             <div className="form-actions">
               <button className="button button--ghost" type="button" onClick={() => dismissPendingRequest(pendingModalRequest.id)} disabled={busyRequestId === pendingModalRequest.id}>{t('device.pendingRequestLater')}</button>
               <button className="button button--primary" type="button" onClick={() => void confirmPendingRequest()} disabled={busyRequestId === pendingModalRequest.id || !deviceCommandsSupported || !canCommitMutation(connectionStatus)} data-autofocus>
                 {busyRequestId === pendingModalRequest.id ? t('request.updating') : requestActionLabel(pendingModalRequest.status, locale)}
               </button>
             </div>
           </div>
        </Modal>
        )}

      </div>
   );
}

function useServerClock(serverTime: string, connectionStatus: ConnectionStatus): Date {
  const [currentTime, setCurrentTime] = useState(() => (
    connectionStatus === 'online' && Number.isFinite(Date.parse(serverTime))
      ? new Date(serverTime)
      : new Date()
  ));

  useEffect(() => {
    const synchronizedAt = Date.parse(serverTime);
    const clientTimeAtSynchronization = Date.now();
    const updateClock = () => {
      const hasAuthoritativeServerTime = connectionStatus === 'online' && Number.isFinite(synchronizedAt);
      setCurrentTime(hasAuthoritativeServerTime
        ? new Date(synchronizedAt + (Date.now() - clientTimeAtSynchronization))
        : new Date());
    };
    updateClock();
    const timer = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(timer);
  }, [connectionStatus, serverTime]);

  return currentTime;
}

function formatSynchronizedAt(value: string, locale: Locale = 'en', clockFormat: '12h' | '24h' = '12h'): string {
  return formatClock(new Date(value), locale, undefined, clockFormat);
}

interface ServiceRequestDialogProps {
  service: ServiceDTO | null;
  deviceToken: string;
  deviceId: string;
  connectionStatus: ConnectionStatus;
  offlineQueueTtlHours: number;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onAuthFailure: (error?: unknown) => void;
  onQueueChange: () => void;
  onQueueError: (message: string) => void;
}

export function ServiceRequestDialog({ service, deviceToken, deviceId, connectionStatus, offlineQueueTtlHours, onClose, onRefresh, onAuthFailure, onQueueChange, onQueueError }: ServiceRequestDialogProps) {
  const { locale, t } = useI18n();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flushingRef = useRef(false);

  useEffect(() => {
    if (service !== null) {
      setError(null);
    }
  }, [service]);

  useEffect(() => {
    if (connectionStatus !== 'online' || deviceToken.length === 0) return undefined;
    let disposed = false;
    const flush = async () => {
      if (disposed || flushingRef.current) return;
      flushingRef.current = true;
      try {
        const result = await flushRoomRequestQueue(
          (request) => api.post<RequestDTO>('/requests', { serviceId: request.serviceId }, {
            token: deviceToken,
            headers: { 'Idempotency-Key': request.idempotencyKey }
          }),
          {
            deviceId,
            now: new Date(),
             shouldRetry: (flushError) => !isApiError(flushError) || flushError.status >= 500 || isDeviceAuthFailure(flushError),
             stopOnError: (flushError) => {
               if (isDeviceAuthFailure(flushError)) {
                 onAuthFailure(flushError);
                 return true;
              }
              if (isApiError(flushError) && flushError.status < 500) {
                 onQueueError(errorMessage(flushError, t('errors.queuedRequestRejected'), locale));
                return true;
              }
              return false;
            }
          }
        );
        if (disposed) return;
        onQueueChange();
        if (result.succeeded > 0) await onRefresh();
      } finally {
        flushingRef.current = false;
      }
    };

    void flush();
    const retryTimer = setInterval(() => void flush(), 5_000);
    return () => {
      disposed = true;
      clearInterval(retryTimer);
    };
  }, [connectionStatus, deviceId, deviceToken, locale, onAuthFailure, onQueueChange, onQueueError, onRefresh, t]);

  async function submit() {
    if (service === null) return;
    setSubmitting(true);
    setError(null);
    const idempotencyKey = makeMutationKey('request');
    let mutationCompleted = false;

    const queueRequest = (): void => {
      const queued = enqueueRoomRequest({ deviceId, serviceId: service.id, idempotencyKey }, {
        ttlMs: offlineQueueTtlHours * 60 * 60 * 1000
      });
      if (queued.status === 'queued' || queued.status === 'duplicate') {
        onQueueChange();
        onClose();
      } else if (queued.status === 'full') {
        setError(t('errors.offlineQueueFull'));
      } else {
        setError(t('errors.offlineStorageFailed'));
      }
    };

    try {
      if (resolveRoomRequestSubmissionMode(connectionStatus) === 'queue') {
        queueRequest();
        return;
      }
      await api.post<RequestDTO>('/requests', { serviceId: service.id }, {
        token: deviceToken,
        headers: { 'Idempotency-Key': idempotencyKey }
      });
      mutationCompleted = true;
      onClose();
      await onRefresh();
    } catch (submissionError) {
      if (mutationCompleted) {
        return;
      }
      if (isDeviceAuthFailure(submissionError)) onAuthFailure(submissionError);
      if (isApiError(submissionError) && submissionError.status < 500) {
        setError(errorMessage(submissionError, t('errors.requestSendFailed'), locale));
      } else {
        queueRequest();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={service !== null} title={service === null ? t('request.confirmTitle') : resolveServiceDisplayName(service, locale)} onClose={onClose} closeLabel={t('common.closeDialog')} className="room-modal room-service-confirmation-modal">
      {service !== null && (
         <div className="room-service-confirmation">
            <div className="room-service-confirmation__icon"><ServiceIcon className="room-service-confirmation__service-icon" iconKey={service.iconKey} size={42} /></div>
           <div className="room-service-confirmation__body">
             <p className="eyebrow eyebrow--muted">{t('request.confirmTitle')}</p>
             <p className="room-service-confirmation__copy">{t('request.confirmCopy')}</p>
           </div>
           {error !== null && <p className="form-error" role="alert">{error}</p>}
           <div className="form-actions room-service-confirmation__actions">
             <button className="button button--ghost" type="button" onClick={onClose} disabled={submitting}>{t('request.notNow')}</button>
             <button className="button button--primary" type="button" onClick={() => void submit()} disabled={submitting}>
               {submitting ? t('request.sending') : t('request.send')}
             </button>
           </div>
         </div>
       )}
    </Modal>
  );
}

function RequestList({ requests, currentTime, emptyCopy }: { requests: RequestDTO[]; currentTime: Date; emptyCopy: string }) {
  const { locale, t } = useI18n();
   if (requests.length === 0) return <div className="empty-state empty-state--inline"><span className="empty-state__mark" aria-hidden="true"><Circle size={19} strokeWidth={1.8} /></span><p>{emptyCopy}</p></div>;
  return (
    <div className="request-list">
      {requests.slice(0, 8).map((request) => (
        <article className="request-row" key={request.id}>
          <span className={`status-dot status-dot--${STATUS_CLASS[request.status]}`} aria-hidden="true" />
          <div className="request-row__main"><strong>{resolveServiceDisplayName(request.service, locale)}</strong><span>{formatElapsedWithAgo(request.createdAt, currentTime, locale, t('common.ago'))}</span></div>
          <span className={`status-label status-label--${STATUS_CLASS[request.status]}`}>{requestStatusLabel(request.status, locale)}</span>
        </article>
      ))}
    </div>
  );
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
   return <div className="empty-state"><span className="empty-state__mark" aria-hidden="true"><Plus size={28} strokeWidth={1.8} /></span><h3>{title}</h3><p>{copy}</p></div>;
}

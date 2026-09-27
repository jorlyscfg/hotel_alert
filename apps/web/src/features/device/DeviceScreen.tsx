import { useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent } from 'react';
import { ArrowLeft, ArrowRight, Bell, Circle, CircleAlert, GripVertical, Moon, Plus } from 'lucide-react';
import * as Shared from '@hotel/shared';
import type { CompactArea, DeviceSyncSnapshot, LocalizedTextVariants, RequestDTO, RequestStatus, RoomBackgroundValue, ServiceDTO } from '@hotel/shared';
import { api, errorMessage, isApiError, isDeviceAuthFailure } from '../../api';
import { formatElapsed, formatElapsedWithAgo, getDeviceMode, makeMutationKey } from '../../app-model';
import { ConnectionBadge } from '../../components/ConnectionBadge';
import { LanguageSelector } from '../../components/LanguageSelector';
import { Modal } from '../../components/Modal';
import { ServiceIcon } from '../../components/ServiceIcon';
import { useI18n, createTranslator, resolveLocalizedValue, resolveServiceDisplayName, type Locale, type MessageKey, formatNumber, translateCount } from '../../i18n';
import { canCommitMutation, type ConnectionStatus } from '../../realtime';
import {
  discardExpiredRoomRequests,
  enqueueRoomRequest,
  flushRoomRequestQueue,
  getRoomRequestQueue,
  type QueuedRoomRequest
} from '../../offline-queue';
import { closeNotificationAudioContext, createNotificationAudioContext, playNotificationTone, replaceNotificationAudioContext } from '../../notification-audio';

const { isRoomBackgroundValue } = Shared;

export { MAX_PENDING_ALERT_REPEATS, resolvePendingAlertIntervalMs, shouldPlayPendingAlertImmediately, usePendingRequestAlert } from './pending-request-alert';

interface DeviceScreenProps {
  snapshot: DeviceSyncSnapshot;
  deviceToken: string;
  connectionStatus: ConnectionStatus;
  onRefresh: () => Promise<void>;
  onOpenAdmin: () => void;
  onAuthFailure: () => void;
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
  PENDING: 'ACCEPTED',
  ACCEPTED: 'IN_PROGRESS',
  IN_PROGRESS: 'COMPLETED',
  COMPLETED: null
};

const TRANSITION_PATH: Record<Exclude<RequestStatus, 'COMPLETED'>, string> = {
  PENDING: 'accept',
  ACCEPTED: 'start',
  IN_PROGRESS: 'complete'
};

const AREA_FILTERS = ['ALL', 'PENDING', 'ACCEPTED', 'IN_PROGRESS'] as const;
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

function resolveRoomAreaTint(areaIndex: number): RoomAreaTint {
  return ROOM_AREA_TINTS[areaIndex % ROOM_AREA_TINTS.length] ?? ROOM_AREA_TINTS[0];
}

const ACTION_KEYS: Record<Exclude<RequestStatus, 'COMPLETED'>, MessageKey> = {
  PENDING: 'request.action.accept',
  ACCEPTED: 'request.action.start',
  IN_PROGRESS: 'request.action.complete'
};

export function resolveAreaDropTransition(sourceStatus: RequestStatus, targetStatus: RequestStatus): RequestStatus | null {
  return NEXT_STATUS[sourceStatus] === targetStatus ? targetStatus : null;
}

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

function isAreaDropStatus(value: string | undefined): value is RequestStatus {
  return value === 'PENDING' || value === 'ACCEPTED' || value === 'IN_PROGRESS' || value === 'COMPLETED';
}

function resolveAreaDropStatusAtPoint(clientX: number, clientY: number): RequestStatus | null {
  if (typeof document === 'undefined') return null;
  const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-area-drop-status]');
  const status = target?.dataset['areaDropStatus'];
  return isAreaDropStatus(status) ? status : null;
}

function resolveLocalizedDisplayName(value: { displayName: string; displayNameVariants?: LocalizedTextVariants }, locale: Locale): string {
  return resolveLocalizedValue(value.displayName, locale, value.displayNameVariants) ?? value.displayName;
}

export type RoomRequestSubmissionMode = 'queue' | 'post';

export function resolveRoomRequestSubmissionMode(status: ConnectionStatus): RoomRequestSubmissionMode {
  return status === 'online' ? 'post' : 'queue';
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

export function filterAreaRequests(requests: RequestDTO[], filter: AreaQueueFilter): RequestDTO[] {
  return requests.filter((request) => request.status !== 'COMPLETED' && (filter === 'ALL' || request.status === filter));
}

function requestStatusLabel(status: RequestStatus, locale: Locale): string {
  return createTranslator(locale)(STATUS_KEYS[status]);
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

export function DeviceScreen({ snapshot, deviceToken, connectionStatus, onRefresh, onOpenAdmin, onAuthFailure, roomRequestNotificationsUnread = false, onClearRoomRequestNotifications }: DeviceScreenProps) {
  const { locale, t } = useI18n();
  const mode = getDeviceMode(snapshot.device);
  const location = snapshot.config.room === null
    ? snapshot.config.area === null ? t('device.unassignedStation') : resolveLocalizedDisplayName(snapshot.config.area, locale)
    : resolveLocalizedDisplayName(snapshot.config.room, locale);
  const deviceDisplayName = resolveLocalizedDisplayName(snapshot.device, locale);
  const roomCode = snapshot.config.room?.code.trim() || t('device.unassignedStation');
  const currentTime = useServerClock(snapshot.serverTime);
  const lastSynchronizedAt = formatSynchronizedAt(snapshot.serverTime, locale, snapshot.config.clockFormat);
  const roomBackgroundStyle = mode === 'ROOM' ? resolveRoomBackgroundStyle(snapshot.config.roomBackground) : undefined;

  return (
    <main className={`app-frame app-frame--device${mode === 'ROOM' ? ' app-frame--room' : ''}`} style={roomBackgroundStyle}>
      <header className={`topbar${mode === 'ROOM' ? ' topbar--room' : ''}`}>
        {mode === 'ROOM' ? (
          <>
            <div className="topbar__identity">
              <BrandLockup hotelName={snapshot.config.hotelName} hotelLogo={snapshot.config.hotelLogo} showContext={false} />
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
            <BrandLockup hotelName={snapshot.config.hotelName} hotelLogo={snapshot.config.hotelLogo} />
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
             connectionStatus={connectionStatus}
             currentTime={currentTime}
             onRefresh={onRefresh}
             onOpenAdmin={onOpenAdmin}
             onAuthFailure={onAuthFailure}
           />
        )}
      </div>

       {mode !== 'ROOM' && (
         <footer className="device-footer">
           <span>{t('device.stationConfig', { version: snapshot.deviceConfigVersion })}</span>
           <span>{t('device.syncSequence', { sequence: formatNumber(snapshot.currentEventSequence, locale) })}</span>
           <span>{resolveDeviceFooterMessage(connectionStatus, lastSynchronizedAt, locale)}</span>
           {snapshot.pendingTokenRotation !== null && <span className="footer-warning">{t('device.tokenRotationReady')}</span>}
         </footer>
       )}
    </main>
  );
}

function RoomDoNotDisturbControl({ enabled, deviceToken, connectionStatus, onRefresh, onAuthFailure }: { enabled: boolean; deviceToken: string; connectionStatus: ConnectionStatus; onRefresh: () => Promise<void>; onAuthFailure: () => void }) {
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
      if (isDeviceAuthFailure(toggleError)) onAuthFailure();
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
  connectionStatus: ConnectionStatus;
  currentTime: Date;
  onRefresh: () => Promise<void>;
  onOpenAdmin: () => void;
  onAuthFailure: () => void;
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
    if (!doNotDisturbEnabled) return;
    setSelectedAreaId(null);
    setSelectedService(null);
  }, [doNotDisturbEnabled]);

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
                          className={`service-tile room-area-card room-area-card--${tint}`}
                          type="button"
                          key={area.id}
                          onClick={() => {
                            if (!doNotDisturbEnabled) setSelectedAreaId(area.id);
                          }}
                          disabled={doNotDisturbEnabled}
                          aria-haspopup="dialog"
                          aria-expanded={selectedAreaId === area.id}
                        >
                          <span className="service-tile__icon"><ServiceIcon iconKey={area.code} size={27} /></span>
                          <span className="service-tile__body">
                            <strong>{resolveLocalizedDisplayName(area, locale)}</strong>
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
                            {services.map((service) => <ServiceTile key={service.id} service={service} onSelect={setSelectedService} disabled={doNotDisturbEnabled} />)}
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
          title={selectedArea === null ? t('device.guestServices') : resolveLocalizedDisplayName(selectedArea.area, locale)}
          onClose={() => setSelectedAreaId(null)}
          closeLabel={t('common.closeDialog')}
          className="room-modal room-area-services-modal"
         >
           {selectedArea !== null && (
             <RoomAreaServices
               services={selectedArea.services}
               disabled={doNotDisturbEnabled}
               onSelect={(nextService) => {
                 if (doNotDisturbEnabled) return;
                 setSelectedAreaId(null);
                 setSelectedService(nextService);
               }}
             />
           )}
         </Modal>
     </div>
   );
}

interface RoomAreaServicesProps {
  services: readonly ServiceDTO[];
  disabled?: boolean;
  onSelect: (service: ServiceDTO) => void;
}

export function RoomAreaServices({ services, onSelect, disabled = false }: RoomAreaServicesProps) {
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
                disabled={disabled}
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
  disabled?: boolean;
  autoFocus?: boolean;
}

function ServiceTile({ service, onSelect, disabled = false, autoFocus = false }: ServiceTileProps) {
  const { locale } = useI18n();

  return <button className="service-tile" type="button" onClick={() => onSelect(service)} disabled={disabled} data-autofocus={autoFocus ? true : undefined}>
    <span className="service-tile__icon"><ServiceIcon iconKey={service.iconKey} size={27} /></span>
    <span className="service-tile__body">
      <strong>{resolveServiceDisplayName(service, locale)}</strong>
    </span>
  </button>;
}

function AreaDisplay({ snapshot, deviceToken, connectionStatus, currentTime, onRefresh, onAuthFailure }: DeviceDisplayProps) {
  const { locale, t } = useI18n();
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AreaQueueFilter>('ALL');
  const initialPendingModalQueue = seedAreaPendingModalQueue(snapshot.activeRequests.filter((request) => request.status === 'PENDING').map((request) => request.id));
  const [pendingModalQueue, setPendingModalQueue] = useState<string[]>(() => initialPendingModalQueue);
  const [draggingRequestId, setDraggingRequestId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<RequestStatus | null>(null);
  const [pendingTonePlayed, setPendingTonePlayed] = useState(false);
  const [pendingToneUnavailable, setPendingToneUnavailable] = useState(false);
  const knownPendingIdsRef = useRef<string[]>(initialPendingModalQueue);
  const audioContextRef = useRef<AudioContext | null>(null);
  const pendingToneAttemptRef = useRef<{ requestId: string; played: boolean } | null>(null);
  const pointerDragRef = useRef<{ requestId: string; pointerId: number } | null>(null);
  const columns: Exclude<RequestStatus, 'COMPLETED'>[] = ['PENDING', 'ACCEPTED', 'IN_PROGRESS'];
  const visibleRequests = filterAreaRequests(snapshot.activeRequests, filter);
  const pendingRequestIdKey = snapshot.activeRequests.filter((request) => request.status === 'PENDING').map((request) => request.id).join('|');
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

  async function advanceRequest(request: RequestDTO, requestedStatus?: RequestStatus): Promise<boolean> {
    const nextStatus = requestedStatus ?? NEXT_STATUS[request.status];
    if (request.status === 'COMPLETED' || nextStatus === null || resolveAreaDropTransition(request.status, nextStatus) === null) return false;
    if (!canCommitMutation(connectionStatus)) {
      setError(t('connection.actionsPaused'));
      return false;
    }
    setBusyRequestId(request.id);
    setError(null);
    let mutationCompleted = false;
    try {
      await api.post<RequestDTO>(
        `/requests/${encodeURIComponent(request.id)}/${TRANSITION_PATH[request.status]}`,
        { expectedVersion: request.version },
        { token: deviceToken, headers: { 'Idempotency-Key': makeMutationKey('transition') } }
      );
      mutationCompleted = true;
    } catch (transitionError) {
       if (isDeviceAuthFailure(transitionError)) onAuthFailure();
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

  function clearDragState(): void {
    pointerDragRef.current = null;
    setDraggingRequestId(null);
    setDragOverStatus(null);
  }

  function dropRequest(requestId: string, targetStatus: RequestStatus): void {
    const request = snapshot.activeRequests.find((candidate) => candidate.id === requestId);
    if (request === undefined || resolveAreaDropTransition(request.status, targetStatus) === null) return;
    void advanceRequest(request, targetStatus);
  }

  function handleNativeDragStart(event: ReactDragEvent<HTMLButtonElement>, request: RequestDTO): void {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', request.id);
    setDraggingRequestId(request.id);
  }

  function handleNativeDragOver(event: ReactDragEvent<HTMLDivElement>, targetStatus: RequestStatus): void {
    const requestId = draggingRequestId ?? event.dataTransfer.getData('text/plain');
    const request = snapshot.activeRequests.find((candidate) => candidate.id === requestId);
    if (request === undefined || resolveAreaDropTransition(request.status, targetStatus) === null) {
      setDragOverStatus(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverStatus(targetStatus);
  }

  function handleNativeDrop(event: ReactDragEvent<HTMLDivElement>, targetStatus: RequestStatus): void {
    event.preventDefault();
    const requestId = draggingRequestId ?? event.dataTransfer.getData('text/plain');
    clearDragState();
    if (requestId !== '') dropRequest(requestId, targetStatus);
  }

  function handleNativeDragLeave(event: ReactDragEvent<HTMLDivElement>): void {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
    setDragOverStatus(null);
  }

  function handleTouchDragStart(event: ReactPointerEvent<HTMLButtonElement>, request: RequestDTO): void {
    if (event.pointerType === 'mouse' || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerDragRef.current = { requestId: request.id, pointerId: event.pointerId };
    setDraggingRequestId(request.id);
  }

  function handleTouchDragMove(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (pointerDragRef.current === null) return;
    event.preventDefault();
    setDragOverStatus(resolveAreaDropStatusAtPoint(event.clientX, event.clientY));
  }

  function handleTouchDragEnd(event: ReactPointerEvent<HTMLButtonElement>, cancelled = false): void {
    const drag = pointerDragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    const targetStatus = cancelled ? null : resolveAreaDropStatusAtPoint(event.clientX, event.clientY);
    clearDragState();
    if (targetStatus !== null) dropRequest(drag.requestId, targetStatus);
  }

  return (
    <div className="device-layout device-layout--area">
      {connectionStatus !== 'online' && (
        <div className="inline-alert inline-alert--stale" role="status">
           <span aria-hidden="true"><CircleAlert size={16} strokeWidth={1.8} /></span>
          <span>{resolveDeviceConnectionMessage(connectionStatus, formatSynchronizedAt(snapshot.serverTime, locale, snapshot.config.clockFormat), locale)} {t('connection.actionsPaused')}</span>
        </div>
      )}

       {error !== null && <div className="inline-alert" role="alert"><span aria-hidden="true"><CircleAlert size={16} strokeWidth={1.8} /></span><span>{error}</span></div>}

       {snapshot.activeDoNotDisturbRooms !== undefined && snapshot.activeDoNotDisturbRooms.length > 0 && (
         <section className="area-dnd-strip" aria-labelledby="area-dnd-title">
           <div className="area-dnd-strip__heading">
             <span className="eyebrow eyebrow--muted" id="area-dnd-title"><Moon size={14} aria-hidden="true" />{t('device.activeDoNotDisturbRooms')}</span>
             <span className="section-count">{formatNumber(snapshot.activeDoNotDisturbRooms.length, locale)}</span>
           </div>
           <div className="area-dnd-strip__rooms" role="list">
             {snapshot.activeDoNotDisturbRooms.map((room) => (
               <div className="area-dnd-room" role="listitem" key={room.id}>
                 <Moon size={16} aria-hidden="true" />
                 <strong>{room.code}</strong>
                 <span>{resolveLocalizedDisplayName(room, locale)}</span>
               </div>
             ))}
           </div>
         </section>
       )}

       <section aria-labelledby="queue-title">
         <div className="section-heading">
          <div>
            <p className="eyebrow eyebrow--muted">{t('device.liveQueue')}</p>
            <h2 id="queue-title">{t('device.serviceRequests')}</h2>
           </div>
          <span className="section-count">{t('device.shown', { count: formatNumber(visibleRequests.length, locale) })}</span>
         </div>
        <div className="filter-row" role="group" aria-label={t('device.filterAreaRequests')}>
          {AREA_FILTERS.map((value) => (
            <button className={`filter-pill${filter === value ? ' filter-pill--active' : ''}`} type="button" key={value} onClick={() => setFilter(value)}>
              {value === 'ALL' ? t('device.allActive') : requestStatusLabel(value, locale)}
            </button>
          ))}
        </div>
         <div className="queue-board">
           {columns.map((status) => {
            const requests = visibleRequests
              .filter((request) => request.status === status)
              .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
             return (
             <div
               className={`queue-column queue-column--${STATUS_CLASS[status]}${status === 'PENDING' && requests.length > 0 ? ' queue-column--has-pending' : ''}${dragOverStatus === status ? ' queue-column--drag-over' : ''}`}
               data-area-drop-status={status}
               key={status}
               onDragOver={(event) => handleNativeDragOver(event, status)}
               onDragLeave={handleNativeDragLeave}
               onDrop={(event) => handleNativeDrop(event, status)}
             >
                <div className="queue-column__heading">
                  <span>{requestStatusLabel(status, locale)}</span>
                  <span>{formatNumber(requests.length, locale)}</span>
                </div>
                <div className="queue-column__body">
                  {requests.length === 0 ? <span className="queue-column__empty">{t('device.clear')}</span> : requests.map((request) => (
                    <article className={`queue-card${request.status === 'PENDING' ? ' queue-card--pending' : ''}${draggingRequestId === request.id ? ' queue-card--dragging' : ''}`} key={request.id}>
                       <div className="queue-card__topline">
                          <span className="request-icon"><ServiceIcon iconKey={request.service.iconKey} size={17} /></span>
                          {request.room.doNotDisturb && <span className="room-dnd-indicator" role="status"><span aria-hidden="true"><Moon size={13} strokeWidth={1.8} /></span>{t('device.doNotDisturb')}</span>}
                         <span className="queue-card__age">{formatAreaRequestAge(request.createdAt, currentTime, locale)}</span>
                         <button
                           className="queue-card__drag-handle"
                           type="button"
                           draggable
                           aria-label={t('device.dragRequest', { service: resolveServiceDisplayName(request.service, locale) })}
                           onDragStart={(event) => handleNativeDragStart(event, request)}
                           onDragEnd={clearDragState}
                           onPointerDown={(event) => handleTouchDragStart(event, request)}
                           onPointerMove={handleTouchDragMove}
                           onPointerUp={handleTouchDragEnd}
                           onPointerCancel={(event) => handleTouchDragEnd(event, true)}
                         >
                           <GripVertical size={18} aria-hidden="true" />
                         </button>
                       </div>
                      <h3>{resolveServiceDisplayName(request.service, locale)}</h3>
                       <p>{t('admin.roomPrefix', { name: resolveLocalizedDisplayName(request.room, locale) })} · {t('admin.createdAt', { time: formatClock(new Date(request.createdAt), locale, undefined, snapshot.config.clockFormat) })}</p>
                      {NEXT_STATUS[request.status] !== null && (
                         <button className="button button--dark button--small queue-card__action" type="button" onClick={() => void advanceRequest(request)} disabled={busyRequestId === request.id || !canCommitMutation(connectionStatus)}>
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
         <div
           className={`queue-complete-drop-zone${dragOverStatus === 'COMPLETED' ? ' queue-complete-drop-zone--drag-over' : ''}`}
           data-area-drop-status="COMPLETED"
           onDragOver={(event) => handleNativeDragOver(event, 'COMPLETED')}
           onDragLeave={handleNativeDragLeave}
           onDrop={(event) => handleNativeDrop(event, 'COMPLETED')}
         >
           <span>{t('device.dropToComplete')}</span>
         </div>
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
               <button className="button button--primary" type="button" onClick={() => void confirmPendingRequest()} disabled={busyRequestId === pendingModalRequest.id || !canCommitMutation(connectionStatus)} data-autofocus>
                 {busyRequestId === pendingModalRequest.id ? t('request.updating') : requestActionLabel(pendingModalRequest.status, locale)}
               </button>
             </div>
           </div>
         </Modal>
       )}
     </div>
  );
}

function useServerClock(serverTime: string): Date {
  const [currentTime, setCurrentTime] = useState(() => new Date(serverTime));

  useEffect(() => {
    const synchronizedAt = Date.parse(serverTime);
    const clientTimeAtSynchronization = Date.now();
    const updateClock = () => setCurrentTime(new Date(synchronizedAt + (Date.now() - clientTimeAtSynchronization)));
    updateClock();
    const timer = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(timer);
  }, [serverTime]);

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
  onAuthFailure: () => void;
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
                 onAuthFailure();
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
      if (isDeviceAuthFailure(submissionError)) onAuthFailure();
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

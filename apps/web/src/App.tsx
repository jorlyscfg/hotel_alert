import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminLoginResult, AdminMe, AdminSystemSnapshot, BootstrapState, DeviceSyncSnapshot } from '@hotel/shared';
import {
  acknowledgeDeviceTokenRotation,
  api,
  claimDeviceTokenRotation,
  isApiError,
  isDeviceInvalidationError,
  startupErrorMessage
} from './api';
import {
  completeDeviceTokenRotation,
  ADMIN_SESSION_STORAGE_KEY,
  DEVICE_ID_STORAGE_KEY,
  DEVICE_PENDING_TOKEN_ROTATION_STORAGE_KEY,
  DEVICE_SNAPSHOT_STORAGE_KEY,
  DEVICE_SYNC_STATE_STORAGE_KEY,
  DEVICE_TOKEN_STORAGE_KEY,
  parseAdminSession,
  buildLocalDeviceSyncState,
  getOrCreateInstallationId,
  makeMutationKey,
  readLocalDeviceSnapshot,
  resolveStartupRetryDelayMs,
  serializeLocalDeviceSnapshot,
  serializeLocalDeviceSyncState,
  serializeAdminSession,
  type LocalAdminSession,
  shouldRetryStartup
} from './app-model';
import { AdminLoginForm } from './features/auth/AdminLoginForm';
import { AdminScreen } from './features/admin/AdminScreen';
import { BootstrapScreen } from './features/bootstrap/BootstrapScreen';
import { DeviceScreen } from './features/device/DeviceScreen';
import { Modal } from './components/Modal';
import { resolveRouteLocale, SpanishI18nProvider, syncDocumentMetadata, useI18n } from './i18n';
import {
  closeNotificationAudioContext,
  createNotificationAudioContext,
  playNotificationTone,
  replaceNotificationAudioContext
} from './notification-audio';
import { useRealtimeConnection, type ConnectionStatus, type RealtimeRefreshResult } from './realtime';

type ViewState =
  | { kind: 'loading' }
  | { kind: 'bootstrap'; installationId: string; bootstrapState: BootstrapState | null; error: string | null }
  | { kind: 'device'; snapshot: DeviceSyncSnapshot }
  | { kind: 'admin'; snapshot: AdminSystemSnapshot; session: AdminLoginResult; installationId: string | null };

const TOKEN_ROTATION_RETRY_INTERVAL_MS = 5_000;
const MAX_ROOM_NOTIFICATION_EVENT_IDS = 2048;

interface RoomNotificationDeduplication {
  scope: string | null;
  highestEventSequence: number;
  seenEventIds: Set<string>;
}

export function App() {
  const [installationId] = useState(getOrCreateInstallationId);
  const [view, setView] = useState<ViewState>({ kind: 'loading' });
  const { locale: roomLocale } = useI18n();
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [adminLoginOpen, setAdminLoginOpen] = useState(false);
  const [roomRequestNotificationsUnread, setRoomRequestNotificationsUnread] = useState(false);
  const viewRef = useRef(view);
  const startupRetryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const startupRetryAttemptRef = useRef(0);
  const tokenRotationInFlightRef = useRef(false);
  const completedTokenRotationIdRef = useRef<string | null>(null);
  const stoppedTokenRotationIdRef = useRef<string | null>(null);
  const roomAudioContextRef = useRef<AudioContext | null>(null);
  const roomNotificationDeduplicationRef = useRef<RoomNotificationDeduplication>({
    scope: null,
    highestEventSequence: 0,
    seenEventIds: new Set<string>()
  });
  viewRef.current = view;
  const route = view.kind === 'device' ? view.snapshot.config.mode === 'ROOM' ? 'room' : 'area' : view.kind;
  const roomAudioUnlockScope = view.kind === 'device' && view.snapshot.config.mode === 'ROOM'
    ? `${view.snapshot.device.id}:${view.snapshot.config.room?.id ?? ''}`
    : null;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    syncDocumentMetadata(document, resolveRouteLocale(route, roomLocale));
  }, [roomLocale, route]);

  const playRoomArrivalTone = useCallback(() => {
    const context = roomAudioContextRef.current ?? createNotificationAudioContext();
    if (context === null) return;
    roomAudioContextRef.current = context;
    void playNotificationTone(context);
  }, []);

  useEffect(() => {
    if (roomAudioUnlockScope === null || typeof window === 'undefined') return undefined;
    let unlocked = false;
    const unlockRoomAudio = (): void => {
      if (unlocked) return;
      unlocked = true;
      window.removeEventListener('pointerdown', unlockRoomAudio);
      window.removeEventListener('touchstart', unlockRoomAudio);
      window.removeEventListener('keydown', unlockRoomAudio);
      const context = replaceNotificationAudioContext(roomAudioContextRef.current);
      roomAudioContextRef.current = context;
      if (context === null) return;
      void context.resume().catch(() => undefined);
    };

    window.addEventListener('pointerdown', unlockRoomAudio, { once: true, passive: true });
    window.addEventListener('touchstart', unlockRoomAudio, { once: true, passive: true });
    window.addEventListener('keydown', unlockRoomAudio, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlockRoomAudio);
      window.removeEventListener('touchstart', unlockRoomAudio);
      window.removeEventListener('keydown', unlockRoomAudio);
    };
  }, [roomAudioUnlockScope]);

  useEffect(() => () => {
    closeNotificationAudioContext(roomAudioContextRef.current);
  }, []);

  const cancelStartupRetry = useCallback(() => {
    if (startupRetryTimerRef.current !== undefined) clearTimeout(startupRetryTimerRef.current);
    startupRetryTimerRef.current = undefined;
    startupRetryAttemptRef.current = 0;
  }, []);

  const scheduleStartupRetry = useCallback((retry: () => void) => {
    const attempt = startupRetryAttemptRef.current;
    if (!shouldRetryStartup(attempt)) return;
    if (startupRetryTimerRef.current !== undefined) clearTimeout(startupRetryTimerRef.current);
    startupRetryAttemptRef.current = attempt + 1;
    startupRetryTimerRef.current = setTimeout(() => {
      startupRetryTimerRef.current = undefined;
      retry();
    }, resolveStartupRetryDelayMs(attempt));
  }, []);

  const loadBootstrapState = useCallback(async (): Promise<BootstrapState> => {
    const result = await api.get<BootstrapState>(`/devices/bootstrap-state?installationId=${encodeURIComponent(installationId)}`);
    return result.data;
  }, [installationId]);

  const restoreAdminSession = useCallback(async (): Promise<boolean> => {
    const storedSession = readPersistedAdminSession();
    if (storedSession === null) return false;
    try {
      const session = await api.get<AdminMe>('/auth/admin/me');
      const snapshot = await api.get<AdminSystemSnapshot>('/system/snapshot');
      cancelStartupRetry();
      setView({
        kind: 'admin',
        snapshot: snapshot.data,
        session: { admin: session.data, csrfToken: storedSession.result.csrfToken },
        installationId: storedSession.installationId
      });
      return true;
    } catch (error) {
      if (isApiError(error, 401)) clearPersistedAdminSession();
      return false;
    }
  }, [cancelStartupRetry]);

  const initialize = useCallback(async (preserveCurrentView = false) => {
    if (!preserveCurrentView) {
      setView({ kind: 'loading' });
      setConnectionStatus('connecting');
    }
    if (await restoreAdminSession()) return;
    const storedToken = localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY);
    const storedDeviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (storedToken !== null) {
      try {
        const result = await api.get<DeviceSyncSnapshot>('/device/session', { token: storedToken });
        cancelStartupRetry();
        localStorage.setItem(DEVICE_ID_STORAGE_KEY, result.data.device.id);
        persistDeviceSyncState(result.data);
        setView({ kind: 'device', snapshot: result.data });
        return;
      } catch (error) {
        if (!isApiError(error, 401) && !isDeviceInvalidationError(error)) {
          const cachedSnapshot = readLocalDeviceSnapshot(localStorage, storedDeviceId);
          if (cachedSnapshot !== null) {
            setView({ kind: 'device', snapshot: cachedSnapshot });
            setConnectionStatus('stale');
            scheduleStartupRetry(() => { void initialize(true); });
            return;
          }
           setView({ kind: 'bootstrap', installationId, bootstrapState: null, error: startupErrorMessage(error, 'es') });
          setConnectionStatus('offline');
          scheduleStartupRetry(() => { void initialize(true); });
          return;
        }
        localStorage.removeItem(DEVICE_TOKEN_STORAGE_KEY);
      }
    }

    try {
      const bootstrapState = await loadBootstrapState();
      cancelStartupRetry();
      setView({ kind: 'bootstrap', installationId, bootstrapState, error: null });
      setConnectionStatus('offline');
    } catch (error) {
       setView({ kind: 'bootstrap', installationId, bootstrapState: null, error: startupErrorMessage(error, 'es') });
      setConnectionStatus('offline');
      scheduleStartupRetry(() => { void initialize(true); });
    }
  }, [cancelStartupRetry, installationId, loadBootstrapState, restoreAdminSession, scheduleStartupRetry]);

  useEffect(() => {
    void initialize();
    return cancelStartupRetry;
  }, [cancelStartupRetry, initialize]);

  useEffect(() => {
    if (view.kind !== 'device' || view.snapshot.config.mode !== 'ROOM') setRoomRequestNotificationsUnread(false);
  }, [view]);

  const handleAuthFailure = useCallback(() => {
    cancelStartupRetry();
    if (viewRef.current.kind === 'admin') clearPersistedAdminSession();
    else localStorage.removeItem(DEVICE_TOKEN_STORAGE_KEY);
    void initialize();
  }, [cancelStartupRetry, initialize]);

  const refreshDeviceSnapshot = useCallback(async (): Promise<DeviceSyncSnapshot | null> => {
    const token = localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY);
    if (token === null) {
      handleAuthFailure();
      return null;
    }
    try {
      const result = await api.get<DeviceSyncSnapshot>('/device/session', { token });
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, result.data.device.id);
      persistDeviceSyncState(result.data);
      setView((current) => current.kind === 'device' ? { kind: 'device', snapshot: result.data } : current);
      return result.data;
    } catch (error) {
      if (isApiError(error, 401) || isDeviceInvalidationError(error)) handleAuthFailure();
      else setConnectionStatus('stale');
      return null;
    }
  }, [handleAuthFailure]);

  const refreshDevice = useCallback(async (): Promise<void> => {
    await refreshDeviceSnapshot();
  }, [refreshDeviceSnapshot]);

  const pendingTokenRotationId = view.kind === 'device' ? view.snapshot.pendingTokenRotation?.rotationId ?? null : null;

  useEffect(() => {
    if (connectionStatus !== 'online' || pendingTokenRotationId === null) return undefined;
    if (completedTokenRotationIdRef.current === pendingTokenRotationId || stoppedTokenRotationIdRef.current === pendingTokenRotationId) return undefined;
    let disposed = false;

    const attemptRotation = async (): Promise<void> => {
      if (disposed || tokenRotationInFlightRef.current) return;
      let currentToken: string | null;
      try {
        currentToken = localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY);
      } catch {
        return;
      }
      if (currentToken === null) return;
      tokenRotationInFlightRef.current = true;
      try {
        await completeDeviceTokenRotation(
          { rotationId: pendingTokenRotationId },
          currentToken,
          { claim: claimDeviceTokenRotation, acknowledge: acknowledgeDeviceTokenRotation },
          localStorage
        );
        completedTokenRotationIdRef.current = pendingTokenRotationId;
        if (!disposed) await refreshDeviceSnapshot();
      } catch (error) {
        if (isApiError(error) && (error.code === 'TOKEN_ROTATION_EXPIRED' || error.code === 'TOKEN_ROTATION_MISMATCH')) {
          stoppedTokenRotationIdRef.current = pendingTokenRotationId;
          try {
            localStorage.removeItem(DEVICE_PENDING_TOKEN_ROTATION_STORAGE_KEY);
          } catch {
            // Local persistence is best effort; the server remains authoritative.
          }
        }
        if (!disposed && (isApiError(error, 401) || isDeviceInvalidationError(error))) handleAuthFailure();
      } finally {
        tokenRotationInFlightRef.current = false;
      }
    };

    void attemptRotation();
    const retryTimer = setInterval(() => { void attemptRotation(); }, TOKEN_ROTATION_RETRY_INTERVAL_MS);
    return () => {
      disposed = true;
      clearInterval(retryTimer);
    };
  }, [connectionStatus, handleAuthFailure, pendingTokenRotationId, refreshDeviceSnapshot]);

  const refreshAdminSnapshot = useCallback(async (): Promise<boolean> => {
    try {
      const result = await api.get<AdminSystemSnapshot>('/system/snapshot');
      setView((current) => current.kind === 'admin' ? { ...current, snapshot: result.data } : current);
      return true;
    } catch (error) {
      if (isApiError(error, 401)) void initialize();
      else setConnectionStatus('stale');
      return false;
    }
  }, [initialize]);

  const refreshAdmin = useCallback(async (): Promise<void> => {
    await refreshAdminSnapshot();
  }, [refreshAdminSnapshot]);

  const handleRealtimeEvent = useCallback(async (eventName?: string, eventPayload?: unknown): Promise<RealtimeRefreshResult> => {
    if (viewRef.current.kind === 'device') {
      const roomId = viewRef.current.snapshot.config.room?.id ?? null;
      if (viewRef.current.snapshot.config.mode === 'ROOM' && isRoomRequestEventForRoom(eventName, eventPayload, roomId)) {
        setRoomRequestNotificationsUnread(true);
        const deviceId = viewRef.current.snapshot.device.id;
        const notificationScope = `${deviceId}:${roomId}`;
        if (shouldPlayRoomArrivalTone(eventPayload, notificationScope, roomNotificationDeduplicationRef.current)) playRoomArrivalTone();
      }
      const snapshot = await refreshDeviceSnapshot();
      return snapshot === null ? { synchronized: false } : {
        synchronized: true,
        lastSeenEventSequence: snapshot.currentEventSequence,
        deviceConfigVersion: snapshot.deviceConfigVersion
      };
    }
    if (viewRef.current.kind === 'admin') return { synchronized: await refreshAdminSnapshot() };
    return { synchronized: false };
  }, [playRoomArrivalTone, refreshAdminSnapshot, refreshDeviceSnapshot]);

  const realtimeView = view.kind === 'device'
    ? { enabled: true, hasSnapshot: true, deviceId: view.snapshot.device.id, deviceToken: localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY) ?? undefined, deviceConfigVersion: view.snapshot.deviceConfigVersion, lastSeenEventSequence: view.snapshot.currentEventSequence, heartbeatIntervalMs: view.snapshot.config.heartbeatIntervalMs }
    : { enabled: view.kind === 'admin', hasSnapshot: view.kind === 'admin' };

  const clearRoomRequestNotifications = useCallback(() => {
    setRoomRequestNotificationsUnread(false);
  }, []);

  useRealtimeConnection({
    ...realtimeView,
    onEvent: handleRealtimeEvent,
    onAuthFailure: handleAuthFailure,
    onStatus: setConnectionStatus
  });

  async function completeAdminLogin(result: AdminLoginResult) {
    const snapshot = await api.get<AdminSystemSnapshot>('/system/snapshot');
    const source = viewRef.current.kind;
    persistAdminSession({ result, installationId: source === 'bootstrap' ? installationId : null });
    setAdminLoginOpen(false);
    setView({ kind: 'admin', snapshot: snapshot.data, session: result, installationId: source === 'bootstrap' ? installationId : null });
  }

  async function retryBootstrap() {
    cancelStartupRetry();
    try {
      const bootstrapState = await loadBootstrapState();
      setView({ kind: 'bootstrap', installationId, bootstrapState, error: null });
    } catch (error) {
       setView((current) => current.kind === 'bootstrap' ? { ...current, error: startupErrorMessage(error, 'es') } : current);
      scheduleStartupRetry(() => { void initialize(true); });
    }
  }

  async function logoutAdmin() {
    if (view.kind !== 'admin') return;
    try {
      await api.post('/auth/admin/logout', undefined, { headers: { 'x-csrf-token': view.session.csrfToken, 'Idempotency-Key': makeMutationKey('logout') } });
    } finally {
      clearPersistedAdminSession();
      await initialize();
    }
  }

  async function useDeviceToken(token: string) {
    if (view.kind !== 'admin') return;
    await api.post('/auth/admin/logout', undefined, { headers: { 'x-csrf-token': view.session.csrfToken, 'Idempotency-Key': makeMutationKey('logout') } });
    clearPersistedAdminSession();
    localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, token);
    await initialize();
  }

  if (view.kind === 'loading') return <SpanishI18nProvider><LoadingScreen /></SpanishI18nProvider>;
  if (view.kind === 'bootstrap') return <SpanishI18nProvider><BootstrapScreen installationId={installationId} bootstrapState={view.bootstrapState} error={view.error} onRetry={() => void retryBootstrap()} onAdminLogin={completeAdminLogin} /></SpanishI18nProvider>;
  if (view.kind === 'device') {
    const deviceScreen = <DeviceScreen snapshot={view.snapshot} deviceToken={localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY) ?? ''} connectionStatus={connectionStatus} onRefresh={refreshDevice} onOpenAdmin={() => setAdminLoginOpen(true)} onAuthFailure={handleAuthFailure} roomRequestNotificationsUnread={roomRequestNotificationsUnread} onClearRoomRequestNotifications={clearRoomRequestNotifications} />;
    const adminLoginDialog = adminLoginOpen && <AdminLoginDialog onSuccess={completeAdminLogin} onCancel={() => setAdminLoginOpen(false)} />;
    if (view.snapshot.config.mode === 'ROOM') return <>{deviceScreen}<SpanishI18nProvider>{adminLoginDialog}</SpanishI18nProvider></>;
    return <SpanishI18nProvider>{deviceScreen}{adminLoginDialog}</SpanishI18nProvider>;
  }
  return <SpanishI18nProvider><AdminScreen snapshot={view.snapshot} csrfToken={view.session.csrfToken} installationId={view.installationId} connectionStatus={connectionStatus} onRefresh={refreshAdmin} onLogout={logoutAdmin} onUseDeviceToken={useDeviceToken} /></SpanishI18nProvider>;
}

function getAdminSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function readPersistedAdminSession(): LocalAdminSession | null {
  const storage = getAdminSessionStorage();
  if (storage === null) return null;
  const raw = storage.getItem(ADMIN_SESSION_STORAGE_KEY);
  return raw === null ? null : parseAdminSession(raw);
}

function persistAdminSession(session: LocalAdminSession): void {
  const storage = getAdminSessionStorage();
  if (storage === null) return;
  try {
    storage.setItem(ADMIN_SESSION_STORAGE_KEY, serializeAdminSession(session));
  } catch {
    // Browser-session persistence is best effort; the HttpOnly cookie remains authoritative.
  }
}

function clearPersistedAdminSession(): void {
  const storage = getAdminSessionStorage();
  if (storage === null) return;
  try {
    storage.removeItem(ADMIN_SESSION_STORAGE_KEY);
  } catch {
    // Browser-session persistence is best effort.
  }
}

function isRoomRequestEventForRoom(eventName: string | undefined, eventPayload: unknown, roomId: string | null): boolean {
  if (roomId === null || (eventName !== 'request.created' && eventName !== 'request.updated')) return false;
  if (!isRecord(eventPayload) || !isRecord(eventPayload['payload']) || !isRecord(eventPayload['payload']['request'])) return false;
  return eventPayload['payload']['request']['roomId'] === roomId;
}

function shouldPlayRoomArrivalTone(eventPayload: unknown, scope: string, state: RoomNotificationDeduplication): boolean {
  if (!isRecord(eventPayload)) return false;
  const eventId = typeof eventPayload['eventId'] === 'string' && eventPayload['eventId'].length > 0
    ? eventPayload['eventId']
    : undefined;
  const eventSequence = typeof eventPayload['eventSequence'] === 'number'
    && Number.isInteger(eventPayload['eventSequence'])
    && eventPayload['eventSequence'] >= 0
    ? eventPayload['eventSequence']
    : undefined;
  if (eventId === undefined && eventSequence === undefined) return false;

  if (state.scope !== scope) {
    state.scope = scope;
    state.highestEventSequence = 0;
    state.seenEventIds.clear();
  }
  if (eventId !== undefined && state.seenEventIds.has(eventId)) return false;
  if (eventSequence !== undefined && eventSequence <= state.highestEventSequence) return false;

  if (eventId !== undefined) {
    state.seenEventIds.add(eventId);
    while (state.seenEventIds.size > MAX_ROOM_NOTIFICATION_EVENT_IDS) {
      const oldestEventId = state.seenEventIds.values().next().value as string | undefined;
      if (oldestEventId === undefined) break;
      state.seenEventIds.delete(oldestEventId);
    }
  }
  if (eventSequence !== undefined) state.highestEventSequence = eventSequence;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function LoadingScreen() {
  const { t } = useI18n();
  const serviceSkeletons = ['service-1', 'service-2', 'service-3', 'service-4'];
  const requestSkeletons = ['request-1', 'request-2', 'request-3'];

  return (
    <main className="app-frame loading-screen" aria-busy="true" aria-label={t('loading.ariaLabel')}>
      <div className="loading-shell" aria-hidden="true">
        <header className="loading-shell__topbar">
          <span className="loading-skeleton loading-skeleton--brand" />
          <span className="loading-skeleton loading-skeleton--context" />
        </header>
        <div className="loading-shell__content">
          <section className="loading-shell__hero">
            <span className="loading-skeleton loading-skeleton--eyebrow" />
            <span className="loading-skeleton loading-skeleton--hero-title" />
            <span className="loading-skeleton loading-skeleton--hero-copy" />
          </section>
          <section className="loading-shell__services">
            {serviceSkeletons.map((skeleton) => <span className="loading-skeleton loading-skeleton--service" key={skeleton} />)}
          </section>
          <section className="loading-shell__requests">
            <span className="loading-skeleton loading-skeleton--section-title" />
            {requestSkeletons.map((skeleton) => <span className="loading-skeleton loading-skeleton--request" key={skeleton} />)}
          </section>
        </div>
      </div>
      <p className="loading-screen__status" role="status">{t('loading.status')}</p>
    </main>
  );
}

function persistDeviceSyncState(snapshot: DeviceSyncSnapshot): void {
  try {
    const state = buildLocalDeviceSyncState(snapshot.device.id, {
      lastSeenEventSequence: snapshot.currentEventSequence,
      configurationRevision: snapshot.configurationRevision,
      deviceConfigVersion: snapshot.deviceConfigVersion
    });
    localStorage.setItem(DEVICE_SYNC_STATE_STORAGE_KEY, serializeLocalDeviceSyncState(state));
  } catch {
    // Local persistence is best effort; the server snapshot remains authoritative.
  }
  try {
    localStorage.setItem(DEVICE_SNAPSHOT_STORAGE_KEY, serializeLocalDeviceSnapshot(snapshot));
  } catch {
    // Local persistence is best effort; the server snapshot remains authoritative.
  }
}

export function AdminLoginDialog({ onSuccess, onCancel }: { onSuccess: (result: AdminLoginResult) => Promise<void>; onCancel: () => void }) {
  const { t } = useI18n();
  return (
    <Modal open title={t('bootstrap.adminSignIn')} onClose={onCancel} closeLabel={t('common.closeDialog')} className="room-modal room-admin-login-modal">
      <p className="eyebrow eyebrow--muted">{t('modal.restrictedAccess')}</p>
      <p className="card-copy">{t('modal.adminCopy')}</p>
      <AdminLoginForm onSuccess={onSuccess} onCancel={onCancel} compact />
    </Modal>
  );
}

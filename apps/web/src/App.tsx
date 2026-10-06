import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminLoginResult, AdminMe, AdminSystemSnapshot, BootstrapState, DeviceAssignmentMode, DeviceBootstrapResult, DeviceSyncSnapshot } from '@hotel/shared';
import {
  acknowledgeDeviceTokenRotation,
  api,
  errorMessage,
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
  clearPersistedDeviceState,
  getOrCreateInstallationId,
  makeMutationKey,
  readLocalDeviceSnapshot,
  readPendingDeviceTokenRotation,
  resolveStartupRetryDelayMs,
  rotateInstallationId,
  serializeLocalDeviceSnapshot,
  serializeLocalDeviceSyncState,
  serializeAdminSession,
  type LocalAdminSession,
  shouldRetryStartup
} from './app-model';
import { AdminLoginForm, type AdminLoginRole } from './features/auth/AdminLoginForm';
import { AdminPasswordChangeScreen, AdminScreen } from './features/admin/AdminScreen';
import { BootstrapScreen } from './features/bootstrap/BootstrapScreen';
import { buildDeviceBootstrapInput, DeviceRoleAssignmentScreen, type DeviceRoleAssignmentTarget } from './features/bootstrap/DeviceRoleAssignmentScreen';
import { DeviceScreen } from './features/device/DeviceScreen';
import { Modal } from './components/Modal';
import { createTranslator, resolveRouteLocale, SpanishI18nProvider, syncDocumentMetadata, useI18n } from './i18n';
import {
  closeNotificationAudioContext,
  createNotificationAudioContext,
  playNotificationTone,
  replaceNotificationAudioContext
} from './notification-audio';
import { shouldWebViewSendRestHeartbeat, useRealtimeConnection, type ConnectionStatus, type RealtimeRefreshResult } from './realtime';
import {
  clearNativeRoomSession,
  configureNativeRoomSession,
  getNativeRoomPresenceBridge,
  readNativeRoomPresenceState,
  stageNativeRoomToken,
  supportsNativeRoomPresence
} from './native-room-bridge';
import { getNativeWebViewBridge, supportsNativeDeviceCommands, type NativeWebViewBridge } from './native-bridge';
import {
  getNativeStationBridge,
  pairNativeStation,
  readNativeStationSnapshot,
  resolveNativeStationReceiverStatus,
  type NativeStationBridge
} from './native-station-bridge';

type ViewState =
  | { kind: 'loading' }
  | { kind: 'bootstrap'; installationId: string; bootstrapState: BootstrapState | null; error: string | null }
  | { kind: 'assignment'; role: Exclude<AdminLoginRole, 'ADMIN'>; snapshot: AdminSystemSnapshot; session: AdminLoginResult; installationId: string; error: string | null; busy: boolean }
  | { kind: 'device'; snapshot: DeviceSyncSnapshot }
  | { kind: 'password-change'; session: AdminLoginResult; installationId: string | null }
  | { kind: 'admin'; snapshot: AdminSystemSnapshot; session: AdminLoginResult; installationId: string | null };

const TOKEN_ROTATION_RETRY_INTERVAL_MS = 5_000;
const MAX_ROOM_NOTIFICATION_EVENT_IDS = 2048;
const spanishT = createTranslator('es');

function isRetiredInstallationConflict(error: unknown): boolean {
  if (!isApiError(error, 409) || typeof error !== 'object' || error === null) return false;
  const details = (error as { details?: unknown }).details;
  return typeof details === 'object'
    && details !== null
    && (details as { reason?: unknown }).reason === 'RETIRED_INSTALLATION';
}

async function hydrateAssignmentTargets(snapshot: AdminSystemSnapshot, role: Exclude<AdminLoginRole, 'ADMIN'>): Promise<AdminSystemSnapshot> {
  if (role === 'AREA' && Array.isArray(snapshot.areas) && snapshot.areas.some(isUsableAreaTarget)) return snapshot;
  if (role === 'ROOM' && Array.isArray(snapshot.rooms) && snapshot.rooms.length > 0) return snapshot;

  if (role === 'AREA') {
    const result = await api.get<AdminSystemSnapshot['areas']>('/areas', { cache: 'no-store' });
    return Array.isArray(result.data) ? { ...snapshot, areas: result.data } : snapshot;
  }
  const result = await api.get<AdminSystemSnapshot['rooms']>('/rooms', { cache: 'no-store' });
  return Array.isArray(result.data) ? { ...snapshot, rooms: result.data } : snapshot;
}

function isUsableAreaTarget(value: unknown): value is AdminSystemSnapshot['areas'][number] {
  if (typeof value !== 'object' || value === null) return false;
  const area = value as Record<string, unknown>;
  return area['active'] === true
    && typeof area['id'] === 'string' && area['id'].trim().length > 0
    && typeof area['code'] === 'string' && area['code'].trim().length > 0
    && typeof area['displayName'] === 'string' && area['displayName'].trim().length > 0;
}

function normalizeAssignmentSnapshot(snapshot: AdminSystemSnapshot): AdminSystemSnapshot {
  return {
    ...snapshot,
    areas: Array.isArray(snapshot.areas) ? snapshot.areas : [],
    rooms: Array.isArray(snapshot.rooms) ? snapshot.rooms : []
  };
}

interface RoomNotificationDeduplication {
  scope: string | null;
  highestEventSequence: number;
  seenEventIds: Set<string>;
}

interface DeviceTokenPairing {
  deviceId: string;
  deviceToken: string;
  assignmentMode: DeviceAssignmentMode;
}

async function waitForNativeSnapshot(bridge: NativeStationBridge): Promise<DeviceSyncSnapshot | null> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const snapshot = readNativeStationSnapshot(bridge);
    if (snapshot !== null) return snapshot;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

export function App() {
  const [installationId, setInstallationId] = useState(getOrCreateInstallationId);
  const [view, setView] = useState<ViewState>({ kind: 'loading' });
  const [passwordChangeError, setPasswordChangeError] = useState<string | null>(null);
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
  const route = view.kind === 'device' ? view.snapshot.config.mode === 'ROOM' ? 'room' : 'area' : view.kind === 'assignment' || view.kind === 'password-change' ? 'bootstrap' : view.kind;
  const nativeStationBridgeAvailable = getNativeStationBridge() !== null;
  const nativeRoomPresenceAvailable = supportsNativeRoomPresence(getNativeRoomPresenceBridge());
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
      if (session.data.mustChangePassword === true) {
        cancelStartupRetry();
        const pendingSession = { admin: session.data, csrfToken: storedSession.result.csrfToken };
        setPasswordChangeError(null);
        setView({ kind: 'password-change', session: pendingSession, installationId: storedSession.installationId ?? null });
        return true;
      }
      const snapshot = await api.get<AdminSystemSnapshot>('/system/snapshot', { cache: 'no-store' });
      cancelStartupRetry();
      if (storedSession.pendingStationRole !== undefined) {
        let assignmentSnapshot = snapshot.data;
        let assignmentError: string | null = null;
        try {
          assignmentSnapshot = await hydrateAssignmentTargets(snapshot.data, storedSession.pendingStationRole);
        } catch (error) {
          assignmentError = errorMessage(error, spanishT('errors.serviceUnavailable'), 'es');
        }
        assignmentSnapshot = normalizeAssignmentSnapshot(assignmentSnapshot);
        setView({
          kind: 'assignment',
          role: storedSession.pendingStationRole,
          snapshot: assignmentSnapshot,
          session: { admin: session.data, csrfToken: storedSession.result.csrfToken },
          installationId: storedSession.installationId ?? installationId,
          error: assignmentError,
          busy: false
        });
        return true;
      }
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
  }, [cancelStartupRetry, installationId]);

  const restoreStoredRoomSession = useCallback(async (): Promise<boolean> => {
    const storedToken = localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY);
    if (storedToken === null) return false;
    const storedDeviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    const restoreRoomSnapshot = async (snapshot: DeviceSyncSnapshot, token: string, recoveredRotation = false): Promise<boolean> => {
      if (snapshot.config.mode !== 'ROOM') {
        try { clearNativeRoomSession(getNativeRoomPresenceBridge()); } catch { /* The server remains authoritative. */ }
        clearPersistedDeviceState(localStorage);
        const nextInstallationId = rotateInstallationId();
        setInstallationId(nextInstallationId);
        setView({ kind: 'bootstrap', installationId: nextInstallationId, bootstrapState: null, error: null });
        setConnectionStatus('offline');
        return true;
      }
      cancelStartupRetry();
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, snapshot.device.id);
      if (token !== storedToken) localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, token);
      if (recoveredRotation) localStorage.removeItem(DEVICE_PENDING_TOKEN_ROTATION_STORAGE_KEY);
      persistDeviceSyncState(snapshot);
      const bridge = getNativeRoomPresenceBridge();
      if (supportsNativeRoomPresence(bridge)) {
        await configureNativeRoomSession(bridge, { deviceId: snapshot.device.id, deviceToken: token });
      }
      setView({ kind: 'device', snapshot });
      return true;
    };
    try {
      const result = await api.get<DeviceSyncSnapshot>('/device/session', { token: storedToken });
      return restoreRoomSnapshot(result.data, storedToken);
    } catch (error) {
      if (isDeviceInvalidationError(error)) {
        const pendingRotation = readPendingDeviceTokenRotation(localStorage);
        if (pendingRotation !== null) {
          try {
            const replacement = await api.get<DeviceSyncSnapshot>('/device/session', { token: pendingRotation.deviceToken });
            if (storedDeviceId !== null && replacement.data.device.id === storedDeviceId) {
              return restoreRoomSnapshot(replacement.data, pendingRotation.deviceToken, true);
            }
          } catch (replacementError) {
            if (!isDeviceInvalidationError(replacementError)) return false;
          }
        }
        try { clearNativeRoomSession(getNativeRoomPresenceBridge()); } catch { /* The server remains authoritative. */ }
        clearPersistedAdminSession();
        clearPersistedDeviceState(localStorage);
        const nextInstallationId = rotateInstallationId();
        setInstallationId(nextInstallationId);
        setView({ kind: 'bootstrap', installationId: nextInstallationId, bootstrapState: null, error: null });
        setConnectionStatus('offline');
        return true;
      }
      if (isApiError(error, 401)) {
        localStorage.removeItem(DEVICE_TOKEN_STORAGE_KEY);
        if (storedDeviceId !== null) localStorage.removeItem(DEVICE_ID_STORAGE_KEY);
      }
      return false;
    }
  }, [cancelStartupRetry]);

  const initialize = useCallback(async (preserveCurrentView = false) => {
    if (!preserveCurrentView) {
      setView({ kind: 'loading' });
      setConnectionStatus('connecting');
    }
    if (await restoreAdminSession()) return;
    const nativeRoomBridge = getNativeRoomPresenceBridge();
    const nativeRoomPresenceAvailable = supportsNativeRoomPresence(nativeRoomBridge);
    if (nativeRoomPresenceAvailable && readNativeRoomPresenceState(nativeRoomBridge) === 'INVALIDATED') {
      clearPersistedAdminSession();
      clearPersistedDeviceState(localStorage);
      try { clearNativeRoomSession(nativeRoomBridge); } catch { /* Credentials are already revoked server-side. */ }
      const nextInstallationId = rotateInstallationId();
      setInstallationId(nextInstallationId);
      setView({ kind: 'bootstrap', installationId: nextInstallationId, bootstrapState: null, error: null });
      setConnectionStatus('offline');
      cancelStartupRetry();
      return;
    }
    const nativeStationBridge = getNativeStationBridge();
    if (nativeRoomPresenceAvailable || nativeStationBridge !== null) {
      if (await restoreStoredRoomSession()) return;
      const storedRoomToken = localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY);
      const storedRoomDeviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
      const cachedRoomSnapshot = storedRoomToken === null
        ? null
        : readLocalDeviceSnapshot(localStorage, storedRoomDeviceId);
      if (cachedRoomSnapshot?.config.mode === 'ROOM') {
        setView({ kind: 'device', snapshot: cachedRoomSnapshot });
        setConnectionStatus('stale');
        scheduleStartupRetry(() => { void initialize(true); });
        return;
      }
    }
    if (nativeStationBridge !== null) {
      const nativeSnapshot = readNativeStationSnapshot(nativeStationBridge);
      if (nativeSnapshot !== null) {
        localStorage.removeItem(DEVICE_TOKEN_STORAGE_KEY);
        localStorage.removeItem(DEVICE_ID_STORAGE_KEY);
        cancelStartupRetry();
        setView({ kind: 'device', snapshot: nativeSnapshot });
        setConnectionStatus(resolveNativeStationReceiverStatus(nativeStationBridge.getReceiverState(), true));
        return;
      }
      setView({ kind: 'bootstrap', installationId, bootstrapState: null, error: null });
      setConnectionStatus('offline');
      scheduleStartupRetry(() => { void initialize(true); });
      return;
    }
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
        if (isDeviceInvalidationError(error)) {
          clearPersistedAdminSession();
          clearPersistedDeviceState(localStorage);
          const nextInstallationId = rotateInstallationId();
          setInstallationId(nextInstallationId);
          setView({ kind: 'bootstrap', installationId: nextInstallationId, bootstrapState: null, error: null });
          setConnectionStatus('offline');
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
  }, [cancelStartupRetry, installationId, loadBootstrapState, restoreAdminSession, restoreStoredRoomSession, scheduleStartupRetry]);

  async function submitAdminPasswordChange(currentPassword: string, newPassword: string): Promise<void> {
    const activeView = viewRef.current;
    const session = activeView.kind === 'admin' || activeView.kind === 'password-change' ? activeView.session : null;
    if (session === null) return;

    setPasswordChangeError(null);
    try {
      await api.post('/auth/admin/change-password', { currentPassword, newPassword }, {
        headers: {
          'x-csrf-token': session.csrfToken,
          'Idempotency-Key': makeMutationKey('admin-password-change')
        }
      });
      clearPersistedAdminSession();
      cancelStartupRetry();
      setPasswordChangeError(null);
      await initialize();
    } catch (error) {
      const passwordChangeTranslator = createTranslator(roomLocale);
      setPasswordChangeError(errorMessage(error, passwordChangeTranslator('errors.internal'), roomLocale));
    }
  }

  const handleAuthFailure = useCallback((error?: unknown, forceInvalidate = false) => {
    cancelStartupRetry();
    const invalidated = forceInvalidate
      || isDeviceInvalidationError(error)
      || error === 'DEVICE_INACTIVE'
      || error === 'DEVICE_TOKEN_REVOKED';
    if (invalidated) {
      const currentView = viewRef.current;
      if (currentView.kind === 'device' && currentView.snapshot.config.mode === 'ROOM') {
        try { clearNativeRoomSession(getNativeRoomPresenceBridge()); } catch { /* The server remains authoritative. */ }
      }
      clearPersistedAdminSession();
      clearPersistedDeviceState(localStorage);
      const nextInstallationId = rotateInstallationId();
      setInstallationId(nextInstallationId);
      setView({ kind: 'bootstrap', installationId: nextInstallationId, bootstrapState: null, error: null });
      setConnectionStatus('offline');
      void initialize(true);
      return;
    } else if (viewRef.current.kind === 'admin') {
      clearPersistedAdminSession();
    } else {
      localStorage.removeItem(DEVICE_TOKEN_STORAGE_KEY);
    }
    void initialize();
  }, [cancelStartupRetry, initialize]);

  useEffect(() => {
    void initialize();
    return cancelStartupRetry;
  }, [cancelStartupRetry, initialize]);

  useEffect(() => {
    if (view.kind !== 'device' || view.snapshot.config.mode !== 'ROOM') return undefined;
    const bridge = getNativeRoomPresenceBridge();
    if (!supportsNativeRoomPresence(bridge)) return undefined;
    let invalidationHandled = false;
    const checkRoomAssignment = (): void => {
      if (invalidationHandled || readNativeRoomPresenceState(bridge) !== 'INVALIDATED') return;
      invalidationHandled = true;
      handleAuthFailure('DEVICE_INACTIVE', true);
    };
    checkRoomAssignment();
    const timer = window.setInterval(checkRoomAssignment, 1_000);
    return () => window.clearInterval(timer);
  }, [handleAuthFailure, view.kind, view.kind === 'device' ? view.snapshot.config.mode : undefined]);

  useEffect(() => {
    if (view.kind !== 'device' || view.snapshot.config.mode !== 'ROOM') setRoomRequestNotificationsUnread(false);
  }, [view]);

  useEffect(() => {
    if (!nativeStationBridgeAvailable || view.kind === 'loading' || view.kind === 'admin' || view.kind === 'assignment' || (view.kind === 'device' && view.snapshot.config.mode === 'ROOM')) return undefined;
    const refreshNativeSnapshot = (): void => {
      if (viewRef.current.kind === 'assignment') return;
      const nativeStationBridge = getNativeStationBridge();
      if (nativeStationBridge === null) {
        setConnectionStatus('offline');
        return;
      }
      const nativeSnapshot = readNativeStationSnapshot(nativeStationBridge);
      if (nativeSnapshot === null) {
        if (viewRef.current.kind === 'device') {
          handleAuthFailure(undefined, true);
          return;
        }
        setView((current) => current.kind === 'admin' ? current : { kind: 'bootstrap', installationId, bootstrapState: null, error: null });
        setConnectionStatus('offline');
        scheduleStartupRetry(() => { void initialize(true); });
        return;
      }
      cancelStartupRetry();
      setView((current) => current.kind === 'admin' ? current : { kind: 'device', snapshot: nativeSnapshot });
      setConnectionStatus(resolveNativeStationReceiverStatus(nativeStationBridge.getReceiverState(), true));
    };
    const timer = window.setInterval(refreshNativeSnapshot, 1_000);
    return () => window.clearInterval(timer);
  }, [cancelStartupRetry, handleAuthFailure, initialize, installationId, nativeStationBridgeAvailable, scheduleStartupRetry, view.kind, view.kind === 'device' ? view.snapshot.config.mode : undefined]);

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
      if (isApiError(error, 401) || isDeviceInvalidationError(error)) handleAuthFailure(error);
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
        const currentView = viewRef.current;
        const roomBridge = currentView.kind === 'device' && currentView.snapshot.config.mode === 'ROOM'
          ? getNativeRoomPresenceBridge()
          : null;
        const nativeRoomBridge = supportsNativeRoomPresence(roomBridge) ? roomBridge : null;
        await completeDeviceTokenRotation(
          { rotationId: pendingTokenRotationId },
          currentToken,
          { claim: claimDeviceTokenRotation, acknowledge: acknowledgeDeviceTokenRotation },
          localStorage,
          nativeRoomBridge !== null
            ? async (replacementToken) => stageNativeRoomToken(nativeRoomBridge, replacementToken)
            : undefined
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
      const result = await api.get<AdminSystemSnapshot>('/system/snapshot', { cache: 'no-store' });
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

  const isAdminView = view.kind === 'admin';
  const isRoomDeviceView = view.kind === 'device' && view.snapshot.config.mode === 'ROOM';
  const realtimeView = isAdminView
    ? { enabled: true, hasSnapshot: true }
    : nativeStationBridgeAvailable && !isRoomDeviceView
    ? { enabled: false, hasSnapshot: view.kind === 'device' }
    : view.kind === 'device'
    ? { enabled: true, hasSnapshot: true, deviceId: view.snapshot.device.id, deviceToken: localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY) ?? undefined, deviceConfigVersion: view.snapshot.deviceConfigVersion, lastSeenEventSequence: view.snapshot.currentEventSequence, heartbeatIntervalMs: view.snapshot.config.heartbeatIntervalMs, heartbeatEnabled: shouldWebViewSendRestHeartbeat({ isRoomDevice: isRoomDeviceView, nativeRoomPresenceSupported: nativeRoomPresenceAvailable }) }
    : { enabled: false, hasSnapshot: false };

  const clearRoomRequestNotifications = useCallback(() => {
    setRoomRequestNotificationsUnread(false);
  }, []);

  useRealtimeConnection({
    ...realtimeView,
    onEvent: handleRealtimeEvent,
    onAuthFailure: handleAuthFailure,
    onStatus: isAdminView || !nativeStationBridgeAvailable || isRoomDeviceView ? setConnectionStatus : () => undefined
  });

  async function completeAdminLogin(result: AdminLoginResult, role: AdminLoginRole = 'ADMIN') {
    cancelStartupRetry();
    const source = viewRef.current.kind;
    const sessionInstallationId = source === 'bootstrap' ? installationId : null;
    if (result.admin.mustChangePassword === true) {
      persistAdminSession({ result, installationId: sessionInstallationId });
      setPasswordChangeError(null);
      setAdminLoginOpen(false);
      setView({ kind: 'password-change', session: result, installationId: sessionInstallationId });
      return;
    }
    const snapshot = await api.get<AdminSystemSnapshot>('/system/snapshot', { cache: 'no-store' });
    let assignmentSnapshot = snapshot.data;
    let assignmentError: string | null = null;
    if (source === 'bootstrap' && role !== 'ADMIN') {
      try {
        assignmentSnapshot = await hydrateAssignmentTargets(snapshot.data, role);
      } catch (error) {
        assignmentError = errorMessage(error, spanishT('errors.serviceUnavailable'), 'es');
      }
      assignmentSnapshot = normalizeAssignmentSnapshot(assignmentSnapshot);
    }
    persistAdminSession({
      result,
      installationId: sessionInstallationId,
      ...(source === 'bootstrap' && role !== 'ADMIN' ? { pendingStationRole: role } : {})
    });
    setAdminLoginOpen(false);
    setView(source === 'bootstrap' && role !== 'ADMIN'
      ? { kind: 'assignment', role, snapshot: assignmentSnapshot, session: result, installationId, error: assignmentError, busy: false }
      : { kind: 'admin', snapshot: snapshot.data, session: result, installationId: sessionInstallationId });
  }

  async function retryBootstrap() {
    cancelStartupRetry();
    if (getNativeStationBridge() !== null) {
      await initialize(true);
      return;
    }
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

  async function useDeviceToken(pairing: DeviceTokenPairing) {
    if (view.kind !== 'admin' && view.kind !== 'assignment') return;
    const nativeStationBridge = getNativeStationBridge();
    if (pairing.assignmentMode === 'ROOM') {
      localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, pairing.deviceToken);
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, pairing.deviceId);
      const roomBridge = getNativeRoomPresenceBridge();
      if (supportsNativeRoomPresence(roomBridge)) {
        await configureNativeRoomSession(roomBridge, { deviceId: pairing.deviceId, deviceToken: pairing.deviceToken });
      }
      try {
        await api.post('/auth/admin/logout', undefined, { headers: { 'x-csrf-token': view.session.csrfToken, 'Idempotency-Key': makeMutationKey('logout') } });
      } catch {
        // A completed room assignment is owned by the device session; logout is best effort.
      }
      clearPersistedAdminSession();
      await initialize();
      return;
    }
    if (nativeStationBridge !== null) {
      await pairNativeStation(nativeStationBridge, { deviceId: pairing.deviceId, deviceToken: pairing.deviceToken });
      const nativeSnapshot = await waitForNativeSnapshot(nativeStationBridge);
      if (nativeSnapshot === null) throw new Error('NATIVE_SNAPSHOT_UNAVAILABLE');
      try {
        await api.post('/auth/admin/logout', undefined, { headers: { 'x-csrf-token': view.session.csrfToken, 'Idempotency-Key': makeMutationKey('logout') } });
      } catch {
        // Native pairing already owns the device session; browser logout is best effort.
      }
      clearPersistedAdminSession();
      localStorage.removeItem(DEVICE_TOKEN_STORAGE_KEY);
      localStorage.removeItem(DEVICE_ID_STORAGE_KEY);
      cancelStartupRetry();
      setConnectionStatus(resolveNativeStationReceiverStatus(nativeStationBridge.getReceiverState(), true));
      setView({ kind: 'device', snapshot: nativeSnapshot });
      return;
    }
    await api.post('/auth/admin/logout', undefined, { headers: { 'x-csrf-token': view.session.csrfToken, 'Idempotency-Key': makeMutationKey('logout') } });
    clearPersistedAdminSession();
    localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, pairing.deviceToken);
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, pairing.deviceId);
    await initialize();
  }

  async function provisionSelectedTarget(target: DeviceRoleAssignmentTarget): Promise<void> {
    if (view.kind !== 'assignment') return;
    const assignment = view;
    setView((current) => current.kind === 'assignment' ? { ...current, busy: true, error: null } : current);
    let currentInstallationId = assignment.installationId;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await api.post<DeviceBootstrapResult>('/devices/bootstrap', buildDeviceBootstrapInput(currentInstallationId, assignment.role, target), {
          headers: {
            'x-csrf-token': assignment.session.csrfToken,
            // Keep the onboarding mutation key stable for this installation/target.
            // If native pairing fails after the server creates the device, the next
            // tap must replay the same idempotent bootstrap result instead of
            // attempting to create a second device for the same installation.
            'Idempotency-Key': `station-onboarding-${assignment.role}-${currentInstallationId}-${target.id}`
          }
        });
        await useDeviceToken({ deviceId: result.data.device.id, deviceToken: result.data.deviceToken, assignmentMode: result.data.device.assignmentMode });
        return;
      } catch (provisioningError) {
        if (attempt === 0 && isRetiredInstallationConflict(provisioningError)) {
          currentInstallationId = rotateInstallationId();
          setInstallationId(currentInstallationId);
          persistAdminSession({ result: assignment.session, installationId: currentInstallationId, pendingStationRole: assignment.role });
          setView((current) => current.kind === 'assignment'
            ? { ...current, installationId: currentInstallationId, busy: true, error: null }
            : current);
          continue;
        }
        setView((current) => current.kind === 'assignment'
          ? { ...current, busy: false, error: errorMessage(provisioningError, spanishT('errors.deviceProvisionFailed'), 'es') }
          : current);
        return;
      }
    }
  }

  if (view.kind === 'loading') return <SpanishI18nProvider><LoadingScreen /></SpanishI18nProvider>;
  if (view.kind === 'bootstrap') return <SpanishI18nProvider><BootstrapScreen installationId={installationId} bootstrapState={view.bootstrapState} error={view.error} onRetry={() => void retryBootstrap()} onAdminLogin={completeAdminLogin} /></SpanishI18nProvider>;
  if (view.kind === 'assignment') return <SpanishI18nProvider><DeviceRoleAssignmentScreen role={view.role} snapshot={view.snapshot} busy={view.busy} error={view.error} onSelect={(target) => void provisionSelectedTarget(target)} onAdmin={() => { persistAdminSession({ result: view.session, installationId: view.installationId }); setView({ kind: 'admin', snapshot: view.snapshot, session: view.session, installationId: view.installationId }); }} /></SpanishI18nProvider>;
  if (view.kind === 'password-change') return <SpanishI18nProvider><AdminPasswordChangeScreen error={passwordChangeError} onChangePassword={submitAdminPasswordChange} /></SpanishI18nProvider>;
  if (view.kind === 'device') {
    const isAreaDevice = view.snapshot.config.mode === 'AREA';
    const nativeBridge: NativeWebViewBridge | null = isAreaDevice && nativeStationBridgeAvailable
      ? getNativeWebViewBridge()
      : null;
    const deviceCommandsSupported = isAreaDevice
      ? !nativeStationBridgeAvailable || (nativeBridge !== null && supportsNativeDeviceCommands(nativeBridge))
      : undefined;
    const deviceScreen = <DeviceScreen snapshot={view.snapshot} deviceToken={localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY) ?? ''} {...(deviceCommandsSupported === undefined ? {} : { deviceCommandsSupported, nativeBridge })} connectionStatus={connectionStatus} onRefresh={refreshDevice} onOpenAdmin={() => setAdminLoginOpen(true)} onAuthFailure={handleAuthFailure} roomRequestNotificationsUnread={roomRequestNotificationsUnread} onClearRoomRequestNotifications={clearRoomRequestNotifications} />;
    const adminLoginDialog = adminLoginOpen && <AdminLoginDialog onSuccess={(result) => completeAdminLogin(result, 'ADMIN')} onCancel={() => setAdminLoginOpen(false)} />;
    if (view.snapshot.config.mode === 'ROOM') return <>{deviceScreen}<SpanishI18nProvider>{adminLoginDialog}</SpanishI18nProvider></>;
    return <SpanishI18nProvider>{deviceScreen}{adminLoginDialog}</SpanishI18nProvider>;
  }
  return <SpanishI18nProvider><AdminScreen snapshot={view.snapshot} csrfToken={view.session.csrfToken} installationId={view.installationId} connectionStatus={connectionStatus} onRefresh={refreshAdmin} onLogout={logoutAdmin} onUseDeviceToken={useDeviceToken} onChangePassword={submitAdminPasswordChange} passwordChangeError={passwordChangeError} /></SpanishI18nProvider>;
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

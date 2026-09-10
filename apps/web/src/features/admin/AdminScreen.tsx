import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, Check, Circle, CircleAlert, House, LayoutDashboard, List, LogOut, PanelsTopLeft, ScrollText } from 'lucide-react';
import type {
  AdminSystemSnapshot,
  AdminWarningCode,
  ActorType,
  DeviceAssignmentMode,
  DeviceBootstrapResult,
  DevicePresence,
  RequestDTO,
  RequestStatus,
  RoomDTO,
  AreaDTO,
  RequestHistoryDTO,
  ServiceDTO,
  TokenRotationResult
} from '@hotel/shared';
import { api, errorMessage } from '../../api';
import { buildDeviceAssignmentPayload, formatElapsedWithAgo, makeMutationKey, mutationSucceeded } from '../../app-model';
import { ConnectionBadge } from '../../components/ConnectionBadge';
import { Modal } from '../../components/Modal';
import { ServiceIcon } from '../../components/ServiceIcon';
import { TouchSelect, type TouchSelectOption } from '../../components/TouchSelect';
import { createTranslator, useI18n, type Locale, type MessageKey, formatNumber, translateCount } from '../../i18n';
import { canCommitMutation, type ConnectionStatus } from '../../realtime';
import { AdminManagement, CatalogPanels, SERVICE_ICON_OPTIONS, SettingsPanel } from './SetupPanels';

interface AdminScreenProps {
  snapshot: AdminSystemSnapshot;
  csrfToken: string;
  installationId: string | null;
  connectionStatus: ConnectionStatus;
  onRefresh: () => Promise<void>;
  onLogout: () => Promise<void>;
  onUseDeviceToken: (token: string) => Promise<void>;
}

type AdminTab = 'overview' | 'queue' | 'setup' | 'audit';
type ClockFormat = '12h' | '24h';

export const SETUP_SECTIONS = ['rooms', 'areas', 'services', 'devices', 'settings', 'admins'] as const;
type SetupSection = (typeof SETUP_SECTIONS)[number];

const SETUP_SECTION_LABEL_KEYS: Record<SetupSection, MessageKey> = {
  rooms: 'admin.rooms',
  areas: 'admin.areas',
  services: 'admin.servicesTitle',
  devices: 'admin.stations',
  settings: 'admin.systemSettings',
  admins: 'admin.administrators'
};

const REQUEST_STATUS_KEYS: Record<RequestStatus, MessageKey> = {
  PENDING: 'request.status.new',
  ACCEPTED: 'request.status.accepted',
  IN_PROGRESS: 'request.status.inProgress',
  COMPLETED: 'request.status.completed'
};

const DEVICE_PRESENCE_KEYS: Record<DevicePresence, MessageKey> = {
  ONLINE: 'connection.online',
  STALE: 'connection.stale',
  OFFLINE: 'connection.offline',
  DISABLED: 'admin.inactive'
};

const ACTOR_TYPE_KEYS: Record<ActorType, MessageKey> = {
  ADMIN: 'admin.actorAdmin',
  DEVICE: 'admin.actorDevice',
  SYSTEM: 'admin.actorSystem'
};

const ENTITY_TYPE_KEYS: Record<string, MessageKey> = {
  ADMIN: 'admin.administrator',
  ADMIN_SESSION: 'admin.session',
  ROOM: 'admin.room',
  AREA: 'admin.area',
  SERVICE: 'admin.service',
  DEVICE: 'admin.device',
  REQUEST: 'admin.request',
  SYSTEM: 'admin.system'
};

const AUDIT_ACTION_KEYS: Record<string, MessageKey> = {
  ADMIN_CREATED: 'audit.adminCreated',
  ADMIN_LOGIN_FAILED: 'audit.adminLoginFailed',
  ADMIN_LOGIN_LOCKED: 'audit.adminLoginLocked',
  ADMIN_LOGIN_SUCCEEDED: 'audit.adminLoginSucceeded',
  ADMIN_LOGOUT: 'audit.adminLogout',
  ADMIN_SESSIONS_REVOKED: 'audit.adminSessionsRevoked',
  ADMIN_PASSWORD_CHANGED: 'audit.adminPasswordChanged',
  ADMIN_UPDATED: 'audit.adminUpdated',
  ROOM_CREATED: 'audit.roomCreated',
  ROOM_UPDATED: 'audit.roomUpdated',
  AREA_CREATED: 'audit.areaCreated',
  AREA_UPDATED: 'audit.areaUpdated',
  SERVICE_CREATED: 'audit.serviceCreated',
  SERVICE_UPDATED: 'audit.serviceUpdated',
  DEVICE_BOOTSTRAPPED: 'audit.deviceBootstrapped',
  DEVICE_ACTIVATED: 'audit.deviceActivated',
  DEVICE_DEACTIVATED: 'audit.deviceDeactivated',
  DEVICE_ASSIGNMENT_CHANGED: 'audit.deviceAssignmentChanged',
  DEVICE_TOKEN_ROTATION_STARTED: 'audit.deviceTokenRotationStarted',
  DEVICE_TOKEN_ROTATION_ACKNOWLEDGED: 'audit.deviceTokenRotationAcknowledged',
  DEVICE_TOKEN_REVOKED: 'audit.deviceTokenRevoked',
  DEVICE_REBOUND: 'audit.deviceRebound',
  DEVICE_RETIRED: 'audit.deviceRetired',
  REQUEST_CREATED: 'audit.requestCreated',
  REQUEST_STATUS_CHANGED: 'audit.requestStatusChanged',
  SETTINGS_UPDATED: 'audit.settingsUpdated'
};

const ADMIN_WARNING_KEYS: Record<AdminWarningCode, MessageKey> = {
  NO_ACTIVE_AREAS: 'admin.warning.noActiveAreas',
  ACTIVE_SERVICE_WITHOUT_AREA: 'admin.warning.activeServiceWithoutArea',
  ACTIVE_ROOM_WITHOUT_SERVICE: 'admin.warning.activeRoomWithoutService',
  INVALID_ACTIVE_DEVICE_ASSIGNMENT: 'admin.warning.invalidActiveDeviceAssignment'
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

const ADMIN_STATUS_FILTERS = ['ALL', 'PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED'] as const;

interface ConfirmationRequest {
  title: string;
  copy: string;
  onConfirm: () => Promise<boolean> | boolean;
  danger?: boolean;
  resolve: (confirmed: boolean) => void;
}

export interface AdminRequestFilters {
  status: (typeof ADMIN_STATUS_FILTERS)[number];
  roomId: string;
  serviceId: string;
  areaId: string;
  deviceId: string;
  from: string;
  to: string;
  search: string;
}

export function filterAdminRequests(requests: RequestDTO[], filters: AdminRequestFilters): RequestDTO[] {
  const search = filters.search.trim().toLowerCase();
  return requests.filter((request) => {
    if (filters.status !== 'ALL' && request.status !== filters.status) return false;
    if (filters.roomId !== '' && request.roomId !== filters.roomId) return false;
    if (filters.serviceId !== '' && request.serviceId !== filters.serviceId) return false;
    if (filters.areaId !== '' && request.responsibleAreaId !== filters.areaId) return false;
    if (filters.deviceId !== '' && request.createdByDeviceId !== filters.deviceId) return false;
    const createdDate = request.createdAt.slice(0, 10);
    if (filters.from !== '' && createdDate < filters.from) return false;
    if (filters.to !== '' && createdDate > filters.to) return false;
    if (search !== '') {
      const searchable = [
        request.room.code,
        request.room.displayName,
        request.service.code,
        request.service.displayName,
        request.responsibleArea.code,
        request.responsibleArea.displayName,
        request.createdByDeviceId ?? ''
      ].join(' ').toLowerCase();
      if (!searchable.includes(search)) return false;
    }
    return true;
  });
}

const EMPTY_ADMIN_REQUEST_FILTERS: AdminRequestFilters = {
  status: 'ALL',
  roomId: '',
  serviceId: '',
  areaId: '',
  deviceId: '',
  from: '',
  to: '',
  search: ''
};

function requestStatusLabel(status: RequestStatus, locale: Locale): string {
  return createTranslator(locale)(REQUEST_STATUS_KEYS[status]);
}

function readableCode(value: string): string {
  return value.replaceAll('_', ' ').toLowerCase().replace(/^./, (character) => character.toUpperCase());
}

export function devicePresenceLabel(presence: DevicePresence, locale: Locale): string {
  return createTranslator(locale)(DEVICE_PRESENCE_KEYS[presence]);
}

export function actorTypeLabel(actorType: ActorType, locale: Locale): string {
  return createTranslator(locale)(ACTOR_TYPE_KEYS[actorType]);
}

export function entityTypeLabel(entityType: string | null, locale: Locale): string {
  if (entityType === null) return createTranslator(locale)('admin.system');
  const key = ENTITY_TYPE_KEYS[entityType];
  return key === undefined ? readableCode(entityType) : createTranslator(locale)(key);
}

export function auditActionLabel(action: string, locale: Locale): string {
  const translator = createTranslator(locale);
  const key = AUDIT_ACTION_KEYS[action];
  return key === undefined ? translator('admin.unknownAuditAction', { action: readableCode(action) }) : translator(key);
}

export function adminWarningLabel(warning: string, locale: Locale): string {
  const key = ADMIN_WARNING_KEYS[warning as AdminWarningCode];
  return key === undefined ? readableCode(warning) : createTranslator(locale)(key);
}

function resolveAdminClockFormat(settings: AdminSystemSnapshot['settings']): ClockFormat {
  return settings.find((setting) => setting.key === 'clockFormat')?.value === '24h' ? '24h' : '12h';
}

export function formatAdminRoomAreaCounts(locale: Locale, rooms: number, areas: number): string {
  return `${translateCount(locale, 'admin.roomCount', rooms)} · ${translateCount(locale, 'admin.areaCount', areas)}`;
}

export async function runConfirmation(onConfirm: () => Promise<boolean> | boolean): Promise<boolean> {
  try {
    return await onConfirm();
  } catch {
    return false;
  }
}

export type ToggleConfirmationResource = 'room' | 'area' | 'service' | 'administrator';

export interface ToggleConfirmationCopy {
  title: string;
  copy: string;
  danger: boolean;
}

const TOGGLE_RESOURCE_LABEL_KEYS: Record<ToggleConfirmationResource, MessageKey> = {
  room: 'admin.room',
  area: 'admin.area',
  service: 'admin.service',
  administrator: 'admin.administrator'
};

export function resolveToggleConfirmationCopy(locale: Locale, resource: ToggleConfirmationResource, name: string, currentlyActive: boolean): ToggleConfirmationCopy {
  const translator = createTranslator(locale);
  const action = currentlyActive ? translator('admin.deactivate') : translator('admin.reactivate');
  const resourceLabel = translator(TOGGLE_RESOURCE_LABEL_KEYS[resource]);
  const lowerCase = (value: string) => value.toLocaleLowerCase(locale);
  return {
    title: translator(currentlyActive ? 'confirm.deactivateResource.title' : 'confirm.reactivateResource.title', { resource: lowerCase(resourceLabel) }),
    copy: translator('confirm.resourceToggle.copy', { action: lowerCase(action), name }),
    danger: currentlyActive
  };
}

export function AdminScreen({ snapshot, csrfToken, installationId, connectionStatus, onRefresh, onLogout, onUseDeviceToken }: AdminScreenProps) {
  const { locale, t } = useI18n();
  const clockFormat = resolveAdminClockFormat(snapshot.settings);
  const [tab, setTab] = useState<AdminTab>('overview');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [secretToken, setSecretToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyRequest, setHistoryRequest] = useState<RequestDTO | null>(null);
  const [requestHistory, setRequestHistory] = useState<RequestHistoryDTO[] | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null);
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const historyRequestIdRef = useRef<string | null>(null);
  const mutationBusy = busy || !canCommitMutation(connectionStatus);

  function requestConfirmation(request: Omit<ConfirmationRequest, 'resolve'>): Promise<boolean> {
    return new Promise((resolve) => setConfirmation({ ...request, resolve }));
  }

  const adminHeaders = (operation: string): HeadersInit => ({
    'x-csrf-token': csrfToken,
    'Idempotency-Key': makeMutationKey(operation)
  });

  async function perform<T>(operation: string, action: () => Promise<{ data: T }>, successMessage?: string): Promise<{ data: T } | null> {
    if (!canCommitMutation(connectionStatus)) {
      setError(connectionStatus === 'stale' ? t('connection.changesPausedStale') : t('connection.changesPausedOffline'));
      return null;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      if (successMessage !== undefined) setNotice(successMessage);
      try {
        await onRefresh();
      } catch (refreshError) {
         setError(errorMessage(refreshError, t('errors.refreshFailed'), locale));
      }
      return result;
    } catch (actionError) {
       setError(errorMessage(actionError, t('errors.internal'), locale));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function transitionRequest(request: RequestDTO): Promise<boolean> {
    const currentStatus = request.status;
    if (currentStatus === 'COMPLETED') return false;
    const nextStatus = NEXT_STATUS[currentStatus];
    if (nextStatus === null) return false;
    const result = await perform('transition', () => api.post<RequestDTO>(
      `/requests/${encodeURIComponent(request.id)}/${TRANSITION_PATH[currentStatus]}`,
      { expectedVersion: request.version },
      { headers: adminHeaders('transition') }
    ), t('feedback.requestMoved', { status: requestStatusLabel(nextStatus, locale).toLowerCase() }));
    return mutationSucceeded(result);
  }

  async function toggleDevice(deviceId: string, active: boolean) {
    if (!await requestConfirmation({
      title: active ? t('confirm.activateDevice.title') : t('confirm.deactivateDevice.title'),
      copy: t('confirm.deviceToggle.copy', { action: active ? t('confirm.activateDevice.title').toLowerCase() : t('confirm.deactivateDevice.title').toLowerCase() }),
      danger: !active,
      onConfirm: async () => (await perform('device-toggle', () => api.post(`/devices/${encodeURIComponent(deviceId)}/${active ? 'activate' : 'deactivate'}`, undefined, { headers: adminHeaders('device-toggle') }), active ? t('feedback.deviceActivated') : t('feedback.deviceDeactivated'))) !== null
    })) return;
  }

  async function rotateToken(deviceId: string) {
    if (!await requestConfirmation({
      title: t('confirm.rotateToken.title'),
      copy: t('confirm.rotateToken.copy'),
      onConfirm: async () => {
        const result = await perform<TokenRotationResult>('token-rotation', () => api.post<TokenRotationResult>(
          `/devices/${encodeURIComponent(deviceId)}/token-rotation`,
          { reason: 'Routine administrator rotation' },
          { headers: adminHeaders('token-rotation') }
        ), t('feedback.tokenRotationStarted'));
        if (result !== null) setNotice(t('feedback.tokenRotationPending', { rotationId: result.data.rotationId }));
        return result !== null;
      }
    })) return;
  }

  async function rebindDevice(deviceId: string, reason: string): Promise<boolean> {
    if (!await requestConfirmation({
      title: t('confirm.rebind.title'),
      copy: t('confirm.rebind.copy'),
      danger: true,
      onConfirm: async () => {
        const result = await perform<DeviceBootstrapResult>('device-rebind', () => api.post<DeviceBootstrapResult>(
          '/device/rebind',
          { deviceId, reason },
          { headers: adminHeaders('device-rebind') }
        ), t('feedback.deviceRebound'));
        if (result !== null) setSecretToken(result.data.deviceToken);
        return result !== null;
      }
    })) return false;
    return true;
  }

  async function revokeToken(deviceId: string) {
    if (!await requestConfirmation({
      title: t('confirm.revoke.title'),
      copy: t('confirm.revoke.copy'),
      danger: true,
      onConfirm: async () => (await perform('token-revoke', () => api.post(`/devices/${encodeURIComponent(deviceId)}/revoke-token`, undefined, { headers: adminHeaders('token-revoke') }), t('feedback.deviceTokenRevoked'))) !== null
    })) return;
  }

  async function retireDevice(deviceId: string) {
    if (!await requestConfirmation({
      title: t('confirm.retire.title'),
      copy: t('confirm.retire.copy'),
      danger: true,
      onConfirm: async () => (await perform('device-retire', () => api.post(`/devices/${encodeURIComponent(deviceId)}/retire`, undefined, { headers: adminHeaders('device-retire') }), t('feedback.deviceRetired'))) !== null
    })) return;
  }

  async function assignDevice(device: AdminSystemSnapshot['devices'][number], values: { assignmentMode: DeviceAssignmentMode; roomId: string; areaId: string; reason: string }): Promise<boolean> {
    if (!await requestConfirmation({
      title: t('confirm.assign.title'),
      copy: t('confirm.assign.copy', { device: device.displayName, target: values.assignmentMode === 'ROOM' ? t('admin.room').toLowerCase() : t('admin.area').toLowerCase() }),
      onConfirm: async () => (await perform('device-assignment', () => api.post(`/devices/${encodeURIComponent(device.id)}/assignment`, buildDeviceAssignmentPayload(device, values), { headers: adminHeaders('device-assignment') }), t('feedback.deviceAssignmentUpdated'))) !== null
    })) return false;
    return true;
  }

  async function toggleRoom(room: RoomDTO) {
    const confirmationCopy = resolveToggleConfirmationCopy(locale, 'room', room.displayName, room.active);
    if (!await requestConfirmation({
      ...confirmationCopy,
      onConfirm: async () => (await perform('room-toggle', () => api.post(`/rooms/${encodeURIComponent(room.id)}/${room.active ? 'deactivate' : 'activate'}`, undefined, { headers: adminHeaders('room-toggle') }), room.active ? t('feedback.roomDeactivated') : t('feedback.roomReactivated'))) !== null
    })) return;
  }

  async function patchRoom(room: RoomDTO, values: { code: string; displayName: string; floor: string; displayOrder: number; doNotDisturb: boolean }): Promise<boolean> {
    const result = await perform('room-update', () => api.patch<RoomDTO>(`/rooms/${encodeURIComponent(room.id)}`, { ...values, floor: values.floor.length === 0 ? null : values.floor, expectedUpdatedAt: room.updatedAt }, { headers: adminHeaders('room-update') }), t('feedback.roomUpdated'));
    return mutationSucceeded(result);
  }

  async function toggleArea(area: AreaDTO) {
    const confirmationCopy = resolveToggleConfirmationCopy(locale, 'area', area.displayName, area.active);
    if (!await requestConfirmation({
      ...confirmationCopy,
      onConfirm: async () => (await perform('area-toggle', () => api.post(`/areas/${encodeURIComponent(area.id)}/${area.active ? 'deactivate' : 'activate'}`, undefined, { headers: adminHeaders('area-toggle') }), area.active ? t('feedback.areaDeactivated') : t('feedback.areaReactivated'))) !== null
    })) return;
  }

  async function patchArea(area: AreaDTO, values: { code: string; displayName: string; description: string; displayOrder: number }): Promise<boolean> {
    const result = await perform('area-update', () => api.patch<AreaDTO>(`/areas/${encodeURIComponent(area.id)}`, { ...values, description: values.description.length === 0 ? null : values.description, expectedUpdatedAt: area.updatedAt }, { headers: adminHeaders('area-update') }), t('feedback.areaUpdated'));
    return mutationSucceeded(result);
  }

  async function toggleService(service: ServiceDTO) {
    const confirmationCopy = resolveToggleConfirmationCopy(locale, 'service', service.displayName, service.active);
    if (!await requestConfirmation({
      ...confirmationCopy,
      onConfirm: async () => (await perform('service-toggle', () => api.post(`/services/${encodeURIComponent(service.id)}/${service.active ? 'deactivate' : 'activate'}`, undefined, { headers: adminHeaders('service-toggle') }), service.active ? t('feedback.serviceDeactivated') : t('feedback.serviceReactivated'))) !== null
    })) return;
  }

  async function patchService(service: ServiceDTO, values: { code: string; displayName: string; description: string; iconKey: string; areaId: string; displayOrder: number }): Promise<boolean> {
    const result = await perform('service-update', () => api.patch<ServiceDTO>(`/services/${encodeURIComponent(service.id)}`, { ...values, description: values.description.length === 0 ? null : values.description, iconKey: values.iconKey.length === 0 ? null : values.iconKey, expectedUpdatedAt: service.updatedAt }, { headers: adminHeaders('service-update') }), t('feedback.serviceUpdated'));
    return mutationSucceeded(result);
  }

  async function updateSettings(changes: Record<string, unknown>) {
    await perform('settings-update', () => api.patch('/settings', { changes }, { headers: adminHeaders('settings-update') }), t('feedback.settingsUpdated'));
  }

  async function createAdmin(username: string, password: string): Promise<boolean> {
    const result = await perform('admin-create', () => api.post('/admins', { username, password }, { headers: adminHeaders('admin-create') }), t('feedback.administratorAdded'));
    return mutationSucceeded(result);
  }

  async function toggleAdmin(admin: AdminSystemSnapshot['admins'][number]) {
    const confirmationCopy = resolveToggleConfirmationCopy(locale, 'administrator', admin.username, admin.active);
    if (!await requestConfirmation({
      ...confirmationCopy,
      onConfirm: async () => (await perform('admin-toggle', () => api.post(`/admins/${encodeURIComponent(admin.id)}/${admin.active ? 'deactivate' : 'activate'}`, undefined, { headers: adminHeaders('admin-toggle') }), admin.active ? t('feedback.administratorDeactivated') : t('feedback.administratorReactivated'))) !== null
    })) return;
  }

  async function createRoom(values: { code: string; displayName: string; floor: string }): Promise<boolean> {
    const result = await perform<RoomDTO>('create-room', () => api.post<RoomDTO>('/rooms', {
      code: values.code,
      displayName: values.displayName,
      floor: values.floor.length === 0 ? null : values.floor
    }, { headers: adminHeaders('create-room') }), t('feedback.roomAdded'));
    return mutationSucceeded(result);
  }

  async function createArea(values: { code: string; displayName: string; description: string }): Promise<boolean> {
    const result = await perform<AreaDTO>('create-area', () => api.post<AreaDTO>('/areas', {
      code: values.code,
      displayName: values.displayName,
      description: values.description.length === 0 ? null : values.description
    }, { headers: adminHeaders('create-area') }), t('feedback.areaAdded'));
    return mutationSucceeded(result);
  }

  async function createService(values: { code: string; displayName: string; description: string; iconKey: string; areaId: string }): Promise<boolean> {
    const result = await perform<ServiceDTO>('create-service', () => api.post<ServiceDTO>('/services', {
      code: values.code,
      displayName: values.displayName,
      description: values.description.length === 0 ? null : values.description,
      iconKey: values.iconKey.length === 0 ? null : values.iconKey,
      areaId: values.areaId
    }, { headers: adminHeaders('create-service') }), t('feedback.serviceAdded'));
    return mutationSucceeded(result);
  }

  async function provisionDevice(values: { installationId: string; displayName: string; assignmentMode: DeviceAssignmentMode; roomId: string; areaId: string }): Promise<boolean> {
    const result = await perform<DeviceBootstrapResult>('provision-device', () => api.post<DeviceBootstrapResult>('/devices/bootstrap', {
      installationId: values.installationId,
      displayName: values.displayName,
      assignmentMode: values.assignmentMode,
      roomId: values.assignmentMode === 'ROOM' ? values.roomId : null,
      areaId: values.assignmentMode === 'AREA' ? values.areaId : null
    }, { headers: adminHeaders('provision-device') }), t('feedback.deviceProvisioned'));
    if (result !== null) setSecretToken(result.data.deviceToken);
    return mutationSucceeded(result);
  }

  async function openRequestHistory(request: RequestDTO): Promise<void> {
    historyRequestIdRef.current = request.id;
    setHistoryRequest(request);
    setRequestHistory(null);
    setHistoryError(null);
    setHistoryBusy(true);
    try {
      const result = await api.get<RequestHistoryDTO[]>(`/requests/${encodeURIComponent(request.id)}/history`);
      if (historyRequestIdRef.current === request.id) setRequestHistory(result.data);
    } catch (historyLoadError) {
       if (historyRequestIdRef.current === request.id) setHistoryError(errorMessage(historyLoadError, t('errors.requestHistoryFailed'), locale));
    } finally {
      if (historyRequestIdRef.current === request.id) setHistoryBusy(false);
    }
  }

  function closeRequestHistory(): void {
    historyRequestIdRef.current = null;
    setHistoryRequest(null);
    setRequestHistory(null);
    setHistoryError(null);
    setHistoryBusy(false);
  }

  function closeConfirmation(): void {
    if (confirmationBusy || confirmation === null) return;
    confirmation.resolve(false);
    setConfirmation(null);
  }

  async function confirmConfirmation(): Promise<void> {
    const pending = confirmation;
    if (pending === null || confirmationBusy) return;
    setConfirmationBusy(true);
    const confirmed = await runConfirmation(pending.onConfirm);
    pending.resolve(confirmed);
    setConfirmation(null);
    setConfirmationBusy(false);
  }

  return (
    <main className="app-frame app-frame--admin">
      <header className="topbar topbar--admin">
        <div className="brand-lockup">
          <span className="brand-lockup__mark" aria-hidden="true">+</span>
          <div><span className="brand-lockup__name">{t('brand.hotelLocal')}</span><span className="brand-lockup__context">{t('brand.commandCenter')}</span></div>
        </div>
         <div className="topbar__right">
           <ConnectionBadge status={connectionStatus} />
             <button className="icon-button admin-logout" type="button" onClick={() => void onLogout()} aria-label={t('common.signOut')} title={t('common.signOut')}><LogOut aria-hidden="true" size={19} strokeWidth={1.8} /></button>
        </div>
      </header>

       <div className="admin-shell">
         <aside className="admin-sidebar" aria-label={t('admin.navigation')}>
           <div className="admin-sidebar__intro"><p className="eyebrow eyebrow--muted">{t('admin.todayAtAGlance')}</p><h1>{t('admin.makeNextMoveObvious')}</h1></div>
           <AdminNavigation variant="desktop" activeTab={tab} openRequestCount={snapshot.requests.filter((request) => request.status !== 'COMPLETED').length} onTabChange={setTab} />
           <div className="admin-sidebar__footer"><span className="signal-mini" aria-hidden="true" /><span>{t('admin.localSourceTruth')}</span></div>
         </aside>

        <section className="admin-main">
          {connectionStatus !== 'online' && <div className="inline-alert inline-alert--stale" role="status"><span aria-hidden="true"><CircleAlert size={16} strokeWidth={1.8} /></span><span>{connectionStatus === 'stale' ? t('connection.changesPausedStale') : t('connection.changesPausedOffline')}</span></div>}
          {error !== null && <div className="inline-alert" role="alert"><span aria-hidden="true"><CircleAlert size={16} strokeWidth={1.8} /></span><span>{error}</span><button className="text-button" type="button" onClick={() => setError(null)}>{t('common.dismiss')}</button></div>}
          {notice !== null && <div className="inline-alert inline-alert--success" role="status"><span aria-hidden="true"><Check size={16} strokeWidth={1.8} /></span><span>{notice}</span><button className="text-button" type="button" onClick={() => setNotice(null)}>{t('common.dismiss')}</button></div>}
          {secretToken !== null && <SecretTokenCard token={secretToken} onDismiss={() => setSecretToken(null)} onUseOnThisStation={installationId === null ? undefined : () => void onUseDeviceToken(secretToken)} />}

          {tab === 'overview' && <OverviewTab snapshot={snapshot} clockFormat={clockFormat} onOpenQueue={() => setTab('queue')} onRefresh={onRefresh} />}
           {tab === 'queue' && <QueueTab snapshot={snapshot} busy={mutationBusy} onTransition={transitionRequest} onViewHistory={(request) => void openRequestHistory(request)} />}
          {tab === 'setup' && <SetupTab snapshot={snapshot} busy={mutationBusy} initialInstallationId={installationId} onCreateRoom={createRoom} onCreateArea={createArea} onCreateService={createService} onProvisionDevice={provisionDevice} onToggleDevice={toggleDevice} onRotateToken={rotateToken} onRebindDevice={rebindDevice} onToggleRoom={toggleRoom} onPatchRoom={patchRoom} onToggleArea={toggleArea} onPatchArea={patchArea} onToggleService={toggleService} onPatchService={patchService} onSaveSettings={updateSettings} onCreateAdmin={createAdmin} onToggleAdmin={toggleAdmin} onRevokeToken={revokeToken} onRetireDevice={retireDevice} onAssignDevice={assignDevice} />}
             {tab === 'audit' && <AuditTab snapshot={snapshot} clockFormat={clockFormat} />}
             {historyRequest !== null && <RequestHistoryDialog request={historyRequest} history={requestHistory} busy={historyBusy} error={historyError} clockFormat={clockFormat} onClose={closeRequestHistory} />}
           </section>
        </div>
        <AdminNavigation variant="mobile" activeTab={tab} openRequestCount={snapshot.requests.filter((request) => request.status !== 'COMPLETED').length} onTabChange={setTab} />
         {confirmation !== null && (
           <AdminConfirmationDialog
            title={confirmation.title}
            copy={confirmation.copy}
            danger={confirmation.danger === true}
            busy={confirmationBusy}
            onClose={closeConfirmation}
            onConfirm={() => void confirmConfirmation()}
          />
        )}
     </main>
  );
}

export interface AdminConfirmationDialogProps {
  title: string;
  copy: string;
  danger?: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function AdminConfirmationDialog({ title, copy, danger = false, busy, onClose, onConfirm }: AdminConfirmationDialogProps) {
  const { t } = useI18n();

  return (
    <Modal open title={title} onClose={onClose} closeLabel={t('common.closeDialog')} className="admin-confirmation-modal">
      <p className="modal-card__copy">{copy}</p>
      <div className="form-actions">
        <button className="button button--ghost" type="button" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
        <button className={`button ${danger ? 'button--danger' : 'button--dark'}`} type="button" onClick={onConfirm} disabled={busy} aria-busy={busy}>{t('confirm.dangerConfirm')}</button>
      </div>
    </Modal>
  );
}

function AdminNavigation({ variant, activeTab, openRequestCount, onTabChange }: { variant: 'desktop' | 'mobile'; activeTab: AdminTab; openRequestCount: number; onTabChange: (tab: AdminTab) => void }) {
  const { locale, t } = useI18n();
  const className = variant === 'mobile' ? 'admin-mobile-nav' : 'admin-nav';

  return (
    <nav className={className} aria-label={t('admin.navigation')} data-admin-navigation={variant}>
      <AdminNavButton tab="overview" active={activeTab === 'overview'} onClick={() => onTabChange('overview')} icon={<LayoutDashboard aria-hidden="true" size={18} strokeWidth={1.8} />}>{t('admin.overview')}</AdminNavButton>
      <AdminNavButton tab="queue" active={activeTab === 'queue'} onClick={() => onTabChange('queue')} icon={<List aria-hidden="true" size={18} strokeWidth={1.8} />}>{t('admin.liveQueue')} <span className="nav-count">{formatNumber(openRequestCount, locale)}</span></AdminNavButton>
      <AdminNavButton tab="setup" active={activeTab === 'setup'} onClick={() => onTabChange('setup')} icon={<PanelsTopLeft aria-hidden="true" size={18} strokeWidth={1.8} />}>{t('admin.setup')}</AdminNavButton>
      <AdminNavButton tab="audit" active={activeTab === 'audit'} onClick={() => onTabChange('audit')} icon={<ScrollText aria-hidden="true" size={18} strokeWidth={1.8} />}>{t('admin.auditTrail')}</AdminNavButton>
    </nav>
  );
}

function AdminNavButton({ tab, active, onClick, icon, children }: { tab: AdminTab; active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return <button className={`admin-nav__item${active ? ' admin-nav__item--active' : ''}`} type="button" onClick={onClick} aria-current={active ? 'page' : undefined} data-admin-nav-item={tab}><span aria-hidden="true">{icon}</span><span>{children}</span></button>;
}

function OverviewTab({ snapshot, clockFormat, onOpenQueue, onRefresh }: { snapshot: AdminSystemSnapshot; clockFormat: ClockFormat; onOpenQueue: () => void; onRefresh: () => Promise<void> }) {
  const { locale, t } = useI18n();
  const openRequests = snapshot.requests.filter((request) => request.status !== 'COMPLETED');
  const onlineDevices = snapshot.devices.filter((device) => device.presence === 'ONLINE').length;
  const pendingRequests = snapshot.requests.filter((request) => request.status === 'PENDING').length;

  return (
    <div className="admin-content">
       <PageHeading eyebrow={t('admin.overview')} title={t('admin.overviewTitle')} copy={t('admin.overviewCopy')} action={<button className="button button--ghost button--small" type="button" onClick={() => void onRefresh()}>{t('common.refreshData')}</button>} />
         {snapshot.warnings.length > 0 && <div className="warning-strip"><span className="warning-strip__icon" aria-hidden="true"><CircleAlert size={16} strokeWidth={1.8} /></span><div><strong>{t('admin.needsLook')}</strong><span>{snapshot.warnings.map((warning) => adminWarningLabel(warning, locale)).join(' · ')}</span></div></div>}
       <div className="metric-grid">
          <MetricCard label={t('admin.openRequests')} value={formatNumber(openRequests.length, locale)} note={pendingRequests > 0 ? translateCount(locale, 'admin.waitingForAcceptance', pendingRequests) : t('admin.nothingWaiting')} accent="coral" />
         <MetricCard label={t('admin.stationsOnline')} value={`${formatNumber(onlineDevices, locale)}/${formatNumber(snapshot.devices.length, locale)}`} note={t('admin.heartbeatPresence')} accent="amber" />
         <MetricCard label={t('admin.outboxBacklog')} value={formatNumber(snapshot.outboxBacklog, locale)} note={snapshot.outboxBacklog === 0 ? t('admin.fullyPublished') : t('admin.publishingBackground')} accent="sage" />
           <MetricCard label={t('admin.catalog')} value={translateCount(locale, 'admin.services', snapshot.services.length)} note={formatAdminRoomAreaCounts(locale, snapshot.rooms.length, snapshot.areas.length)} accent="blue" />
      </div>
      <div className="overview-grid">
        <section className="surface-card panel-card" aria-labelledby="attention-title">
            <div className="panel-card__heading"><div><p className="eyebrow eyebrow--muted">{t('admin.priority')}</p><h2 id="attention-title">{t('admin.requestsNeedingMovement')}</h2></div><button className="text-button" type="button" onClick={onOpenQueue}>{t('admin.openQueue')}<ArrowUpRight aria-hidden="true" size={16} strokeWidth={1.8} /></button></div>
           {openRequests.length === 0 ? <EmptyPanel title={t('admin.floorClear')} copy={t('admin.newRequestsLand')} /> : <div className="compact-request-list">{openRequests.slice(0, 5).map((request) => <CompactRequest key={request.id} request={request} />)}</div>}
        </section>
        <section className="surface-card panel-card" aria-labelledby="presence-title">
           <div className="panel-card__heading"><div><p className="eyebrow eyebrow--muted">{t('admin.presence')}</p><h2 id="presence-title">{t('admin.stationsOnFloor')}</h2></div><span className="section-count">{formatNumber(snapshot.devices.length, locale)}</span></div>
             <div className="presence-list">{snapshot.devices.slice(0, 6).map((device) => <div className="presence-row" key={device.id}><span className={`presence-dot presence-dot--${device.presence.toLowerCase()}`} aria-hidden="true" /><div><strong>{device.displayName}</strong><span>{device.roomId !== null ? t('admin.modeRoom') : device.areaId !== null ? t('admin.modeArea') : t('device.unassignedStation')}</span></div><span className="presence-status">{devicePresenceLabel(device.presence, locale)}</span></div>)}</div>
       </section>
      </div>
         <section className="surface-card panel-card audit-preview" aria-labelledby="activity-title"><div className="panel-card__heading"><div><p className="eyebrow eyebrow--muted">{t('admin.traceability')}</p><h2 id="activity-title">{t('admin.recentActivity')}</h2></div><span className="section-count">{translateCount(locale, 'admin.events', snapshot.auditLog.length)}</span></div><div className="activity-list">{snapshot.auditLog.slice(0, 5).map((entry) => <div className="activity-row" key={entry.id}><span className="activity-row__mark" aria-hidden="true">·</span><div><strong>{auditActionLabel(entry.action, locale)}</strong><span>{entityTypeLabel(entry.entityType, locale)} · {formatDate(entry.createdAt, locale, clockFormat)}</span></div></div>)}</div></section>
    </div>
  );
}

function QueueTab({ snapshot, busy, onTransition, onViewHistory }: { snapshot: AdminSystemSnapshot; busy: boolean; onTransition: (request: RequestDTO) => Promise<boolean>; onViewHistory: (request: RequestDTO) => void }) {
  const { locale, t } = useI18n();
  const [filters, setFilters] = useState<AdminRequestFilters>(EMPTY_ADMIN_REQUEST_FILTERS);
  const requests = useMemo(() => filterAdminRequests(snapshot.requests, filters).sort((left, right) => right.createdAt.localeCompare(left.createdAt)), [snapshot.requests, filters]);

  function clearFilters(): void {
    setFilters({ ...EMPTY_ADMIN_REQUEST_FILTERS });
  }

  return (
    <div className="admin-content">
       <PageHeading eyebrow={t('admin.liveQueue')} title={t('admin.everyRequestNextStep')} copy={t('admin.queueCopy')} />
       <div className="filter-row" role="group" aria-label={t('admin.filterRequests')}>
        {ADMIN_STATUS_FILTERS.map((value) => (
          <button className={`filter-pill${filters.status === value ? ' filter-pill--active' : ''}`} type="button" key={value} onClick={() => setFilters((current) => ({ ...current, status: value }))}>
             {value === 'ALL' ? t('admin.all') : requestStatusLabel(value, locale)}
          </button>
        ))}
      </div>
       <div className="queue-filter-grid" aria-label={t('admin.additionalFilters')}>
         <SelectInput label={t('admin.room')} value={filters.roomId} onChange={(value) => setFilters((current) => ({ ...current, roomId: value }))} options={snapshot.rooms.map((room) => ({ value: room.id, label: `${room.code} · ${room.displayName}` }))} />
         <SelectInput label={t('admin.service')} value={filters.serviceId} onChange={(value) => setFilters((current) => ({ ...current, serviceId: value }))} options={snapshot.services.map((service) => ({ value: service.id, label: service.displayName }))} />
         <SelectInput label={t('admin.area')} value={filters.areaId} onChange={(value) => setFilters((current) => ({ ...current, areaId: value }))} options={snapshot.areas.map((area) => ({ value: area.id, label: area.displayName }))} />
         <SelectInput label={t('admin.device')} value={filters.deviceId} onChange={(value) => setFilters((current) => ({ ...current, deviceId: value }))} options={snapshot.devices.map((device) => ({ value: device.id, label: device.displayName }))} />
         <TextInput label={t('admin.fromDate')} type="date" value={filters.from} onChange={(value) => setFilters((current) => ({ ...current, from: value }))} />
         <TextInput label={t('admin.toDate')} type="date" value={filters.to} onChange={(value) => setFilters((current) => ({ ...current, to: value }))} />
         <TextInput label={t('admin.search')} value={filters.search} onChange={(value) => setFilters((current) => ({ ...current, search: value }))} placeholder={t('admin.searchPlaceholder')} />
         <button className="button button--ghost button--small queue-filter-clear" type="button" onClick={clearFilters} disabled={JSON.stringify(filters) === JSON.stringify(EMPTY_ADMIN_REQUEST_FILTERS)}>{t('common.clearFilters')}</button>
      </div>
      <div className="surface-card request-table">
         <div className="request-table__header"><span>{t('admin.tableService')}</span><span>{t('admin.tableRoom')}</span><span>{t('admin.tableStatus')}</span><span>{t('admin.tableCreated')}</span><span>{t('admin.tableAction')}</span></div>
         {requests.length === 0 ? <EmptyPanel title={t('admin.noRequestsView')} copy={t('admin.tryDifferentFilter')} /> : requests.map((request) => (
          <div className="request-table__row" key={request.id}>
             <div className="table-service"><span className="request-icon" aria-hidden="true"><ServiceIcon iconKey={request.service.iconKey} size={16} /></span><div><strong>{request.service.displayName}</strong><span>{request.responsibleArea.displayName}</span></div></div>
             <span>{t('admin.roomPrefix', { name: request.room.displayName })}</span>
             <span className={`status-label status-label--${request.status.toLowerCase().replace('_', '-')}`}>{requestStatusLabel(request.status, locale)}</span>
              <span>{formatElapsedWithAgo(request.createdAt, new Date(), locale, t('common.ago'))}</span>
            <div className="request-table__actions">
               {NEXT_STATUS[request.status] !== null ? <button className="button button--dark button--small" type="button" onClick={() => void onTransition(request)} disabled={busy}>{t('common.moveForward')}</button> : <span className="table-complete">{t('common.complete')}</span>}
               <button className="text-button" type="button" onClick={() => onViewHistory(request)}>{t('common.history')}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface SetupTabProps {
  snapshot: AdminSystemSnapshot;
  busy: boolean;
  initialInstallationId: string | null;
  onCreateRoom: (values: { code: string; displayName: string; floor: string }) => Promise<boolean>;
  onCreateArea: (values: { code: string; displayName: string; description: string }) => Promise<boolean>;
  onCreateService: (values: { code: string; displayName: string; description: string; iconKey: string; areaId: string }) => Promise<boolean>;
  onProvisionDevice: (values: { installationId: string; displayName: string; assignmentMode: DeviceAssignmentMode; roomId: string; areaId: string }) => Promise<boolean>;
  onToggleDevice: (deviceId: string, active: boolean) => Promise<void>;
  onRotateToken: (deviceId: string) => Promise<void>;
  onRebindDevice: (deviceId: string, reason: string) => Promise<boolean>;
  onToggleRoom: (room: RoomDTO) => Promise<void>;
  onPatchRoom: (room: RoomDTO, values: { code: string; displayName: string; floor: string; displayOrder: number; doNotDisturb: boolean }) => Promise<boolean>;
  onToggleArea: (area: AreaDTO) => Promise<void>;
  onPatchArea: (area: AreaDTO, values: { code: string; displayName: string; description: string; displayOrder: number }) => Promise<boolean>;
  onToggleService: (service: ServiceDTO) => Promise<void>;
  onPatchService: (service: ServiceDTO, values: { code: string; displayName: string; description: string; iconKey: string; areaId: string; displayOrder: number }) => Promise<boolean>;
  onSaveSettings: (changes: Record<string, unknown>) => Promise<void>;
  onCreateAdmin: (username: string, password: string) => Promise<boolean>;
  onToggleAdmin: (admin: AdminSystemSnapshot['admins'][number]) => Promise<void>;
  onRevokeToken: (deviceId: string) => Promise<void>;
  onRetireDevice: (deviceId: string) => Promise<void>;
  onAssignDevice: (device: AdminSystemSnapshot['devices'][number], values: { assignmentMode: DeviceAssignmentMode; roomId: string; areaId: string; reason: string }) => Promise<boolean>;
}

export function SetupTab({ snapshot, busy, initialInstallationId, onCreateRoom, onCreateArea, onCreateService, onProvisionDevice, onToggleDevice, onRotateToken, onRebindDevice, onToggleRoom, onPatchRoom, onToggleArea, onPatchArea, onToggleService, onPatchService, onSaveSettings, onCreateAdmin, onToggleAdmin, onRevokeToken, onRetireDevice, onAssignDevice }: SetupTabProps) {
  const { t } = useI18n();
  const [section, setSection] = useState<SetupSection>('rooms');
  const panelId = `setup-panel-${section}`;

  return (
    <div className="admin-content">
      <PageHeading eyebrow={t('admin.setup')} title={t('admin.setupTitle')} copy={t('admin.setupCopy')} />
      <div className="setup-tabs" role="tablist" aria-label={t('admin.setup')}>
        {SETUP_SECTIONS.map((value) => (
          <button
            className={`setup-tab${section === value ? ' setup-tab--active' : ''}`}
            type="button"
            role="tab"
            id={`setup-tab-${value}`}
            aria-selected={section === value}
            aria-controls={`setup-panel-${value}`}
            key={value}
            onClick={() => setSection(value)}
          >
            {t(SETUP_SECTION_LABEL_KEYS[value])}
          </button>
        ))}
      </div>
      <div className="setup-tabpanel" id={panelId} role="tabpanel" aria-labelledby={`setup-tab-${section}`}>
        {section === 'rooms' && <div className="setup-grid"><CreateRoomForm busy={busy} onSubmit={onCreateRoom} /><CatalogPanels resource="rooms" rooms={snapshot.rooms} areas={snapshot.areas} services={snapshot.services} busy={busy} onToggleRoom={onToggleRoom} onPatchRoom={onPatchRoom} onToggleArea={onToggleArea} onPatchArea={onPatchArea} onToggleService={onToggleService} onPatchService={onPatchService} /></div>}
        {section === 'areas' && <div className="setup-grid"><CreateAreaForm busy={busy} onSubmit={onCreateArea} /><CatalogPanels resource="areas" rooms={snapshot.rooms} areas={snapshot.areas} services={snapshot.services} busy={busy} onToggleRoom={onToggleRoom} onPatchRoom={onPatchRoom} onToggleArea={onToggleArea} onPatchArea={onPatchArea} onToggleService={onToggleService} onPatchService={onPatchService} /></div>}
        {section === 'services' && <div className="setup-grid"><CreateServiceForm areas={snapshot.areas} busy={busy} onSubmit={onCreateService} /><CatalogPanels resource="services" rooms={snapshot.rooms} areas={snapshot.areas} services={snapshot.services} busy={busy} onToggleRoom={onToggleRoom} onPatchRoom={onPatchRoom} onToggleArea={onToggleArea} onPatchArea={onPatchArea} onToggleService={onToggleService} onPatchService={onPatchService} /></div>}
        {section === 'devices' && <><div className="setup-grid"><ProvisionDeviceForm initialInstallationId={initialInstallationId} rooms={snapshot.rooms} areas={snapshot.areas} busy={busy} onSubmit={onProvisionDevice} /></div><DeviceManagement devices={snapshot.devices} rooms={snapshot.rooms} areas={snapshot.areas} busy={busy} onToggle={onToggleDevice} onRotate={onRotateToken} onRebind={onRebindDevice} onRevoke={onRevokeToken} onRetire={onRetireDevice} onAssign={onAssignDevice} /></>}
          {section === 'settings' && <SettingsPanel settings={snapshot.settings} busy={busy} onSave={onSaveSettings} />}
        {section === 'admins' && <AdminManagement admins={snapshot.admins} busy={busy} onCreate={onCreateAdmin} onToggle={onToggleAdmin} />}
      </div>
    </div>
  );
}

function CreateRoomForm({ busy, onSubmit }: { busy: boolean; onSubmit: (values: { code: string; displayName: string; floor: string }) => Promise<boolean> }) {
  const { t } = useI18n();
  const [code, setCode] = useState(''); const [displayName, setDisplayName] = useState(''); const [floor, setFloor] = useState('');
  return <form className="surface-card setup-card" onSubmit={async (event) => { event.preventDefault(); if (await onSubmit({ code, displayName, floor })) { setCode(''); setDisplayName(''); setFloor(''); } }}><FormTitle eyebrow={t('admin.catalog')} title={t('admin.addRoom')} /><TextInput label={t('admin.code')} value={code} onChange={setCode} placeholder={t('admin.roomCodePlaceholder')} required /><TextInput label={t('admin.displayName')} value={displayName} onChange={setDisplayName} placeholder={t('admin.roomNamePlaceholder')} required /><TextInput label={t('admin.floor')} value={floor} onChange={setFloor} placeholder={t('admin.floorPlaceholder')} /><button className="button button--dark button--full" type="submit" disabled={busy}>{t('admin.addRoom')}</button></form>;
}

function CreateAreaForm({ busy, onSubmit }: { busy: boolean; onSubmit: (values: { code: string; displayName: string; description: string }) => Promise<boolean> }) {
  const { t } = useI18n();
  const [code, setCode] = useState(''); const [displayName, setDisplayName] = useState(''); const [description, setDescription] = useState('');
  return <form className="surface-card setup-card" onSubmit={async (event) => { event.preventDefault(); if (await onSubmit({ code, displayName, description })) { setCode(''); setDisplayName(''); setDescription(''); } }}><FormTitle eyebrow={t('admin.catalog')} title={t('admin.addArea')} /><TextInput label={t('admin.code')} value={code} onChange={setCode} placeholder={t('admin.areaCodePlaceholder')} required /><TextInput label={t('admin.displayName')} value={displayName} onChange={setDisplayName} placeholder={t('admin.areaNamePlaceholder')} required /><TextInput label={t('admin.description')} value={description} onChange={setDescription} placeholder={t('admin.areaDescriptionPlaceholder')} /><button className="button button--dark button--full" type="submit" disabled={busy}>{t('admin.addArea')}</button></form>;
}

function CreateServiceForm({ areas, busy, onSubmit }: { areas: AreaDTO[]; busy: boolean; onSubmit: (values: { code: string; displayName: string; description: string; iconKey: string; areaId: string }) => Promise<boolean> }) {
  const { t } = useI18n();
  const [code, setCode] = useState(''); const [displayName, setDisplayName] = useState(''); const [description, setDescription] = useState(''); const [iconKey, setIconKey] = useState('bell'); const [areaId, setAreaId] = useState(areas[0]?.id ?? '');
  return <form className="surface-card setup-card" onSubmit={async (event) => { event.preventDefault(); if (await onSubmit({ code, displayName, description, iconKey, areaId })) { setCode(''); setDisplayName(''); setDescription(''); } }}><FormTitle eyebrow={t('admin.catalog')} title={t('admin.addService')} /><TextInput label={t('admin.code')} value={code} onChange={setCode} placeholder={t('admin.serviceCodePlaceholder')} required /><TextInput label={t('admin.displayName')} value={displayName} onChange={setDisplayName} placeholder={t('admin.serviceNamePlaceholder')} required /><SelectInput label={t('admin.area')} value={areaId} onChange={setAreaId} options={areas.map((area) => ({ value: area.id, label: area.displayName }))} required /><SelectInput label={t('admin.icon')} value={iconKey} onChange={setIconKey} options={SERVICE_ICON_OPTIONS.map((option) => ({ value: option.value, label: t(option.label), icon: option.icon }))} /><button className="button button--dark button--full" type="submit" disabled={busy || areas.length === 0}>{areas.length === 0 ? t('admin.addAreaFirst') : t('admin.addService')}</button></form>;
}

function ProvisionDeviceForm({ initialInstallationId, rooms, areas, busy, onSubmit }: { initialInstallationId: string | null; rooms: RoomDTO[]; areas: AreaDTO[]; busy: boolean; onSubmit: (values: { installationId: string; displayName: string; assignmentMode: DeviceAssignmentMode; roomId: string; areaId: string }) => Promise<boolean> }) {
  const { t } = useI18n();
  const [installationId, setInstallationId] = useState(initialInstallationId ?? ''); const [displayName, setDisplayName] = useState(''); const [assignmentMode, setAssignmentMode] = useState<DeviceAssignmentMode>('ROOM'); const [roomId, setRoomId] = useState(rooms[0]?.id ?? ''); const [areaId, setAreaId] = useState(areas[0]?.id ?? '');
  return <form className="surface-card setup-card setup-card--wide" onSubmit={async (event) => { event.preventDefault(); if (await onSubmit({ installationId, displayName, assignmentMode, roomId, areaId })) { setInstallationId(''); setDisplayName(''); } }}><FormTitle eyebrow={t('admin.stations')} title={t('admin.provisionDevice')} /><div className="form-grid"><TextInput label={t('admin.installationId')} value={installationId} onChange={setInstallationId} placeholder={t('admin.installationIdPlaceholder')} required /><TextInput label={t('admin.stationName')} value={displayName} onChange={setDisplayName} placeholder={t('admin.stationNamePlaceholder')} required /><SelectInput label={t('admin.displayMode')} value={assignmentMode} onChange={(value) => setAssignmentMode(value as DeviceAssignmentMode)} options={[{ value: 'ROOM', label: t('admin.modeRoom') }, { value: 'AREA', label: t('admin.modeArea') }]} />{assignmentMode === 'ROOM' ? <SelectInput label={t('admin.room')} value={roomId} onChange={setRoomId} options={rooms.map((room) => ({ value: room.id, label: `${room.code} · ${room.displayName}` }))} required /> : <SelectInput label={t('admin.area')} value={areaId} onChange={setAreaId} options={areas.map((area) => ({ value: area.id, label: `${area.code} · ${area.displayName}` }))} required />}</div><button className="button button--dark" type="submit" disabled={busy || (assignmentMode === 'ROOM' ? rooms.length === 0 : areas.length === 0)}>{t('admin.provisionStation')}</button></form>;
}

interface DeviceManagementProps {
  devices: AdminSystemSnapshot['devices'];
  rooms: RoomDTO[];
  areas: AreaDTO[];
  busy: boolean;
  onToggle: (id: string, active: boolean) => Promise<void>;
  onRotate: (id: string) => Promise<void>;
  onRebind: (id: string, reason: string) => Promise<boolean>;
  onRevoke: (id: string) => Promise<void>;
  onRetire: (id: string) => Promise<void>;
  onAssign: (device: AdminSystemSnapshot['devices'][number], values: DeviceAssignmentFormValues) => Promise<boolean>;
}

interface DeviceAssignmentFormValues {
  assignmentMode: DeviceAssignmentMode;
  roomId: string;
  areaId: string;
  reason: string;
}

function DeviceManagement({ devices, rooms, areas, busy, onToggle, onRotate, onRebind, onRevoke, onRetire, onAssign }: DeviceManagementProps) {
  const { locale, t } = useI18n();
  const [rebindId, setRebindId] = useState<string | null>(null);
  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const activeRooms = rooms.filter((room) => room.active);
  const activeAreas = areas.filter((area) => area.active);

  function openAssignment(device: AdminSystemSnapshot['devices'][number]): void {
    setRebindId(null);
    setAssignmentId(device.id);
  }

  function closeForms(): void {
    setRebindId(null);
    setAssignmentId(null);
  }

  return (
    <section className="surface-card device-management" aria-labelledby="device-management-title">
      <div className="panel-card__heading"><div><p className="eyebrow eyebrow--muted">{t('admin.stations')}</p><h2 id="device-management-title">{t('admin.deviceHealthCredentials')}</h2></div><span className="section-count">{formatNumber(devices.length, locale)}</span></div>
      <div className="device-list">
        {devices.length === 0 ? <EmptyPanel title={t('admin.noStationsProvisioned')} copy={t('admin.provisionStationAbove')} /> : devices.map((device) => <div className="device-row" key={device.id}>
             <div className={`device-row__mark device-row__mark--${device.presence.toLowerCase()}`} aria-hidden="true">{device.assignmentMode === 'ROOM' ? <House size={18} strokeWidth={1.8} /> : <PanelsTopLeft size={18} strokeWidth={1.8} />}</div>
            <div className="device-row__main"><strong>{device.displayName}</strong><span>{device.installationId} · {devicePresenceLabel(device.presence, locale)} · {device.lastHeartbeatAt === null ? t('admin.neverSeen') : formatElapsedWithAgo(device.lastHeartbeatAt, new Date(), locale, t('common.ago'))}</span><span>{device.assignmentMode === 'ROOM' ? t('admin.roomPrefix', { name: device.roomId ?? t('admin.unassigned') }) : t('admin.areaPrefix', { name: device.areaId ?? t('admin.unassigned') })}</span></div>
            <div className="device-row__actions"><button className="text-button" type="button" onClick={() => void onToggle(device.id, !device.active)} disabled={busy}>{device.active ? t('admin.deactivate') : t('admin.activate')}</button><button className="text-button" type="button" onClick={() => void onRotate(device.id)} disabled={busy}>{t('admin.rotateToken')}</button><button className="text-button" type="button" onClick={() => openAssignment(device)} disabled={busy}>{t('admin.reassign')}</button><button className="text-button text-button--danger" type="button" onClick={() => void onRevoke(device.id)} disabled={busy}>{t('admin.revokeToken')}</button><button className="text-button text-button--danger" type="button" onClick={() => { setAssignmentId(null); setRebindId(device.id); }} disabled={busy}>{t('admin.rebind')}</button><button className="text-button text-button--danger" type="button" onClick={() => void onRetire(device.id)} disabled={busy}>{t('admin.retire')}</button></div>
           {assignmentId === device.id && <DeviceAssignmentForm rooms={activeRooms} areas={activeAreas} device={device} busy={busy} onCancel={closeForms} onSubmit={async (values) => { const succeeded = await onAssign(device, values); if (succeeded) closeForms(); return succeeded; }} />}
           {rebindId === device.id && <DeviceRebindForm busy={busy} onCancel={closeForms} onSubmit={async (reason) => { const succeeded = await onRebind(device.id, reason); if (succeeded) closeForms(); return succeeded; }} />}
        </div>)}
      </div>
    </section>
  );
}

function DeviceAssignmentForm({ device, rooms, areas, busy, onCancel, onSubmit }: { device: AdminSystemSnapshot['devices'][number]; rooms: RoomDTO[]; areas: AreaDTO[]; busy: boolean; onCancel: () => void; onSubmit: (values: DeviceAssignmentFormValues) => Promise<boolean> }) {
  const { t } = useI18n();
  const [assignmentMode, setAssignmentMode] = useState<DeviceAssignmentMode>(device.assignmentMode);
  const [roomId, setRoomId] = useState(device.roomId ?? rooms[0]?.id ?? '');
  const [areaId, setAreaId] = useState(device.areaId ?? areas[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const hasTarget = assignmentMode === 'ROOM' ? rooms.length > 0 : areas.length > 0;

  return <form className="device-action-form" onSubmit={async (event) => { event.preventDefault(); await onSubmit({ assignmentMode, roomId, areaId, reason }); }}><p className="eyebrow eyebrow--muted">{t('admin.remoteAssignment')}</p><div className="form-grid form-grid--compact"><SelectInput label={t('admin.mode')} value={assignmentMode} onChange={(value) => setAssignmentMode(value as DeviceAssignmentMode)} options={[{ value: 'ROOM', label: t('admin.modeRoom') }, { value: 'AREA', label: t('admin.modeArea') }]} /><SelectInput label={t('admin.room')} value={roomId} onChange={setRoomId} options={rooms.map((room) => ({ value: room.id, label: `${room.code} · ${room.displayName}` }))} required={assignmentMode === 'ROOM'} /><SelectInput label={t('admin.area')} value={areaId} onChange={setAreaId} options={areas.map((area) => ({ value: area.id, label: `${area.code} · ${area.displayName}` }))} required={assignmentMode === 'AREA'} /><TextInput label={t('admin.reason')} value={reason} onChange={setReason} placeholder={t('admin.assignmentPlaceholder')} required /></div>{!hasTarget && <p className="form-hint">{t('admin.addTarget', { target: assignmentMode === 'ROOM' ? t('admin.room').toLowerCase() : t('admin.area').toLowerCase() })}</p>}<div className="form-actions"><button className="button button--ghost button--small" type="button" onClick={onCancel}>{t('common.cancel')}</button><button className="button button--dark button--small" type="submit" disabled={busy || !hasTarget}>{t('admin.saveAssignment')}</button></div></form>;
}

function DeviceRebindForm({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: (reason: string) => Promise<boolean> }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  return <form className="device-action-form" onSubmit={async (event) => { event.preventDefault(); await onSubmit(reason); }}><p className="eyebrow eyebrow--muted">{t('admin.credentialReset')}</p><TextInput label={t('admin.reason')} value={reason} onChange={setReason} placeholder={t('admin.rebindPlaceholder')} required /><div className="form-actions"><button className="button button--ghost button--small" type="button" onClick={onCancel}>{t('common.cancel')}</button><button className="button button--dark button--small" type="submit" disabled={busy}>{t('admin.rebindDevice')}</button></div></form>;
}

function RequestHistoryDialog({ request, history, busy, error, clockFormat, onClose }: { request: RequestDTO; history: RequestHistoryDTO[] | null; busy: boolean; error: string | null; clockFormat: ClockFormat; onClose: () => void }) {
  const { locale, t } = useI18n();
  return (
    <Modal open title={request.service.displayName} onClose={onClose} closeLabel={t('common.closeDialog')}>
        <p className="eyebrow eyebrow--muted">{t('admin.requestHistory')}</p>
        <p className="modal-card__copy">{t('admin.roomPrefix', { name: request.room.displayName })} · {request.responsibleArea.displayName}</p>
        {busy && <p className="form-hint">{t('admin.loadingHistory')}</p>}
        {error !== null && <p className="form-error" role="alert">{error}</p>}
        {history !== null && (
          <ol className="request-history">
            {history.map((entry) => (
              <li className="request-history__item" key={entry.id}>
                 <div><strong>{entry.fromStatus === null ? t('admin.created') : `${requestStatusLabel(entry.fromStatus, locale)} → ${requestStatusLabel(entry.toStatus, locale)}`}</strong><span>{actorTypeLabel(entry.actorType, locale)} · {entry.actorId ?? t('admin.system')}</span></div>
                  <time dateTime={entry.createdAt}>{formatDate(entry.createdAt, locale, clockFormat)}</time>
              </li>
            ))}
          </ol>
        )}
    </Modal>
  );
}

function AuditTab({ snapshot, clockFormat }: { snapshot: AdminSystemSnapshot; clockFormat: ClockFormat }) {
  const { locale, t } = useI18n();
   return <div className="admin-content"><PageHeading eyebrow={t('admin.auditTrail')} title={t('admin.auditTitle')} copy={t('admin.auditCopy')} /><div className="surface-card audit-table">{snapshot.auditLog.length === 0 ? <EmptyPanel title={t('admin.noActivity')} copy={t('admin.activityWillAppear')} /> : snapshot.auditLog.map((entry) => <div className="audit-row" key={entry.id}><span className="audit-row__id">#{entry.id}</span><div><strong>{auditActionLabel(entry.action, locale)}</strong><span>{actorTypeLabel(entry.actorType, locale)} · {entityTypeLabel(entry.entityType, locale)}{entry.entityId === null ? '' : ` · ${entry.entityId}`}</span></div><time dateTime={entry.createdAt}>{formatDate(entry.createdAt, locale, clockFormat)}</time></div>)}</div></div>;
}

function SecretTokenCard({ token, onDismiss, onUseOnThisStation }: { token: string; onDismiss: () => void; onUseOnThisStation?: (() => void) | undefined }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  async function copy() { try { await navigator.clipboard.writeText(token); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); } }
  return <div className="secret-card" role="alert"><div><p className="eyebrow">{t('admin.oneTimeCredential')}</p><strong>{t('admin.storeToken')}</strong><code>{token}</code><span>{t('admin.tokenNotShownAgain')}</span></div><div className="secret-card__actions"><button className="button button--dark button--small" type="button" onClick={() => void copy()}>{copied ? t('common.copied') : t('admin.copyToken')}</button>{onUseOnThisStation !== undefined && <button className="button button--dark button--small" type="button" onClick={onUseOnThisStation}>{t('admin.useOnThisStation')}</button>}<button className="button button--ghost button--small" type="button" onClick={onDismiss}>{t('common.dismiss')}</button></div></div>;
}

function PageHeading({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow eyebrow--muted">{eyebrow}</p><h1>{title}</h1><p>{copy}</p></div>{action}</div>;
}

function MetricCard({ label, value, note, accent }: { label: string; value: string; note: string; accent: string }) {
  return <article className={`metric-card metric-card--${accent}`}><span className="metric-card__label">{label}</span><strong>{value}</strong><span>{note}</span></article>;
}

function CompactRequest({ request }: { request: RequestDTO }) {
  const { locale, t } = useI18n();
  return <div className="compact-request"><span className={`status-dot status-dot--${request.status.toLowerCase().replace('_', '-')}`} /><div><strong>{request.service.displayName}</strong><span>{t('admin.roomPrefix', { name: request.room.displayName })} · {formatElapsedWithAgo(request.createdAt, new Date(), locale, t('common.ago'))}</span></div><span className={`status-label status-label--${request.status.toLowerCase().replace('_', '-')}`}>{requestStatusLabel(request.status, locale)}</span></div>;
}

function EmptyPanel({ title, copy }: { title: string; copy: string }) { return <div className="empty-panel"><span aria-hidden="true"><Circle size={19} strokeWidth={1.8} /></span><div><strong>{title}</strong><p>{copy}</p></div></div>; }

function FormTitle({ eyebrow, title }: { eyebrow: string; title: string }) { return <div className="setup-card__heading"><p className="eyebrow eyebrow--muted">{eyebrow}</p><h2>{title}</h2></div>; }

function TextInput({ label, value, onChange, placeholder, required = false, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; required?: boolean; type?: 'text' | 'date' }) {
  const id = `input-${label.toLowerCase().replaceAll(' ', '-')}-${useId().replaceAll(':', '')}`;
  return <div className="form-field"><label htmlFor={id}>{label}</label><input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} /></div>;
}

function SelectInput({ label, value, onChange, options, required = false }: { label: string; value: string; onChange: (value: string) => void; options: TouchSelectOption[]; required?: boolean }) {
  const { t } = useI18n();
  return <TouchSelect label={label} value={value} onChange={onChange} options={options} placeholder={t('common.select', { label: label.toLowerCase() })} required={required} />;
}

function formatDate(value: string, locale: Locale = 'en', clockFormat: ClockFormat = '12h'): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: clockFormat === '24h' ? '2-digit' : 'numeric',
    minute: '2-digit',
    hour12: clockFormat === '12h'
  }).format(new Date(value));
}

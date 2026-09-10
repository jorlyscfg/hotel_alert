import type { AppMode, ActorType, DeviceAssignmentMode, DevicePresence, RequestStatus, RoomBackgroundValue, SettingKey, SettingValue } from './domain';

export type LocalizedTextVariants = Partial<Record<string, string>>;

export interface RoomDTO {
  id: string;
  code: string;
  displayName: string;
  displayNameVariants?: LocalizedTextVariants;
  floor: string | null;
  displayOrder: number;
  active: boolean;
  doNotDisturb: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AreaDTO {
  id: string;
  code: string;
  displayName: string;
  displayNameVariants?: LocalizedTextVariants;
  description: string | null;
  descriptionVariants?: LocalizedTextVariants;
  displayOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceDTO {
  id: string;
  code: string;
  displayName: string;
  displayNameVariants?: LocalizedTextVariants;
  description: string | null;
  descriptionVariants?: LocalizedTextVariants;
  iconKey: string | null;
  areaId: string;
  active: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceDTO {
  id: string;
  installationId: string;
  displayName: string;
  displayNameVariants?: LocalizedTextVariants;
  assignmentMode: DeviceAssignmentMode;
  roomId: string | null;
  areaId: string | null;
  active: boolean;
  deviceConfigVersion: number;
  lastHeartbeatAt: string | null;
  presence: DevicePresence;
}

export interface AdminDTO {
  id: string;
  username: string;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SettingDTO {
  key: SettingKey;
  value: SettingValue;
  updatedAt: string;
  updatedByAdminId: string | null;
}

export interface CompactRoom {
  id: string;
  code: string;
  displayName: string;
  displayNameVariants?: LocalizedTextVariants;
  doNotDisturb: boolean;
}

export interface CompactArea {
  id: string;
  code: string;
  displayName: string;
  displayNameVariants?: LocalizedTextVariants;
}

export interface CompactService {
  id: string;
  code: string;
  displayName: string;
  displayNameVariants?: LocalizedTextVariants;
  iconKey: string | null;
}

export interface RequestDTO {
  id: string;
  roomId: string;
  serviceId: string;
  responsibleAreaId: string;
  room: CompactRoom;
  service: CompactService;
  responsibleArea: CompactArea;
  status: RequestStatus;
  version: number;
  createdAt: string;
  acceptedAt: string | null;
  inProgressAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  createdByDeviceId?: string;
}

export interface PageInfo {
  nextCursor: string | null;
  hasMore: boolean;
}

export interface PageResult<T> {
  data: T[];
  page: PageInfo;
}

export type RequestPage = PageResult<RequestDTO>;

export interface RequestHistoryDTO {
  id: string;
  requestId: string;
  fromStatus: RequestStatus | null;
  toStatus: RequestStatus;
  actorType: ActorType;
  actorId: string | null;
  requestVersion: number;
  createdAt: string;
}

export interface AuditLogDTO {
  id: number;
  actorType: ActorType;
  actorId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  requestId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface DeviceConfig {
  mode: DeviceAssignmentMode;
  room: CompactRoom | null;
  area: CompactArea | null;
  services: ServiceDTO[];
  /** Named service areas are omitted only from legacy cached snapshots. */
  areas?: CompactArea[];
  hotelName: string;
  hotelLogo: string | null;
  roomBackground: RoomBackgroundValue;
  clockFormat: '12h' | '24h';
  offlineQueueTtlHours: number;
  heartbeatIntervalMs: number;
  heartbeatStaleAfterMs: number;
  heartbeatOfflineAfterMs: number;
  pendingAlertIntervalMs: number;
}

export interface PendingTokenRotation {
  rotationId: string;
  state: 'ROTATION_PENDING' | 'CLAIMED';
  graceExpiresAt: string;
}

export interface DeviceSyncSnapshot {
  snapshotSequence: number;
  currentEventSequence: number;
  configurationRevision: number;
  deviceConfigVersion: number;
  serverTime: string;
  device: DeviceDTO;
  config: DeviceConfig;
  activeRequests: RequestDTO[];
  activeDoNotDisturbRooms?: CompactRoom[];
  pendingTokenRotation: PendingTokenRotation | null;
}

export interface MutationResponse<T> {
  data: T;
  requestId: string;
  configurationRevision?: number;
  idempotentReplay?: boolean;
}

export interface BootstrapState {
  installationId: string;
  configured: boolean;
  displayHint: string | null;
}

export interface AdminSystemSnapshot {
  configurationRevision: number;
  rooms: RoomDTO[];
  areas: AreaDTO[];
  services: ServiceDTO[];
  devices: DeviceDTO[];
  requests: RequestDTO[];
  admins: AdminDTO[];
  settings: SettingDTO[];
  auditLog: AuditLogDTO[];
  outboxBacklog: number;
  warnings: AdminWarningCode[];
}

export type AdminWarningCode =
  | 'NO_ACTIVE_AREAS'
  | 'ACTIVE_SERVICE_WITHOUT_AREA'
  | 'ACTIVE_ROOM_WITHOUT_SERVICE'
  | 'INVALID_ACTIVE_DEVICE_ASSIGNMENT';

export interface AdminMe {
  id: string;
  username: string;
  expiresAt: string;
}

export interface AdminLoginResult {
  admin: AdminMe;
  csrfToken: string;
}

export interface DeviceBootstrapResult {
  device: DeviceDTO;
  deviceToken: string;
  tokenPrefix: string;
  configurationRevision: number;
}

export interface TokenRotationResult {
  rotationId: string;
  state: 'ROTATION_PENDING';
  graceExpiresAt: string;
}

export interface ClaimedTokenResult {
  rotationId: string;
  deviceToken: string;
  tokenPrefix: string;
}

export interface HealthDTO {
  status: 'ready' | 'degraded';
  process: 'ready';
  database: 'ready' | 'unavailable';
  migrations: 'ready' | 'pending' | 'unavailable';
  outboxBacklog: number;
  serverTime: string;
}

export type { AppMode };

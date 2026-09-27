import type {
  AdminDTO,
  AdminWarningCode,
  AdminLoginResult,
  AdminMe,
  AdminSystemSnapshot,
  AreaDTO,
  AuditLogDTO,
  BootstrapState,
  ClaimedTokenResult,
  CompactArea,
  CompactRoom,
  DeviceBootstrapResult,
  DeviceConfig,
  DeviceDTO,
  DevicePresence,
  DeviceSyncSnapshot,
  HealthDTO,
  PendingTokenRotation,
  RequestDTO,
  RequestHistoryDTO,
  RequestPage,
  RoomDTO,
  ServiceDTO,
  SettingDTO,
  TokenRotationResult
} from '@hotel/shared';
import {
  DEFAULT_SETTINGS,
  isSettingKey,
  isValidSettingValue,
  validateSettings,
  type ActorType,
  type DeviceAssignmentMode,
  type RequestStatus,
  type SettingKey,
  type SettingValues
} from '@hotel/shared';
import type {
  AdminCreateInput,
  AdminPatchInput,
  AreaCreateInput,
  AreaPatchInput,
  DeviceAssignmentInput,
  DeviceCreateInput,
  DevicePatchInput,
  DeviceRebindInput,
  RoomCreateInput,
  RoomPatchInput,
  ServiceCreateInput,
  ServicePatchInput
} from '@hotel/shared';
import { LATEST_MIGRATION_VERSION, type SqliteDatabase } from '../db/connection';
import { AppError, conflictError, notFound, validationError } from '../errors';
import { assertIdempotencyKeyMatches, validateIdempotencyKey } from './idempotency';
import { assertLegalRequestTransition, canReadRequest, canTransitionRequest, type RequestScope } from './policies';
import type { ServerConfig } from '../config/env';
import { createCsrfToken, createId, createRawToken, decryptIdempotencySecret, encryptIdempotencySecret, hashJson, hashPassword, hashToken, hashesMatch, verifyPassword } from '../security/crypto';
import type { Actor, AdminPrincipal, DevicePrincipal, Principal } from '../security/principal';

interface RoomRow {
  id: string;
  code: string;
  display_name: string;
  floor: string | null;
  display_order: number;
  active: number;
  do_not_disturb: number;
  created_at: string;
  updated_at: string;
}

interface AreaRow {
  id: string;
  code: string;
  display_name: string;
  description: string | null;
  display_order: number;
  active: number;
  created_at: string;
  updated_at: string;
}

interface ServiceRow {
  id: string;
  code: string;
  display_name: string;
  description: string | null;
  icon_key: string | null;
  area_id: string;
  display_order: number;
  active: number;
  created_at: string;
  updated_at: string;
}

interface DeviceRow {
  id: string;
  installation_id: string;
  display_name: string;
  assignment_mode: DeviceAssignmentMode;
  room_id: string | null;
  area_id: string | null;
  active: number;
  last_seen_at: string | null;
  last_heartbeat_at: string | null;
  last_ip: string | null;
  last_user_agent: string | null;
  client_version: string | null;
  device_config_version: number;
  retired_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AdminRow {
  id: string;
  username: string;
  password_hash: string;
  active: number;
  failed_login_count: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SessionRow {
  session_id: string;
  admin_id: string;
  username: string;
  csrf_token_hash: string;
  expires_at: string;
}

interface DeviceTokenRow extends DeviceRow {
  token_id: string;
  token_hash: string;
  token_revoked_at: string | null;
}

interface RequestRow {
  id: string;
  room_id: string;
  service_id: string;
  responsible_area_id: string;
  status: RequestStatus;
  version: number;
  created_by_actor_type: ActorType;
  created_by_actor_id: string | null;
  room_code_snapshot: string;
  room_display_name_snapshot: string;
  room_do_not_disturb: number;
  service_code_snapshot: string;
  service_display_name_snapshot: string;
  service_icon_key: string | null;
  area_code_snapshot: string;
  area_display_name_snapshot: string;
  created_at: string;
  accepted_at: string | null;
  in_progress_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

interface HistoryRow {
  id: string;
  request_id: string;
  from_status: RequestStatus | null;
  to_status: RequestStatus;
  actor_type: ActorType;
  actor_id: string | null;
  request_version: number;
  metadata_json: string | null;
  created_at: string;
}

interface IdempotencyRow {
  operation: string;
  request_hash: string;
  response_json: string | null;
  response_status: number | null;
}

interface StoredRebindResult {
  device: DeviceDTO;
  encryptedDeviceToken: string;
  tokenPrefix: string;
  configurationRevision: number;
}

const REQUEST_PAGE_SIZE_CAP = 100;

interface RequestCursor {
  version: 1;
  filterKey: string;
  createdAt: string;
  id: string;
}

export interface OutboxRow {
  id: number;
  event_id: string;
  event_name: string;
  aggregate_type: 'REQUEST' | 'DEVICE' | 'ROOM' | 'AREA' | 'SERVICE' | 'SYSTEM';
  aggregate_id: string;
  aggregate_version: number | null;
  payload_json: string;
  created_at: string;
  published_at: string | null;
  attempt_count: number;
  last_error: string | null;
}

export interface RetentionPurgeResult {
  eventsDeleted: number;
  requestHistoryDeleted: number;
  auditDeleted: number;
  idempotencyDeleted: number;
  heartbeatLogsDeleted: number;
}

export interface MutationResult<T> {
  data: T;
  idempotentReplay: boolean;
  configurationRevision?: number;
}

export interface DeviceRetirementResult {
  deviceId: string;
  retiredAt: string;
}

export type SecurityChange =
  | { kind: 'ADMIN'; id: string }
  | { kind: 'DEVICE'; id: string };

export type SecurityChangeHandler = (change: SecurityChange) => void;

export interface LoginSessionResult {
  data: AdminLoginResult;
  sessionToken: string;
}

export interface DeviceTokenPrincipal {
  principal: DevicePrincipal;
  tokenId: string;
}

export interface RotationTokenPrincipal {
  principal: DevicePrincipal;
  rotationId: string;
}

export interface RequestFilters {
  statuses?: RequestStatus[];
  roomId?: string;
  serviceId?: string;
  areaId?: string;
  deviceId?: string;
  createdFrom?: string;
  createdTo?: string;
  includeCreator?: boolean;
  search?: string;
  limit?: number;
  cursor?: string;
}

export interface ReplayPlan {
  sync: 'REPLAY_AVAILABLE' | 'FULL_SNAPSHOT_REQUIRED' | 'UP_TO_DATE';
  reason?: 'EVENT_GAP' | 'ASSIGNMENT_CHANGED' | 'SERVER_RESTART' | 'DEVICE_CONFIG_MISMATCH';
  currentEventSequence: number;
  events: OutboxRow[];
}

export interface AreaRequestsResult {
  data: RequestDTO[];
}

export interface DeviceAssignmentResult {
  device: DeviceDTO;
  configurationRevision: number;
}

export class HotelService {
  private securityChangeHandler: SecurityChangeHandler | undefined;

  public constructor(
    private readonly db: SqliteDatabase,
    private readonly config: ServerConfig,
    private readonly onCommitted?: () => void
  ) {}

  public setSecurityChangeHandler(handler: SecurityChangeHandler | undefined): void {
    this.securityChangeHandler = handler;
  }

  public getConfigurationRevision(): number {
    const row = this.db.prepare('SELECT configuration_revision FROM configuration_state WHERE singleton_id = 1').get() as { configuration_revision: number } | undefined;
    return row?.configuration_revision ?? 1;
  }

  public getSettings(): SettingValues {
    const result: SettingValues = {
      ...DEFAULT_SETTINGS,
      'heartbeat.intervalMs': this.config.heartbeatIntervalMs,
      'heartbeat.staleAfterMs': this.config.deviceStaleAfterMs,
      'heartbeat.offlineAfterMs': this.config.deviceOfflineAfterMs,
      'alerts.pendingRepeatMs': this.config.pendingAlertIntervalMs,
      'realtime.replayMinMinutes': this.config.socketEventReplayMinMinutes,
      'realtime.replayMaxEvents': this.config.socketEventReplayMaxEvents,
      'requests.pageSizeDefault': this.config.requestPageSizeDefault,
      'requests.historyRetentionDays': this.config.requestHistoryRetentionDays,
      'idempotency.retentionHours': this.config.idempotencyRetentionHours,
      'client.offlineQueueTtlHours': this.config.offlineQueueTtlHours,
      'audit.retentionDays': this.config.auditRetentionDays
    };
    const rows = this.db.prepare('SELECT key, value_json, updated_by_admin_id FROM system_settings').all() as Array<{ key: string; value_json: string; updated_by_admin_id: string | null }>;
    for (const row of rows) {
      if (!isSettingKey(row.key) || row.updated_by_admin_id === null) {
        continue;
      }
      const value: unknown = JSON.parse(row.value_json) as unknown;
      if (isValidSettingValue(row.key, value)) {
        Object.assign(result, { [row.key]: value });
      }
    }
    return result;
  }

  public listSettings(): SettingDTO[] {
    const settings = this.getSettings();
    const rows = this.db.prepare('SELECT key, updated_at, updated_by_admin_id FROM system_settings ORDER BY key').all() as Array<{
      key: string;
      updated_at: string;
      updated_by_admin_id: string | null;
    }>;
    return rows.filter((row): row is typeof row & { key: SettingKey } => isSettingKey(row.key)).map((row) => ({
      key: row.key,
      value: settings[row.key],
      updatedAt: row.updated_at,
      updatedByAdminId: row.updated_by_admin_id
    }));
  }

  public getHealth(): HealthDTO {
    try {
      const migration = this.db.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get() as { version: number } | undefined;
      const backlog = this.getOutboxBacklog();
      return {
        status: migration?.version === LATEST_MIGRATION_VERSION ? 'ready' : 'degraded',
        process: 'ready',
        database: 'ready',
        migrations: migration?.version === LATEST_MIGRATION_VERSION ? 'ready' : 'pending',
        outboxBacklog: backlog,
        serverTime: new Date().toISOString()
      };
    } catch {
      return {
        status: 'degraded',
        process: 'ready',
        database: 'unavailable',
        migrations: 'unavailable',
        outboxBacklog: 0,
        serverTime: new Date().toISOString()
      };
    }
  }

  public getOutboxBacklog(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM outbox_events WHERE published_at IS NULL').get() as { count: number };
    return row.count;
  }

  public getBootstrapState(installationId: string): BootstrapState {
    const row = this.db.prepare('SELECT id, display_name FROM devices WHERE installation_id = ?').get(installationId) as { id: string; display_name: string } | undefined;
    return {
      installationId,
      configured: row !== undefined,
      displayHint: row === undefined ? null : row.display_name
    };
  }

  public createAdmin(input: AdminCreateInput, actor: Actor, requestId: string): AdminDTO {
    const now = new Date().toISOString();
    const id = createId('adm');
    const passwordHash = hashPassword(input.password);
    return this.mutate(() => {
      try {
        this.db.prepare('INSERT INTO admins(id, username, password_hash, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
          id, input.username, passwordHash, input.active === false ? 0 : 1, now, now
        );
      } catch (error) {
        if (isSqliteConstraintError(error)) {
          throw conflictError('An administrator with that username already exists.');
        }
        throw error;
      }
      this.audit(actor, 'ADMIN_CREATED', 'ADMIN', id, requestId, { username: input.username });
      return this.getAdmin(id) ?? this.assertImpossible('Created administrator disappeared.');
    });
  }

  public loginAdmin(username: string, password: string, requestId: string, sourceIp: string | undefined, userAgent: string | undefined): LoginSessionResult {
    const admin = this.db.prepare('SELECT * FROM admins WHERE username = ? COLLATE NOCASE').get(username) as AdminRow | undefined;
    const now = new Date();
    if (admin === undefined) {
      this.audit({ actorType: 'SYSTEM', actorId: null }, 'ADMIN_LOGIN_FAILED', 'ADMIN', null, requestId, { reason: 'invalid_credentials' });
      throw new AppError('AUTH_INVALID', 'Invalid username or password.', 401);
    }
    if (admin.locked_until !== null && new Date(admin.locked_until) > now) {
      throw new AppError('AUTH_LOCKED', 'This account is temporarily locked.', 423);
    }
    if (!admin.active) {
      throw new AppError('AUTH_INVALID', 'Invalid username or password.', 401);
    }
    if (!verifyPassword(password, admin.password_hash)) {
      const nextFailures = admin.failed_login_count + 1;
      const lockedUntil = nextFailures >= this.config.loginMaxAttempts
        ? new Date(now.getTime() + this.config.loginLockMinutes * 60000).toISOString()
        : null;
      this.db.prepare('UPDATE admins SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?').run(nextFailures, lockedUntil, now.toISOString(), admin.id);
      this.audit({ actorType: 'SYSTEM', actorId: null }, lockedUntil === null ? 'ADMIN_LOGIN_FAILED' : 'ADMIN_LOGIN_LOCKED', 'ADMIN', admin.id, requestId, { reason: 'invalid_credentials' });
      throw new AppError(lockedUntil === null ? 'AUTH_INVALID' : 'AUTH_LOCKED', 'Invalid username or password.', 401);
    }

    const sessionToken = createRawToken();
    const csrfToken = createCsrfToken();
    const sessionId = createId('ses');
    const expiresAt = new Date(now.getTime() + this.config.adminSessionTtlMinutes * 60000).toISOString();
    this.db.prepare('UPDATE admins SET failed_login_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?').run(now.toISOString(), now.toISOString(), admin.id);
    this.db.prepare('INSERT INTO admin_sessions(id, admin_id, session_token_hash, csrf_token_hash, created_at, expires_at, last_seen_at, created_ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      sessionId, admin.id, hashToken(sessionToken, this.config.sessionSecret), hashToken(csrfToken, this.config.sessionSecret), now.toISOString(), expiresAt, now.toISOString(), sourceIp ?? null, userAgent ?? null
    );
    this.audit({ actorType: 'ADMIN', actorId: admin.id }, 'ADMIN_LOGIN_SUCCEEDED', 'ADMIN', admin.id, requestId, {});
    const adminMe: AdminMe = { id: admin.id, username: admin.username, expiresAt };
    return { data: { admin: adminMe, csrfToken }, sessionToken };
  }

  public authenticateAdmin(sessionToken: string | undefined): AdminPrincipal {
    if (sessionToken === undefined || sessionToken.length === 0) {
      throw new AppError('AUTH_REQUIRED', 'Administrator authentication is required.', 401);
    }
    const row = this.db.prepare(`
      SELECT s.id AS session_id, s.admin_id, a.username, s.csrf_token_hash, s.expires_at
      FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
      WHERE s.session_token_hash = ? AND s.revoked_at IS NULL AND a.active = 1
    `).get(hashToken(sessionToken, this.config.sessionSecret)) as SessionRow | undefined;
    if (row === undefined || new Date(row.expires_at) <= new Date()) {
      throw new AppError('AUTH_INVALID', 'Administrator session is invalid or expired.', 401);
    }
    this.db.prepare('UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), row.session_id);
    return { kind: 'ADMIN', actorType: 'ADMIN', adminId: row.admin_id, username: row.username, sessionId: row.session_id, csrfTokenHash: row.csrf_token_hash };
  }

  public verifyCsrf(principal: AdminPrincipal, token: string | undefined): void {
    if (token === undefined || !hashesMatch(hashToken(token, this.config.sessionSecret), principal.csrfTokenHash)) {
      throw new AppError('AUTH_INVALID', 'A valid CSRF token is required.', 403);
    }
  }

  public getAdminSessionExpiry(principal: AdminPrincipal): string {
    const row = this.db.prepare('SELECT expires_at FROM admin_sessions WHERE id = ? AND admin_id = ? AND revoked_at IS NULL').get(principal.sessionId, principal.adminId) as { expires_at: string } | undefined;
    if (row === undefined) {
      throw new AppError('AUTH_INVALID', 'Administrator session is invalid or expired.', 401);
    }
    return row.expires_at;
  }

  public logoutAdmin(principal: AdminPrincipal, requestId: string): void {
    this.db.prepare('UPDATE admin_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(new Date().toISOString(), principal.sessionId);
    this.audit({ actorType: 'ADMIN', actorId: principal.adminId }, 'ADMIN_LOGOUT', 'ADMIN_SESSION', principal.sessionId, requestId, {});
    this.notifySecurityChange({ kind: 'ADMIN', id: principal.adminId });
  }

  public logoutAllAdminSessions(principal: AdminPrincipal, requestId: string): void {
    this.db.prepare('UPDATE admin_sessions SET revoked_at = ? WHERE admin_id = ? AND revoked_at IS NULL').run(new Date().toISOString(), principal.adminId);
    this.audit({ actorType: 'ADMIN', actorId: principal.adminId }, 'ADMIN_SESSIONS_REVOKED', 'ADMIN', principal.adminId, requestId, {});
    this.notifySecurityChange({ kind: 'ADMIN', id: principal.adminId });
  }

  public revokeAdminSessions(principal: AdminPrincipal, adminId: string, requestId: string): void {
    this.getAdminRow(adminId);
    const now = new Date().toISOString();
    this.mutate(() => {
      this.db.prepare('UPDATE admin_sessions SET revoked_at = ? WHERE admin_id = ? AND revoked_at IS NULL').run(now, adminId);
      this.audit({ actorType: 'ADMIN', actorId: principal.adminId }, 'ADMIN_SESSIONS_REVOKED', 'ADMIN', adminId, requestId, {});
    });
    this.notifySecurityChange({ kind: 'ADMIN', id: adminId });
  }

  public changeAdminPassword(principal: AdminPrincipal, adminId: string, currentPassword: string, newPassword: string, requestId: string): AdminDTO {
    const admin = this.getAdminRow(adminId);
    if (!verifyPassword(currentPassword, admin.password_hash)) {
      throw new AppError('AUTH_INVALID', 'Current password is incorrect.', 403);
    }
    const now = new Date().toISOString();
    const result = this.mutate(() => {
      this.db.prepare('UPDATE admins SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashPassword(newPassword), now, adminId);
      this.db.prepare('UPDATE admin_sessions SET revoked_at = ? WHERE admin_id = ? AND revoked_at IS NULL').run(now, adminId);
      this.audit({ actorType: 'ADMIN', actorId: principal.adminId }, 'ADMIN_PASSWORD_CHANGED', 'ADMIN', adminId, requestId, {});
      return this.getAdmin(adminId) ?? this.assertImpossible('Updated administrator disappeared.');
    });
    this.notifySecurityChange({ kind: 'ADMIN', id: adminId });
    return result;
  }

  public listAdmins(): AdminDTO[] {
    const rows = this.db.prepare('SELECT id, username, active, last_login_at, created_at, updated_at FROM admins ORDER BY username').all() as Array<Omit<AdminRow, 'password_hash' | 'failed_login_count' | 'locked_until'>>;
    return rows.map(mapAdmin);
  }

  public getAdmin(id: string): AdminDTO | null {
    const row = this.db.prepare('SELECT id, username, active, last_login_at, created_at, updated_at FROM admins WHERE id = ?').get(id) as Omit<AdminRow, 'password_hash' | 'failed_login_count' | 'locked_until'> | undefined;
    return row === undefined ? null : mapAdmin(row);
  }

  public patchAdmin(principal: AdminPrincipal, id: string, input: AdminPatchInput, requestId: string): AdminDTO {
    const existing = this.getAdminRow(id);
    const username = input.username ?? existing.username;
    const active = input.active ?? Boolean(existing.active);
    if (!active && existing.active) {
      const count = (this.db.prepare('SELECT COUNT(*) AS count FROM admins WHERE active = 1').get() as { count: number }).count;
      if (count <= 1) {
        throw new AppError('ACTIVE_DEPENDENCIES', 'The last active administrator cannot be disabled.', 409);
      }
    }
    const now = new Date().toISOString();
    const result = this.mutate(() => {
      try {
        this.db.prepare('UPDATE admins SET username = ?, active = ?, updated_at = ? WHERE id = ?').run(username, active ? 1 : 0, now, id);
      } catch (error) {
        if (isSqliteConstraintError(error)) {
          throw conflictError('An administrator with that username already exists.');
        }
        throw error;
      }
      if (!active) {
        this.db.prepare('UPDATE admin_sessions SET revoked_at = ? WHERE admin_id = ? AND revoked_at IS NULL').run(now, id);
      }
      this.audit({ actorType: 'ADMIN', actorId: principal.adminId }, 'ADMIN_UPDATED', 'ADMIN', id, requestId, { active });
      return this.getAdmin(id) ?? this.assertImpossible('Updated administrator disappeared.');
    });
    if (!active && Boolean(existing.active)) {
      this.notifySecurityChange({ kind: 'ADMIN', id });
    }
    return result;
  }

  public createRoom(input: RoomCreateInput, actor: Actor, requestId: string): RoomDTO {
    const id = createId('room');
    const now = new Date().toISOString();
    return this.mutate(() => {
      this.insertRoom(id, input, now);
      this.bumpConfiguration();
      this.audit(actor, 'ROOM_CREATED', 'ROOM', id, requestId, {});
      this.appendOutbox('service.catalog.changed', 'ROOM', id, null, { configurationRevision: this.getConfigurationRevision(), changedServiceIds: [] });
      return this.getRoom(id) ?? this.assertImpossible('Created room disappeared.');
    });
  }

  public patchRoom(id: string, input: RoomPatchInput, actor: Actor, requestId: string): RoomDTO {
    const existing = this.getRoomRow(id);
    this.assertExpectedTimestamp(existing.updated_at, input.expectedUpdatedAt);
    const nextActive = input.active ?? Boolean(existing.active);
    const nextDoNotDisturb = input.doNotDisturb ?? Boolean(existing.do_not_disturb);
    const doNotDisturbChanged = nextDoNotDisturb !== Boolean(existing.do_not_disturb);
    if (existing.active && !nextActive) {
      this.assertRoomCanDeactivate(id);
    }
    const now = new Date().toISOString();
    return this.mutate(() => {
      try {
        this.db.prepare('UPDATE rooms SET code = ?, display_name = ?, floor = ?, display_order = ?, active = ?, do_not_disturb = ?, updated_at = ? WHERE id = ?').run(
          input.code ?? existing.code, input.displayName ?? existing.display_name, input.floor === undefined ? existing.floor : input.floor,
          input.displayOrder ?? existing.display_order, nextActive ? 1 : 0, nextDoNotDisturb ? 1 : 0, now, id
        );
      } catch (error) {
        if (isSqliteConstraintError(error)) {
          throw conflictError('A room with that code already exists.');
        }
        throw error;
      }
      this.bumpConfiguration();
      this.audit(actor, 'ROOM_UPDATED', 'ROOM', id, requestId, { active: nextActive, doNotDisturb: nextDoNotDisturb });
      this.appendOutbox('service.catalog.changed', 'ROOM', id, null, { configurationRevision: this.getConfigurationRevision(), changedServiceIds: [] });
      const room = this.getRoom(id) ?? this.assertImpossible('Updated room disappeared.');
      if (doNotDisturbChanged) {
        this.appendRoomUpdatedEvent(room);
      }
      return room;
    });
  }

  public setRoomDoNotDisturb(principal: DevicePrincipal, doNotDisturb: boolean, idempotencyKey: string | undefined, requestId: string): MutationResult<RoomDTO> {
    if (principal.assignmentMode !== 'ROOM' || principal.roomId === null) {
      throw new AppError('FORBIDDEN_ASSIGNMENT', 'Only ROOM devices can change do-not-disturb.', 403);
    }
    const key = validateIdempotencyKey(idempotencyKey);
    const actor: Actor = { actorType: 'DEVICE', actorId: principal.deviceId };
    const requestHash = hashJson({ doNotDisturb });
    return this.mutate(() => {
      const replay = this.getIdempotentResult<RoomDTO>(actor, key, 'room.doNotDisturb', requestHash);
      if (replay !== undefined) {
        return { data: replay, idempotentReplay: true };
      }

      const current = this.getRoomRow(principal.roomId ?? this.assertImpossible('Room assignment is missing.'));
      if (!current.active) {
        throw new AppError('INACTIVE_DEPENDENCY', 'The assigned room is inactive.', 409);
      }
      let room = mapRoom(current);
      if (Boolean(current.do_not_disturb) !== doNotDisturb) {
        const now = new Date().toISOString();
        this.db.prepare('UPDATE rooms SET do_not_disturb = ?, updated_at = ? WHERE id = ?').run(doNotDisturb ? 1 : 0, now, current.id);
        this.bumpConfiguration();
        room = this.getRoom(current.id) ?? this.assertImpossible('Updated room disappeared.');
        this.audit(actor, 'ROOM_UPDATED', 'ROOM', current.id, requestId, { doNotDisturb });
        this.appendRoomUpdatedEvent(room);
      }
      this.storeIdempotency(actor, key, 'room.doNotDisturb', requestHash, room, 200, room.id);
      return { data: room, idempotentReplay: false };
    });
  }

  public listRooms(): RoomDTO[] {
    return (this.db.prepare('SELECT * FROM rooms ORDER BY active DESC, display_order, code').all() as RoomRow[]).map(mapRoom);
  }

  public getRoom(id: string): RoomDTO | null {
    const row = this.db.prepare('SELECT * FROM rooms WHERE id = ?').get(id) as RoomRow | undefined;
    return row === undefined ? null : mapRoom(row);
  }

  public createArea(input: AreaCreateInput, actor: Actor, requestId: string): AreaDTO {
    const id = createId('area');
    const now = new Date().toISOString();
    return this.mutate(() => {
      try {
        this.db.prepare('INSERT INTO areas(id, code, display_name, description, display_order, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
          id, input.code, input.displayName, input.description ?? null, input.displayOrder ?? 0, input.active === false ? 0 : 1, now, now
        );
      } catch (error) {
        if (isSqliteConstraintError(error)) {
          throw conflictError('An area with that code already exists.');
        }
        throw error;
      }
      this.bumpConfiguration();
      this.audit(actor, 'AREA_CREATED', 'AREA', id, requestId, {});
      this.appendOutbox('service.catalog.changed', 'AREA', id, null, { configurationRevision: this.getConfigurationRevision(), changedServiceIds: [] });
      return this.getArea(id) ?? this.assertImpossible('Created area disappeared.');
    });
  }

  public patchArea(id: string, input: AreaPatchInput, actor: Actor, requestId: string): AreaDTO {
    const existing = this.getAreaRow(id);
    this.assertExpectedTimestamp(existing.updated_at, input.expectedUpdatedAt);
    const nextActive = input.active ?? Boolean(existing.active);
    if (existing.active && !nextActive) {
      this.assertAreaCanDeactivate(id);
    }
    const now = new Date().toISOString();
    return this.mutate(() => {
      try {
        this.db.prepare('UPDATE areas SET code = ?, display_name = ?, description = ?, display_order = ?, active = ?, updated_at = ? WHERE id = ?').run(
          input.code ?? existing.code, input.displayName ?? existing.display_name, input.description === undefined ? existing.description : input.description,
          input.displayOrder ?? existing.display_order, nextActive ? 1 : 0, now, id
        );
      } catch (error) {
        if (isSqliteConstraintError(error)) {
          throw conflictError('An area with that code already exists.');
        }
        throw error;
      }
      this.bumpConfiguration();
      this.audit(actor, 'AREA_UPDATED', 'AREA', id, requestId, { active: nextActive });
      this.appendOutbox('service.catalog.changed', 'AREA', id, null, { configurationRevision: this.getConfigurationRevision(), changedServiceIds: [] });
      return this.getArea(id) ?? this.assertImpossible('Updated area disappeared.');
    });
  }

  public listAreas(): AreaDTO[] {
    return (this.db.prepare('SELECT * FROM areas ORDER BY active DESC, display_order, code').all() as AreaRow[]).map(mapArea);
  }

  public getArea(id: string): AreaDTO | null {
    const row = this.db.prepare('SELECT * FROM areas WHERE id = ?').get(id) as AreaRow | undefined;
    return row === undefined ? null : mapArea(row);
  }

  public createService(input: ServiceCreateInput, actor: Actor, requestId: string): ServiceDTO {
    const area = this.getAreaRow(input.areaId);
    if (!area.active && input.active !== false) {
      throw new AppError('INACTIVE_DEPENDENCY', 'An active service requires an active area.', 409);
    }
    const id = createId('svc');
    const now = new Date().toISOString();
    return this.mutate(() => {
      try {
        this.db.prepare('INSERT INTO services(id, code, display_name, description, icon_key, area_id, display_order, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
          id, input.code, input.displayName, input.description ?? null, input.iconKey ?? null, input.areaId, input.displayOrder ?? 0, input.active === false ? 0 : 1, now, now
        );
      } catch (error) {
        if (isSqliteConstraintError(error)) {
          throw conflictError('A service with that code already exists.');
        }
        throw error;
      }
      this.bumpConfiguration();
      this.audit(actor, 'SERVICE_CREATED', 'SERVICE', id, requestId, { areaId: input.areaId });
      this.appendCatalogEvent([id]);
      return this.getService(id) ?? this.assertImpossible('Created service disappeared.');
    });
  }

  public patchService(id: string, input: ServicePatchInput, actor: Actor, requestId: string): ServiceDTO {
    const existing = this.getServiceRow(id);
    this.assertExpectedTimestamp(existing.updated_at, input.expectedUpdatedAt);
    const areaId = input.areaId ?? existing.area_id;
    const nextActive = input.active ?? Boolean(existing.active);
    const area = this.getAreaRow(areaId);
    if (nextActive && !area.active) {
      throw new AppError('INACTIVE_DEPENDENCY', 'An active service requires an active area.', 409);
    }
    const now = new Date().toISOString();
    return this.mutate(() => {
      try {
        this.db.prepare('UPDATE services SET code = ?, display_name = ?, description = ?, icon_key = ?, area_id = ?, display_order = ?, active = ?, updated_at = ? WHERE id = ?').run(
          input.code ?? existing.code, input.displayName ?? existing.display_name, input.description === undefined ? existing.description : input.description,
          input.iconKey === undefined ? existing.icon_key : input.iconKey, areaId, input.displayOrder ?? existing.display_order, nextActive ? 1 : 0, now, id
        );
      } catch (error) {
        if (isSqliteConstraintError(error)) {
          throw conflictError('A service with that code already exists.');
        }
        throw error;
      }
      this.bumpConfiguration();
      this.audit(actor, 'SERVICE_UPDATED', 'SERVICE', id, requestId, { areaId });
      this.appendCatalogEvent([id]);
      return this.getService(id) ?? this.assertImpossible('Updated service disappeared.');
    });
  }

  public listServices(activeOnly = false, areaId?: string): ServiceDTO[] {
    const clauses = activeOnly ? ['s.active = 1', 'a.active = 1'] : [];
    const values: string[] = [];
    if (areaId !== undefined) {
      clauses.push('s.area_id = ?');
      values.push(areaId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return (this.db.prepare(`SELECT s.* FROM services s JOIN areas a ON a.id = s.area_id ${where} ORDER BY s.active DESC, s.display_order, s.display_name`).all(...values) as ServiceRow[]).map(mapService);
  }

  public getService(id: string): ServiceDTO | null {
    const row = this.db.prepare('SELECT * FROM services WHERE id = ?').get(id) as ServiceRow | undefined;
    return row === undefined ? null : mapService(row);
  }

  public bootstrapDevice(input: DeviceCreateInput, actor: Actor, requestId: string): DeviceBootstrapResult {
    const assignment = this.resolveAssignment(input.assignmentMode, input.roomId ?? null, input.areaId ?? null);
    const existing = this.db.prepare('SELECT id FROM devices WHERE installation_id = ?').get(input.installationId) as { id: string } | undefined;
    if (existing !== undefined) {
      throw conflictError('This browser installation is already bound to a device.');
    }
    const id = createId('dev');
    const tokenId = createId('tok');
    const rawToken = createRawToken();
    const now = new Date().toISOString();
    return this.mutate(() => {
      const active = input.active !== false;
      if (active && input.assignmentMode === 'ROOM') {
        this.assertActiveRoomAssignmentAvailable(assignment.roomId ?? this.assertImpossible('Room assignment is missing.'));
      }
      try {
        this.db.prepare('INSERT INTO devices(id, installation_id, display_name, assignment_mode, room_id, area_id, active, device_config_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
          id, input.installationId, input.displayName, input.assignmentMode, assignment.roomId, assignment.areaId, active ? 1 : 0, 1, now, now
        );
      } catch (error) {
        if (isSqliteConstraintError(error)) {
          throw conflictError('An active ROOM device is already assigned to this room.');
        }
        throw error;
      }
      this.db.prepare('INSERT INTO device_tokens(id, device_id, token_hash, token_prefix, issued_at) VALUES (?, ?, ?, ?, ?)').run(
        tokenId, id, hashToken(rawToken, this.config.tokenPepper), rawToken.slice(0, 8), now
      );
      const revision = this.bumpConfiguration();
      this.audit(actor, 'DEVICE_BOOTSTRAPPED', 'DEVICE', id, requestId, { assignmentMode: input.assignmentMode });
      this.appendDeviceConfigEvent(id, revision, 1, input.assignmentMode, assignment.roomId, assignment.areaId, input.active === false ? 'DEVICE_DEACTIVATED' : 'DEVICE_ACTIVATED');
      const device = this.getDevice(id) ?? this.assertImpossible('Created device disappeared.');
      return { device, deviceToken: rawToken, tokenPrefix: rawToken.slice(0, 8), configurationRevision: revision };
    });
  }

  public authenticateDeviceToken(rawToken: string | undefined): DeviceTokenPrincipal {
    if (rawToken === undefined || rawToken.length === 0) {
      throw new AppError('AUTH_REQUIRED', 'A device bearer token is required.', 401);
    }
    const hash = hashToken(rawToken, this.config.tokenPepper);
    const row = this.db.prepare(`
      SELECT d.*, t.id AS token_id, t.token_hash, t.revoked_at AS token_revoked_at
      FROM device_tokens t JOIN devices d ON d.id = t.device_id
      WHERE t.token_hash = ?
    `).get(hash) as DeviceTokenRow | undefined;
    if (row === undefined) {
      throw new AppError('AUTH_INVALID', 'Device authentication failed.', 401);
    }
    if (row.token_revoked_at !== null) {
      throw new AppError('DEVICE_TOKEN_REVOKED', 'This device token has been revoked.', 401);
    }
    if (row.retired_at !== null || !row.active) {
      throw new AppError('DEVICE_INACTIVE', 'This device is inactive.', 403);
    }
    this.db.prepare('UPDATE device_tokens SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), row.token_id);
    return { principal: devicePrincipal(row), tokenId: row.token_id };
  }

  public authenticateRotationToken(rawToken: string | undefined): RotationTokenPrincipal {
    if (rawToken === undefined || rawToken.length === 0) {
      throw new AppError('AUTH_REQUIRED', 'A device bearer token is required.', 401);
    }
    const hash = hashToken(rawToken, this.config.tokenPepper);
    const row = this.db.prepare(`
      SELECT d.*, r.id AS rotation_id, r.state AS rotation_state, r.grace_expires_at,
        t.id AS replacement_token_id, t.revoked_at AS replacement_token_revoked_at
      FROM device_token_rotations r JOIN devices d ON d.id = r.device_id
      LEFT JOIN device_tokens t ON t.token_hash = r.new_token_hash
      WHERE r.new_token_hash = ?
    `).get(hash) as (DeviceRow & {
      rotation_id: string;
      rotation_state: 'ROTATION_PENDING' | 'CLAIMED' | 'ACKNOWLEDGED' | 'CANCELLED' | 'EXPIRED';
      grace_expires_at: string;
      replacement_token_id: string | null;
      replacement_token_revoked_at: string | null | undefined;
    }) | undefined;
    if (row === undefined) {
      throw new AppError('AUTH_INVALID', 'The rotation token is invalid.', 401);
    }
    if (row.retired_at !== null || !row.active) {
      throw new AppError('DEVICE_INACTIVE', 'This device is inactive.', 403);
    }
    if (row.rotation_state === 'CLAIMED' && new Date(row.grace_expires_at) <= new Date()) {
      throw new AppError('TOKEN_ROTATION_EXPIRED', 'This token rotation is expired or unavailable.', 409);
    }
    if (row.rotation_state !== 'CLAIMED' && row.rotation_state !== 'ACKNOWLEDGED') {
      throw new AppError('TOKEN_ROTATION_EXPIRED', 'This token rotation is expired or unavailable.', 409);
    }
    if (row.rotation_state === 'ACKNOWLEDGED' && row.replacement_token_id === null) {
      throw new AppError('TOKEN_ROTATION_EXPIRED', 'This token rotation is expired or unavailable.', 409);
    }
    if (row.replacement_token_revoked_at !== null) {
      throw new AppError('DEVICE_TOKEN_REVOKED', 'This device token has been revoked.', 401);
    }
    return { principal: devicePrincipal(row), rotationId: row.rotation_id };
  }

  public getDevice(id: string): DeviceDTO | null {
    const row = this.db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceRow | undefined;
    return row === undefined ? null : mapDevice(row, this.getPresence(row));
  }

  public getDevicePrincipal(id: string): DevicePrincipal {
    return devicePrincipal(this.getDeviceRow(id));
  }

  public listDevices(): DeviceDTO[] {
    return (this.db.prepare('SELECT * FROM devices WHERE retired_at IS NULL ORDER BY display_name').all() as DeviceRow[]).map((row) => mapDevice(row, this.getPresence(row)));
  }

  public patchDevice(principal: AdminPrincipal, id: string, input: DevicePatchInput, requestId: string): DeviceDTO {
    const existing = this.getDeviceRow(id);
    if (existing.retired_at !== null) {
      throw new AppError('RESOURCE_CONFLICT', 'A retired device cannot be reactivated.', 409);
    }
    const nextActive = input.active ?? Boolean(existing.active);
    const now = new Date().toISOString();
    const result = this.mutate(() => {
      if (nextActive && existing.assignment_mode === 'ROOM') {
        this.assertActiveRoomAssignmentAvailable(existing.room_id ?? this.assertImpossible('Room assignment is missing.'), id);
      }
      try {
        this.db.prepare('UPDATE devices SET display_name = ?, active = ?, updated_at = ? WHERE id = ?').run(input.displayName ?? existing.display_name, nextActive ? 1 : 0, now, id);
      } catch (error) {
        if (isSqliteConstraintError(error)) {
          throw conflictError('An active ROOM device is already assigned to this room.');
        }
        throw error;
      }
      if (!nextActive && existing.active) {
        this.db.prepare('UPDATE device_tokens SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL').run(now, id);
      }
      const revision = this.bumpConfiguration();
      this.audit({ actorType: 'ADMIN', actorId: principal.adminId }, nextActive ? 'DEVICE_ACTIVATED' : 'DEVICE_DEACTIVATED', 'DEVICE', id, requestId, {});
      this.appendDeviceConfigEvent(id, revision, existing.device_config_version, existing.assignment_mode, existing.room_id, existing.area_id, nextActive ? 'DEVICE_ACTIVATED' : 'DEVICE_DEACTIVATED');
      if (!nextActive && existing.active && existing.assignment_mode === 'ROOM' && existing.room_id !== null) {
        this.clearRoomDoNotDisturb(existing.room_id, { actorType: 'ADMIN', actorId: principal.adminId }, requestId);
      }
      return this.getDevice(id) ?? this.assertImpossible('Updated device disappeared.');
    });
    if (!nextActive && Boolean(existing.active)) {
      this.notifySecurityChange({ kind: 'DEVICE', id });
    }
    return result;
  }

  public assignDevice(principal: AdminPrincipal, id: string, input: DeviceAssignmentInput, requestId: string): DeviceAssignmentResult {
    const existing = this.getDeviceRow(id);
    if (existing.retired_at !== null) {
      throw conflictError('A retired device cannot be reassigned.');
    }
    if (existing.device_config_version !== input.expectedDeviceConfigVersion) {
      throw new AppError('VERSION_CONFLICT', 'The device configuration changed before this action was applied.', 409, { currentVersion: existing.device_config_version });
    }
    const assignment = this.resolveAssignment(input.assignmentMode, input.roomId ?? null, input.areaId ?? null);
    const nextVersion = existing.device_config_version + 1;
    const now = new Date().toISOString();
    return this.mutate(() => {
      if (existing.active && input.assignmentMode === 'ROOM') {
        this.assertActiveRoomAssignmentAvailable(assignment.roomId ?? this.assertImpossible('Room assignment is missing.'), id);
      }
      try {
        this.db.prepare('UPDATE devices SET assignment_mode = ?, room_id = ?, area_id = ?, device_config_version = ?, updated_at = ? WHERE id = ? AND device_config_version = ?').run(
          input.assignmentMode, assignment.roomId, assignment.areaId, nextVersion, now, id, input.expectedDeviceConfigVersion
        );
      } catch (error) {
        if (isSqliteConstraintError(error)) {
          throw conflictError('An active ROOM device is already assigned to this room.');
        }
        throw error;
      }
      const revision = this.bumpConfiguration();
      this.audit({ actorType: 'ADMIN', actorId: principal.adminId }, 'DEVICE_ASSIGNMENT_CHANGED', 'DEVICE', id, requestId, { reason: input.reason, assignmentMode: input.assignmentMode });
      this.appendDeviceConfigEvent(id, revision, nextVersion, input.assignmentMode, assignment.roomId, assignment.areaId, 'ASSIGNMENT_CHANGED');
      if (existing.assignment_mode === 'ROOM' && existing.room_id !== null && (input.assignmentMode !== 'ROOM' || assignment.roomId !== existing.room_id)) {
        this.clearRoomDoNotDisturb(existing.room_id, { actorType: 'ADMIN', actorId: principal.adminId }, requestId);
      }
      return { device: this.getDevice(id) ?? this.assertImpossible('Assigned device disappeared.'), configurationRevision: revision };
    });
  }

  public startTokenRotation(principal: AdminPrincipal, deviceId: string, gracePeriodMinutes: number, reason: string, requestId: string): TokenRotationResult {
    const device = this.getDeviceRow(deviceId);
    const activeToken = this.db.prepare('SELECT id FROM device_tokens WHERE device_id = ? AND revoked_at IS NULL').get(deviceId) as { id: string } | undefined;
    if (activeToken === undefined) {
      throw new AppError('DEVICE_TOKEN_REVOKED', 'The device has no active token.', 409);
    }
    const pending = this.db.prepare("SELECT id FROM device_token_rotations WHERE device_id = ? AND state IN ('ROTATION_PENDING', 'CLAIMED')").get(deviceId) as { id: string } | undefined;
    if (pending !== undefined) {
      throw conflictError('A token rotation is already pending for this device.');
    }
    const rotationId = createId('rot');
    const now = new Date();
    const graceExpiresAt = new Date(now.getTime() + gracePeriodMinutes * 60000).toISOString();
    const revision = this.mutate(() => {
      this.db.prepare('INSERT INTO device_token_rotations(id, device_id, previous_token_id, state, created_at, grace_expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        rotationId, deviceId, activeToken.id, 'ROTATION_PENDING', now.toISOString(), graceExpiresAt
      );
      const nextRevision = this.bumpConfiguration();
      this.audit({ actorType: 'ADMIN', actorId: principal.adminId }, 'DEVICE_TOKEN_ROTATION_STARTED', 'DEVICE', deviceId, requestId, { reason });
      this.appendOutbox('device.token.rotation.required', 'DEVICE', deviceId, device.device_config_version, { deviceId, rotationId, state: 'ROTATION_PENDING', graceExpiresAt, configurationRevision: nextRevision });
      return nextRevision;
    });
    void revision;
    return { rotationId, state: 'ROTATION_PENDING', graceExpiresAt };
  }

  public claimTokenRotation(principal: DevicePrincipal, rotationId: string): ClaimedTokenResult {
    const rotation = this.db.prepare('SELECT id, device_id, state, grace_expires_at, new_token_prefix FROM device_token_rotations WHERE id = ? AND device_id = ?').get(rotationId, principal.deviceId) as {
      id: string;
      device_id: string;
      state: string;
      grace_expires_at: string;
      new_token_prefix: string | null;
    } | undefined;
    if (rotation === undefined || rotation.state === 'CANCELLED' || rotation.state === 'EXPIRED' || new Date(rotation.grace_expires_at) <= new Date()) {
      throw new AppError('TOKEN_ROTATION_EXPIRED', 'This token rotation is expired or unavailable.', 409);
    }
    if (rotation.state === 'CLAIMED') {
      throw new AppError('TOKEN_ROTATION_EXPIRED', 'The replacement token was already claimed and cannot be recovered.', 409);
    }
    const rawToken = createRawToken();
    const now = new Date().toISOString();
    return this.mutate(() => {
      this.db.prepare("UPDATE device_token_rotations SET new_token_hash = ?, new_token_prefix = ?, state = 'CLAIMED', claimed_at = ? WHERE id = ? AND state = 'ROTATION_PENDING'").run(
        hashToken(rawToken, this.config.tokenPepper), rawToken.slice(0, 8), now, rotationId
      );
      return { rotationId, deviceToken: rawToken, tokenPrefix: rawToken.slice(0, 8) };
    });
  }

  public acknowledgeTokenRotation(principal: RotationTokenPrincipal, rotationId: string, requestId: string): void {
    if (rotationId !== principal.rotationId) {
      throw new AppError('TOKEN_ROTATION_MISMATCH', 'The rotation identifier does not match the replacement token.', 409);
    }
    const now = new Date();
    const changed = this.mutate(() => {
      const rotation = this.db.prepare('SELECT previous_token_id, new_token_hash, new_token_prefix, state, grace_expires_at FROM device_token_rotations WHERE id = ? AND device_id = ?').get(principal.rotationId, principal.principal.deviceId) as {
        previous_token_id: string;
        new_token_hash: string | null;
        new_token_prefix: string | null;
        state: 'ROTATION_PENDING' | 'CLAIMED' | 'ACKNOWLEDGED' | 'CANCELLED' | 'EXPIRED';
        grace_expires_at: string;
      } | undefined;
      if (rotation === undefined || rotation.state === 'CANCELLED' || rotation.state === 'EXPIRED' || rotation.new_token_hash === null || rotation.new_token_prefix === null) {
        throw new AppError('TOKEN_ROTATION_EXPIRED', 'This token rotation is expired or unavailable.', 409);
      }
      if (rotation.state === 'ACKNOWLEDGED') {
        return false;
      }
      if (rotation.state !== 'CLAIMED' || new Date(rotation.grace_expires_at) <= now) {
        throw new AppError('TOKEN_ROTATION_EXPIRED', 'This token rotation is expired or unavailable.', 409);
      }
      const issuedAt = now.toISOString();
      const tokenId = createId('tok');
      this.db.prepare('INSERT INTO device_tokens(id, device_id, token_hash, token_prefix, issued_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        tokenId,
        principal.principal.deviceId,
        rotation.new_token_hash,
        rotation.new_token_prefix,
        issuedAt,
        issuedAt
      );
      this.db.prepare('UPDATE device_tokens SET revoked_at = ?, replaced_by_token_id = ? WHERE id = ? AND revoked_at IS NULL').run(issuedAt, tokenId, rotation.previous_token_id);
      this.db.prepare('UPDATE device_tokens SET revoked_at = NULL WHERE id = ?').run(tokenId);
      this.db.prepare("UPDATE device_token_rotations SET state = 'ACKNOWLEDGED', acknowledged_at = ? WHERE id = ? AND state = 'CLAIMED'").run(issuedAt, principal.rotationId);
      const device = this.getDeviceRow(principal.principal.deviceId);
      const revision = this.bumpConfiguration();
      this.audit({ actorType: 'DEVICE', actorId: principal.principal.deviceId }, 'DEVICE_TOKEN_ROTATION_ACKNOWLEDGED', 'DEVICE', principal.principal.deviceId, requestId, { rotationId });
      this.appendDeviceConfigEvent(device.id, revision, device.device_config_version, device.assignment_mode, device.room_id, device.area_id, 'TOKEN_ROTATED');
      return true;
    });
    if (changed) {
      this.notifySecurityChange({ kind: 'DEVICE', id: principal.principal.deviceId });
    }
  }

  public revokeDeviceToken(principal: AdminPrincipal, deviceId: string, requestId: string): void {
    this.getDeviceRow(deviceId);
    const now = new Date().toISOString();
    this.mutate(() => {
      this.db.prepare('UPDATE device_tokens SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL').run(now, deviceId);
      this.audit({ actorType: 'ADMIN', actorId: principal.adminId }, 'DEVICE_TOKEN_REVOKED', 'DEVICE', deviceId, requestId, {});
    });
    this.notifySecurityChange({ kind: 'DEVICE', id: deviceId });
  }

  public retireDevice(principal: AdminPrincipal, deviceId: string, idempotencyKey: string | undefined, requestId: string): MutationResult<DeviceRetirementResult> {
    const key = validateIdempotencyKey(idempotencyKey);
    const actor: Actor = { actorType: 'ADMIN', actorId: principal.adminId };
    const requestHash = hashJson({ deviceId });
    const result = this.mutate(() => {
      const replay = this.getIdempotentResult<DeviceRetirementResult>(actor, key, 'device.retire', requestHash);
      if (replay !== undefined) {
        return { data: replay, idempotentReplay: true };
      }

      const existing = this.getDeviceRow(deviceId);
      if (existing.retired_at !== null) {
        throw new AppError('RESOURCE_CONFLICT', 'The device is already retired.', 409);
      }
      const retiredAt = new Date().toISOString();
      this.db.prepare('UPDATE devices SET active = 0, retired_at = ?, updated_at = ? WHERE id = ? AND retired_at IS NULL').run(retiredAt, retiredAt, deviceId);
      this.db.prepare('UPDATE device_tokens SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL').run(retiredAt, deviceId);
      this.db.prepare("UPDATE device_token_rotations SET state = 'CANCELLED', cancelled_at = ? WHERE device_id = ? AND state IN ('ROTATION_PENDING', 'CLAIMED')").run(retiredAt, deviceId);
      if (existing.assignment_mode === 'ROOM' && existing.room_id !== null) {
        this.clearRoomDoNotDisturb(existing.room_id, { actorType: 'ADMIN', actorId: principal.adminId }, requestId);
      }
      const configurationRevision = this.bumpConfiguration();
      this.audit({ actorType: 'ADMIN', actorId: principal.adminId }, 'DEVICE_RETIRED', 'DEVICE', deviceId, requestId, { retiredAt });
      this.appendDeviceConfigEvent(deviceId, configurationRevision, existing.device_config_version, existing.assignment_mode, existing.room_id, existing.area_id, 'DEVICE_RETIRED');
      const data = { deviceId, retiredAt } satisfies DeviceRetirementResult;
      this.storeIdempotency(actor, key, 'device.retire', requestHash, data, 200, deviceId);
      return { data, idempotentReplay: false, configurationRevision };
    });
    this.notifySecurityChange({ kind: 'DEVICE', id: deviceId });
    return result;
  }

  public rebindDevice(principal: AdminPrincipal, input: DeviceRebindInput, idempotencyKey: string | undefined, requestId: string): MutationResult<DeviceBootstrapResult> {
    const key = validateIdempotencyKey(idempotencyKey);
    const actor: Actor = { actorType: 'ADMIN', actorId: principal.adminId };
    const requestHash = hashJson(input);
    const result = this.mutate(() => {
      const replay = this.getIdempotentResult<StoredRebindResult>(actor, key, 'device.rebind', requestHash);
      if (replay !== undefined) {
        return {
          data: {
            device: replay.device,
            deviceToken: decryptIdempotencySecret(replay.encryptedDeviceToken, this.config.tokenPepper),
            tokenPrefix: replay.tokenPrefix,
            configurationRevision: replay.configurationRevision
          },
          idempotentReplay: true
        };
      }

      const device = this.getDeviceRow(input.deviceId);
      if (!device.active) {
        throw new AppError('DEVICE_INACTIVE', 'An inactive device cannot be rebound.', 409);
      }
      const tokenId = createId('tok');
      const rawToken = createRawToken();
      const now = new Date().toISOString();
      this.db.prepare('UPDATE device_tokens SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL').run(now, input.deviceId);
      this.db.prepare("UPDATE device_token_rotations SET state = 'CANCELLED', cancelled_at = ? WHERE device_id = ? AND state IN ('ROTATION_PENDING', 'CLAIMED')").run(now, input.deviceId);
      this.db.prepare('INSERT INTO device_tokens(id, device_id, token_hash, token_prefix, issued_at) VALUES (?, ?, ?, ?, ?)').run(
        tokenId, input.deviceId, hashToken(rawToken, this.config.tokenPepper), rawToken.slice(0, 8), now
      );
      this.db.prepare('UPDATE devices SET updated_at = ? WHERE id = ?').run(now, input.deviceId);
      const revision = this.bumpConfiguration();
      this.audit({ actorType: 'ADMIN', actorId: principal.adminId }, 'DEVICE_REBOUND', 'DEVICE', input.deviceId, requestId, { reason: input.reason });
      this.appendDeviceConfigEvent(device.id, revision, device.device_config_version, device.assignment_mode, device.room_id, device.area_id, 'TOKEN_ROTATED');
      const rebound = this.getDevice(input.deviceId) ?? this.assertImpossible('Rebound device disappeared.');
      const data: DeviceBootstrapResult = { device: rebound, deviceToken: rawToken, tokenPrefix: rawToken.slice(0, 8), configurationRevision: revision };
      this.storeIdempotency(actor, key, 'device.rebind', requestHash, {
        device: rebound,
        encryptedDeviceToken: encryptIdempotencySecret(rawToken, this.config.tokenPepper),
        tokenPrefix: data.tokenPrefix,
        configurationRevision: revision
      } satisfies StoredRebindResult, 200, input.deviceId);
      return { data, idempotentReplay: false };
    });
    this.notifySecurityChange({ kind: 'DEVICE', id: input.deviceId });
    return result;
  }

  public recordHeartbeat(principal: DevicePrincipal, input: { clientVersion?: string; socketConnected?: boolean }, sourceIp: string | undefined, userAgent: string | undefined): void {
    const device = this.getDeviceRow(principal.deviceId);
    if (device.retired_at !== null || !device.active) {
      throw new AppError('DEVICE_INACTIVE', 'This device is inactive.', 403);
    }
    const now = new Date().toISOString();
    this.db.prepare('UPDATE devices SET last_seen_at = ?, last_heartbeat_at = ?, last_ip = ?, last_user_agent = ?, client_version = ?, updated_at = ? WHERE id = ? AND active = 1').run(
      now, now, sourceIp ?? null, userAgent ?? null, input.clientVersion ?? null, now, principal.deviceId
    );
    this.db.prepare('INSERT INTO device_heartbeat_log(device_id, observed_at, client_version, source_ip, socket_connected) VALUES (?, ?, ?, ?, ?)').run(
      principal.deviceId, now, input.clientVersion ?? null, sourceIp ?? null, input.socketConnected === false ? 0 : 1
    );
  }

  public getDeviceSnapshot(principal: DevicePrincipal): DeviceSyncSnapshot {
    const readSnapshot = this.db.transaction(() => {
      const sequenceRow = this.db.prepare('SELECT COALESCE(MAX(id), 0) AS sequence FROM outbox_events').get() as { sequence: number };
      const device = this.getDeviceRow(principal.deviceId);
      const config = this.getDeviceConfig(device);
      const requestFilters: RequestFilters = {
        statuses: ['PENDING', 'ACCEPTED', 'IN_PROGRESS'],
        limit: 100
      };
      if (principal.assignmentMode === 'ROOM' && principal.roomId !== null) {
        requestFilters.roomId = principal.roomId;
      }
      if (principal.assignmentMode === 'AREA' && principal.areaId !== null) {
        requestFilters.areaId = principal.areaId;
      }
      const activeRequests = this.listRequests(requestFilters);
      const activeDoNotDisturbRooms = principal.assignmentMode === 'AREA'
        ? this.listActiveDoNotDisturbRooms()
        : undefined;
      const rotation = this.db.prepare("SELECT id, state, grace_expires_at FROM device_token_rotations WHERE device_id = ? AND state IN ('ROTATION_PENDING', 'CLAIMED') ORDER BY created_at DESC LIMIT 1").get(principal.deviceId) as {
        id: string;
        state: 'ROTATION_PENDING' | 'CLAIMED';
        grace_expires_at: string;
      } | undefined;
      const pendingTokenRotation: PendingTokenRotation | null = rotation === undefined ? null : {
        rotationId: rotation.id,
        state: rotation.state,
        graceExpiresAt: rotation.grace_expires_at
      };
      return {
        snapshotSequence: sequenceRow.sequence,
        currentEventSequence: sequenceRow.sequence,
        configurationRevision: this.getConfigurationRevision(),
        deviceConfigVersion: device.device_config_version,
        serverTime: new Date().toISOString(),
         device: mapDevice(device, this.getPresence(device)),
         config,
         activeRequests,
         ...(activeDoNotDisturbRooms === undefined ? {} : { activeDoNotDisturbRooms }),
         pendingTokenRotation
       };
    });
    return readSnapshot();
  }

  public getRoomServices(principal: DevicePrincipal): ServiceDTO[] {
    if (principal.assignmentMode !== 'ROOM' || principal.roomId === null) {
      throw new AppError('FORBIDDEN_ASSIGNMENT', 'Only ROOM devices can read room services.', 403);
    }
    const room = this.getRoomRow(principal.roomId);
    if (!room.active) {
      throw new AppError('INACTIVE_DEPENDENCY', 'The assigned room is inactive.', 409);
    }
    return this.listServices(true);
  }

  private listActiveDoNotDisturbRooms(): CompactRoom[] {
    const rows = this.db.prepare(
      `SELECT r.id, r.code, r.display_name, r.do_not_disturb
       FROM rooms r
       WHERE r.active = 1 AND r.do_not_disturb = 1
         AND EXISTS (
           SELECT 1 FROM devices d
           WHERE d.assignment_mode = 'ROOM' AND d.room_id = r.id AND d.active = 1 AND d.retired_at IS NULL
         )
       ORDER BY r.display_order, r.code, r.id`
    ).all() as Array<Pick<RoomRow, 'id' | 'code' | 'display_name' | 'do_not_disturb'>>;
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      displayName: row.display_name,
      doNotDisturb: Boolean(row.do_not_disturb)
    }));
  }

  public createRequest(principal: DevicePrincipal, serviceId: string, idempotencyKey: string | undefined, requestId: string): MutationResult<RequestDTO> {
    if (principal.assignmentMode !== 'ROOM' || principal.roomId === null) {
      throw new AppError('FORBIDDEN_ASSIGNMENT', 'Only ROOM devices can create requests.', 403);
    }
    const key = validateIdempotencyKey(idempotencyKey);
    const requestHash = hashJson({ serviceId });
    const actor: Actor = { actorType: 'DEVICE', actorId: principal.deviceId };
    const now = new Date().toISOString();
    return this.mutate(() => {
      const replay = this.getIdempotentResult<RequestDTO>(actor, key, 'request.create', requestHash);
      if (replay !== undefined) {
        return { data: replay, idempotentReplay: true };
      }
      const room = this.getRoomRow(principal.roomId ?? this.assertImpossible('Room assignment is missing.'));
      const service = this.getServiceRow(serviceId);
      const area = this.getAreaRow(service.area_id);
      if (!room.active || !service.active || !area.active) {
        throw new AppError('INACTIVE_DEPENDENCY', 'The room, service, and responsible area must all be active.', 409);
      }
      if (room.do_not_disturb) {
        throw new AppError('RESOURCE_CONFLICT', 'Room service requests are unavailable while do-not-disturb is enabled.', 409);
      }
      const id = createId('req');
      this.db.prepare(`INSERT INTO requests(
        id, room_id, service_id, responsible_area_id, status, version, created_by_actor_type, created_by_actor_id,
        room_code_snapshot, room_display_name_snapshot, service_code_snapshot, service_display_name_snapshot,
        area_code_snapshot, area_display_name_snapshot, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'PENDING', 1, 'DEVICE', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, room.id, service.id, area.id, principal.deviceId, room.code, room.display_name, service.code, service.display_name,
        area.code, area.display_name, now, now
      );
      const request = this.getRequest(id) ?? this.assertImpossible('Created request disappeared.');
      this.db.prepare('INSERT INTO request_status_history(id, request_id, from_status, to_status, actor_type, actor_id, request_version, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)').run(
        createId('hist'), id, 'PENDING', actor.actorType, actor.actorId, 1, now
      );
      this.audit(actor, 'REQUEST_CREATED', 'REQUEST', id, requestId, {});
      this.appendOutbox('request.created', 'REQUEST', id, 1, { request, alert: { repeatUntil: 'ACCEPTED' } });
      this.storeIdempotency(actor, key, 'request.create', requestHash, request, 201, id);
      return { data: request, idempotentReplay: false };
    });
  }

  public transitionRequest(principal: Principal, requestIdValue: string, targetStatus: RequestStatus, expectedVersion: number, idempotencyKey: string | undefined, requestId: string): MutationResult<RequestDTO> {
    const key = validateIdempotencyKey(idempotencyKey);
    const request = this.getRequestRow(requestIdValue);
    const scope = requestScope(request);
    if (!canTransitionRequest(principal, scope)) {
      throw new AppError('FORBIDDEN_ASSIGNMENT', 'This principal cannot transition the request.', 403);
    }
    if (principal.kind === 'SYSTEM') {
      throw new AppError('FORBIDDEN_ASSIGNMENT', 'System principals cannot transition requests.', 403);
    }
    const actor: Actor = principal.kind === 'ADMIN'
      ? { actorType: 'ADMIN', actorId: principal.adminId }
      : { actorType: 'DEVICE', actorId: principal.deviceId };
    const requestHash = hashJson({ expectedVersion });
    return this.mutate(() => {
      const replay = this.getIdempotentResult<RequestDTO>(actor, key, `request.transition.${targetStatus}`, requestHash);
      if (replay !== undefined) {
        return { data: replay, idempotentReplay: true };
      }
      const current = this.getRequestRow(requestIdValue);
      if (current.version !== expectedVersion) {
        throw new AppError('REQUEST_VERSION_CONFLICT', 'The request changed before this action was applied.', 409, { currentStatus: current.status, currentVersion: current.version, request: this.mapRequest(current) });
      }
      assertLegalRequestTransition(current.status, targetStatus);
      const now = new Date().toISOString();
      const timestampColumn = targetStatus === 'ACCEPTED' ? 'accepted_at' : targetStatus === 'IN_PROGRESS' ? 'in_progress_at' : 'completed_at';
      this.db.prepare(`UPDATE requests SET status = ?, version = version + 1, ${timestampColumn} = ?, updated_at = ? WHERE id = ? AND version = ?`).run(
        targetStatus, now, now, requestIdValue, expectedVersion
      );
      const committed = this.getRequestRow(requestIdValue);
      this.db.prepare('INSERT INTO request_status_history(id, request_id, from_status, to_status, actor_type, actor_id, request_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        createId('hist'), requestIdValue, current.status, targetStatus, actor.actorType, actor.actorId, committed.version, now
      );
      this.audit(actor, 'REQUEST_STATUS_CHANGED', 'REQUEST', requestIdValue, requestId, { fromStatus: current.status, toStatus: targetStatus });
      const data = this.mapRequest(committed);
      this.appendOutbox('request.updated', 'REQUEST', requestIdValue, committed.version, { request: data, transition: { from: current.status, to: targetStatus, actorType: actor.actorType, actorId: actor.actorId } });
      this.storeIdempotency(actor, key, `request.transition.${targetStatus}`, requestHash, data, 200, requestIdValue);
      return { data, idempotentReplay: false };
    });
  }

  public getAuthorizedRequest(principal: Principal, requestIdValue: string): RequestDTO {
    const row = this.getRequestRow(requestIdValue);
    if (!canReadRequest(principal, requestScope(row))) {
      throw new AppError('FORBIDDEN_ASSIGNMENT', 'This principal cannot read the request.', 403);
    }
    return this.mapRequest(row);
  }

  public listRequests(filters: RequestFilters = {}): RequestDTO[] {
    return this.listRequestsPage(filters).data;
  }

  public listRequestsPage(filters: RequestFilters = {}): RequestPage {
    const clauses: string[] = [];
    const values: Array<string | number> = [];
    const filterKey = requestFilterKey(filters);
    const cursor = filters.cursor === undefined ? undefined : decodeRequestCursor(filters.cursor);
    if (cursor !== undefined && cursor.filterKey !== filterKey) {
      throw validationError('The request cursor does not match the supplied filters.');
    }
    if (filters.statuses !== undefined && filters.statuses.length > 0) {
      clauses.push(`r.status IN (${filters.statuses.map(() => '?').join(', ')})`);
      values.push(...filters.statuses);
    }
    if (filters.roomId !== undefined) {
      clauses.push('r.room_id = ?');
      values.push(filters.roomId);
    }
    if (filters.serviceId !== undefined) {
      clauses.push('r.service_id = ?');
      values.push(filters.serviceId);
    }
    if (filters.areaId !== undefined) {
      clauses.push('r.responsible_area_id = ?');
      values.push(filters.areaId);
    }
    if (filters.deviceId !== undefined) {
      clauses.push("r.created_by_actor_type = 'DEVICE' AND r.created_by_actor_id = ?");
      values.push(filters.deviceId);
    }
    if (filters.createdFrom !== undefined) {
      clauses.push('r.created_at >= ?');
      values.push(filters.createdFrom);
    }
    if (filters.createdTo !== undefined) {
      clauses.push('r.created_at < ?');
      values.push(filters.createdTo);
    }
    if (filters.search !== undefined && filters.search.trim() !== '') {
      clauses.push('(r.room_code_snapshot LIKE ? OR r.service_display_name_snapshot LIKE ? OR r.area_display_name_snapshot LIKE ?)');
      const search = `%${filters.search.trim()}%`;
      values.push(search, search, search);
    }
    if (cursor !== undefined) {
      clauses.push('(r.created_at < ? OR (r.created_at = ? AND r.id < ?))');
      values.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const limit = Math.min(Math.max(filters.limit ?? this.getSettings()['requests.pageSizeDefault'], 1), this.config.requestPageSizeMax, REQUEST_PAGE_SIZE_CAP);
    values.push(limit + 1);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
     const rows = this.db.prepare(`SELECT r.*, rooms.do_not_disturb AS room_do_not_disturb, services.icon_key AS service_icon_key FROM requests r JOIN rooms ON rooms.id = r.room_id JOIN services ON services.id = r.service_id ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT ?`).all(...values) as RequestRow[];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = pageRows[pageRows.length - 1];
    return {
      data: pageRows.map((row) => this.mapRequest(row, filters.includeCreator === true)),
      page: {
        hasMore,
        nextCursor: hasMore && lastRow !== undefined ? encodeRequestCursor({ filterKey, createdAt: lastRow.created_at, id: lastRow.id }) : null
      }
    };
  }

  public listRoomRequests(principal: DevicePrincipal): RequestDTO[] {
    return this.listRoomRequestsPage(principal).data;
  }

  public listRoomRequestsPage(principal: DevicePrincipal, filters: RequestFilters = {}): RequestPage {
    if (principal.assignmentMode !== 'ROOM' || principal.roomId === null) {
      throw new AppError('FORBIDDEN_ASSIGNMENT', 'Only ROOM devices can read room requests.', 403);
    }
    return this.listRequestsPage({ ...filters, roomId: principal.roomId, limit: filters.limit ?? 50 });
  }

  public listAreaRequests(principal: DevicePrincipal): RequestDTO[] {
    return this.listAreaRequestsPage(principal).data;
  }

  public listAreaRequestsPage(principal: DevicePrincipal, filters: RequestFilters = {}): RequestPage {
    if (principal.assignmentMode !== 'AREA' || principal.areaId === null) {
      throw new AppError('FORBIDDEN_ASSIGNMENT', 'Only AREA devices can read area requests.', 403);
    }
    return this.listRequestsPage({
      ...filters,
      areaId: principal.areaId,
      statuses: filters.statuses ?? ['PENDING', 'ACCEPTED', 'IN_PROGRESS'],
      limit: filters.limit ?? 100
    });
  }

  public getRequestHistory(principal: Principal, requestIdValue: string): RequestHistoryDTO[] {
    const request = this.getRequestRow(requestIdValue);
    if (!canReadRequest(principal, requestScope(request))) {
      throw new AppError('FORBIDDEN_ASSIGNMENT', 'This principal cannot read request history.', 403);
    }
    const rows = this.db.prepare('SELECT * FROM request_status_history WHERE request_id = ? ORDER BY created_at').all(requestIdValue) as HistoryRow[];
    return rows.map((row) => ({ id: row.id, requestId: row.request_id, fromStatus: row.from_status, toStatus: row.to_status, actorType: row.actor_type, actorId: row.actor_id, requestVersion: row.request_version, createdAt: row.created_at }));
  }

  public updateSettings(principal: AdminPrincipal, changes: Record<string, unknown>, requestId: string): SettingDTO[] {
    const validation = validateSettings(changes, this.getSettings());
    if (!validation.ok) {
      throw new AppError('SETTING_INVALID', 'One or more settings are invalid.', 422, validation.errors);
    }
    const now = new Date().toISOString();
    return this.mutate(() => {
      for (const [key] of Object.entries(changes)) {
        if (isSettingKey(key)) {
          this.db.prepare('UPDATE system_settings SET value_json = ?, updated_at = ?, updated_by_admin_id = ? WHERE key = ?').run(JSON.stringify(validation.values[key]), now, principal.adminId, key);
        }
      }
      const revision = this.bumpConfiguration();
      this.audit({ actorType: 'ADMIN', actorId: principal.adminId }, 'SETTINGS_UPDATED', 'SYSTEM', 'settings', requestId, { changedKeys: Object.keys(changes) });
      this.appendOutbox('system.maintenance', 'SYSTEM', 'settings', null, { message: `Configuration revision ${revision} applied.`, severity: 'INFO' });
      return this.listSettings();
    });
  }

  public getAuditLog(limit = 100): AuditLogDTO[] {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const rows = this.db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(safeLimit) as Array<{
      id: number; actor_type: ActorType; actor_id: string | null; action: string; entity_type: string | null; entity_id: string | null; request_id: string | null; metadata_json: string | null; created_at: string;
    }>;
    return rows.map((row) => ({ id: row.id, actorType: row.actor_type, actorId: row.actor_id, action: row.action, entityType: row.entity_type, entityId: row.entity_id, requestId: row.request_id, metadata: row.metadata_json === null ? null : parseMetadata(row.metadata_json), createdAt: row.created_at }));
  }

  public getAdminSnapshot(): AdminSystemSnapshot {
    const rooms = this.listRooms();
    const areas = this.listAreas();
    const services = this.listServices();
    const devices = this.listDevices();
    const requests = this.listRequests({ limit: 100, includeCreator: true });
    const admins = this.listAdmins();
    const settings = this.listSettings();
    const auditLog = this.getAuditLog(100);
    const warnings: AdminWarningCode[] = [];
    if (areas.every((area) => !area.active)) warnings.push('NO_ACTIVE_AREAS');
    if (services.some((service) => service.active && !areas.some((area) => area.id === service.areaId && area.active))) warnings.push('ACTIVE_SERVICE_WITHOUT_AREA');
    if (rooms.some((room) => room.active && services.every((service) => !service.active))) warnings.push('ACTIVE_ROOM_WITHOUT_SERVICE');
    if (devices.some((device) => device.active && ((device.assignmentMode === 'ROOM' && !rooms.some((room) => room.id === device.roomId && room.active)) || (device.assignmentMode === 'AREA' && !areas.some((area) => area.id === device.areaId && area.active))))) warnings.push('INVALID_ACTIVE_DEVICE_ASSIGNMENT');
    return { configurationRevision: this.getConfigurationRevision(), rooms, areas, services, devices, requests, admins, settings, auditLog, outboxBacklog: this.getOutboxBacklog(), warnings };
  }

  public getReplayPlan(lastSeenEventSequence: number | undefined, deviceConfigVersion: number | undefined, principal: Principal): ReplayPlan {
    const settings = this.getSettings();
    const current = (this.db.prepare('SELECT COALESCE(MAX(id), 0) AS sequence FROM outbox_events').get() as { sequence: number }).sequence;
    if (principal.kind === 'DEVICE' && deviceConfigVersion !== undefined) {
      const device = this.getDeviceRow(principal.deviceId);
      if (device.device_config_version !== deviceConfigVersion) {
        return { sync: 'FULL_SNAPSHOT_REQUIRED', reason: 'DEVICE_CONFIG_MISMATCH', currentEventSequence: current, events: [] };
      }
    }
    if (lastSeenEventSequence === undefined || lastSeenEventSequence > current) {
      return { sync: 'FULL_SNAPSHOT_REQUIRED', reason: 'EVENT_GAP', currentEventSequence: current, events: [] };
    }
    const cursor = lastSeenEventSequence ?? 0;
    if (cursor >= current) {
      return { sync: 'UP_TO_DATE', currentEventSequence: current, events: [] };
    }
    const oldest = this.db.prepare('SELECT MIN(id) AS sequence FROM outbox_events').get() as { sequence: number | null };
    if (oldest.sequence !== null && cursor < oldest.sequence - 1) {
      return { sync: 'FULL_SNAPSHOT_REQUIRED', reason: 'EVENT_GAP', currentEventSequence: current, events: [] };
    }
    const available = (this.db.prepare('SELECT COUNT(*) AS count FROM outbox_events WHERE id > ?').get(cursor) as { count: number }).count;
    if (available > settings['realtime.replayMaxEvents']) {
      return { sync: 'FULL_SNAPSHOT_REQUIRED', reason: 'EVENT_GAP', currentEventSequence: current, events: [] };
    }
    if (principal.kind === 'DEVICE') {
      const maintenance = this.db.prepare("SELECT id FROM outbox_events WHERE id > ? AND event_name = 'system.maintenance' LIMIT 1").get(cursor) as { id: number } | undefined;
      if (maintenance !== undefined) {
        return { sync: 'FULL_SNAPSHOT_REQUIRED', reason: 'EVENT_GAP', currentEventSequence: current, events: [] };
      }
    }
    const events = (this.db.prepare('SELECT * FROM outbox_events WHERE id > ? ORDER BY id LIMIT ?').all(cursor, settings['realtime.replayMaxEvents']) as OutboxRow[])
      .filter((event) => isReplayEventVisible(event, principal));
    return { sync: 'REPLAY_AVAILABLE', currentEventSequence: current, events };
  }

  public getEvent(id: number): OutboxRow | null {
    const row = this.db.prepare('SELECT * FROM outbox_events WHERE id = ?').get(id) as OutboxRow | undefined;
    return row ?? null;
  }

  public markOutboxPublished(id: number): void {
    this.db.prepare('UPDATE outbox_events SET published_at = ?, attempt_count = attempt_count + 1, last_error = NULL WHERE id = ? AND published_at IS NULL').run(new Date().toISOString(), id);
  }

  public markOutboxFailure(id: number, error: string): void {
    this.db.prepare('UPDATE outbox_events SET attempt_count = attempt_count + 1, last_error = ? WHERE id = ?').run(error.slice(0, 500), id);
  }

  public getPendingOutbox(limit = 100): OutboxRow[] {
    return this.db.prepare('SELECT * FROM outbox_events WHERE published_at IS NULL ORDER BY id LIMIT ?').all(Math.min(limit, 1000)) as OutboxRow[];
  }

  public purgeRetention(now = new Date()): RetentionPurgeResult {
    const settings = this.getSettings();
    const cutoff = new Date(now.getTime() - settings['realtime.replayMinMinutes'] * 60_000).toISOString();
    const boundary = this.db.prepare('SELECT id FROM outbox_events WHERE published_at IS NOT NULL ORDER BY id DESC LIMIT 1 OFFSET ?').get(
      Math.max(0, settings['realtime.replayMaxEvents'] - 1)
    ) as { id: number } | undefined;

    const purge = this.db.transaction(() => {
      let eventsDeleted = 0;
      if (boundary !== undefined) {
        while (true) {
          const result = this.db.prepare(`
            DELETE FROM outbox_events
            WHERE id IN (
              SELECT id FROM outbox_events
              WHERE published_at IS NOT NULL AND created_at < ? AND id < ?
              ORDER BY id
              LIMIT 1000
            )
          `).run(cutoff, boundary.id);
          eventsDeleted += result.changes;
          if (result.changes < 1000) {
            break;
          }
        }
      }
      const requestHistoryCutoff = new Date(now.getTime() - settings['requests.historyRetentionDays'] * 24 * 60 * 60 * 1000).toISOString();
      const auditCutoff = new Date(now.getTime() - settings['audit.retentionDays'] * 24 * 60 * 60 * 1000).toISOString();
      const idempotencyCutoff = new Date(now.getTime() - settings['idempotency.retentionHours'] * 60 * 60 * 1000).toISOString();
      const heartbeatLogCutoff = new Date(now.getTime() - this.config.heartbeatLogRetentionDays * 24 * 60 * 60 * 1000).toISOString();
      const requestHistoryDeleted = this.db.prepare('DELETE FROM request_status_history WHERE created_at < ?').run(requestHistoryCutoff).changes;
      const auditDeleted = this.db.prepare('DELETE FROM audit_log WHERE created_at < ?').run(auditCutoff).changes;
      const idempotencyDeleted = this.db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(idempotencyCutoff).changes;
      const heartbeatLogsDeleted = this.db.prepare('DELETE FROM device_heartbeat_log WHERE observed_at < ?').run(heartbeatLogCutoff).changes;
      return { eventsDeleted, requestHistoryDeleted, auditDeleted, idempotencyDeleted, heartbeatLogsDeleted };
    });
    return purge.immediate();
  }

  private getIdempotentResult<T>(actor: Actor, key: string, operation: string, requestHash: string): T | undefined {
    const row = this.db.prepare('SELECT operation, request_hash, response_json, response_status FROM idempotency_keys WHERE actor_type = ? AND actor_id = ? AND key = ?').get(actor.actorType, actor.actorId ?? '', key) as IdempotencyRow | undefined;
    if (row === undefined) {
      return undefined;
    }
    assertIdempotencyKeyMatches(row.operation, row.request_hash, operation, requestHash);
    return row.response_json === null ? undefined : JSON.parse(row.response_json) as T;
  }

  private storeIdempotency(actor: Actor, key: string, operation: string, requestHash: string, response: unknown, status: number, resourceId: string): void {
    const created = new Date();
    const expires = new Date(created.getTime() + this.getSettings()['idempotency.retentionHours'] * 3600000).toISOString();
    this.db.prepare('INSERT INTO idempotency_keys(id, actor_type, actor_id, key, operation, request_hash, response_status, response_json, resource_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      createId('idem'), actor.actorType, actor.actorId ?? '', key, operation, requestHash, status, JSON.stringify(response), resourceId, created.toISOString(), expires
    );
  }

  private insertRoom(id: string, input: RoomCreateInput, now: string): void {
    try {
      this.db.prepare('INSERT INTO rooms(id, code, display_name, floor, display_order, active, do_not_disturb, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        id, input.code, input.displayName, input.floor ?? null, input.displayOrder ?? 0, input.active === false ? 0 : 1, input.doNotDisturb === true ? 1 : 0, now, now
      );
    } catch (error) {
      if (isSqliteConstraintError(error)) throw conflictError('A room with that code already exists.');
      throw error;
    }
  }

  private resolveAssignment(mode: DeviceAssignmentMode, roomId: string | null, areaId: string | null): { roomId: string | null; areaId: string | null } {
    if (mode === 'ROOM') {
      if (roomId === null || areaId !== null) throw validationError('ROOM devices require exactly one room assignment.');
      const room = this.getRoomRow(roomId);
      if (!room.active) throw new AppError('INACTIVE_DEPENDENCY', 'The assigned room is inactive.', 409);
      return { roomId, areaId: null };
    }
    if (areaId === null || roomId !== null) throw validationError('AREA devices require exactly one area assignment.');
    const area = this.getAreaRow(areaId);
    if (!area.active) throw new AppError('INACTIVE_DEPENDENCY', 'The assigned area is inactive.', 409);
    return { roomId: null, areaId };
  }

  private assertActiveRoomAssignmentAvailable(roomId: string, deviceId?: string): void {
    const row = deviceId === undefined
      ? this.db.prepare("SELECT id FROM devices WHERE assignment_mode = 'ROOM' AND room_id = ? AND active = 1 AND retired_at IS NULL LIMIT 1").get(roomId)
      : this.db.prepare("SELECT id FROM devices WHERE assignment_mode = 'ROOM' AND room_id = ? AND active = 1 AND retired_at IS NULL AND id <> ? LIMIT 1").get(roomId, deviceId);
    if (row !== undefined) {
      throw conflictError('An active ROOM device is already assigned to this room.');
    }
  }

  private getDeviceConfig(device: DeviceRow): DeviceConfig {
    const settings = this.getSettings();
    const room = device.room_id === null ? null : this.getRoom(device.room_id);
    const area = device.area_id === null ? null : this.getArea(device.area_id);
    const services = this.listServices(true, device.assignment_mode === 'AREA' ? device.area_id ?? undefined : undefined);
    const returnedServiceAreaIds = new Set(services.map((service) => service.areaId));
    const areas = this.listAreas()
      .filter((candidate) => candidate.active && returnedServiceAreaIds.has(candidate.id))
      .map(compactArea);
    return {
      mode: device.assignment_mode,
      room: room === null ? null : compactRoom(room),
      area: area === null ? null : compactArea(area),
      services,
      areas,
      hotelName: settings.hotelName,
      hotelLogo: settings.hotelLogo,
      roomBackground: settings.roomBackground,
      clockFormat: settings.clockFormat,
      offlineQueueTtlHours: settings['client.offlineQueueTtlHours'],
      heartbeatIntervalMs: settings['heartbeat.intervalMs'],
      heartbeatStaleAfterMs: settings['heartbeat.staleAfterMs'],
      heartbeatOfflineAfterMs: settings['heartbeat.offlineAfterMs'],
      pendingAlertIntervalMs: settings['alerts.pendingRepeatMs']
    };
  }

  private getPresence(device: DeviceRow): DevicePresence {
    const settings = this.getSettings();
    if (!device.active) return 'DISABLED';
    if (device.last_heartbeat_at === null) return 'OFFLINE';
    const elapsed = Date.now() - new Date(device.last_heartbeat_at).getTime();
    if (elapsed < settings['heartbeat.staleAfterMs']) return 'ONLINE';
    if (elapsed < settings['heartbeat.offlineAfterMs']) return 'STALE';
    return 'OFFLINE';
  }

  private assertRoomCanDeactivate(id: string): void {
    const deviceIds = (this.db.prepare("SELECT id FROM devices WHERE room_id = ? AND active = 1").all(id) as Array<{ id: string }>).map((row) => row.id);
    const requestIds = (this.db.prepare("SELECT id FROM requests WHERE room_id = ? AND status IN ('PENDING', 'ACCEPTED', 'IN_PROGRESS')").all(id) as Array<{ id: string }>).map((row) => row.id);
    if (deviceIds.length > 0 || requestIds.length > 0) {
      throw new AppError('ACTIVE_DEPENDENCIES', 'The room has active devices or open requests.', 409, { deviceIds, requestIds });
    }
  }

  private assertAreaCanDeactivate(id: string): void {
    const serviceIds = (this.db.prepare('SELECT id FROM services WHERE area_id = ? AND active = 1').all(id) as Array<{ id: string }>).map((row) => row.id);
    const deviceIds = (this.db.prepare("SELECT id FROM devices WHERE area_id = ? AND active = 1").all(id) as Array<{ id: string }>).map((row) => row.id);
    const requestIds = (this.db.prepare("SELECT id FROM requests WHERE responsible_area_id = ? AND status IN ('PENDING', 'ACCEPTED', 'IN_PROGRESS')").all(id) as Array<{ id: string }>).map((row) => row.id);
    if (serviceIds.length > 0 || deviceIds.length > 0 || requestIds.length > 0) {
      throw new AppError('ACTIVE_DEPENDENCIES', 'The area has active services, devices, or open requests.', 409, { serviceIds, deviceIds, requestIds });
    }
  }

  private assertExpectedTimestamp(actual: string, expected: string | undefined): void {
    if (expected !== undefined && expected !== actual) {
      throw new AppError('VERSION_CONFLICT', 'The resource changed before this action was applied.', 409, { currentUpdatedAt: actual });
    }
  }

  private bumpConfiguration(): number {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE configuration_state SET configuration_revision = configuration_revision + 1, updated_at = ? WHERE singleton_id = 1').run(now);
    return this.getConfigurationRevision();
  }

  private appendCatalogEvent(changedServiceIds: string[]): void {
    this.appendOutbox('service.catalog.changed', 'SERVICE', changedServiceIds[0] ?? 'catalog', null, { configurationRevision: this.getConfigurationRevision(), changedServiceIds });
  }

  private appendDeviceConfigEvent(deviceId: string, configurationRevision: number, deviceConfigVersion: number, assignmentMode: DeviceAssignmentMode, roomId: string | null, areaId: string | null, reason: 'ASSIGNMENT_CHANGED' | 'TOKEN_ROTATED' | 'DEVICE_ACTIVATED' | 'DEVICE_DEACTIVATED' | 'DEVICE_RETIRED'): void {
    this.appendOutbox('device.config.changed', 'DEVICE', deviceId, deviceConfigVersion, { deviceId, configurationRevision, deviceConfigVersion, assignmentMode, roomId, areaId, reason });
  }

  private appendRoomUpdatedEvent(room: RoomDTO): void {
    this.appendOutbox('room.updated', 'ROOM', room.id, null, { room });
  }

  private clearRoomDoNotDisturb(roomId: string, actor: Actor, requestId: string): void {
    const current = this.getRoomRow(roomId);
    if (!current.do_not_disturb) return;

    const now = new Date().toISOString();
    const update = this.db.prepare('UPDATE rooms SET do_not_disturb = 0, updated_at = ? WHERE id = ? AND do_not_disturb = 1').run(now, roomId);
    if (update.changes !== 1) return;

    const room = this.getRoom(roomId) ?? this.assertImpossible('Updated room disappeared.');
    this.audit(actor, 'ROOM_UPDATED', 'ROOM', roomId, requestId, { doNotDisturb: false });
    this.appendRoomUpdatedEvent(room);
  }

  private appendOutbox(eventName: string, aggregateType: OutboxRow['aggregate_type'], aggregateId: string, aggregateVersion: number | null, payload: unknown): number {
    if (eventName === 'device.presence.changed') {
      throw new AppError('INTERNAL_ERROR', 'Ephemeral presence events must not be stored in the outbox.', 500);
    }
    if (!isDurableOutboxEventName(eventName)) {
      throw new AppError('INTERNAL_ERROR', `Unsupported durable realtime event: ${eventName}`, 500);
    }
    const result = this.db.prepare('INSERT INTO outbox_events(event_id, event_name, aggregate_type, aggregate_id, aggregate_version, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      createId('evt'), eventName, aggregateType, aggregateId, aggregateVersion, JSON.stringify(payload), new Date().toISOString()
    );
    return Number(result.lastInsertRowid);
  }

  private audit(actor: Actor, action: string, entityType: string | null, entityId: string | null, requestId: string | null, metadata: Record<string, unknown>): void {
    this.db.prepare('INSERT INTO audit_log(actor_type, actor_id, action, entity_type, entity_id, request_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      actor.actorType, actor.actorId, action, entityType, entityId, requestId, JSON.stringify(metadata), new Date().toISOString()
    );
  }

  private mutate<T>(operation: () => T): T {
    const transaction = this.db.transaction(operation);
    const result = transaction.immediate();
    this.onCommitted?.();
    return result;
  }

  private notifySecurityChange(change: SecurityChange): void {
    this.securityChangeHandler?.(change);
  }

  private getRoomRow(id: string): RoomRow {
    const row = this.db.prepare('SELECT * FROM rooms WHERE id = ?').get(id) as RoomRow | undefined;
    if (row === undefined) throw notFound('Room');
    return row;
  }

  private getAreaRow(id: string): AreaRow {
    const row = this.db.prepare('SELECT * FROM areas WHERE id = ?').get(id) as AreaRow | undefined;
    if (row === undefined) throw notFound('Area');
    return row;
  }

  private getServiceRow(id: string): ServiceRow {
    const row = this.db.prepare('SELECT * FROM services WHERE id = ?').get(id) as ServiceRow | undefined;
    if (row === undefined) throw notFound('Service');
    return row;
  }

  private getDeviceRow(id: string): DeviceRow {
    const row = this.db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceRow | undefined;
    if (row === undefined) throw notFound('Device');
    return row;
  }

  private getAdminRow(id: string): AdminRow {
    const row = this.db.prepare('SELECT * FROM admins WHERE id = ?').get(id) as AdminRow | undefined;
    if (row === undefined) throw notFound('Administrator');
    return row;
  }

  private getRequestRow(id: string): RequestRow {
    const row = this.db.prepare('SELECT r.*, rooms.do_not_disturb AS room_do_not_disturb, services.icon_key AS service_icon_key FROM requests r JOIN rooms ON rooms.id = r.room_id JOIN services ON services.id = r.service_id WHERE r.id = ?').get(id) as RequestRow | undefined;
    if (row === undefined) throw notFound('Request');
    return row;
  }

  private getRequest(id: string): RequestDTO | null {
    const row = this.db.prepare('SELECT r.*, rooms.do_not_disturb AS room_do_not_disturb, services.icon_key AS service_icon_key FROM requests r JOIN rooms ON rooms.id = r.room_id JOIN services ON services.id = r.service_id WHERE r.id = ?').get(id) as RequestRow | undefined;
    return row === undefined ? null : this.mapRequest(row);
  }

  private mapRequest(row: RequestRow, includeCreator = false): RequestDTO {
    const request: RequestDTO = {
      id: row.id,
      roomId: row.room_id,
      serviceId: row.service_id,
      responsibleAreaId: row.responsible_area_id,
       room: { id: row.room_id, code: row.room_code_snapshot, displayName: row.room_display_name_snapshot, doNotDisturb: Boolean(row.room_do_not_disturb) },
       service: { id: row.service_id, code: row.service_code_snapshot, displayName: row.service_display_name_snapshot, iconKey: row.service_icon_key },
      responsibleArea: { id: row.responsible_area_id, code: row.area_code_snapshot, displayName: row.area_display_name_snapshot },
      status: row.status,
      version: row.version,
      createdAt: row.created_at,
      acceptedAt: row.accepted_at,
      inProgressAt: row.in_progress_at,
      completedAt: row.completed_at,
      updatedAt: row.updated_at
    };
    if (includeCreator && row.created_by_actor_type === 'DEVICE' && row.created_by_actor_id !== null) {
      request.createdByDeviceId = row.created_by_actor_id;
    }
    return request;
  }

  private assertImpossible(message: string): never {
    throw new AppError('INTERNAL_ERROR', message, 500);
  }
}

function isSqliteConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('SQLITE_CONSTRAINT');
}

function requestFilterKey(filters: RequestFilters): string {
  const search = filters.search?.trim();
  return JSON.stringify({
    statuses: filters.statuses === undefined || filters.statuses.length === 0 ? null : [...filters.statuses].sort(),
    roomId: filters.roomId ?? null,
    serviceId: filters.serviceId ?? null,
    areaId: filters.areaId ?? null,
    deviceId: filters.deviceId ?? null,
    createdFrom: filters.createdFrom ?? null,
    createdTo: filters.createdTo ?? null,
    includeCreator: filters.includeCreator === true,
    search: search === undefined || search.length === 0 ? null : search
  });
}

function encodeRequestCursor(cursor: Omit<RequestCursor, 'version'>): string {
  return Buffer.from(JSON.stringify({ version: 1, ...cursor }), 'utf8').toString('base64url');
}

function decodeRequestCursor(value: string): RequestCursor {
  if (value.length === 0 || value.length > 4096 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw validationError('The request cursor is invalid.');
  }
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== value) {
      throw new Error('The request cursor is not canonical base64url.');
    }
    const parsed: unknown = JSON.parse(decoded) as unknown;
    if (!isRequestCursor(parsed)) {
      throw new Error('The request cursor payload is invalid.');
    }
    return parsed;
  } catch {
    throw validationError('The request cursor is invalid.');
  }
}

function isRequestCursor(value: unknown): value is RequestCursor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate['version'] === 1
    && typeof candidate['filterKey'] === 'string'
    && candidate['filterKey'].length <= 4096
    && typeof candidate['createdAt'] === 'string'
    && candidate['createdAt'].length > 0
    && !Number.isNaN(new Date(candidate['createdAt']).getTime())
    && typeof candidate['id'] === 'string'
    && candidate['id'].length > 0
    && candidate['id'].length <= 128;
}

function parseMetadata(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

function mapRoom(row: RoomRow): RoomDTO {
  return { id: row.id, code: row.code, displayName: row.display_name, floor: row.floor, displayOrder: row.display_order, active: Boolean(row.active), doNotDisturb: Boolean(row.do_not_disturb), createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapArea(row: AreaRow): AreaDTO {
  return { id: row.id, code: row.code, displayName: row.display_name, description: row.description, displayOrder: row.display_order, active: Boolean(row.active), createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapService(row: ServiceRow): ServiceDTO {
  return { id: row.id, code: row.code, displayName: row.display_name, description: row.description, iconKey: row.icon_key, areaId: row.area_id, active: Boolean(row.active), displayOrder: row.display_order, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapDevice(row: DeviceRow, presence: DevicePresence): DeviceDTO {
  return { id: row.id, installationId: row.installation_id, displayName: row.display_name, assignmentMode: row.assignment_mode, roomId: row.room_id, areaId: row.area_id, active: Boolean(row.active), deviceConfigVersion: row.device_config_version, lastHeartbeatAt: row.last_heartbeat_at, presence };
}

function mapAdmin(row: Omit<AdminRow, 'password_hash' | 'failed_login_count' | 'locked_until'>): AdminDTO {
  return { id: row.id, username: row.username, active: Boolean(row.active), lastLoginAt: row.last_login_at, createdAt: row.created_at, updatedAt: row.updated_at };
}

function devicePrincipal(row: Pick<DeviceRow, 'id' | 'assignment_mode' | 'room_id' | 'area_id'>): DevicePrincipal {
  return { kind: 'DEVICE', actorType: 'DEVICE', deviceId: row.id, assignmentMode: row.assignment_mode, roomId: row.room_id, areaId: row.area_id };
}

function compactRoom(room: RoomDTO): CompactRoom {
  return { id: room.id, code: room.code, displayName: room.displayName, doNotDisturb: room.doNotDisturb };
}

function compactArea(area: AreaDTO): CompactArea {
  return { id: area.id, code: area.code, displayName: area.displayName };
}

function requestScope(row: Pick<RequestRow, 'room_id' | 'responsible_area_id' | 'status'>): RequestScope {
  return { roomId: row.room_id, responsibleAreaId: row.responsible_area_id, status: row.status };
}

function isReplayEventVisible(event: OutboxRow, principal: Principal): boolean {
  if (!isDurableOutboxEventName(event.event_name)) return false;
  let payload: unknown;
  try {
    payload = JSON.parse(event.payload_json) as unknown;
  } catch {
    return false;
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return false;
  }
  if (principal.kind === 'ADMIN' || principal.kind === 'SYSTEM') {
    return true;
  }
  const values = payload as Record<string, unknown>;
  switch (event.event_name) {
    case 'request.created':
    case 'request.updated': {
      const request = values['request'];
      if (typeof request !== 'object' || request === null || Array.isArray(request)) return false;
      const requestValues = request as Record<string, unknown>;
      return principal.assignmentMode === 'ROOM'
        ? requestValues['roomId'] === principal.roomId
        : requestValues['responsibleAreaId'] === principal.areaId;
    }
    case 'device.config.changed':
    case 'device.token.rotation.required':
    case 'device.presence.changed':
      return values['deviceId'] === principal.deviceId;
    case 'service.catalog.changed':
      return true;
    case 'room.updated': {
      const room = values['room'];
      if (typeof room !== 'object' || room === null || Array.isArray(room)) return false;
      const roomValues = room as Record<string, unknown>;
      return principal.assignmentMode === 'AREA' || roomValues['id'] === principal.roomId;
    }
    case 'system.maintenance':
      return false;
    default:
      return false;
  }
}

function isDurableOutboxEventName(eventName: string): boolean {
  switch (eventName) {
    case 'request.created':
    case 'request.updated':
    case 'device.config.changed':
    case 'device.token.rotation.required':
    case 'service.catalog.changed':
    case 'room.updated':
    case 'system.maintenance':
      return true;
    default:
      return false;
  }
}

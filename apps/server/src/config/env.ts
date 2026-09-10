import crypto from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';

export const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');

dotenv.config({ path: path.join(REPOSITORY_ROOT, '.env') });

export interface ServerConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  appOrigin: string;
  databasePath: string;
  sessionSecret: string;
  tokenPepper: string;
  adminSessionTtlMinutes: number;
  loginMaxAttempts: number;
  loginLockMinutes: number;
  heartbeatIntervalMs: number;
  deviceStaleAfterMs: number;
  deviceOfflineAfterMs: number;
  socketReconnectMinMs: number;
  socketReconnectMaxMs: number;
  socketEventReplayMinMinutes: number;
  socketEventReplayMaxEvents: number;
  outboxPublishIntervalMs: number;
  pendingAlertIntervalMs: number;
  requestPageSizeDefault: number;
  requestPageSizeMax: number;
  idempotencyRetentionHours: number;
  offlineQueueTtlHours: number;
  requestHistoryRetentionDays: number;
  auditRetentionDays: number;
  heartbeatLogRetentionDays: number;
  backupDirectory: string;
  backupRetentionDays: number;
}

export interface ConfigOverrides {
  databasePath?: string;
  sessionSecret?: string;
  tokenPepper?: string;
  host?: string;
  port?: number;
  nodeEnv?: ServerConfig['nodeEnv'];
  appOrigin?: string;
}

function integerFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer.`);
  }
  return parsed;
}

function secretFromEnv(name: string): string {
  return process.env[name] ?? crypto.randomBytes(32).toString('hex');
}

export function resolveRepositoryPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(REPOSITORY_ROOT, filePath);
}

export function loadConfig(overrides: ConfigOverrides = {}): ServerConfig {
  const nodeEnv = overrides.nodeEnv ?? (process.env['NODE_ENV'] as ServerConfig['nodeEnv'] | undefined) ?? 'development';
  const databasePath = overrides.databasePath ?? process.env['DATABASE_PATH'] ?? './data/hotel.sqlite';
  const port = overrides.port ?? integerFromEnv('PORT', nodeEnv === 'development' ? 3001 : 3000);
  const config: ServerConfig = {
    nodeEnv,
    host: overrides.host ?? process.env['HOST'] ?? '0.0.0.0',
    port,
    appOrigin: overrides.appOrigin ?? process.env['APP_ORIGIN'] ?? (nodeEnv === 'development' ? 'http://localhost:4173' : `http://localhost:${port}`),
    databasePath: resolveRepositoryPath(databasePath),
    sessionSecret: overrides.sessionSecret ?? secretFromEnv('SESSION_SECRET'),
    tokenPepper: overrides.tokenPepper ?? secretFromEnv('TOKEN_PEPPER'),
    adminSessionTtlMinutes: integerFromEnv('ADMIN_SESSION_TTL_MINUTES', 480),
    loginMaxAttempts: integerFromEnv('LOGIN_MAX_ATTEMPTS', 5),
    loginLockMinutes: integerFromEnv('LOGIN_LOCK_MINUTES', 15),
    heartbeatIntervalMs: integerFromEnv('HEARTBEAT_INTERVAL_MS', 15000),
    deviceStaleAfterMs: integerFromEnv('DEVICE_STALE_AFTER_MS', 45000),
    deviceOfflineAfterMs: integerFromEnv('DEVICE_OFFLINE_AFTER_MS', 90000),
    socketReconnectMinMs: integerFromEnv('SOCKET_RECONNECT_MIN_MS', 1000),
    socketReconnectMaxMs: integerFromEnv('SOCKET_RECONNECT_MAX_MS', 30000),
    socketEventReplayMinMinutes: integerFromEnv('SOCKET_EVENT_REPLAY_MINUTES', 60),
    socketEventReplayMaxEvents: integerFromEnv('SOCKET_EVENT_REPLAY_MAX_EVENTS', 100000),
    outboxPublishIntervalMs: integerFromEnv('OUTBOX_PUBLISH_INTERVAL_MS', 250),
    pendingAlertIntervalMs: integerFromEnv('PENDING_ALERT_INTERVAL_MS', 5000),
    requestPageSizeDefault: integerFromEnv('REQUEST_PAGE_SIZE_DEFAULT', 50),
    requestPageSizeMax: integerFromEnv('REQUEST_PAGE_SIZE_MAX', 100),
    idempotencyRetentionHours: integerFromEnv('IDEMPOTENCY_RETENTION_HOURS', 72),
    offlineQueueTtlHours: integerFromEnv('OFFLINE_QUEUE_TTL_HOURS', 48),
    requestHistoryRetentionDays: integerFromEnv('REQUEST_HISTORY_RETENTION_DAYS', 30),
    auditRetentionDays: integerFromEnv('AUDIT_RETENTION_DAYS', 180),
    heartbeatLogRetentionDays: integerFromEnv('HEARTBEAT_LOG_RETENTION_DAYS', 7),
    backupDirectory: resolveRepositoryPath(process.env['BACKUP_DIRECTORY'] ?? './data/backups'),
    backupRetentionDays: integerFromEnv('BACKUP_RETENTION_DAYS', 30)
  };

  if (config.nodeEnv === 'production' && (!process.env['SESSION_SECRET'] || !process.env['TOKEN_PEPPER'])) {
    throw new Error('SESSION_SECRET and TOKEN_PEPPER are required in production.');
  }
  if (config.deviceOfflineAfterMs < config.deviceStaleAfterMs || config.deviceStaleAfterMs < config.heartbeatIntervalMs) {
    throw new Error('Heartbeat thresholds must be ordered: interval <= stale <= offline.');
  }
  if (config.offlineQueueTtlHours >= config.idempotencyRetentionHours) {
    throw new Error('OFFLINE_QUEUE_TTL_HOURS must be shorter than IDEMPOTENCY_RETENTION_HOURS.');
  }
  if (config.socketEventReplayMinMinutes < 60 || config.socketEventReplayMaxEvents < 100000) {
    throw new Error('Socket replay retention cannot be configured below the 60-minute and 100000-event floors.');
  }
  return config;
}

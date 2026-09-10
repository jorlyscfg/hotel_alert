export const INITIAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  failed_login_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until TEXT NULL,
  last_login_at TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS configuration_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  configuration_revision INTEGER NOT NULL DEFAULT 1 CHECK (configuration_revision > 0),
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO configuration_state(singleton_id, configuration_revision, updated_at) VALUES (1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_admin_id TEXT NULL REFERENCES admins(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  csrf_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT NULL,
  created_ip TEXT NULL,
  user_agent TEXT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  floor TEXT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS areas (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT NULL,
  icon_key TEXT NULL,
  area_id TEXT NOT NULL REFERENCES areas(id) ON DELETE RESTRICT,
  display_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  assignment_mode TEXT NOT NULL CHECK (assignment_mode IN ('ROOM', 'AREA')),
  room_id TEXT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  area_id TEXT NULL REFERENCES areas(id) ON DELETE RESTRICT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  last_seen_at TEXT NULL,
  last_heartbeat_at TEXT NULL,
  last_ip TEXT NULL,
  last_user_agent TEXT NULL,
  client_version TEXT NULL,
  device_config_version INTEGER NOT NULL DEFAULT 1 CHECK (device_config_version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (assignment_mode = 'ROOM' AND room_id IS NOT NULL AND area_id IS NULL)
    OR (assignment_mode = 'AREA' AND area_id IS NOT NULL AND room_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  last_used_at TEXT NULL,
  revoked_at TEXT NULL,
  replaced_by_token_id TEXT NULL REFERENCES device_tokens(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_device_token ON device_tokens(device_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS device_token_rotations (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  previous_token_id TEXT NOT NULL REFERENCES device_tokens(id) ON DELETE RESTRICT,
  new_token_hash TEXT NULL UNIQUE,
  new_token_prefix TEXT NULL,
  state TEXT NOT NULL CHECK (state IN ('ROTATION_PENDING', 'CLAIMED', 'ACKNOWLEDGED', 'CANCELLED', 'EXPIRED')),
  created_at TEXT NOT NULL,
  grace_expires_at TEXT NOT NULL,
  claimed_at TEXT NULL,
  acknowledged_at TEXT NULL,
  cancelled_at TEXT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_device_rotation ON device_token_rotations(device_id) WHERE state IN ('ROTATION_PENDING', 'CLAIMED');

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  responsible_area_id TEXT NOT NULL REFERENCES areas(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_actor_type TEXT NOT NULL CHECK (created_by_actor_type IN ('ADMIN', 'DEVICE', 'SYSTEM')),
  created_by_actor_id TEXT NULL,
  room_code_snapshot TEXT NOT NULL,
  room_display_name_snapshot TEXT NOT NULL,
  service_code_snapshot TEXT NOT NULL,
  service_display_name_snapshot TEXT NOT NULL,
  area_code_snapshot TEXT NOT NULL,
  area_display_name_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL,
  accepted_at TEXT NULL,
  in_progress_at TEXT NULL,
  completed_at TEXT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS request_status_history (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  from_status TEXT NULL CHECK (from_status IS NULL OR from_status IN ('PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED')),
  to_status TEXT NOT NULL CHECK (to_status IN ('PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('ADMIN', 'DEVICE', 'SYSTEM')),
  actor_id TEXT NULL,
  request_version INTEGER NOT NULL CHECK (request_version > 0),
  metadata_json TEXT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('ADMIN', 'DEVICE', 'SYSTEM')),
  actor_id TEXT NOT NULL,
  key TEXT NOT NULL,
  operation TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NULL,
  response_json TEXT NULL,
  resource_id TEXT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(actor_type, actor_id, key)
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  event_name TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  aggregate_version INTEGER NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('ADMIN', 'DEVICE', 'SYSTEM')),
  actor_id TEXT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NULL,
  entity_id TEXT NULL,
  request_id TEXT NULL,
  source_ip TEXT NULL,
  metadata_json TEXT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_heartbeat_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  observed_at TEXT NOT NULL,
  client_version TEXT NULL,
  source_ip TEXT NULL,
  socket_connected INTEGER NOT NULL CHECK (socket_connected IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_services_active_order ON services(active, display_order, display_name);
CREATE INDEX IF NOT EXISTS idx_devices_room_active ON devices(room_id, active);
CREATE INDEX IF NOT EXISTS idx_devices_area_active ON devices(area_id, active);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_requests_area_status_created ON requests(responsible_area_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_requests_room_status_created ON requests(room_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_requests_service_created ON requests(service_id, created_at);
CREATE INDEX IF NOT EXISTS idx_request_history_request_created ON request_status_history(request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_published_id ON outbox_events(published_at, id);
CREATE INDEX IF NOT EXISTS idx_audit_entity_created ON audit_log(entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_heartbeat_device_observed ON device_heartbeat_log(device_id, observed_at);
`;

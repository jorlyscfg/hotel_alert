import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../apps/server/src/config/env';
import { closeDatabase, openDatabase, runMigrations, type SqliteDatabase } from '../../apps/server/src/db/connection';
import { INITIAL_SCHEMA } from '../../apps/server/src/db/migrations/001_initial';

interface CatalogArea {
  id: string;
  code: string;
  display_name: string;
  description: string | null;
  display_order: number;
  active: number;
}

interface CatalogService {
  id: string;
  code: string;
  display_name: string;
  description: string | null;
  icon_key: string | null;
  area_id: string;
  display_order: number;
  active: number;
}

const expectedAreas: CatalogArea[] = [
  { id: 'area_default_front-desk', code: 'front-desk', display_name: 'Front Desk', description: 'Reception and general guest assistance', display_order: 10, active: 1 },
  { id: 'area_default_housekeeping', code: 'housekeeping', display_name: 'Housekeeping', description: 'Room cleaning and guest-room amenities', display_order: 20, active: 1 },
  { id: 'area_default_maintenance', code: 'maintenance', display_name: 'Maintenance', description: 'Repairs and technical issues', display_order: 30, active: 1 },
  { id: 'area_default_concierge', code: 'concierge', display_name: 'Concierge', description: 'Guest assistance, arrivals, and local arrangements', display_order: 40, active: 1 },
  { id: 'area_default_food-beverage', code: 'food-beverage', display_name: 'Food & Beverage', description: 'Room service and refreshments', display_order: 50, active: 1 }
];

const expectedServices: CatalogService[] = [
  { id: 'svc_default_front-desk-assistance', code: 'front-desk-assistance', display_name: 'Front desk assistance', description: 'Reception and general guest assistance', icon_key: 'bell', area_id: 'area_default_front-desk', display_order: 10, active: 1 },
  { id: 'svc_default_wake-up-call', code: 'wake-up-call', display_name: 'Wake-up call', description: 'Scheduled wake-up call', icon_key: 'bell', area_id: 'area_default_front-desk', display_order: 20, active: 1 },
  { id: 'svc_default_fresh-towels', code: 'fresh-towels', display_name: 'Fresh towels', description: 'Fresh bath towels', icon_key: 'towels', area_id: 'area_default_housekeeping', display_order: 30, active: 1 },
  { id: 'svc_default_room-cleaning', code: 'room-cleaning', display_name: 'Room cleaning', description: 'Guest room cleaning', icon_key: 'housekeeping', area_id: 'area_default_housekeeping', display_order: 40, active: 1 },
  { id: 'svc_default_extra-room-amenities', code: 'extra-room-amenities', display_name: 'Extra room amenities', description: 'Additional room amenities', icon_key: 'housekeeping', area_id: 'area_default_housekeeping', display_order: 50, active: 1 },
  { id: 'svc_default_room-repair', code: 'room-repair', display_name: 'Room repair', description: 'Repairs and technical issues', icon_key: 'maintenance', area_id: 'area_default_maintenance', display_order: 60, active: 1 },
  { id: 'svc_default_air-conditioning', code: 'air-conditioning', display_name: 'Air conditioning issue', description: 'Air conditioning issue', icon_key: 'maintenance', area_id: 'area_default_maintenance', display_order: 70, active: 1 },
  { id: 'svc_default_plumbing-issue', code: 'plumbing-issue', display_name: 'Plumbing issue', description: 'Plumbing issue', icon_key: 'maintenance', area_id: 'area_default_maintenance', display_order: 80, active: 1 },
  { id: 'svc_default_concierge-assistance', code: 'concierge-assistance', display_name: 'Concierge assistance', description: 'Guest assistance and local arrangements', icon_key: 'concierge', area_id: 'area_default_concierge', display_order: 90, active: 1 },
  { id: 'svc_default_bell-service', code: 'bell-service', display_name: 'Bell service', description: 'Luggage and bell service', icon_key: 'bell', area_id: 'area_default_concierge', display_order: 100, active: 1 },
  { id: 'svc_default_room-service', code: 'room-service', display_name: 'Room service', description: 'Food and beverages delivered to the room', icon_key: 'food', area_id: 'area_default_food-beverage', display_order: 110, active: 1 },
  { id: 'svc_default_breakfast-request', code: 'breakfast-request', display_name: 'Breakfast request', description: 'Breakfast request', icon_key: 'food', area_id: 'area_default_food-beverage', display_order: 120, active: 1 },
  { id: 'svc_default_drinks-and-ice', code: 'drinks-and-ice', display_name: 'Drinks and ice', description: 'Drinks and ice', icon_key: 'drink', area_id: 'area_default_food-beverage', display_order: 130, active: 1 }
];

describe('default catalog migration', () => {
  let database: SqliteDatabase;
  let databaseDirectory: string;

  beforeEach(() => {
    databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-default-catalog-'));
    database = openDatabase(loadConfig({ nodeEnv: 'test', databasePath: path.join(databaseDirectory, 'hotel.sqlite') }));
  });

  afterEach(() => {
    closeDatabase(database);
    fs.rmSync(databaseDirectory, { recursive: true, force: true });
  });

  it('populates the starter areas and guest-facing services on a fresh database', () => {
    runMigrations(database);

    expect(readAreas(database)).toEqual(expectedAreas);
    expect(readServices(database)).toEqual(expectedServices);
    expect(readMigrationVersions(database)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(readBrandingSettings(database)).toEqual({ hotelName: 'Hotel Local', hotelLogo: null, roomBackground: null, clockFormat: '12h' });
    expect(database.prepare('SELECT do_not_disturb FROM rooms').get()).toBeUndefined();
    expect(readConfigurationRevision(database)).toBe(2);

    const catalogEvent = database.prepare("SELECT event_name, aggregate_type, aggregate_id, payload_json FROM outbox_events WHERE event_name = 'service.catalog.changed'").get() as {
      event_name: string;
      aggregate_type: string;
      aggregate_id: string;
      payload_json: string;
    } | undefined;
    expect(catalogEvent).toMatchObject({ event_name: 'service.catalog.changed', aggregate_type: 'SERVICE', aggregate_id: expectedServices[0]?.id });
    expect(JSON.parse(catalogEvent?.payload_json ?? '{}')).toEqual({
      configurationRevision: 2,
      changedServiceIds: expectedServices.map((service) => service.id)
    });
  });

  it('adds non-conflicting defaults without attaching services to a colliding custom area', () => {
    createVersionOneDatabase(database);
    database.prepare('INSERT INTO areas(id, code, display_name, description, display_order, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      'area-custom-housekeeping',
      'HOUSEKEEPING',
      'Custom housekeeping team',
      'Managed by the hotel',
      1,
      1,
      '2026-08-31T12:00:00.000Z',
      '2026-08-31T12:00:00.000Z'
    );
    database.prepare('INSERT INTO services(id, code, display_name, description, icon_key, area_id, display_order, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'svc-custom-housekeeping',
      'fresh-towels',
      'Hotel towels',
      'Custom towel workflow',
      'towels',
      'area-custom-housekeeping',
      1,
      1,
      '2026-08-31T12:00:00.000Z',
      '2026-08-31T12:00:00.000Z'
    );

    runMigrations(database);

    expect(database.prepare('SELECT id FROM areas WHERE id = ?').get('area_default_housekeeping')).toBeUndefined();
    expect(database.prepare('SELECT * FROM areas WHERE id = ?').get('area-custom-housekeeping')).toMatchObject({
      code: 'HOUSEKEEPING',
      display_name: 'Custom housekeeping team',
      active: 1
    });
    expect(database.prepare('SELECT * FROM services WHERE id = ?').get('svc-custom-housekeeping')).toMatchObject({
      code: 'fresh-towels',
      area_id: 'area-custom-housekeeping',
      display_name: 'Hotel towels'
    });
    expect((database.prepare('SELECT COUNT(*) AS count FROM services WHERE area_id = ?').get('area-custom-housekeeping') as { count: number }).count).toBe(1);
    expect((database.prepare('SELECT COUNT(*) AS count FROM areas').get() as { count: number }).count).toBe(5);
    expect((database.prepare('SELECT COUNT(*) AS count FROM services').get() as { count: number }).count).toBe(11);
  });

  it('does not overwrite edited or inactive defaults when a missing migration record is replayed', () => {
    createVersionOneDatabase(database);
    insertArea(database, 'area_default_front-desk', 'front-desk', 'Front Desk', 10);
    insertArea(database, 'area_default_housekeeping', 'housekeeping', 'Housekeeping', 20);
    insertService(database, 'svc_default_fresh-towels', 'fresh-towels', 'Fresh towels', 'area_default_housekeeping', 30);
    insertService(database, 'svc_default_wake-up-call', 'wake-up-call', 'Wake-up call', 'area_default_front-desk', 20);
    runMigrations(database);
    database.prepare('UPDATE areas SET display_name = ?, active = ?, updated_at = ? WHERE id = ?').run('Housekeeping - Night', 0, '2026-08-31T12:05:00.000Z', 'area_default_housekeeping');
    database.prepare('UPDATE services SET display_name = ?, active = ?, updated_at = ? WHERE id = ?').run('Hotel towels', 0, '2026-08-31T12:05:00.000Z', 'svc_default_fresh-towels');
    database.prepare('DELETE FROM services WHERE id = ?').run('svc_default_wake-up-call');
    database.prepare('INSERT INTO services(id, code, display_name, description, icon_key, area_id, display_order, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'svc-custom-wake-up',
      'WAKE-UP-CALL',
      'Custom wake-up workflow',
      'Managed by the hotel',
      'bell',
      'area_default_front-desk',
      21,
      1,
      '2026-08-31T12:00:00.000Z',
      '2026-08-31T12:00:00.000Z'
    );
    database.prepare('DELETE FROM schema_migrations WHERE version = 2').run();
    const revisionBeforeReplay = readConfigurationRevision(database);
    const eventCountBeforeReplay = (database.prepare('SELECT COUNT(*) AS count FROM outbox_events').get() as { count: number }).count;

    runMigrations(database);

    expect(database.prepare('SELECT * FROM areas WHERE id = ?').get('area_default_housekeeping')).toMatchObject({ display_name: 'Housekeeping - Night', active: 0 });
    expect(database.prepare('SELECT * FROM services WHERE id = ?').get('svc_default_fresh-towels')).toMatchObject({ display_name: 'Hotel towels', active: 0 });
    expect(database.prepare('SELECT * FROM services WHERE id = ?').get('svc_default_wake-up-call')).toBeUndefined();
    expect(database.prepare('SELECT * FROM services WHERE id = ?').get('svc-custom-wake-up')).toMatchObject({ code: 'WAKE-UP-CALL', display_name: 'Custom wake-up workflow' });
    expect(readConfigurationRevision(database)).toBe(revisionBeforeReplay);
    expect((database.prepare('SELECT COUNT(*) AS count FROM outbox_events').get() as { count: number }).count).toBe(eventCountBeforeReplay);
    expect(readMigrationVersions(database)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('adds branding defaults while upgrading a version three database', () => {
    createVersionThreeDatabase(database);

    runMigrations(database);

    expect(readMigrationVersions(database)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(readBrandingSettings(database)).toEqual({ hotelName: 'Hotel Local', hotelLogo: null, roomBackground: null, clockFormat: '12h' });
  });

  it('reconciles duplicate active ROOM assignments before creating the uniqueness index', () => {
    runMigrations(database);
    database.exec('DROP INDEX idx_one_active_room_device');
    database.prepare('DELETE FROM schema_migrations WHERE version = 6').run();
    database.prepare('INSERT INTO rooms(id, code, display_name, floor, display_order, active, do_not_disturb, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'room-duplicate', '101', 'Room 101', null, 1, 1, 0, '2026-08-31T12:00:00.000Z', '2026-08-31T12:00:00.000Z'
    );
    const insertDevice = database.prepare('INSERT INTO devices(id, installation_id, display_name, assignment_mode, room_id, area_id, active, last_seen_at, last_heartbeat_at, device_config_version, retired_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const duplicateDevices = [
      ['device-duplicate-1', 'installation-duplicate-1', '2026-08-31T12:00:00.000Z', null, '2026-08-31T12:00:00.000Z', '2026-08-31T12:50:00.000Z'],
      ['device-duplicate-2', 'installation-duplicate-2', null, '2026-08-31T12:30:00.000Z', '2026-08-31T12:00:00.000Z', '2026-08-31T12:00:00.000Z'],
      ['device-duplicate-3', 'installation-duplicate-3', null, '2026-08-31T12:30:00.000Z', '2026-08-31T12:00:00.000Z', '2026-08-31T12:05:00.000Z'],
      ['device-duplicate-4', 'installation-duplicate-4', null, '2026-08-31T12:30:00.000Z', '2026-08-31T12:01:00.000Z', '2026-08-31T12:05:00.000Z'],
      ['device-duplicate-5', 'installation-duplicate-5', null, '2026-08-31T12:30:00.000Z', '2026-08-31T12:01:00.000Z', '2026-08-31T12:05:00.000Z']
    ] as const;
    for (const [id, installationId, lastSeenAt, lastHeartbeatAt, createdAt, updatedAt] of duplicateDevices) {
      insertDevice.run(id, installationId, `Duplicate ${id.slice(-1)}`, 'ROOM', 'room-duplicate', null, 1, lastSeenAt, lastHeartbeatAt, 1, null, createdAt, updatedAt);
    }
    database.prepare('INSERT INTO device_tokens(id, device_id, token_hash, token_prefix, issued_at) VALUES (?, ?, ?, ?, ?)').run(
      'token-duplicate-1', 'device-duplicate-1', 'token-hash-duplicate-1', 'dup-1', '2026-08-31T12:00:00.000Z'
    );
    database.prepare('INSERT INTO device_heartbeat_log(device_id, observed_at, client_version, source_ip, socket_connected) VALUES (?, ?, ?, ?, ?)').run(
      'device-duplicate-1', '2026-08-31T12:00:00.000Z', 'test', '127.0.0.1', 1
    );

    runMigrations(database);

    expect(readMigrationVersions(database)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_one_active_room_device'").get()).toEqual({ name: 'idx_one_active_room_device' });

    const devices = database.prepare('SELECT id, active, retired_at, updated_at FROM devices WHERE room_id = ? ORDER BY id').all('room-duplicate') as Array<{
      id: string;
      active: number;
      retired_at: string | null;
      updated_at: string;
    }>;
    expect(devices).toHaveLength(5);
    expect(devices.filter((device) => device.active === 1).map((device) => device.id)).toEqual(['device-duplicate-5']);
    expect(devices.find((device) => device.id === 'device-duplicate-5')).toMatchObject({ active: 1, retired_at: null });

    const losers = devices.filter((device) => device.id !== 'device-duplicate-5');
    expect(losers.every((device) => device.active === 0 && device.retired_at !== null && device.updated_at === device.retired_at)).toBe(true);
    expect(new Set(losers.map((device) => device.retired_at))).toHaveLength(1);
    expect(database.prepare('SELECT device_id FROM device_tokens WHERE id = ?').get('token-duplicate-1')).toEqual({ device_id: 'device-duplicate-1' });
    expect(database.prepare('SELECT device_id FROM device_heartbeat_log WHERE device_id = ?').get('device-duplicate-1')).toEqual({ device_id: 'device-duplicate-1' });
  });
});

function createVersionOneDatabase(database: SqliteDatabase): void {
  database.exec(INITIAL_SCHEMA);
  database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(1, 'initial-domain-schema', '2026-08-31T12:00:00.000Z');
}

function createVersionThreeDatabase(database: SqliteDatabase): void {
  createVersionOneDatabase(database);
  database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(2, 'default-catalog', '2026-08-31T12:00:00.000Z');
  database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(3, 'room-do-not-disturb', '2026-08-31T12:00:00.000Z');
  database.exec('ALTER TABLE rooms ADD COLUMN do_not_disturb INTEGER NOT NULL DEFAULT 0 CHECK (do_not_disturb IN (0, 1))');
}

function insertArea(database: SqliteDatabase, id: string, code: string, displayName: string, displayOrder: number): void {
  database.prepare('INSERT INTO areas(id, code, display_name, description, display_order, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, code, displayName, null, displayOrder, 1, '2026-08-31T12:00:00.000Z', '2026-08-31T12:00:00.000Z'
  );
}

function insertService(database: SqliteDatabase, id: string, code: string, displayName: string, areaId: string, displayOrder: number): void {
  database.prepare('INSERT INTO services(id, code, display_name, description, icon_key, area_id, display_order, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, code, displayName, null, 'bell', areaId, displayOrder, 1, '2026-08-31T12:00:00.000Z', '2026-08-31T12:00:00.000Z'
  );
}

function readAreas(database: SqliteDatabase): CatalogArea[] {
  return database.prepare('SELECT id, code, display_name, description, display_order, active FROM areas ORDER BY display_order, id').all() as CatalogArea[];
}

function readServices(database: SqliteDatabase): CatalogService[] {
  return database.prepare('SELECT id, code, display_name, description, icon_key, area_id, display_order, active FROM services ORDER BY display_order, id').all() as CatalogService[];
}

function readMigrationVersions(database: SqliteDatabase): number[] {
  return (database.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>).map((row) => row.version);
}

function readConfigurationRevision(database: SqliteDatabase): number {
  return (database.prepare('SELECT configuration_revision FROM configuration_state WHERE singleton_id = 1').get() as { configuration_revision: number }).configuration_revision;
}

function readBrandingSettings(database: SqliteDatabase): { hotelName: unknown; hotelLogo: unknown; roomBackground: unknown; clockFormat: unknown } {
  const rows = database.prepare("SELECT key, value_json FROM system_settings WHERE key IN ('hotelName', 'hotelLogo', 'roomBackground', 'clockFormat') ORDER BY key").all() as Array<{ key: string; value_json: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value_json)])) as { hotelName: unknown; hotelLogo: unknown; roomBackground: unknown; clockFormat: unknown };
}

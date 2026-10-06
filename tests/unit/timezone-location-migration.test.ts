import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../apps/server/src/config/env';
import { closeDatabase, LATEST_MIGRATION_VERSION, openDatabase, runMigrations, type SqliteDatabase } from '../../apps/server/src/db/connection';
import { HotelService } from '../../apps/server/src/domain/hotel-service';
import type { Actor } from '../../apps/server/src/security/principal';

const systemActor: Actor = { actorType: 'SYSTEM', actorId: null };
const LOCATION_SETTING_KEYS = ['timeZone', 'weatherLocationName', 'weatherLatitude', 'weatherLongitude'];

describe('time zone and location settings migration', () => {
  let database: SqliteDatabase;
  let databaseDirectory: string;
  let config: ReturnType<typeof loadConfig>;

  beforeEach(() => {
    databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-timezone-location-'));
    config = loadConfig({ nodeEnv: 'test', databasePath: path.join(databaseDirectory, 'hotel.sqlite') });
    database = openDatabase(config);
  });

  afterEach(() => {
    closeDatabase(database);
    fs.rmSync(databaseDirectory, { recursive: true, force: true });
  });

  it('adds Cancun as the shared default to a fresh database', () => {
    runMigrations(database);

    const persisted = Object.fromEntries((database.prepare('SELECT key, value_json FROM system_settings WHERE key IN (?, ?, ?, ?)').all(...LOCATION_SETTING_KEYS) as Array<{ key: string; value_json: string }>).map((row) => [row.key, JSON.parse(row.value_json) as unknown]));
    const settings = new HotelService(database, config).getSettings();

    expect(LATEST_MIGRATION_VERSION).toBe(19);
    expect(persisted).toEqual({
      timeZone: 'America/Cancun',
      weatherLocationName: '',
      weatherLatitude: null,
      weatherLongitude: null
    });
    expect(settings.timeZone).toBe('America/Cancun');
  });

  it('upgrades an existing version 16 database and preserves administrator settings on rerun', () => {
    runMigrations(database);
    database.prepare('DELETE FROM schema_migrations WHERE version IN (17, 18)').run();
    database.prepare('DELETE FROM system_settings WHERE key IN (?, ?, ?, ?)').run(...LOCATION_SETTING_KEYS);

    runMigrations(database);

    const service = new HotelService(database, config);
    const admin = service.createAdmin({ username: 'timezone-admin', password: 'correct-horse-battery-staple' }, systemActor, 'setup-admin');
    const principal = service.authenticateAdmin(service.loginAdmin(admin.username, 'correct-horse-battery-staple', 'login-admin').sessionToken);
    service.updateSettings(principal, {
      timeZone: 'America/Cancun',
      weatherLocationName: 'Playa del Carmen',
      weatherLatitude: 20.6275,
      weatherLongitude: -87.0799
    }, 'configure-location');

    database.prepare('DELETE FROM schema_migrations WHERE version IN (17, 18)').run();
    runMigrations(database);

    expect(service.getSettings()).toMatchObject({
      timeZone: 'America/Cancun',
      weatherLocationName: 'Playa del Carmen',
      weatherLatitude: 20.6275,
      weatherLongitude: -87.0799
    });
    expect(database.prepare('SELECT name FROM schema_migrations WHERE version = 17').get()).toEqual({ name: 'timezone-location-settings' });
    expect(database.prepare('SELECT name FROM schema_migrations WHERE version = 18').get()).toEqual({ name: 'timezone-cancun-default' });
  });

  it('replaces a persisted unconfigured UTC default but preserves an administrator-selected UTC zone', () => {
    runMigrations(database);
    database.prepare('UPDATE system_settings SET value_json = ?, updated_by_admin_id = NULL WHERE key = ?').run(JSON.stringify('UTC'), 'timeZone');
    database.prepare('DELETE FROM schema_migrations WHERE version = 18').run();

    runMigrations(database);

    expect(new HotelService(database, config).getSettings().timeZone).toBe('America/Cancun');

    const service = new HotelService(database, config);
    const admin = service.createAdmin({ username: 'timezone-admin-utc', password: 'correct-horse-battery-staple' }, systemActor, 'setup-admin-utc');
    const principal = service.authenticateAdmin(service.loginAdmin(admin.username, 'correct-horse-battery-staple', 'login-admin-utc').sessionToken);
    service.updateSettings(principal, { timeZone: 'UTC' }, 'configure-utc');
    database.prepare('DELETE FROM schema_migrations WHERE version = 18').run();

    runMigrations(database);

    expect(service.getSettings().timeZone).toBe('UTC');
  });
});

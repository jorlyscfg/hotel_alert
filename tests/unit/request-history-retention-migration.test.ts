import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../apps/server/src/config/env';
import { closeDatabase, LATEST_MIGRATION_VERSION, openDatabase, runMigrations, type SqliteDatabase } from '../../apps/server/src/db/connection';
import { HotelService } from '../../apps/server/src/domain/hotel-service';
import type { Actor } from '../../apps/server/src/security/principal';

const systemActor: Actor = { actorType: 'SYSTEM', actorId: null };

describe('request history retention migration', () => {
  let database: SqliteDatabase;
  let databaseDirectory: string;
  let config: ReturnType<typeof loadConfig>;

  beforeEach(() => {
    databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-request-retention-'));
    vi.stubEnv('REQUEST_HISTORY_RETENTION_DAYS', '');
    config = loadConfig({ nodeEnv: 'test', databasePath: path.join(databaseDirectory, 'hotel.sqlite') });
    database = openDatabase(config);
  });

  afterEach(() => {
    closeDatabase(database);
    fs.rmSync(databaseDirectory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('defaults a fresh database to 365 days in config, shared settings, and persisted settings', () => {
    runMigrations(database);

    const setting = database.prepare('SELECT value_json FROM system_settings WHERE key = ?').get('requests.historyRetentionDays') as { value_json: string };
    const service = new HotelService(database, config);

    expect(config.requestHistoryRetentionDays).toBe(365);
    expect(JSON.parse(setting.value_json)).toBe(365);
    expect(service.getSettings()['requests.historyRetentionDays']).toBe(365);
    expect(LATEST_MIGRATION_VERSION).toBe(19);
  });

  it('upgrades a version 13 database to 365 days once and leaves later admin changes intact', () => {
    runMigrations(database);
    database.prepare('DELETE FROM schema_migrations WHERE version = 14').run();
    database.prepare('UPDATE system_settings SET value_json = ?, updated_by_admin_id = NULL WHERE key = ?').run(JSON.stringify(30), 'requests.historyRetentionDays');

    runMigrations(database);

    const migratedSetting = database.prepare('SELECT value_json FROM system_settings WHERE key = ?').get('requests.historyRetentionDays') as { value_json: string };
    expect(JSON.parse(migratedSetting.value_json)).toBe(365);
    expect(database.prepare('SELECT name FROM schema_migrations WHERE version = 14').get()).toEqual({ name: 'request-history-retention-one-year' });

    const service = new HotelService(database, config);
    const admin = service.createAdmin({ username: 'retention-admin', password: 'correct-horse-battery-staple' }, systemActor, 'setup-admin');
    const principal = service.authenticateAdmin(service.loginAdmin(admin.username, 'correct-horse-battery-staple', 'login-admin').sessionToken);
    service.updateSettings(principal, { 'requests.historyRetentionDays': 90 }, 'change-retention');
    runMigrations(database);

    expect(service.getSettings()['requests.historyRetentionDays']).toBe(90);
  });
});

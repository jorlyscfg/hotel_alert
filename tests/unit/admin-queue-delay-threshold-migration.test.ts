import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../apps/server/src/config/env';
import { closeDatabase, LATEST_MIGRATION_VERSION, openDatabase, runMigrations, type SqliteDatabase } from '../../apps/server/src/db/connection';

const pendingKey = 'requests.pendingDelayWarningMinutes';
const inProgressKey = 'requests.inProgressDelayWarningMinutes';

describe('Admin queue delay threshold migration', () => {
  let database: SqliteDatabase;
  let databaseDirectory: string;

  beforeEach(() => {
    databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-admin-queue-delay-'));
    const config = loadConfig({ nodeEnv: 'test', databasePath: path.join(databaseDirectory, 'hotel.sqlite') });
    database = openDatabase(config);
  });

  afterEach(() => {
    closeDatabase(database);
    fs.rmSync(databaseDirectory, { recursive: true, force: true });
  });

  function readSetting(key: string): number | undefined {
    const row = database.prepare('SELECT value_json FROM system_settings WHERE key = ?').get(key) as { value_json: string } | undefined;
    return row === undefined ? undefined : JSON.parse(row.value_json) as number;
  }

  it('seeds default thresholds in a fresh database', () => {
    runMigrations(database);

    expect(LATEST_MIGRATION_VERSION).toBe(19);
    expect(readSetting(pendingKey)).toBe(3);
    expect(readSetting(inProgressKey)).toBe(15);
    expect(database.prepare('SELECT name FROM schema_migrations WHERE version = 15').get()).toEqual({ name: 'admin-queue-delay-thresholds' });
  });

  it('fills missing values without overwriting existing Admin settings and is safe to rerun', () => {
    runMigrations(database);
    database.prepare('UPDATE system_settings SET value_json = ? WHERE key = ?').run(JSON.stringify(9), pendingKey);
    database.prepare('DELETE FROM system_settings WHERE key = ?').run(inProgressKey);
    database.prepare('DELETE FROM schema_migrations WHERE version = 15').run();

    runMigrations(database);

    expect(readSetting(pendingKey)).toBe(9);
    expect(readSetting(inProgressKey)).toBe(15);

    database.prepare('UPDATE system_settings SET value_json = ? WHERE key = ?').run(JSON.stringify(22), inProgressKey);
    database.prepare('DELETE FROM schema_migrations WHERE version = 15').run();
    runMigrations(database);

    expect(readSetting(pendingKey)).toBe(9);
    expect(readSetting(inProgressKey)).toBe(22);
  });
});

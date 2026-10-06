import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../apps/server/src/config/env';
import { closeDatabase, LATEST_MIGRATION_VERSION, openDatabase, runMigrations, type SqliteDatabase } from '../../apps/server/src/db/connection';
import { INITIAL_SCHEMA } from '../../apps/server/src/db/migrations/001_initial';

describe('responsible name migration', () => {
  let database: SqliteDatabase;
  let databaseDirectory: string;

  beforeEach(() => {
    databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-responsible-migration-'));
    const config = loadConfig({ nodeEnv: 'test', databasePath: path.join(databaseDirectory, 'hotel.sqlite') });
    database = openDatabase(config);
  });

  afterEach(() => {
    closeDatabase(database);
    fs.rmSync(databaseDirectory, { recursive: true, force: true });
  });

  it('adds nullable request/history attribution to an existing schema without backfilling legacy rows', () => {
    database.exec(INITIAL_SCHEMA);
    const markVersionApplied = database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)');
    for (let version = 1; version <= 15; version += 1) {
      markVersionApplied.run(version, `legacy-${version}`, new Date(0).toISOString());
    }
    database.pragma('foreign_keys = OFF');
    database.prepare(`INSERT INTO requests(
      id, room_id, service_id, responsible_area_id, status, version, created_by_actor_type, created_by_actor_id,
      room_code_snapshot, room_display_name_snapshot, service_code_snapshot, service_display_name_snapshot,
      area_code_snapshot, area_display_name_snapshot, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'IN_PROGRESS', 2, 'DEVICE', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'legacy-request', 'legacy-room', 'legacy-service', 'legacy-area', 'legacy-station',
      '101', 'Room 101', 'Towels', 'Fresh towels', 'HOUSEKEEPING', 'Housekeeping', '2026-01-01T00:00:00.000Z', '2026-01-01T00:01:00.000Z'
    );
    database.prepare(`INSERT INTO request_status_history(
      id, request_id, from_status, to_status, actor_type, actor_id, request_version, created_at
    ) VALUES (?, ?, 'ACCEPTED', 'IN_PROGRESS', 'DEVICE', ?, 2, ?)`).run(
      'legacy-history', 'legacy-request', 'legacy-station', '2026-01-01T00:01:00.000Z'
    );

    runMigrations(database);
    runMigrations(database);

    expect(LATEST_MIGRATION_VERSION).toBe(19);
    expect(database.prepare('SELECT responsible_name FROM requests WHERE id = ?').get('legacy-request')).toEqual({ responsible_name: null });
    expect(database.prepare('SELECT responsible_name FROM request_status_history WHERE id = ?').get('legacy-history')).toEqual({ responsible_name: null });
    expect(database.prepare('SELECT name FROM schema_migrations WHERE version = 16').get()).toEqual({ name: 'request-responsible-name' });
  });
});

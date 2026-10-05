import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyPassword } from '../../apps/server/src/security/crypto';
import { loadConfig } from '../../apps/server/src/config/env';
import type { SqliteDatabase } from '../../apps/server/src/db/connection';
import { closeDatabase, openDatabase, runMigrations } from '../../apps/server/src/db/connection';
import { INITIAL_SCHEMA } from '../../apps/server/src/db/migrations/001_initial';

const FIRST_LOGIN_MIGRATION_VERSION = 19;
const PREVIOUS_MIGRATION_VERSION = FIRST_LOGIN_MIGRATION_VERSION - 1;

interface AdminRow {
  id: string;
  username: string;
  password_hash: string;
  active: number;
  must_change_password: number;
}

describe('admin first-login migration', () => {
  let database: SqliteDatabase;
  let databaseDirectory: string;

  beforeEach(() => {
    databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-admin-first-login-'));
    database = openDatabase(loadConfig({
      nodeEnv: 'test',
      databasePath: path.join(databaseDirectory, 'hotel.sqlite')
    }));
  });

  afterEach(() => {
    closeDatabase(database);
    fs.rmSync(databaseDirectory, { recursive: true, force: true });
  });

  it('seeds one active admin/admin account requiring a password change on an empty database', () => {
    runMigrations(database);

    const admins = database.prepare('SELECT id, username, password_hash, active, must_change_password FROM admins ORDER BY username').all() as AdminRow[];

    expect(admins).toHaveLength(1);
    expect(admins[0]).toMatchObject({ username: 'admin', active: 1, must_change_password: 1 });
    expect(verifyPassword('admin', admins[0]!.password_hash)).toBe(true);
  });

  it('preserves existing administrator credentials and is safe to reapply', () => {
    createVersionEighteenDatabaseWithAdmin(database);

    runMigrations(database);
    const upgradedAdmin = database.prepare('SELECT id, username, password_hash, active, must_change_password FROM admins WHERE id = ?').get('existing-admin') as AdminRow;
    expect(upgradedAdmin).toMatchObject({
      id: 'existing-admin',
      username: 'operator',
      password_hash: 'existing-password-verifier',
      active: 1,
      must_change_password: 0
    });

    database.prepare('DELETE FROM schema_migrations WHERE version = ?').run(FIRST_LOGIN_MIGRATION_VERSION);
    expect(() => runMigrations(database)).not.toThrow();

    const admins = database.prepare('SELECT id, username, password_hash, active, must_change_password FROM admins ORDER BY username').all() as AdminRow[];
    expect(admins).toEqual([upgradedAdmin]);
  });
});

function createVersionEighteenDatabaseWithAdmin(database: SqliteDatabase): void {
  database.exec(INITIAL_SCHEMA);
  const migration = database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)');
  for (let version = 1; version <= PREVIOUS_MIGRATION_VERSION; version += 1) {
    migration.run(version, `legacy-migration-${version}`, '2026-10-05T00:00:00.000Z');
  }
  database.prepare('INSERT INTO admins(id, username, password_hash, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'existing-admin',
    'operator',
    'existing-password-verifier',
    1,
    '2026-10-01T00:00:00.000Z',
    '2026-10-01T00:00:00.000Z'
  );
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../apps/server/src/config/env';
import { closeDatabase, LATEST_MIGRATION_VERSION, openDatabase, runMigrations, type SqliteDatabase } from '../../apps/server/src/db/connection';
import { createBackup, pruneBackups, readMigrationVersion, verifyBackup } from '../../apps/server/src/db/operations';

describe('database operations', () => {
  let database: SqliteDatabase;
  let temporaryDirectory: string;
  let backupDirectory: string;

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-operations-'));
    backupDirectory = path.join(temporaryDirectory, 'backups');
    const config = loadConfig({ nodeEnv: 'test', databasePath: path.join(temporaryDirectory, 'hotel.sqlite') });
    database = openDatabase(config);
    runMigrations(database);
  });

  afterEach(() => {
    closeDatabase(database);
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('creates an integrity-checked backup and checksum sidecar', async () => {
    const config = loadConfig({ nodeEnv: 'test', databasePath: path.join(temporaryDirectory, 'hotel.sqlite') });
    config.backupDirectory = backupDirectory;

    const result = await createBackup(database, config, new Date('2026-08-31T12:34:56.000Z'));

    expect(result.integrityCheck).toBe('ok');
    expect(verifyBackup(result.backupPath)).toEqual({ integrityCheck: 'ok' });
    expect(readMigrationVersion(result.backupPath)).toBe(LATEST_MIGRATION_VERSION);
    expect(fs.readFileSync(result.checksumPath, 'utf8')).toBe(`${result.sha256}  ${path.basename(result.backupPath)}\n`);
  });

  it('removes only expired backup files and their checksum sidecars', () => {
    fs.mkdirSync(backupDirectory, { recursive: true });
    const oldBackup = path.join(backupDirectory, 'hotel-old.sqlite');
    const recentBackup = path.join(backupDirectory, 'hotel-recent.sqlite');
    fs.writeFileSync(oldBackup, 'old');
    fs.writeFileSync(`${oldBackup}.sha256`, 'old-checksum');
    fs.writeFileSync(recentBackup, 'recent');
    const now = new Date('2026-08-31T12:00:00.000Z');
    fs.utimesSync(oldBackup, new Date('2026-07-01T12:00:00.000Z'), new Date('2026-07-01T12:00:00.000Z'));
    fs.utimesSync(recentBackup, new Date('2026-08-30T12:00:00.000Z'), new Date('2026-08-30T12:00:00.000Z'));

    const removed = pruneBackups(backupDirectory, 30, now);

    expect(removed).toEqual([oldBackup]);
    expect(fs.existsSync(oldBackup)).toBe(false);
    expect(fs.existsSync(`${oldBackup}.sha256`)).toBe(false);
    expect(fs.existsSync(recentBackup)).toBe(true);
  });
});

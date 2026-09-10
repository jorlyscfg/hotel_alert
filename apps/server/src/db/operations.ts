import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { ServerConfig } from '../config/env';
import type { SqliteDatabase } from './connection';

export interface BackupResult {
  backupPath: string;
  checksumPath: string;
  sha256: string;
  integrityCheck: 'ok';
  removedBackups: string[];
}

export interface BackupVerification {
  integrityCheck: 'ok';
}

export async function createBackup(database: SqliteDatabase, config: ServerConfig, now = new Date()): Promise<BackupResult> {
  fs.mkdirSync(config.backupDirectory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(config.backupDirectory, `.hotel-${process.pid}-${crypto.randomBytes(8).toString('hex')}.sqlite`);
  const backupPath = path.join(config.backupDirectory, `hotel-${formatTimestamp(now)}.sqlite`);
  const checksumPath = `${backupPath}.sha256`;

  try {
    await database.backup(temporaryPath);
    verifyBackup(temporaryPath);
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, backupPath);
    const sha256 = checksum(backupPath);
    writeChecksum(checksumPath, backupPath, sha256);
    const removedBackups = pruneBackups(config.backupDirectory, config.backupRetentionDays, now, backupPath);
    return { backupPath, checksumPath, sha256, integrityCheck: 'ok', removedBackups };
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.rmSync(temporaryPath, { force: true });
    }
  }
}

export function verifyBackup(filePath: string): BackupVerification {
  const database = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const result = database.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (result.length !== 1 || result[0]?.integrity_check !== 'ok') {
      throw new Error(`SQLite integrity check failed for ${filePath}.`);
    }
    return { integrityCheck: 'ok' };
  } finally {
    database.close();
  }
}

export function verifyBackupChecksum(filePath: string): string | null {
  const checksumPath = `${filePath}.sha256`;
  if (!fs.existsSync(checksumPath)) {
    return null;
  }
  const expected = fs.readFileSync(checksumPath, 'utf8').trim().split(/\s+/u)[0];
  const actual = checksum(filePath);
  if (expected !== actual) {
    throw new Error(`Checksum verification failed for ${filePath}.`);
  }
  return actual;
}

export function readMigrationVersion(filePath: string): number {
  const database = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const row = database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null };
    if (row.version === null) {
      throw new Error(`No applied migrations were found in ${filePath}.`);
    }
    return row.version;
  } finally {
    database.close();
  }
}

export function pruneBackups(directory: string, retentionDays: number, now = new Date(), protectedPath?: string): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith('hotel-') || !entry.name.endsWith('.sqlite')) {
      continue;
    }
    const filePath = path.join(directory, entry.name);
    if (filePath === protectedPath || fs.statSync(filePath).mtimeMs >= cutoff) {
      continue;
    }
    fs.rmSync(filePath);
    fs.rmSync(`${filePath}.sha256`, { force: true });
    removed.push(filePath);
  }
  return removed.sort();
}

function checksum(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeChecksum(checksumPath: string, backupPath: string, sha256: string): void {
  const temporaryPath = `${checksumPath}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  try {
    fs.writeFileSync(temporaryPath, `${sha256}  ${path.basename(backupPath)}\n`, { mode: 0o600, encoding: 'utf8' });
    fs.renameSync(temporaryPath, checksumPath);
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.rmSync(temporaryPath, { force: true });
    }
  }
}

function formatTimestamp(value: Date): string {
  return value.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

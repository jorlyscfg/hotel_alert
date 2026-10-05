import { createId, hashPassword } from '../../security/crypto';
import type { SqliteDatabase } from '../connection';

export function applyAdminFirstLoginPasswordMigration(database: SqliteDatabase): void {
  const adminColumns = database.pragma('table_info(admins)') as Array<{ name: string }>;
  if (!adminColumns.some((column) => column.name === 'must_change_password')) {
    database.exec('ALTER TABLE admins ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1))');
  }

  const adminCount = database.prepare('SELECT COUNT(*) AS count FROM admins').get() as { count: number };
  if (adminCount.count > 0) {
    return;
  }

  const now = new Date().toISOString();
  database.prepare('INSERT INTO admins(id, username, password_hash, active, must_change_password, created_at, updated_at) VALUES (?, ?, ?, 1, 1, ?, ?)').run(
    createId('adm'),
    'admin',
    hashPassword('admin'),
    now,
    now
  );
}

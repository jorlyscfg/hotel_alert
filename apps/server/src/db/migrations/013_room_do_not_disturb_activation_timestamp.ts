import type { SqliteDatabase } from '../connection';

export function applyRoomDoNotDisturbActivationTimestampMigration(database: SqliteDatabase): void {
  const columns = database.pragma('table_info(rooms)') as Array<{ name: string }>;
  if (columns.some((column) => column.name === 'do_not_disturb_activated_at')) return;

  // Existing active DND records intentionally remain unknown until the next activation.
  database.exec('ALTER TABLE rooms ADD COLUMN do_not_disturb_activated_at TEXT');
}

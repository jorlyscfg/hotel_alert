import type { SqliteDatabase } from '../connection';

export function applyRoomDoNotDisturbMigration(database: SqliteDatabase): void {
  const columns = database.pragma('table_info(rooms)') as Array<{ name: string }>;
  if (columns.some((column) => column.name === 'do_not_disturb')) {
    return;
  }
  database.exec('ALTER TABLE rooms ADD COLUMN do_not_disturb INTEGER NOT NULL DEFAULT 0 CHECK (do_not_disturb IN (0, 1))');
}

import type { SqliteDatabase } from '../connection';

export function applyRequestResponsibleNameMigration(database: SqliteDatabase): void {
  database.exec(`
    ALTER TABLE requests ADD COLUMN responsible_name TEXT NULL;
    ALTER TABLE request_status_history ADD COLUMN responsible_name TEXT NULL;
  `);
}

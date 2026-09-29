import type { SqliteDatabase } from '../connection';

const REQUEST_HISTORY_RETENTION_SETTING = 'requests.historyRetentionDays';
const REQUEST_HISTORY_RETENTION_DAYS = 365;

export function applyRequestHistoryRetentionMigration(database: SqliteDatabase): void {
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO system_settings(key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at,
      updated_by_admin_id = NULL
  `).run(REQUEST_HISTORY_RETENTION_SETTING, JSON.stringify(REQUEST_HISTORY_RETENTION_DAYS), now);
}

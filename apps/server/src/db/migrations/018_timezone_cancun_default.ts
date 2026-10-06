import { DEFAULT_SETTINGS } from '@hotel/shared';
import type { SqliteDatabase } from '../connection';

const PREVIOUS_UNCONFIGURED_TIME_ZONE = 'UTC';

export function applyTimeZoneCancunDefaultMigration(database: SqliteDatabase): void {
  database.prepare(`
    UPDATE system_settings
    SET value_json = ?, updated_at = ?
    WHERE key = 'timeZone'
      AND updated_by_admin_id IS NULL
      AND value_json = ?
  `).run(
    JSON.stringify(DEFAULT_SETTINGS.timeZone),
    new Date().toISOString(),
    JSON.stringify(PREVIOUS_UNCONFIGURED_TIME_ZONE)
  );
}

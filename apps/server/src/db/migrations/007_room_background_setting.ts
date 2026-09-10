import { DEFAULT_SETTINGS } from '@hotel/shared';
import type { SqliteDatabase } from '../connection';

export function applyRoomBackgroundSettingMigration(database: SqliteDatabase): void {
  database.prepare('INSERT OR IGNORE INTO system_settings(key, value_json, updated_at) VALUES (?, ?, ?)').run(
    'roomBackground',
    JSON.stringify(DEFAULT_SETTINGS.roomBackground),
    new Date().toISOString()
  );
}

import { DEFAULT_SETTINGS, type SettingKey } from '@hotel/shared';
import type { SqliteDatabase } from '../connection';

const LOCATION_SETTING_KEYS = ['timeZone', 'weatherLocationName', 'weatherLatitude', 'weatherLongitude'] satisfies readonly SettingKey[];

export function applyTimeZoneLocationSettingsMigration(database: SqliteDatabase): void {
  const insert = database.prepare('INSERT OR IGNORE INTO system_settings(key, value_json, updated_at) VALUES (?, ?, ?)');
  const now = new Date().toISOString();
  for (const key of LOCATION_SETTING_KEYS) {
    insert.run(key, JSON.stringify(DEFAULT_SETTINGS[key]), now);
  }
}

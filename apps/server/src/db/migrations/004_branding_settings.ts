import { DEFAULT_SETTINGS } from '@hotel/shared';
import type { SqliteDatabase } from '../connection';

const BRANDING_DEFAULTS = [
  ['hotelName', DEFAULT_SETTINGS.hotelName],
  ['hotelLogo', DEFAULT_SETTINGS.hotelLogo],
  ['clockFormat', DEFAULT_SETTINGS.clockFormat]
] as const;

export function applyBrandingSettingsMigration(database: SqliteDatabase): void {
  const now = new Date().toISOString();
  const insert = database.prepare('INSERT OR IGNORE INTO system_settings(key, value_json, updated_at) VALUES (?, ?, ?)');
  for (const [key, value] of BRANDING_DEFAULTS) {
    insert.run(key, JSON.stringify(value), now);
  }
}

import { DEFAULT_SETTINGS } from '@hotel/shared';
import type { SqliteDatabase } from '../connection';

export function applyInformationCarouselSettingsMigration(database: SqliteDatabase): void {
  const insert = database.prepare('INSERT OR IGNORE INTO system_settings(key, value_json, updated_at) VALUES (?, ?, ?)');
  const now = new Date().toISOString();
  insert.run('information.idleTimeoutSeconds', JSON.stringify(DEFAULT_SETTINGS['information.idleTimeoutSeconds']), now);
  insert.run('information.slideIntervalSeconds', JSON.stringify(DEFAULT_SETTINGS['information.slideIntervalSeconds']), now);
}

import type { SqliteDatabase } from '../connection';

const ADMIN_QUEUE_DELAY_DEFAULTS: ReadonlyArray<readonly [string, number]> = [
  ['requests.pendingDelayWarningMinutes', 3],
  ['requests.inProgressDelayWarningMinutes', 15]
];

export function applyAdminQueueDelayThresholdsMigration(database: SqliteDatabase): void {
  const insert = database.prepare('INSERT OR IGNORE INTO system_settings(key, value_json, updated_at) VALUES (?, ?, ?)');
  const now = new Date().toISOString();

  for (const [key, value] of ADMIN_QUEUE_DELAY_DEFAULTS) {
    insert.run(key, JSON.stringify(value), now);
  }
}

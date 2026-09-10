import type { SqliteDatabase } from '../connection';

export function applyDeviceRetirementMigration(database: SqliteDatabase): void {
  database.exec('ALTER TABLE devices ADD COLUMN retired_at TEXT NULL');
  database.exec('CREATE INDEX IF NOT EXISTS idx_devices_retired_active ON devices(retired_at, active)');
}

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { ServerConfig } from '../config/env';
import { INITIAL_SCHEMA } from './migrations/001_initial';
import { applyDefaultCatalogMigration } from './migrations/002_default_catalog';
import { applyRoomDoNotDisturbMigration } from './migrations/003_room_do_not_disturb';
import { applyBrandingSettingsMigration } from './migrations/004_branding_settings';
import { applyDeviceRetirementMigration } from './migrations/005_device_retirement';
import { applyActiveRoomDeviceAssignmentMigration } from './migrations/006_active_room_device_assignment';
import { applyRoomBackgroundSettingMigration } from './migrations/007_room_background_setting';
import { applyInformationImagesMigration } from './migrations/008_information_images';
import { applyInformationCarouselSettingsMigration } from './migrations/009_information_carousel_settings';
import { applyInformationImageVariantsMigration } from './migrations/010_information_image_variants';
import { applyLocalizedCatalogTextMigration } from './migrations/011_localized_catalog_text';
import { applyInformationImageLocalizationMigration } from './migrations/012_information_image_localization';
import { applyRoomDoNotDisturbActivationTimestampMigration } from './migrations/013_room_do_not_disturb_activation_timestamp';
import { applyRequestHistoryRetentionMigration } from './migrations/014_request_history_retention';
import { applyAdminFirstLoginPasswordMigration } from './migrations/019_admin_first_login_password';

export type SqliteDatabase = Database.Database;
export const LATEST_MIGRATION_VERSION = 19;

interface Migration {
  version: number;
  name: string;
  apply(database: SqliteDatabase): void;
}

const MIGRATIONS: ReadonlyArray<Migration> = [
  {
    version: 1,
    name: 'initial-domain-schema',
    apply: (database) => {
      database.exec(INITIAL_SCHEMA);
      ensureDefaultSettings(database);
    }
  },
  {
    version: 2,
    name: 'default-catalog',
    apply: applyDefaultCatalogMigration
  },
  {
    version: 3,
    name: 'room-do-not-disturb',
    apply: applyRoomDoNotDisturbMigration
  },
  {
    version: 4,
    name: 'branding-settings',
    apply: applyBrandingSettingsMigration
  },
  {
    version: 5,
    name: 'device-retirement',
    apply: applyDeviceRetirementMigration
  },
  {
    version: 6,
    name: 'active-room-device-assignment',
    apply: applyActiveRoomDeviceAssignmentMigration
  },
  {
    version: 7,
    name: 'room-background-setting',
    apply: applyRoomBackgroundSettingMigration
  },
  {
    version: 8,
    name: 'information-images',
    apply: applyInformationImagesMigration
  },
  {
    version: 9,
    name: 'information-carousel-settings',
    apply: applyInformationCarouselSettingsMigration
  },
  {
    version: 10,
    name: 'information-image-variants',
    apply: applyInformationImageVariantsMigration
  },
  {
    version: 11,
    name: 'localized-catalog-text',
    apply: applyLocalizedCatalogTextMigration
  },
  {
    version: 12,
    name: 'information-image-localization',
    apply: applyInformationImageLocalizationMigration
  },
  {
    version: 13,
    name: 'room-do-not-disturb-activation-timestamp',
    apply: applyRoomDoNotDisturbActivationTimestampMigration
  },
  {
    version: 14,
    name: 'request-history-retention-one-year',
    apply: applyRequestHistoryRetentionMigration
  },
  {
    version: 19,
    name: 'admin-first-login-password',
    apply: applyAdminFirstLoginPasswordMigration
  }
];

export function openDatabase(config: ServerConfig): SqliteDatabase {
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  const db = new Database(config.databasePath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('busy_timeout = 5000');
  return db;
}

export function runMigrations(db: SqliteDatabase): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const hasPendingMigration = MIGRATIONS.some((migration) => db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(migration.version) === undefined);
  if (!hasPendingMigration) {
    return;
  }
  const apply = db.transaction(() => {
    for (const migration of MIGRATIONS) {
      const applied = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(migration.version) as { version: number } | undefined;
      if (applied !== undefined) {
        continue;
      }
      migration.apply(db);
      db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(migration.version, migration.name, new Date().toISOString());
    }
  });
  apply.immediate();
}

function ensureDefaultSettings(db: SqliteDatabase): void {
  const defaults: ReadonlyArray<readonly [string, number]> = [
    ['heartbeat.intervalMs', 15000],
    ['heartbeat.staleAfterMs', 45000],
    ['heartbeat.offlineAfterMs', 90000],
    ['alerts.pendingRepeatMs', 5000],
    ['realtime.replayMinMinutes', 60],
    ['realtime.replayMaxEvents', 100000],
    ['requests.pageSizeDefault', 50],
    ['requests.historyRetentionDays', 365],
    ['idempotency.retentionHours', 72],
    ['client.offlineQueueTtlHours', 48],
    ['audit.retentionDays', 180]
  ];
  const insert = db.prepare('INSERT OR IGNORE INTO system_settings(key, value_json, updated_at) VALUES (?, ?, ?)');
  const now = new Date().toISOString();
  for (const [key, value] of defaults) {
    insert.run(key, JSON.stringify(value), now);
  }
}

export function closeDatabase(db: SqliteDatabase): void {
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
}

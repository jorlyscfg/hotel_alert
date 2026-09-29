import { DEFAULT_SETTINGS } from '@hotel/shared';
import type { SqliteDatabase } from '../connection';

/** Adds language-tagged artwork without reclassifying or rewriting legacy carousel files. */
export function applyInformationImageLocalizationMigration(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS information_image_localized_variants (
      information_image_id TEXT NOT NULL REFERENCES information_images(id) ON DELETE CASCADE,
      language TEXT NOT NULL CHECK (language IN ('en', 'es')),
      variant TEXT NOT NULL CHECK (variant IN ('square480', 'wide')),
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
      byte_size INTEGER NOT NULL CHECK (byte_size > 0),
      storage_name TEXT NOT NULL UNIQUE,
      PRIMARY KEY (information_image_id, language, variant)
    );
    CREATE INDEX IF NOT EXISTS idx_information_image_localized_variants_lookup
      ON information_image_localized_variants(information_image_id, language, variant);
  `);

  database.prepare('INSERT OR IGNORE INTO system_settings(key, value_json, updated_at) VALUES (?, ?, ?)')
    .run('hotelNameEn', JSON.stringify(DEFAULT_SETTINGS.hotelNameEn), new Date().toISOString());
}

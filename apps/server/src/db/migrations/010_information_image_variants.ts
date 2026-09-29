import type { SqliteDatabase } from '../connection';

export function applyInformationImageVariantsMigration(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS information_image_variants (
      information_image_id TEXT NOT NULL REFERENCES information_images(id) ON DELETE CASCADE,
      variant TEXT NOT NULL CHECK (variant IN ('square480', 'wide')),
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
      byte_size INTEGER NOT NULL CHECK (byte_size > 0),
      storage_name TEXT NOT NULL UNIQUE,
      PRIMARY KEY (information_image_id, variant)
    );
    CREATE INDEX IF NOT EXISTS idx_information_image_variants_image ON information_image_variants(information_image_id, variant);
  `);
}

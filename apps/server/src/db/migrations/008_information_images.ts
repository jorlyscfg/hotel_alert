import type { SqliteDatabase } from '../connection';

export function applyInformationImagesMigration(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS information_images (
      id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
      byte_size INTEGER NOT NULL CHECK (byte_size > 0),
      storage_name TEXT NOT NULL UNIQUE,
      display_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_information_images_order ON information_images(display_order, id);
  `);
}

import type { SqliteDatabase } from '../connection';

export function applyLocalizedCatalogTextMigration(database: SqliteDatabase): void {
  database.exec(`
    ALTER TABLE areas ADD COLUMN display_name_variants_json TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE areas ADD COLUMN description_variants_json TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE services ADD COLUMN display_name_variants_json TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE services ADD COLUMN description_variants_json TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE requests ADD COLUMN service_display_name_variants_snapshot_json TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE requests ADD COLUMN area_display_name_variants_snapshot_json TEXT NOT NULL DEFAULT '{}';
  `);
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../apps/server/src/config/env';
import { closeDatabase, openDatabase, type SqliteDatabase } from '../../apps/server/src/db/connection';
import { INITIAL_SCHEMA } from '../../apps/server/src/db/migrations/001_initial';
import { applyLocalizedCatalogTextMigration } from '../../apps/server/src/db/migrations/011_localized_catalog_text';

describe('localized catalog text migration', () => {
  let database: SqliteDatabase;
  let databaseDirectory: string;

  beforeEach(() => {
    databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-localized-catalog-'));
    database = openDatabase(loadConfig({ nodeEnv: 'test', databasePath: path.join(databaseDirectory, 'hotel.sqlite') }));
    database.exec(INITIAL_SCHEMA);
  });

  afterEach(() => {
    closeDatabase(database);
    fs.rmSync(databaseDirectory, { recursive: true, force: true });
  });

  it('preserves legacy Spanish catalog fields and initializes English variants as missing', () => {
    database.exec(INITIAL_SCHEMA);
    database.prepare('INSERT INTO areas(id, code, display_name, description, display_order, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      'custom-area', 'custom-area', 'Limpieza nocturna', 'Servicio de limpieza por la noche', 1, 1, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'
    );
    database.prepare('INSERT INTO services(id, code, display_name, description, icon_key, area_id, display_order, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'custom-service', 'custom-service', 'Preparar cuna', 'Solicitar una cuna para bebé', 'bell', 'custom-area', 1, 1, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'
    );

    applyLocalizedCatalogTextMigration(database);

    expect(database.prepare('SELECT display_name, display_name_variants_json, description, description_variants_json FROM areas WHERE id = ?').get('custom-area')).toEqual({
      display_name: 'Limpieza nocturna',
      display_name_variants_json: '{}',
      description: 'Servicio de limpieza por la noche',
      description_variants_json: '{}'
    });
    expect(database.prepare('SELECT display_name, display_name_variants_json, description, description_variants_json FROM services WHERE id = ?').get('custom-service')).toEqual({
      display_name: 'Preparar cuna',
      display_name_variants_json: '{}',
      description: 'Solicitar una cuna para bebé',
      description_variants_json: '{}'
    });
    const requestColumns = (database.prepare('PRAGMA table_info(requests)').all() as Array<{ name: string }>).map((column) => column.name);
    expect(requestColumns).toContain('service_display_name_variants_snapshot_json');
    expect(requestColumns).toContain('area_display_name_variants_snapshot_json');
  });
});

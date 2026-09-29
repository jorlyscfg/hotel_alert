import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../apps/server/src/config/env';
import type { SqliteDatabase } from '../../apps/server/src/db/connection';
import { closeDatabase, openDatabase } from '../../apps/server/src/db/connection';
import { applyRoomDoNotDisturbActivationTimestampMigration } from '../../apps/server/src/db/migrations/013_room_do_not_disturb_activation_timestamp';

describe('room do-not-disturb activation timestamp migration', () => {
  let database: SqliteDatabase;
  let databaseDirectory: string;

  beforeEach(() => {
    databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-room-dnd-migration-'));
    const config = loadConfig({
      nodeEnv: 'test',
      databasePath: path.join(databaseDirectory, 'hotel.sqlite'),
      sessionSecret: 'session-secret',
      tokenPepper: 'token-pepper'
    });
    database = openDatabase(config);
    database.exec(`
      CREATE TABLE rooms (
        id TEXT PRIMARY KEY,
        do_not_disturb INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )
    `);
    database.prepare('INSERT INTO rooms(id, do_not_disturb, updated_at) VALUES (?, ?, ?)').run(
      'legacy-active-room',
      1,
      '2026-08-31T11:00:00.000Z'
    );
  });

  afterEach(() => {
    closeDatabase(database);
    fs.rmSync(databaseDirectory, { recursive: true, force: true });
  });

  it('leaves active legacy rooms with an unknown activation time and is idempotent', () => {
    applyRoomDoNotDisturbActivationTimestampMigration(database);

    expect(database.prepare('SELECT do_not_disturb, do_not_disturb_activated_at, updated_at FROM rooms WHERE id = ?').get('legacy-active-room'))
      .toEqual({
        do_not_disturb: 1,
        do_not_disturb_activated_at: null,
        updated_at: '2026-08-31T11:00:00.000Z'
      });

    expect(() => applyRoomDoNotDisturbActivationTimestampMigration(database)).not.toThrow();
    expect(database.prepare('SELECT do_not_disturb_activated_at FROM rooms WHERE id = ?').get('legacy-active-room'))
      .toEqual({ do_not_disturb_activated_at: null });
  });
});

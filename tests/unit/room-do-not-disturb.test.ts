import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, type ServerConfig } from '../../apps/server/src/config/env';
import { closeDatabase, openDatabase, runMigrations, type SqliteDatabase } from '../../apps/server/src/db/connection';
import { HotelService } from '../../apps/server/src/domain/hotel-service';
import type { Actor } from '../../apps/server/src/security/principal';

const systemActor: Actor = { actorType: 'SYSTEM', actorId: null };

describe('room do-not-disturb state', () => {
  let database: SqliteDatabase;
  let databaseDirectory: string;
  let config: ServerConfig;
  let service: HotelService;

  beforeEach(() => {
    databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-room-dnd-'));
    config = loadConfig({
      nodeEnv: 'test',
      databasePath: path.join(databaseDirectory, 'hotel.sqlite'),
      sessionSecret: 'session-secret',
      tokenPepper: 'token-pepper'
    });
    database = openDatabase(config);
    runMigrations(database);
    service = new HotelService(database, config);
  });

  afterEach(() => {
    closeDatabase(database);
    fs.rmSync(databaseDirectory, { recursive: true, force: true });
  });

  it('persists do-not-disturb in the room snapshot and emits a durable room update', () => {
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const device = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device');
    const principal = service.authenticateDeviceToken(device.deviceToken).principal;

    const result = service.setRoomDoNotDisturb(principal, true, 'room-dnd-101', 'room-dnd-request');

    expect(result).toMatchObject({ idempotentReplay: false, data: { id: room.id, doNotDisturb: true } });
    expect(service.getRoom(room.id)).toMatchObject({ id: room.id, doNotDisturb: true });
    expect(service.getDeviceSnapshot(principal).config.room).toMatchObject({ id: room.id, doNotDisturb: true });
    expect(database.prepare("SELECT event_name, aggregate_type, aggregate_id, payload_json FROM outbox_events WHERE event_name = 'room.updated'").get()).toMatchObject({
      event_name: 'room.updated',
      aggregate_type: 'ROOM',
      aggregate_id: room.id
    });
  });
});

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

  it('clears room DND and publishes room updates when its ROOM station leaves', () => {
    const area = service.createArea({ code: 'dnd-housekeeping', displayName: 'Housekeeping' }, systemActor, 'setup-area');
    const rooms = ['101', '102', '103'].map((code) => service.createRoom({ code, displayName: `Room ${code}` }, systemActor, `setup-room-${code}`));
    const devices = rooms.map((room, index) => service.bootstrapDevice({
      installationId: `installation-${room.code}`,
      displayName: `Room ${room.code} tablet`,
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, `setup-device-${index}`));
    const roomPrincipals = devices.map((device) => service.authenticateDeviceToken(device.deviceToken).principal);
    roomPrincipals.forEach((principal, index) => service.setRoomDoNotDisturb(principal, true, `enable-${index}`, `enable-${index}`));
    const areaDevice = service.bootstrapDevice({
      installationId: 'installation-housekeeping',
      displayName: 'Housekeeping console',
      assignmentMode: 'AREA',
      areaId: area.id
    }, systemActor, 'setup-area-device');
    const areaPrincipal = service.authenticateDeviceToken(areaDevice.deviceToken).principal;
    const admin = service.createAdmin({ username: 'dnd-admin', password: 'correct-horse-battery-staple' }, systemActor, 'setup-admin');
    const adminPrincipal = service.authenticateAdmin(service.loginAdmin(
      admin.username, 'correct-horse-battery-staple', 'login-admin', undefined, undefined
    ).sessionToken);
    const latestRoomUpdate = (roomId: string) => database.prepare(
      "SELECT payload_json FROM outbox_events WHERE event_name = 'room.updated' AND aggregate_id = ? ORDER BY rowid DESC LIMIT 1"
    ).get(roomId) as { payload_json: string } | undefined;

    service.assignDevice(adminPrincipal, devices[0]!.device.id, {
      expectedDeviceConfigVersion: devices[0]!.device.deviceConfigVersion,
      assignmentMode: 'AREA',
      roomId: null,
      areaId: area.id,
      reason: 'Move station to the housekeeping console'
    }, 'move-device-101');

    service.patchDevice(adminPrincipal, devices[1]!.device.id, {
      active: false,
      expectedDeviceConfigVersion: devices[1]!.device.deviceConfigVersion
    }, 'deactivate-device-102');

    service.retireDevice(adminPrincipal, devices[2]!.device.id, 'retire-device-103', 'retire-device-103');

    expect.soft(rooms.map((room) => service.getRoom(room.id)?.doNotDisturb)).toEqual([false, false, false]);
    expect.soft(rooms.map((room) => JSON.parse(latestRoomUpdate(room.id)!.payload_json).room.doNotDisturb)).toEqual([false, false, false]);
    expect.soft((service.getDeviceSnapshot(areaPrincipal) as { activeDoNotDisturbRooms: Array<{ id: string }> }).activeDoNotDisturbRooms).toEqual([]);
  });
});

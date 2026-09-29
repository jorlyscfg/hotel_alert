import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    const area = service.createArea({ code: 'dnd-test-area-101', displayName: 'DND Test Area 101' }, systemActor, 'setup-area');
    const areaDevice = service.bootstrapDevice({
      installationId: 'installation-housekeeping',
      displayName: 'Housekeeping console',
      assignmentMode: 'AREA',
      areaId: area.id
    }, systemActor, 'setup-area-device');
    const areaPrincipal = service.authenticateDeviceToken(areaDevice.deviceToken).principal;

    const result = service.setRoomDoNotDisturb(principal, true, 'room-dnd-101', 'room-dnd-request');

    expect(result).toMatchObject({ idempotentReplay: false, data: { id: room.id, doNotDisturb: true } });
    expect(service.getRoom(room.id)).toMatchObject({ id: room.id, doNotDisturb: true });
    expect(service.getDeviceSnapshot(principal).config.room).toMatchObject({ id: room.id, doNotDisturb: true });
    expect(service.getDeviceSnapshot(areaPrincipal).activeDoNotDisturbRooms?.[0]?.doNotDisturbActivatedAt).toBeTypeOf('string');
    expect(database.prepare("SELECT event_name, aggregate_type, aggregate_id, payload_json FROM outbox_events WHERE event_name = 'room.updated'").get()).toMatchObject({
      event_name: 'room.updated',
      aggregate_type: 'ROOM',
      aggregate_id: room.id
    });
  });

  it('sets the activation timestamp when a room is created with do-not-disturb enabled', () => {
    vi.useFakeTimers();
    try {
      const activationTime = '2026-08-31T12:00:00.000Z';
      vi.setSystemTime(new Date(activationTime));

      const activeRoom = service.createRoom({
        code: 'created-active',
        displayName: 'Active DND room',
        doNotDisturb: true
      }, systemActor, 'setup-active-room');
      const inactiveRoom = service.createRoom({
        code: 'created-inactive',
        displayName: 'Inactive DND room'
      }, systemActor, 'setup-inactive-room');

      expect(database.prepare('SELECT do_not_disturb_activated_at FROM rooms WHERE id = ?').get(activeRoom.id))
        .toEqual({ do_not_disturb_activated_at: activationTime });
      expect(database.prepare('SELECT do_not_disturb_activated_at FROM rooms WHERE id = ?').get(inactiveRoom.id))
        .toEqual({ do_not_disturb_activated_at: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps nullable activation time to the RoomDTO', () => {
    const knownTime = '2026-08-31T12:00:00.000Z';
    const knownRoom = service.createRoom({ code: 'known-time', displayName: 'Known time' }, systemActor, 'setup-known-room');
    const unknownRoom = service.createRoom({ code: 'unknown-time', displayName: 'Unknown time' }, systemActor, 'setup-unknown-room');
    database.prepare('UPDATE rooms SET do_not_disturb = 1, do_not_disturb_activated_at = ? WHERE id = ?').run(knownTime, knownRoom.id);

    expect(service.getRoom(knownRoom.id)?.doNotDisturbActivatedAt).toBe(knownTime);
    expect(service.getRoom(unknownRoom.id)?.doNotDisturbActivatedAt).toBeNull();
  });

  it('initializes a legacy active room with unknown time on explicit enable and refreshes AREA snapshots', () => {
    const room = service.createRoom({ code: 'legacy-active', displayName: 'Legacy active room' }, systemActor, 'setup-legacy-room');
    const roomDevice = service.bootstrapDevice({
      installationId: 'installation-legacy-active',
      displayName: 'Legacy room tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-room-device');
    const roomPrincipal = service.authenticateDeviceToken(roomDevice.deviceToken).principal;
    const area = service.createArea({ code: 'legacy-dnd-area', displayName: 'Legacy DND area' }, systemActor, 'setup-area');
    const areaDevice = service.bootstrapDevice({
      installationId: 'installation-legacy-area',
      displayName: 'Housekeeping console',
      assignmentMode: 'AREA',
      areaId: area.id
    }, systemActor, 'setup-area-device');
    const areaPrincipal = service.authenticateDeviceToken(areaDevice.deviceToken).principal;

    database.prepare('UPDATE rooms SET do_not_disturb = 1, do_not_disturb_activated_at = NULL, updated_at = ? WHERE id = ?')
      .run('2020-01-01T00:00:00.000Z', room.id);

    vi.useFakeTimers();
    try {
      const activationTime = '2026-08-31T12:00:00.000Z';
      vi.setSystemTime(new Date(activationTime));
      const result = service.setRoomDoNotDisturb(roomPrincipal, true, 'repair-legacy-dnd', 'repair-legacy-dnd');
      const snapshotRoom = service.getDeviceSnapshot(areaPrincipal).activeDoNotDisturbRooms?.[0];
      const roomUpdate = database.prepare(
        "SELECT payload_json FROM outbox_events WHERE event_name = 'room.updated' AND aggregate_id = ? ORDER BY rowid DESC LIMIT 1"
      ).get(room.id) as { payload_json: string } | undefined;

      expect.soft(result.data).toMatchObject({ id: room.id, doNotDisturb: true, doNotDisturbActivatedAt: activationTime });
      expect.soft(snapshotRoom).toMatchObject({ id: room.id, doNotDisturb: true, doNotDisturbActivatedAt: activationTime });
      expect.soft(roomUpdate && JSON.parse(roomUpdate.payload_json).room)
        .toMatchObject({ id: room.id, doNotDisturb: true, doNotDisturbActivatedAt: activationTime });
    } finally {
      vi.useRealTimers();
    }
  });

  it('sets DND activation time on transitions, preserves it on room edits, and resets it after reactivation', () => {
    const room = service.createRoom({ code: '201', displayName: 'Room 201' }, systemActor, 'setup-room');
    const device = service.bootstrapDevice({
      installationId: 'installation-201',
      displayName: 'Room 201 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device');
    const principal = service.authenticateDeviceToken(device.deviceToken).principal;
    const area = service.createArea({ code: 'dnd-test-area-201', displayName: 'DND Test Area 201' }, systemActor, 'setup-area');
    const areaDevice = service.bootstrapDevice({
      installationId: 'installation-housekeeping',
      displayName: 'Housekeeping console',
      assignmentMode: 'AREA',
      areaId: area.id
    }, systemActor, 'setup-area-device');
    const areaPrincipal = service.authenticateDeviceToken(areaDevice.deviceToken).principal;
    const readActivationTime = () => service.getDeviceSnapshot(areaPrincipal).activeDoNotDisturbRooms?.[0]?.doNotDisturbActivatedAt;

    vi.useFakeTimers();
    try {
      const firstActivation = '2026-08-31T12:05:00.000Z';
      vi.setSystemTime(new Date(firstActivation));
      service.setRoomDoNotDisturb(principal, true, 'enable-first', 'enable-first');
      expect(readActivationTime()).toBe(firstActivation);

      vi.setSystemTime(new Date('2026-08-31T12:06:00.000Z'));
      service.setRoomDoNotDisturb(principal, true, 'enable-repeat', 'enable-repeat');
      const currentRoom = service.getRoom(room.id)!;
      service.patchRoom(room.id, {
        displayName: 'Updated Room 201',
        expectedUpdatedAt: currentRoom.updatedAt
      }, systemActor, 'update-room');
      expect(readActivationTime()).toBe(firstActivation);

      vi.setSystemTime(new Date('2026-08-31T12:07:00.000Z'));
      service.setRoomDoNotDisturb(principal, false, 'disable', 'disable');
      expect(database.prepare('SELECT do_not_disturb_activated_at FROM rooms WHERE id = ?').get(room.id)).toEqual({ do_not_disturb_activated_at: null });

      const updatedRoom = service.getRoom(room.id)!;
      const secondActivation = '2026-08-31T12:08:00.000Z';
      vi.setSystemTime(new Date(secondActivation));
      service.patchRoom(room.id, {
        doNotDisturb: true,
        expectedUpdatedAt: updatedRoom.updatedAt
      }, systemActor, 'admin-enable-room-dnd');
      expect(readActivationTime()).toBe(secondActivation);
    } finally {
      vi.useRealTimers();
    }
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
    expect.soft(rooms.map((room) => (database.prepare('SELECT do_not_disturb_activated_at FROM rooms WHERE id = ?').get(room.id) as { do_not_disturb_activated_at: string | null }).do_not_disturb_activated_at)).toEqual([null, null, null]);
    expect.soft(rooms.map((room) => JSON.parse(latestRoomUpdate(room.id)!.payload_json).room.doNotDisturb)).toEqual([false, false, false]);
    expect.soft((service.getDeviceSnapshot(areaPrincipal) as { activeDoNotDisturbRooms: Array<{ id: string }> }).activeDoNotDisturbRooms).toEqual([]);
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RequestDTO } from '@hotel/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, type ServerConfig } from '../../apps/server/src/config/env';
import { closeDatabase, openDatabase, runMigrations, type SqliteDatabase } from '../../apps/server/src/db/connection';
import { HotelService, type RequestFilters } from '../../apps/server/src/domain/hotel-service';
import { AppError } from '../../apps/server/src/errors';
import type { Actor } from '../../apps/server/src/security/principal';

const systemActor: Actor = { actorType: 'SYSTEM', actorId: null };

describe('HotelService request access', () => {
  let database: SqliteDatabase;
  let databaseDirectory: string;
  let config: ServerConfig;
  let service: HotelService;

  beforeEach(() => {
    databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-service-'));
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

  it('allows a room device to read its own request and history', () => {
    const area = service.createArea({ code: 'test-housekeeping', displayName: 'Housekeeping' }, systemActor, 'setup-area');
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const catalogService = service.createService({
      code: 'test-towels',
      displayName: 'Fresh towels',
      areaId: area.id
    }, systemActor, 'setup-service');
    const bootstrap = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device');
    const principal = service.authenticateDeviceToken(bootstrap.deviceToken).principal;

    const created = service.createRequest(principal, catalogService.id, 'request-key-101', 'request-101').data;

    expect(service.getAuthorizedRequest(principal, created.id)).toEqual(created);
    expect(service.getRequestHistory(principal, created.id)).toHaveLength(1);
  });

  it('rejects new requests while do-not-disturb is active and preserves successful idempotent replays', () => {
    const area = service.createArea({ code: 'dnd-housekeeping', displayName: 'Housekeeping' }, systemActor, 'dnd-setup-area');
    const room = service.createRoom({ code: 'dnd-101', displayName: 'Room 101' }, systemActor, 'dnd-setup-room');
    const catalogService = service.createService({
      code: 'dnd-towels',
      displayName: 'Fresh towels',
      areaId: area.id
    }, systemActor, 'dnd-setup-service');
    const device = service.bootstrapDevice({
      installationId: 'dnd-installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'dnd-setup-device');
    const principal = service.authenticateDeviceToken(device.deviceToken).principal;

    service.setRoomDoNotDisturb(principal, true, 'dnd-enable', 'dnd-enable');
    let dndError: unknown;
    try {
      service.createRequest(principal, catalogService.id, 'blocked-request-key', 'blocked-request');
    } catch (error) {
      dndError = error;
    }

    expect(dndError).toBeInstanceOf(AppError);
    expect(dndError).toMatchObject({ code: 'RESOURCE_CONFLICT', statusCode: 409 });
    expect((database.prepare('SELECT COUNT(*) AS count FROM requests WHERE room_id = ?').get(room.id) as { count: number }).count).toBe(0);

    service.setRoomDoNotDisturb(principal, false, 'dnd-disable', 'dnd-disable');
    const created = service.createRequest(principal, catalogService.id, 'replay-request-key', 'replay-request');
    expect(created.idempotentReplay).toBe(false);
    service.setRoomDoNotDisturb(principal, true, 'dnd-enable-again', 'dnd-enable-again');

    const replayed = service.createRequest(principal, catalogService.id, 'replay-request-key', 'replay-request-again');

    expect(replayed.idempotentReplay).toBe(true);
    expect(replayed.data).toEqual(created.data);
    expect((database.prepare('SELECT COUNT(*) AS count FROM requests WHERE room_id = ?').get(room.id) as { count: number }).count).toBe(1);
  });
  it('includes the configured service icon in request references', () => {
    const area = service.createArea({ code: 'test-maintenance', displayName: 'Maintenance' }, systemActor, 'setup-area');
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const catalogService = service.createService({
      code: 'test-repair',
      displayName: 'Room repair',
      iconKey: 'maintenance',
      areaId: area.id
    }, systemActor, 'setup-service');
    const device = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device');
    const principal = service.authenticateDeviceToken(device.deviceToken).principal;

    const created = service.createRequest(principal, catalogService.id, 'request-key-101', 'request-101').data;

    expect(created.service).toMatchObject({
      id: catalogService.id,
      code: 'test-repair',
      displayName: 'Room repair',
      iconKey: 'maintenance'
    });
    expect(service.listRequests()[0]?.service.iconKey).toBe('maintenance');
  });

  it('filters admin requests by creating device and date range', () => {
    const area = service.createArea({ code: 'test-housekeeping', displayName: 'Housekeeping' }, systemActor, 'setup-area');
    const firstRoom = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room-1');
    const secondRoom = service.createRoom({ code: '202', displayName: 'Room 202' }, systemActor, 'setup-room-2');
    const catalogService = service.createService({ code: 'test-towels', displayName: 'Fresh towels', areaId: area.id }, systemActor, 'setup-service');
    const firstDevice = service.bootstrapDevice({ installationId: 'installation-101', displayName: 'Room 101 tablet', assignmentMode: 'ROOM', roomId: firstRoom.id }, systemActor, 'setup-device-1');
    const secondDevice = service.bootstrapDevice({ installationId: 'installation-202', displayName: 'Room 202 tablet', assignmentMode: 'ROOM', roomId: secondRoom.id }, systemActor, 'setup-device-2');
    const firstRequest = service.createRequest(service.authenticateDeviceToken(firstDevice.deviceToken).principal, catalogService.id, 'request-key-101', 'request-101').data;
    const secondRequest = service.createRequest(service.authenticateDeviceToken(secondDevice.deviceToken).principal, catalogService.id, 'request-key-202', 'request-202').data;
    database.prepare('UPDATE requests SET created_at = ?, updated_at = ? WHERE id = ?').run('2026-08-15T09:00:00.000Z', '2026-08-15T09:00:00.000Z', firstRequest.id);
    database.prepare('UPDATE requests SET created_at = ?, updated_at = ? WHERE id = ?').run('2026-09-02T09:00:00.000Z', '2026-09-02T09:00:00.000Z', secondRequest.id);

    const filtered = service.listRequests({
      deviceId: firstDevice.device.id,
      createdFrom: '2026-08-01T00:00:00.000Z',
      createdTo: '2026-09-01T00:00:00.000Z'
    });
    const adminRequest = service.getAdminSnapshot().requests.find((request) => request.id === firstRequest.id);

    expect(filtered.map((request) => request.id)).toEqual([firstRequest.id]);
    expect(adminRequest?.createdByDeviceId).toBe(firstDevice.device.id);
  });

  it('returns a stable request page with an opaque cursor while preserving array callers', () => {
    const area = service.createArea({ code: 'test-housekeeping', displayName: 'Housekeeping' }, systemActor, 'setup-area');
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const catalogService = service.createService({ code: 'test-towels', displayName: 'Fresh towels', areaId: area.id }, systemActor, 'setup-service');
    const device = service.bootstrapDevice({ installationId: 'installation-101', displayName: 'Room 101 tablet', assignmentMode: 'ROOM', roomId: room.id }, systemActor, 'setup-device');
    const principal = service.authenticateDeviceToken(device.deviceToken).principal;
    const firstRequest = service.createRequest(principal, catalogService.id, 'request-key-1', 'request-1').data;
    const secondRequest = service.createRequest(principal, catalogService.id, 'request-key-2', 'request-2').data;
    const createdAt = '2026-08-31T09:00:00.000Z';
    database.prepare('UPDATE requests SET created_at = ?, updated_at = ? WHERE id IN (?, ?)').run(createdAt, createdAt, firstRequest.id, secondRequest.id);
    const expectedIds = [firstRequest.id, secondRequest.id].sort().reverse();
    type RequestPage = { data: RequestDTO[]; page: { nextCursor: string | null; hasMore: boolean } };
    const listRequestsPage = (service as HotelService & {
      listRequestsPage(filters?: RequestFilters): RequestPage;
    }).listRequestsPage.bind(service);

    const firstPage = listRequestsPage({ limit: 1 });
    const secondPage = listRequestsPage({ limit: 1, cursor: firstPage.page.nextCursor ?? '' });

    expect(firstPage.data.map((request) => request.id)).toEqual([expectedIds[0]]);
    expect(firstPage.page).toMatchObject({ hasMore: true });
    expect(firstPage.page.nextCursor).toEqual(expect.any(String));
    expect(secondPage.data.map((request) => request.id)).toEqual([expectedIds[1]]);
    expect(secondPage.page).toEqual({ nextCursor: null, hasMore: false });
    expect(service.listRequests({ limit: 1 })).toHaveLength(1);
    expect(firstPage.data[0]).not.toHaveProperty('created_by_actor_id');
  });

  it('filters replay events to the authenticated device scope', () => {
    const secondArea = service.createArea({ code: 'test-maintenance', displayName: 'Maintenance' }, systemActor, 'setup-area-2');
    const firstRoom = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room-1');
    const secondRoom = service.createRoom({ code: '202', displayName: 'Room 202' }, systemActor, 'setup-room-2');
    const secondService = service.createService({ code: 'test-repair', displayName: 'Repair', areaId: secondArea.id }, systemActor, 'setup-service-2');
    const firstDevice = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: firstRoom.id
    }, systemActor, 'setup-device-1');
    const secondDevice = service.bootstrapDevice({
      installationId: 'installation-202',
      displayName: 'Room 202 tablet',
      assignmentMode: 'ROOM',
      roomId: secondRoom.id
    }, systemActor, 'setup-device-2');
    const firstPrincipal = service.authenticateDeviceToken(firstDevice.deviceToken).principal;
    const secondPrincipal = service.authenticateDeviceToken(secondDevice.deviceToken).principal;
    const cursor = service.getReplayPlan(undefined, firstDevice.device.deviceConfigVersion, firstPrincipal).currentEventSequence;

    service.createRequest(secondPrincipal, secondService.id, 'request-key-202', 'request-202');

    const replay = service.getReplayPlan(cursor, firstDevice.device.deviceConfigVersion, firstPrincipal);

    expect(replay.events).toHaveLength(0);
  });

  it('rejects ephemeral presence events before storing them in the outbox', () => {
    const appendOutbox = Reflect.get(service, 'appendOutbox') as (
      eventName: string,
      aggregateType: 'DEVICE',
      aggregateId: string,
      aggregateVersion: number | null,
      payload: unknown
    ) => number;

    expect(() => appendOutbox.call(service, 'device.presence.changed', 'DEVICE', 'device-1', null, {
      deviceId: 'device-1',
      presence: 'ONLINE',
      lastSeenAt: null
    })).toThrowError(/ephemeral.*presence.*outbox/i);
    expect((database.prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE event_name = 'device.presence.changed'").get() as { count: number }).count).toBe(0);
  });

  it('does not return legacy presence rows as replayable durable events', () => {
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const device = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device');
    const principal = service.authenticateDeviceToken(device.deviceToken).principal;
    const cursor = service.getReplayPlan(undefined, device.device.deviceConfigVersion, principal).currentEventSequence;
    const admin = service.createAdmin({ username: 'replay-admin', password: 'correct-horse-battery-staple' }, systemActor, 'setup-admin');
    const adminPrincipal = service.authenticateAdmin(service.loginAdmin(admin.username, 'correct-horse-battery-staple', 'login-admin').sessionToken);

    database.prepare('INSERT INTO outbox_events(event_id, event_name, aggregate_type, aggregate_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      'evt-legacy-presence',
      'device.presence.changed',
      'DEVICE',
      device.device.id,
      JSON.stringify({ deviceId: device.device.id, presence: 'ONLINE', lastSeenAt: null }),
      new Date().toISOString()
    );

    expect(service.getReplayPlan(cursor, device.device.deviceConfigVersion, principal).events).toHaveLength(0);
    expect(service.getReplayPlan(cursor, undefined, adminPrincipal).events).toHaveLength(0);
  });

  it('requires a full snapshot when a device cursor is behind a system maintenance event', () => {
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const device = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device');
    const principal = service.authenticateDeviceToken(device.deviceToken).principal;
    const cursor = service.getReplayPlan(undefined, device.device.deviceConfigVersion, principal).currentEventSequence;

    database.prepare('INSERT INTO outbox_events(event_id, event_name, aggregate_type, aggregate_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      'evt-settings-maintenance',
      'system.maintenance',
      'SYSTEM',
      'settings',
      JSON.stringify({ message: 'Configuration revision 2 applied.', severity: 'INFO' }),
      new Date().toISOString()
    );

    const replay = service.getReplayPlan(cursor, device.device.deviceConfigVersion, principal);

    expect(replay.sync).toBe('FULL_SNAPSHOT_REQUIRED');
    expect(replay.reason).toBe('EVENT_GAP');
    expect(replay.events).toHaveLength(0);
  });

  it('requires a full snapshot when the replay cursor exceeds the configured event window', () => {
    const area = service.createArea({ code: 'test-housekeeping', displayName: 'Housekeeping' }, systemActor, 'setup-area');
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const catalogService = service.createService({ code: 'test-towels', displayName: 'Fresh towels', areaId: area.id }, systemActor, 'setup-service');
    const device = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device');
    const principal = service.authenticateDeviceToken(device.deviceToken).principal;
    const cursor = service.getReplayPlan(undefined, device.device.deviceConfigVersion, principal).currentEventSequence;
    service.createRequest(principal, catalogService.id, 'request-key-1', 'request-1');
    service.createRequest(principal, catalogService.id, 'request-key-2', 'request-2');
    config.socketEventReplayMaxEvents = 1;

    const replay = service.getReplayPlan(cursor, device.device.deviceConfigVersion, principal);

    expect(replay.sync).toBe('FULL_SNAPSHOT_REQUIRED');
    expect(replay.reason).toBe('EVENT_GAP');
    expect(replay.events).toHaveLength(0);
  });

  it('requires a full snapshot when a device reconnects without a replay cursor', () => {
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const device = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device');
    const principal = service.authenticateDeviceToken(device.deviceToken).principal;

    const replay = service.getReplayPlan(undefined, device.device.deviceConfigVersion, principal);

    expect(replay.sync).toBe('FULL_SNAPSHOT_REQUIRED');
    expect(replay.reason).toBe('EVENT_GAP');
    expect(replay.events).toHaveLength(0);
  });

  it('requires a full snapshot when the replay cursor is ahead of the server sequence', () => {
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const device = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device');
    const principal = service.authenticateDeviceToken(device.deviceToken).principal;
    const currentEventSequence = service.getReplayPlan(undefined, device.device.deviceConfigVersion, principal).currentEventSequence;

    const replay = service.getReplayPlan(currentEventSequence + 1, device.device.deviceConfigVersion, principal);

    expect(replay.sync).toBe('FULL_SNAPSHOT_REQUIRED');
    expect(replay.reason).toBe('EVENT_GAP');
    expect(replay.events).toHaveLength(0);
  });

  it('purges only published events outside both replay retention floors', () => {
    config.socketEventReplayMaxEvents = 1;
    const oldTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const insert = database.prepare('INSERT INTO outbox_events(event_id, event_name, aggregate_type, aggregate_id, payload_json, created_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    insert.run('evt-old', 'system.maintenance', 'SYSTEM', 'settings', '{}', oldTimestamp, oldTimestamp);
    insert.run('evt-latest', 'system.maintenance', 'SYSTEM', 'settings', '{}', oldTimestamp, oldTimestamp);
    insert.run('evt-pending', 'system.maintenance', 'SYSTEM', 'settings', '{}', oldTimestamp, null);

    const result = service.purgeRetention();

    expect(result.eventsDeleted).toBe(1);
    expect((database.prepare('SELECT COUNT(*) AS count FROM outbox_events WHERE event_id = ?').get('evt-old') as { count: number }).count).toBe(0);
    expect((database.prepare('SELECT COUNT(*) AS count FROM outbox_events WHERE event_id = ?').get('evt-latest') as { count: number }).count).toBe(1);
    expect((database.prepare('SELECT COUNT(*) AS count FROM outbox_events WHERE event_id = ?').get('evt-pending') as { count: number }).count).toBe(1);
  });

  it('uses persisted settings for presence and device runtime configuration', () => {
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const admin = service.createAdmin({ username: 'settings-admin', password: 'correct-horse-battery-staple' }, systemActor, 'setup-admin');
    const device = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device');

    setPersistedSetting(database, 'heartbeat.intervalMs', 5000, admin.id);
    setPersistedSetting(database, 'heartbeat.staleAfterMs', 15000, admin.id);
    setPersistedSetting(database, 'heartbeat.offlineAfterMs', 30000, admin.id);
    setPersistedSetting(database, 'alerts.pendingRepeatMs', 1000, admin.id);
    setPersistedSetting(database, 'hotelName', 'Hotel Aurora', admin.id);
    setPersistedSetting(database, 'hotelLogo', 'data:image/png;base64,AAAA', admin.id);
    setPersistedSetting(database, 'roomBackground', 'data:image/webp;base64,AAAA', admin.id);
    setPersistedSetting(database, 'clockFormat', '24h', admin.id);
    database.prepare('UPDATE devices SET last_seen_at = ?, last_heartbeat_at = ? WHERE id = ?').run(
      new Date(Date.now() - 20_000).toISOString(),
      new Date(Date.now() - 20_000).toISOString(),
      device.device.id
    );

    const listedDevice = service.listDevices().find((candidate) => candidate.id === device.device.id);
    const snapshot = service.getDeviceSnapshot(service.authenticateDeviceToken(device.deviceToken).principal);

    expect(listedDevice?.presence).toBe('STALE');
    expect(snapshot.config).toMatchObject({
      heartbeatIntervalMs: 5000,
      heartbeatStaleAfterMs: 15000,
      heartbeatOfflineAfterMs: 30000,
      pendingAlertIntervalMs: 1000,
      hotelName: 'Hotel Aurora',
      hotelLogo: 'data:image/png;base64,AAAA',
      roomBackground: 'data:image/webp;base64,AAAA',
      clockFormat: '24h'
    });
  });

  it('includes only active areas that own returned services in device snapshots', () => {
    const emptyArea = service.createArea({ code: 'test-empty', displayName: 'Empty area', displayOrder: 1 }, systemActor, 'setup-empty-area');
    const serviceArea = service.createArea({ code: 'test-service-area', displayName: 'Service area', displayOrder: 2 }, systemActor, 'setup-service-area');
    const inactiveArea = service.createArea({ code: 'test-inactive', displayName: 'Inactive area', displayOrder: 3, active: false }, systemActor, 'setup-inactive-area');
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const catalogService = service.createService({ code: 'test-service', displayName: 'Test service', areaId: serviceArea.id }, systemActor, 'setup-service');
    service.createService({ code: 'test-inactive-service', displayName: 'Inactive service', areaId: inactiveArea.id, active: false }, systemActor, 'setup-inactive-service');
    const roomDevice = service.bootstrapDevice({
      installationId: 'installation-room',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-room-device');
    const areaDevice = service.bootstrapDevice({
      installationId: 'installation-area',
      displayName: 'Service area console',
      assignmentMode: 'AREA',
      areaId: serviceArea.id
    }, systemActor, 'setup-area-device');

    const roomSnapshot = service.getDeviceSnapshot(service.authenticateDeviceToken(roomDevice.deviceToken).principal);
    const areaSnapshot = service.getDeviceSnapshot(service.authenticateDeviceToken(areaDevice.deviceToken).principal);
    const roomAreaIds = new Set(roomSnapshot.config.areas?.map((area) => area.id));

    expect(roomAreaIds.has(serviceArea.id)).toBe(true);
    expect(roomAreaIds.has(emptyArea.id)).toBe(false);
    expect(roomAreaIds.has(inactiveArea.id)).toBe(false);
    expect(roomSnapshot.config.services.every((candidate) => roomAreaIds.has(candidate.areaId))).toBe(true);
    expect(areaSnapshot.config.areas).toEqual([expect.objectContaining({ id: serviceArea.id, displayName: 'Service area' })]);
    expect(areaSnapshot.config.services.map((candidate) => candidate.id)).toEqual([catalogService.id]);
  });

  it('includes active do-not-disturb rooms only in AREA snapshots, in stable order', () => {
    const area = service.createArea({ code: 'test-housekeeping', displayName: 'Housekeeping' }, systemActor, 'setup-area');
    const firstRoom = service.createRoom({ code: '305', displayName: 'Room 305', displayOrder: 20, doNotDisturb: true }, systemActor, 'setup-room-305');
    const secondRoom = service.createRoom({ code: '101', displayName: 'Room 101', displayOrder: 10, doNotDisturb: true }, systemActor, 'setup-room-101');
    service.createRoom({ code: '202', displayName: 'Room 202', displayOrder: 5, doNotDisturb: true, active: false }, systemActor, 'setup-room-inactive');
    service.createRoom({ code: '404', displayName: 'Room 404', displayOrder: 1, doNotDisturb: false }, systemActor, 'setup-room-404');
    const unassignedRoom = service.createRoom({ code: '606', displayName: 'Room 606', displayOrder: 15, doNotDisturb: true }, systemActor, 'setup-room-606');
    const inactiveStationRoom = service.createRoom({ code: '707', displayName: 'Room 707', displayOrder: 16, doNotDisturb: true }, systemActor, 'setup-room-707');
    const retiredStationRoom = service.createRoom({ code: '808', displayName: 'Room 808', displayOrder: 17, doNotDisturb: true }, systemActor, 'setup-room-808');
    const areaDevice = service.bootstrapDevice({
      installationId: 'installation-area',
      displayName: 'Housekeeping console',
      assignmentMode: 'AREA',
      areaId: area.id
    }, systemActor, 'setup-area-device');
    const roomDevice = service.bootstrapDevice({
      installationId: 'installation-room',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: secondRoom.id
    }, systemActor, 'setup-room-device');
    service.bootstrapDevice({
      installationId: 'installation-room-305',
      displayName: 'Room 305 tablet',
      assignmentMode: 'ROOM',
      roomId: firstRoom.id
    }, systemActor, 'setup-room-device-305');
    const inactiveStation = service.bootstrapDevice({
      installationId: 'installation-room-707',
      displayName: 'Room 707 tablet',
      assignmentMode: 'ROOM',
      roomId: inactiveStationRoom.id
    }, systemActor, 'setup-room-device-707');
    const retiredStation = service.bootstrapDevice({
      installationId: 'installation-room-808',
      displayName: 'Room 808 tablet',
      assignmentMode: 'ROOM',
      roomId: retiredStationRoom.id
    }, systemActor, 'setup-room-device-808');
    database.prepare('UPDATE devices SET active = 0 WHERE id = ?').run(inactiveStation.device.id);
    database.prepare('UPDATE devices SET active = 0, retired_at = ? WHERE id = ?').run(new Date().toISOString(), retiredStation.device.id);

    const areaSnapshot = service.getDeviceSnapshot(service.authenticateDeviceToken(areaDevice.deviceToken).principal) as {
      activeDoNotDisturbRooms?: Array<{ code: string; displayName: string }>;
    };
    const roomSnapshot = service.getDeviceSnapshot(service.authenticateDeviceToken(roomDevice.deviceToken).principal);

    expect(areaSnapshot.activeDoNotDisturbRooms?.map((room) => room.code)).toEqual(['101', '305']);
    expect(areaSnapshot.activeDoNotDisturbRooms?.map((room) => room.displayName)).toEqual(['Room 101', 'Room 305']);
    expect(areaSnapshot.activeDoNotDisturbRooms?.some((room) => room.code === unassignedRoom.code)).toBe(false);
    expect(roomSnapshot).not.toHaveProperty('activeDoNotDisturbRooms');
    expect(firstRoom.id).not.toBe(secondRoom.id);
  });

  it('uses deployment configuration for untouched persisted setting defaults', () => {
    config.heartbeatIntervalMs = 5000;
    config.deviceStaleAfterMs = 15000;
    config.deviceOfflineAfterMs = 30000;
    config.pendingAlertIntervalMs = 1000;
    config.socketEventReplayMinMinutes = 120;
    config.socketEventReplayMaxEvents = 200000;
    config.requestPageSizeDefault = 25;
    config.requestHistoryRetentionDays = 45;
    config.idempotencyRetentionHours = 96;
    config.offlineQueueTtlHours = 48;
    config.auditRetentionDays = 365;

    const settings = service.getSettings();

    expect(settings).toEqual({
      'heartbeat.intervalMs': 5000,
      'heartbeat.staleAfterMs': 15000,
      'heartbeat.offlineAfterMs': 30000,
      'alerts.pendingRepeatMs': 1000,
      'realtime.replayMinMinutes': 120,
      'realtime.replayMaxEvents': 200000,
      'requests.pageSizeDefault': 25,
      'requests.historyRetentionDays': 45,
      'idempotency.retentionHours': 96,
      'client.offlineQueueTtlHours': 48,
      'audit.retentionDays': 365,
      hotelName: 'Hotel Local',
      hotelLogo: null,
      roomBackground: null,
      clockFormat: '12h'
    });
  });

  it('cleans auxiliary retention records when no published replay boundary exists', () => {
    const area = service.createArea({ code: 'test-housekeeping', displayName: 'Housekeeping' }, systemActor, 'setup-area');
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const catalogService = service.createService({ code: 'test-towels', displayName: 'Fresh towels', areaId: area.id }, systemActor, 'setup-service');
    const device = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device');
    const principal = service.authenticateDeviceToken(device.deviceToken).principal;
    const request = service.createRequest(principal, catalogService.id, 'request-key-101', 'request-101').data;
    service.recordHeartbeat(principal, { clientVersion: 'test' }, '127.0.0.1', 'test-agent');

    config.requestHistoryRetentionDays = 7;
    config.auditRetentionDays = 30;
    config.idempotencyRetentionHours = 24;
    config.heartbeatLogRetentionDays = 7;
    const now = new Date();
    database.prepare('UPDATE request_status_history SET created_at = ? WHERE request_id = ?').run(daysAgo(now, 8), request.id);
    database.prepare('UPDATE audit_log SET created_at = ? WHERE request_id = ?').run(daysAgo(now, 31), 'request-101');
    database.prepare('UPDATE idempotency_keys SET created_at = ? WHERE key = ?').run(hoursAgo(now, 48), 'request-key-101');
    database.prepare('UPDATE device_heartbeat_log SET observed_at = ? WHERE device_id = ?').run(daysAgo(now, 8), device.device.id);

    const result = service.purgeRetention(now);

    expect(result).toMatchObject({
      eventsDeleted: 0,
      requestHistoryDeleted: 1,
      auditDeleted: 1,
      idempotencyDeleted: 1,
      heartbeatLogsDeleted: 1
    });
  });

  it('allows only one active ROOM device per room while permitting an inactive replacement', () => {
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const firstDevice = service.bootstrapDevice({
      installationId: 'installation-101-first',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device-first');
    const adminPrincipal = createAdminPrincipal(service);

    expect(() => service.bootstrapDevice({
      installationId: 'installation-101-second',
      displayName: 'Room 101 replacement',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device-second')).toThrow(/active ROOM device is already assigned/i);

    const replacement = service.bootstrapDevice({
      installationId: 'installation-101-replacement',
      displayName: 'Room 101 replacement',
      assignmentMode: 'ROOM',
      roomId: room.id,
      active: false
    }, systemActor, 'setup-device-replacement');

    expect(() => service.patchDevice(adminPrincipal, replacement.device.id, { active: true }, 'activate-replacement')).toThrow(/active ROOM device is already assigned/i);

    service.patchDevice(adminPrincipal, firstDevice.device.id, { active: false }, 'deactivate-first');
    expect(service.patchDevice(adminPrincipal, replacement.device.id, { active: true }, 'activate-replacement-after-release').active).toBe(true);
  });

  it('allows duplicate active AREA devices and checks ROOM conflicts when assigning an active device', () => {
    const area = service.createArea({ code: 'test-housekeeping', displayName: 'Housekeeping' }, systemActor, 'setup-area');
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const occupant = service.bootstrapDevice({
      installationId: 'installation-101-occupant',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device-occupant');
    const firstAreaDevice = service.bootstrapDevice({
      installationId: 'installation-housekeeping-first',
      displayName: 'Housekeeping console 1',
      assignmentMode: 'AREA',
      areaId: area.id
    }, systemActor, 'setup-area-device-first');
    service.bootstrapDevice({
      installationId: 'installation-housekeeping-second',
      displayName: 'Housekeeping console 2',
      assignmentMode: 'AREA',
      areaId: area.id
    }, systemActor, 'setup-area-device-second');
    const adminPrincipal = createAdminPrincipal(service);

    expect(() => service.assignDevice(adminPrincipal, firstAreaDevice.device.id, {
      assignmentMode: 'ROOM',
      roomId: room.id,
      areaId: null,
      expectedDeviceConfigVersion: firstAreaDevice.device.deviceConfigVersion,
      reason: 'Move console to room'
    }, 'assign-conflicting-room')).toThrow(/active ROOM device is already assigned/i);

    service.patchDevice(adminPrincipal, occupant.device.id, { active: false }, 'deactivate-occupant');
    const assigned = service.assignDevice(adminPrincipal, firstAreaDevice.device.id, {
      assignmentMode: 'ROOM',
      roomId: room.id,
      areaId: null,
      expectedDeviceConfigVersion: firstAreaDevice.device.deviceConfigVersion,
      reason: 'Move console to room'
    }, 'assign-released-room');

    expect(assigned.device).toMatchObject({ assignmentMode: 'ROOM', roomId: room.id, areaId: null, active: true });
  });
});

function createAdminPrincipal(service: HotelService) {
  const admin = service.createAdmin({ username: 'service-admin', password: 'correct-horse-battery-staple' }, systemActor, 'setup-admin');
  return service.authenticateAdmin(service.loginAdmin(admin.username, 'correct-horse-battery-staple', 'login-admin').sessionToken);
}

function setPersistedSetting(database: SqliteDatabase, key: string, value: unknown, adminId: string): void {
  database.prepare('UPDATE system_settings SET value_json = ?, updated_by_admin_id = ? WHERE key = ?').run(JSON.stringify(value), adminId, key);
}

function daysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function hoursAgo(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

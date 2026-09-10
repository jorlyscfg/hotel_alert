import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, type ServerConfig } from '../../apps/server/src/config/env';
import { closeDatabase, openDatabase, runMigrations, type SqliteDatabase } from '../../apps/server/src/db/connection';
import { createApp } from '../../apps/server/src/http/app';
import { HotelService } from '../../apps/server/src/domain/hotel-service';
import type { Actor } from '../../apps/server/src/security/principal';

const systemActor: Actor = { actorType: 'SYSTEM', actorId: null };
const adminPassword = 'correct-horse-battery-staple';

describe('HTTP API', () => {
  let database: SqliteDatabase;
  let databaseDirectory: string;
  let config: ServerConfig;
  let service: HotelService;
  let app: ReturnType<typeof createApp>;
  let adminClient: ReturnType<typeof request.agent>;
  let csrfToken: string;

  beforeEach(async () => {
    databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-http-'));
    config = loadConfig({
      nodeEnv: 'test',
      databasePath: path.join(databaseDirectory, 'hotel.sqlite'),
      sessionSecret: 'session-secret',
      tokenPepper: 'token-pepper'
    });
    database = openDatabase(config);
    runMigrations(database);
    service = new HotelService(database, config);
    service.createAdmin({ username: 'admin', password: adminPassword }, systemActor, 'setup-admin');
    app = createApp(service, config);
    adminClient = request.agent(app);

    const login = await adminClient.post('/api/v1/auth/admin/login').send({ username: 'admin', password: adminPassword }).expect(200);
    csrfToken = login.body.data.csrfToken as string;

    const me = await adminClient.get('/api/v1/auth/admin/me').expect(200);
    expect(me.body.data.expiresAt).toBe(login.body.data.admin.expiresAt);
  });

  afterEach(() => {
    closeDatabase(database);
    fs.rmSync(databaseDirectory, { recursive: true, force: true });
  });

  it('keeps bootstrap state minimal and supports protected device bootstrap', async () => {
    const bootstrapState = await request(app)
      .get('/api/v1/devices/bootstrap-state')
      .query({ installationId: 'installation-101' })
      .expect(200);

    expect(bootstrapState.body.data).toEqual({
      installationId: 'installation-101',
      configured: false,
      displayHint: null
    });
    expect(JSON.stringify(bootstrapState.body)).not.toContain('rooms');

    const area = await adminClient
      .post('/api/v1/areas')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'area-101')
      .send({ code: 'test-housekeeping', displayName: 'Housekeeping' })
      .expect(201);
    const room = await adminClient
      .post('/api/v1/rooms')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'room-101')
      .send({ code: '101', displayName: 'Room 101' })
      .expect(201);
    const catalogService = await adminClient
      .post('/api/v1/services')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'service-101')
      .send({ code: 'test-towels', displayName: 'Fresh towels', areaId: area.body.data.id })
      .expect(201);

    const bootstrap = await adminClient
      .post('/api/v1/devices/bootstrap')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'device-101')
      .send({
        installationId: 'installation-101',
        displayName: 'Room 101 tablet',
        assignmentMode: 'ROOM',
        roomId: room.body.data.id
      })
      .expect(201);

    expect(bootstrap.body.data.deviceToken).toMatch(/^htl_/);
    expect(bootstrap.body.data.device.id).toBeDefined();
    expect(bootstrap.body.data.deviceToken).not.toBe(catalogService.body.data.id);

    const deviceToken = bootstrap.body.data.deviceToken as string;
    const session = await request(app)
      .get('/api/v1/device/session')
      .set('Authorization', `Bearer ${deviceToken}`)
      .expect(200);

    expect(session.body.data.device.assignmentMode).toBe('ROOM');
    expect(session.body.data.device.roomId).toBe(room.body.data.id);
    expect(session.body.data.config.services).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: catalogService.body.data.id, code: 'test-towels' })
    ]));
    expect(session.body.data.config.offlineQueueTtlHours).toBe(48);

    const rotation = await adminClient
      .post(`/api/v1/devices/${bootstrap.body.data.device.id}/token-rotation`)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'rotation-101')
      .send({ reason: 'Replace the device token' })
      .expect(202);
    const claimed = await request(app)
      .post('/api/v1/device/token-rotation/claim')
      .set('Authorization', `Bearer ${deviceToken}`)
      .send({ rotationId: rotation.body.data.rotationId })
      .expect(200);

    const mismatchedAcknowledgement = await request(app)
      .post('/api/v1/device/token-rotation/acknowledge')
      .set('Authorization', `Bearer ${claimed.body.data.deviceToken}`)
      .send({ rotationId: 'rot_wrong' })
      .expect(409);
    expect(mismatchedAcknowledgement.body.error.code).toBe('TOKEN_ROTATION_MISMATCH');

    const acknowledged = await request(app)
      .post('/api/v1/device/token-rotation/acknowledge')
      .set('Authorization', `Bearer ${claimed.body.data.deviceToken}`)
      .send({ rotationId: rotation.body.data.rotationId });
    expect(acknowledged.status, JSON.stringify(acknowledged.body)).toBe(200);
    const repeatedAcknowledgement = await request(app)
      .post('/api/v1/device/token-rotation/acknowledge')
      .set('Authorization', `Bearer ${claimed.body.data.deviceToken}`)
      .send({ rotationId: rotation.body.data.rotationId })
      .expect(200);
    expect(repeatedAcknowledgement.body.data).toEqual({ rotationId: rotation.body.data.rotationId, acknowledged: true });
    await request(app).get('/api/v1/device/session').set('Authorization', `Bearer ${deviceToken}`).expect(401);

    const rebound = await adminClient
      .post('/api/v1/device/rebind')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'rebind-101')
      .send({ deviceId: bootstrap.body.data.device.id, reason: 'Lost browser storage' })
      .expect(200);
    expect(rebound.body.data.deviceToken).toMatch(/^htl_/);
    expect(rebound.body.data.deviceToken).not.toBe(claimed.body.data.deviceToken);
    await request(app).get('/api/v1/device/session').set('Authorization', `Bearer ${rebound.body.data.deviceToken}`).expect(200);

    const reboundRetry = await adminClient
      .post('/api/v1/device/rebind')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'rebind-101')
      .send({ deviceId: bootstrap.body.data.device.id, reason: 'Lost browser storage' })
      .expect(200);
    expect(reboundRetry.body.idempotentReplay).toBe(true);
    expect(reboundRetry.body.data.deviceToken).toBe(rebound.body.data.deviceToken);
    const storedRebind = database.prepare('SELECT response_json FROM idempotency_keys WHERE key = ?').get('rebind-101') as { response_json: string } | undefined;
    expect(storedRebind).toBeDefined();
    expect(storedRebind?.response_json).not.toContain(rebound.body.data.deviceToken);

    await adminClient
      .post('/api/v1/device/rebind')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'rebind-101')
      .send({ deviceId: bootstrap.body.data.device.id, reason: 'Different reason' })
      .expect(409);

    const secondAdmin = await adminClient
      .post('/api/v1/admins')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'admin-102')
      .send({ username: 'admin2', password: 'another-correct-password' })
      .expect(201);
    const secondAdminClient = request.agent(app);
    await secondAdminClient.post('/api/v1/auth/admin/login').send({ username: 'admin2', password: 'another-correct-password' }).expect(200);

    await adminClient
      .post(`/api/v1/admins/${secondAdmin.body.data.id}/revoke-sessions`)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'revoke-admin-102')
      .send({})
      .expect(200);
    await secondAdminClient.get('/api/v1/auth/admin/me').expect(401);
    await adminClient.get('/api/v1/auth/admin/me').expect(200);
  });

  it('persists legacy and responsive local room backgrounds through device snapshots', async () => {
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const device = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device');
    const roomBackground = 'data:image/webp;base64,AAAA';

    const update = await adminClient
      .patch('/api/v1/settings')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'settings-room-background')
      .send({ changes: { roomBackground } })
      .expect(200);

    expect(update.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'roomBackground', value: roomBackground })
    ]));
    const session = await request(app)
      .get('/api/v1/device/session')
      .set('Authorization', `Bearer ${device.deviceToken}`)
      .expect(200);
    expect(session.body.data.config.roomBackground).toBe(roomBackground);

    const roomBackgroundVariants = {
      square480: 'data:image/webp;base64,SQUARE',
      tablet: 'data:image/webp;base64,TABLET'
    };
    await adminClient
      .patch('/api/v1/settings')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'settings-room-background-variants')
      .send({ changes: { roomBackground: roomBackgroundVariants } })
      .expect(200);
    const responsiveSession = await request(app)
      .get('/api/v1/device/session')
      .set('Authorization', `Bearer ${device.deviceToken}`)
      .expect(200);
    expect(responsiveSession.body.data.config.roomBackground).toEqual(roomBackgroundVariants);

    await adminClient
      .patch('/api/v1/settings')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'settings-room-background-clear')
      .send({ changes: { roomBackground: null } })
      .expect(200);
    const clearedSession = await request(app)
      .get('/api/v1/device/session')
      .set('Authorization', `Bearer ${device.deviceToken}`)
      .expect(200);
    expect(clearedSession.body.data.config.roomBackground).toBeNull();
  });

  it('derives admin cookie security from the configured app origin', async () => {
    const httpLogin = await request(app)
      .post('/api/v1/auth/admin/login')
      .send({ username: 'admin', password: adminPassword })
      .expect(200);
    expect(httpLogin.headers['set-cookie'].join(';')).not.toContain('Secure');

    const httpsApp = createApp(service, { ...config, appOrigin: 'https://hotel.example.test' });
    const httpsLogin = await request(httpsApp)
      .post('/api/v1/auth/admin/login')
      .send({ username: 'admin', password: adminPassword })
      .expect(200);
    expect(httpsLogin.headers['set-cookie'].join(';')).toContain('Secure');
  });

  it('lets a room device toggle do-not-disturb idempotently without blocking requests', async () => {
    const area = service.createArea({ code: 'test-housekeeping', displayName: 'Housekeeping' }, systemActor, 'setup-area');
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const catalogService = service.createService({ code: 'test-towels', displayName: 'Fresh towels', areaId: area.id }, systemActor, 'setup-service');
    const device = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device');

    const toggle = await request(app)
      .patch('/api/v1/room/me/do-not-disturb')
      .set('Authorization', `Bearer ${device.deviceToken}`)
      .set('Idempotency-Key', 'room-dnd-101')
      .send({ doNotDisturb: true })
      .expect(200);

    expect(toggle.body.data).toMatchObject({ id: room.id, doNotDisturb: true });
    expect(toggle.body.idempotentReplay).toBe(false);

    const replay = await request(app)
      .patch('/api/v1/room/me/do-not-disturb')
      .set('Authorization', `Bearer ${device.deviceToken}`)
      .set('Idempotency-Key', 'room-dnd-101')
      .send({ doNotDisturb: true })
      .expect(200);

    expect(replay.body.data).toEqual(toggle.body.data);
    expect(replay.body.idempotentReplay).toBe(true);

    const createdRequest = await request(app)
      .post('/api/v1/requests')
      .set('Authorization', `Bearer ${device.deviceToken}`)
      .set('Idempotency-Key', 'request-101')
      .send({ serviceId: catalogService.id })
      .expect(201);

    expect(createdRequest.body.data).toMatchObject({
      roomId: room.id,
      room: { id: room.id, doNotDisturb: true }
    });
  });

  it('rate limits repeated admin login attempts by source IP', async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await request(app)
        .post('/api/v1/auth/admin/login')
        .send({ username: `unknown-${attempt}`, password: adminPassword })
        .expect(401);
    }

    const limited = await request(app)
      .post('/api/v1/auth/admin/login')
      .send({ username: 'unknown-final', password: adminPassword })
      .expect(429);

    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });

  it('filters the admin request list by device and inclusive date range', async () => {
    const area = service.createArea({ code: 'test-housekeeping', displayName: 'Housekeeping' }, systemActor, 'setup-area');
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const catalogService = service.createService({ code: 'test-towels', displayName: 'Fresh towels', areaId: area.id }, systemActor, 'setup-service');
    const device = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device');
    const requestRow = service.createRequest(service.authenticateDeviceToken(device.deviceToken).principal, catalogService.id, 'request-101', 'request-101').data;
    database.prepare('UPDATE requests SET created_at = ?, updated_at = ? WHERE id = ?').run('2026-08-15T09:00:00.000Z', '2026-08-15T09:00:00.000Z', requestRow.id);

    const response = await adminClient
      .get('/api/v1/requests')
      .query({ deviceId: device.device.id, from: '2026-08-01', to: '2026-08-31', search: 'fresh towels' })
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({ id: requestRow.id, createdByDeviceId: device.device.id });
  });

  it('paginates admin requests with a stable cursor and rejects malformed or mismatched cursors', async () => {
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

    const firstPage = await adminClient
      .get('/api/v1/requests')
      .query({ limit: 1 })
      .expect(200);
    const cursor = firstPage.body.page.nextCursor as string;

    expect(firstPage.body.data.map((request: { id: string }) => request.id)).toEqual([expectedIds[0]]);
    expect(firstPage.body.page).toEqual({ nextCursor: cursor, hasMore: true });
    expect(cursor).toEqual(expect.any(String));
    expect(JSON.stringify(firstPage.body.data[0])).not.toContain('created_by_actor_id');

    const secondPage = await adminClient
      .get('/api/v1/requests')
      .query({ limit: 1, cursor })
      .expect(200);

    expect(secondPage.body.data.map((request: { id: string }) => request.id)).toEqual([expectedIds[1]]);
    expect(secondPage.body.data.map((request: { id: string }) => request.id)).not.toContain(firstPage.body.data[0].id);
    expect(secondPage.body.page).toEqual({ nextCursor: null, hasMore: false });

    const mismatchedFilter = await adminClient
      .get('/api/v1/requests')
      .query({ limit: 1, cursor, areaId: 'area-different' })
      .expect(422);
    expect(mismatchedFilter.body.error.code).toBe('VALIDATION_ERROR');

    const malformedCursor = await adminClient
      .get('/api/v1/requests')
      .query({ limit: 1, cursor: 'not-a-valid-cursor' })
      .expect(422);
    expect(malformedCursor.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns real pagination metadata for ROOM and AREA request lists', async () => {
    const area = service.createArea({ code: 'test-housekeeping', displayName: 'Housekeeping' }, systemActor, 'setup-area');
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const catalogService = service.createService({ code: 'test-towels', displayName: 'Fresh towels', areaId: area.id }, systemActor, 'setup-service');
    const roomDevice = service.bootstrapDevice({ installationId: 'installation-room-101', displayName: 'Room 101 tablet', assignmentMode: 'ROOM', roomId: room.id }, systemActor, 'setup-room-device');
    const areaDevice = service.bootstrapDevice({ installationId: 'installation-area-housekeeping', displayName: 'Housekeeping console', assignmentMode: 'AREA', areaId: area.id }, systemActor, 'setup-area-device');
    const roomPrincipal = service.authenticateDeviceToken(roomDevice.deviceToken).principal;
    const firstRequest = service.createRequest(roomPrincipal, catalogService.id, 'request-key-1', 'request-1').data;
    const secondRequest = service.createRequest(roomPrincipal, catalogService.id, 'request-key-2', 'request-2').data;
    const createdAt = '2026-08-31T09:00:00.000Z';
    database.prepare('UPDATE requests SET created_at = ?, updated_at = ? WHERE id IN (?, ?)').run(createdAt, createdAt, firstRequest.id, secondRequest.id);

    const roomPage = await request(app)
      .get('/api/v1/room/me/requests')
      .set('Authorization', `Bearer ${roomDevice.deviceToken}`)
      .query({ limit: 1 })
      .expect(200);
    expect(roomPage.body.data).toHaveLength(1);
    expect(roomPage.body.page.hasMore).toBe(true);
    expect(roomPage.body.page.nextCursor).toEqual(expect.any(String));

    const roomNextPage = await request(app)
      .get('/api/v1/room/me/requests')
      .set('Authorization', `Bearer ${roomDevice.deviceToken}`)
      .query({ limit: 1, cursor: roomPage.body.page.nextCursor })
      .expect(200);
    expect(roomNextPage.body.data).toHaveLength(1);
    expect(roomNextPage.body.data[0].id).not.toBe(roomPage.body.data[0].id);

    const areaPage = await request(app)
      .get('/api/v1/area/me/requests')
      .set('Authorization', `Bearer ${areaDevice.deviceToken}`)
      .query({ limit: 1 })
      .expect(200);
    expect(areaPage.body.data).toHaveLength(1);
    expect(areaPage.body.page.hasMore).toBe(true);
    expect(areaPage.body.page.nextCursor).toEqual(expect.any(String));
  });

  it('returns the committed request when a device retries with the same idempotency key', async () => {
    const area = service.createArea({ code: 'test-housekeeping', displayName: 'Housekeeping' }, systemActor, 'setup-area');
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const catalogService = service.createService({ code: 'test-towels', displayName: 'Fresh towels', areaId: area.id }, systemActor, 'setup-service');
    const bootstrap = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device');

    const device = `Bearer ${bootstrap.deviceToken}`;
    const first = await request(app)
      .post('/api/v1/requests')
      .set('Authorization', device)
      .set('Idempotency-Key', 'request-101')
      .send({ serviceId: catalogService.id })
      .expect(201);
    const retry = await request(app)
      .post('/api/v1/requests')
      .set('Authorization', device)
      .set('Idempotency-Key', 'request-101')
      .send({ serviceId: catalogService.id })
      .expect(201);

    expect(retry.body.idempotentReplay).toBe(true);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(service.listRequests()).toHaveLength(1);
  });

  it('retires a device without deleting its history or allowing the old token to reconnect', async () => {
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const replacementRoom = service.createRoom({ code: '102', displayName: 'Room 102' }, systemActor, 'setup-room-102');
    const first = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device-101');
    const second = service.bootstrapDevice({
      installationId: 'installation-102',
      displayName: 'Room 101 backup tablet',
      assignmentMode: 'ROOM',
      roomId: room.id,
      active: false
    }, systemActor, 'setup-device-102');

    await request(app)
      .post('/api/v1/device/heartbeat')
      .set('Authorization', `Bearer ${first.deviceToken}`)
      .send({ clientVersion: '0.1.0' })
      .expect(200);
    const heartbeatCountBefore = (database.prepare('SELECT COUNT(*) AS count FROM device_heartbeat_log WHERE device_id = ?').get(first.device.id) as { count: number }).count;

    await adminClient
      .post(`/api/v1/devices/${first.device.id}/retire`)
      .set('Idempotency-Key', 'retire-101')
      .send({})
      .expect(403);

    await request(app)
      .post(`/api/v1/devices/${first.device.id}/retire`)
      .set('Authorization', `Bearer ${first.deviceToken}`)
      .set('Idempotency-Key', 'retire-101-device')
      .send({})
      .expect(401);

    const retired = await adminClient
      .post(`/api/v1/devices/${first.device.id}/retire`)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'retire-101')
      .send({})
      .expect(200);

    expect(retired.body.data).toMatchObject({ deviceId: first.device.id, retiredAt: expect.any(String) });
    expect(retired.body.idempotentReplay).toBe(false);

    const assignmentAttempt = await adminClient
      .post(`/api/v1/devices/${first.device.id}/assignment`)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'assign-retired-101')
      .send({
        assignmentMode: 'ROOM',
        roomId: replacementRoom.id,
        expectedDeviceConfigVersion: first.device.deviceConfigVersion,
        reason: 'Reassign retired device'
      })
      .expect(409);
    expect(assignmentAttempt.body.error).toMatchObject({ code: 'RESOURCE_CONFLICT' });

    const listed = await adminClient.get('/api/v1/devices').expect(200);
    expect(listed.body.data.map((device: { id: string }) => device.id)).toEqual([second.device.id]);

    const detail = await adminClient.get(`/api/v1/devices/${first.device.id}`).expect(200);
    expect(detail.body.data).toMatchObject({ id: first.device.id, active: false, roomId: room.id, deviceConfigVersion: first.device.deviceConfigVersion });

    await adminClient
      .post(`/api/v1/devices/${first.device.id}/activate`)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'reactivate-retired-101')
      .send({})
      .expect(409);

    await request(app)
      .get('/api/v1/device/session')
      .set('Authorization', `Bearer ${first.deviceToken}`)
      .expect(401);
    await request(app)
      .post('/api/v1/device/heartbeat')
      .set('Authorization', `Bearer ${first.deviceToken}`)
      .send({ clientVersion: '0.1.1' })
      .expect(401);

    const stored = database.prepare('SELECT active, retired_at FROM devices WHERE id = ?').get(first.device.id) as { active: number; retired_at: string | null };
    expect(stored.active).toBe(0);
    expect(stored.retired_at).toEqual(retired.body.data.retiredAt);
    expect((database.prepare('SELECT COUNT(*) AS count FROM device_heartbeat_log WHERE device_id = ?').get(first.device.id) as { count: number }).count).toBe(heartbeatCountBefore);
    expect((database.prepare('SELECT COUNT(*) AS count FROM audit_log WHERE action = ? AND entity_id = ?').get('DEVICE_RETIRED', first.device.id) as { count: number }).count).toBe(1);

    const replay = await adminClient
      .post(`/api/v1/devices/${first.device.id}/retire`)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'retire-101')
      .send({})
      .expect(200);
    expect(replay.body.idempotentReplay).toBe(true);
    expect(replay.body.data).toEqual(retired.body.data);

    await adminClient
      .post(`/api/v1/devices/${second.device.id}/retire`)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'retire-101')
      .send({})
      .expect(409);
  });
});

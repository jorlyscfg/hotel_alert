import { createServer, type Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as connectSocket, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, type ServerConfig } from '../../apps/server/src/config/env';
import { closeDatabase, openDatabase, runMigrations, type SqliteDatabase } from '../../apps/server/src/db/connection';
import { HotelService } from '../../apps/server/src/domain/hotel-service';
import { attachRealtime, isAllowedRealtimeOrigin, type RealtimeServer } from '../../apps/server/src/realtime/server';
import type { Actor } from '../../apps/server/src/security/principal';

const systemActor: Actor = { actorType: 'SYSTEM', actorId: null };
const adminPassword = 'correct-horse-battery-staple';

describe('Socket.IO realtime transport', () => {
  let database: SqliteDatabase;
  let databaseDirectory: string;
  let config: ServerConfig;
  let service: HotelService;
  let httpServer: Server;
  let realtime: RealtimeServer;
  let socket: Socket | undefined;

  beforeEach(() => {
    databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-realtime-'));
    config = loadConfig({
      nodeEnv: 'test',
      databasePath: path.join(databaseDirectory, 'hotel.sqlite'),
      sessionSecret: 'session-secret',
      tokenPepper: 'token-pepper'
    });
    database = openDatabase(config);
    runMigrations(database);
    service = new HotelService(database, config);
    httpServer = createServer();
    realtime = attachRealtime(httpServer, service, config);
  });

  afterEach(async () => {
    socket?.disconnect();
    await realtime.close();
    await closeHttpServer(httpServer);
    closeDatabase(database);
    fs.rmSync(databaseDirectory, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('allows private LAN browser origins only outside production when they use the configured web port', () => {
    expect(isAllowedRealtimeOrigin('http://192.168.1.20:4173', { nodeEnv: 'development', appOrigin: 'http://localhost:4173' })).toBe(true);
    expect(isAllowedRealtimeOrigin('http://192.168.1.20:3000', { nodeEnv: 'development', appOrigin: 'http://localhost:4173' })).toBe(false);
    expect(isAllowedRealtimeOrigin('https://192.168.1.20:4173', { nodeEnv: 'development', appOrigin: 'http://localhost:4173' })).toBe(false);
    expect(isAllowedRealtimeOrigin('http://192.168.1.20:4173', { nodeEnv: 'production', appOrigin: 'https://hotel.example' })).toBe(false);
    expect(isAllowedRealtimeOrigin('https://hotel.example', { nodeEnv: 'production', appOrigin: 'https://hotel.example' })).toBe(true);
  });

  it('rejects a foreign websocket origin during the Engine.IO handshake', async () => {
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const bootstrap = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device');

    await listen(httpServer);
    const address = httpServer.address();
    if (address === null || typeof address === 'string') throw new Error('Realtime test server did not expose a TCP address.');
    socket = connectSocket(`http://127.0.0.1:${address.port}/realtime`, {
      transports: ['websocket'],
      timeout: 2000,
      extraHeaders: { Origin: 'https://evil.example' },
      auth: {
        deviceId: bootstrap.device.id,
        deviceToken: bootstrap.deviceToken,
        clientInstanceId: 'foreign-origin-client',
        clientVersion: '0.1.0'
      }
    });

    const error = await onceEvent<Error>(socket, 'connect_error');
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toBe('');
    expect(socket.connected).toBe(false);
  });

  it('authenticates a device, derives its logical rooms, and publishes committed requests', async () => {
    const area = service.createArea({ code: 'test-housekeeping', displayName: 'Housekeeping' }, systemActor, 'setup-area');
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const catalogService = service.createService({ code: 'test-towels', displayName: 'Fresh towels', areaId: area.id }, systemActor, 'setup-service');
    const bootstrap = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device');
    const principal = service.authenticateDeviceToken(bootstrap.deviceToken).principal;
    const cursor = service.getReplayPlan(undefined, bootstrap.device.deviceConfigVersion, principal).currentEventSequence;

    realtime.publishPendingEvents();
    await listen(httpServer);
    socket = connectSocket(`http://127.0.0.1:${httpServer.address() instanceof Object ? httpServer.address().port : 0}/realtime`, {
      transports: ['websocket'],
      timeout: 2000,
      auth: {
        deviceId: bootstrap.device.id,
        deviceToken: bootstrap.deviceToken,
        clientInstanceId: 'client-instance-101',
        lastSeenEventSequence: cursor,
        deviceConfigVersion: bootstrap.device.deviceConfigVersion,
        clientVersion: '0.1.0'
      }
    });

    const ready = await onceEvent<{ sync: string }>(socket, 'connection.ready');
    expect(ready.sync).toBe('UP_TO_DATE');

    const createdEvent = onceEvent<{ eventSequence: number; payload: { request: { id: string; roomId: string; serviceId: string } } }>(socket, 'request.created');
    const created = service.createRequest(principal, catalogService.id, 'request-key-101', 'request-101').data;
    realtime.publishPendingEvents();

    const event = await createdEvent;
    expect(event.eventSequence).toBeGreaterThan(cursor);
    expect(event.payload.request).toMatchObject({ id: created.id, roomId: room.id, serviceId: catalogService.id });
  });

  it('limits device heartbeats to six events per minute across sockets for one device', async () => {
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const bootstrap = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device');
    const recordHeartbeat = vi.spyOn(service, 'recordHeartbeat');

    await listen(httpServer);
    const address = httpServer.address();
    if (address === null || typeof address === 'string') throw new Error('Realtime test server did not expose a TCP address.');
    const url = `http://127.0.0.1:${address.port}/realtime`;
    socket = connectSocket(url, {
      transports: ['websocket'],
      timeout: 2000,
      auth: { deviceId: bootstrap.device.id, deviceToken: bootstrap.deviceToken, clientInstanceId: 'heartbeat-client-1', clientVersion: '0.1.0' }
    });
    const secondSocket = connectSocket(url, {
      transports: ['websocket'],
      timeout: 2000,
      auth: { deviceId: bootstrap.device.id, deviceToken: bootstrap.deviceToken, clientInstanceId: 'heartbeat-client-2', clientVersion: '0.1.0' }
    });
    await Promise.all([
      onceEvent<{ sync: string }>(socket, 'connection.ready'),
      onceEvent<{ sync: string }>(secondSocket, 'connection.ready')
    ]);

    const windowStart = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(windowStart);
    const acknowledgements: HeartbeatAck[] = [];
    for (let index = 0; index < 3; index += 1) {
      acknowledgements.push(await emitHeartbeat(socket, { clientVersion: '0.1.0', socketConnected: true }));
      acknowledgements.push(await emitHeartbeat(secondSocket, { clientVersion: '0.1.0', socketConnected: true }));
    }

    expect(acknowledgements).toEqual(Array.from({ length: 6 }, () => ({ ok: true })));
    expect(await emitHeartbeat(socket, { clientVersion: '0.1.0', socketConnected: true })).toEqual({ ok: false, errorCode: 'RATE_LIMITED' });
    expect(recordHeartbeat).toHaveBeenCalledTimes(6);

    clock.mockReturnValue(windowStart + 60_000);
    expect(await emitHeartbeat(secondSocket, { clientVersion: '0.1.0', socketConnected: true })).toEqual({ ok: true });
    expect(recordHeartbeat).toHaveBeenCalledTimes(7);
    secondSocket.disconnect();
  });

  it('checks the device role before limiting and charges malformed heartbeats to the device budget', async () => {
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const bootstrap = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device');
    service.createAdmin({ username: 'admin', password: adminPassword }, systemActor, 'setup-admin');
    const login = service.loginAdmin('admin', adminPassword, 'login-admin', undefined, undefined);
    const recordHeartbeat = vi.spyOn(service, 'recordHeartbeat');

    await listen(httpServer);
    const address = httpServer.address();
    if (address === null || typeof address === 'string') throw new Error('Realtime test server did not expose a TCP address.');
    const url = `http://127.0.0.1:${address.port}/realtime`;
    const adminSocket = connectSocket(url, {
      transports: ['websocket'],
      timeout: 2000,
      extraHeaders: { Cookie: `hotel_admin_session=${encodeURIComponent(login.sessionToken)}` },
      auth: { clientInstanceId: 'heartbeat-admin-client', clientVersion: '0.1.0' }
    });
    socket = connectSocket(url, {
      transports: ['websocket'],
      timeout: 2000,
      auth: { deviceId: bootstrap.device.id, deviceToken: bootstrap.deviceToken, clientInstanceId: 'heartbeat-device-client', clientVersion: '0.1.0' }
    });
    await Promise.all([
      onceEvent<{ sync: string }>(adminSocket, 'connection.ready'),
      onceEvent<{ sync: string }>(socket, 'connection.ready')
    ]);

    expect(await emitHeartbeat(adminSocket, { clientVersion: '0.1.0' })).toEqual({ ok: false, errorCode: 'FORBIDDEN_ASSIGNMENT' });
    const malformedAcknowledgements: HeartbeatAck[] = [];
    for (let index = 0; index < 6; index += 1) {
      malformedAcknowledgements.push(await emitHeartbeat(socket, { unexpected: true }));
    }

    expect(malformedAcknowledgements).toEqual(Array.from({ length: 6 }, () => ({ ok: false, errorCode: 'VALIDATION_ERROR' })));
    expect(await emitHeartbeat(socket, { clientVersion: '0.1.0' })).toEqual({ ok: false, errorCode: 'RATE_LIMITED' });
    expect(recordHeartbeat).not.toHaveBeenCalled();
    adminSocket.disconnect();
  });

  it('publishes room updates to the assigned room, area consoles, and administrators', async () => {
    const area = service.createArea({ code: 'test-housekeeping', displayName: 'Housekeeping' }, systemActor, 'setup-area');
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const roomDevice = service.bootstrapDevice({ installationId: 'installation-room-101', displayName: 'Room 101 tablet', assignmentMode: 'ROOM', roomId: room.id }, systemActor, 'setup-room-device');
    const areaDevice = service.bootstrapDevice({ installationId: 'installation-area-housekeeping', displayName: 'Housekeeping console', assignmentMode: 'AREA', areaId: area.id }, systemActor, 'setup-area-device');
    service.createAdmin({ username: 'admin', password: adminPassword }, systemActor, 'setup-admin');
    const login = service.loginAdmin('admin', adminPassword, 'login-admin', undefined, undefined);

    realtime.publishPendingEvents();
    await listen(httpServer);
    const address = httpServer.address();
    if (address === null || typeof address === 'string') throw new Error('Realtime test server did not expose a TCP address.');
    const url = `http://127.0.0.1:${address.port}/realtime`;
    const roomSocket = connectSocket(url, {
      transports: ['websocket'],
      timeout: 2000,
      auth: { deviceId: roomDevice.device.id, deviceToken: roomDevice.deviceToken, clientInstanceId: 'room-client', clientVersion: '0.1.0' }
    });
    const areaSocket = connectSocket(url, {
      transports: ['websocket'],
      timeout: 2000,
      auth: { deviceId: areaDevice.device.id, deviceToken: areaDevice.deviceToken, clientInstanceId: 'area-client', clientVersion: '0.1.0' }
    });
    const adminSocket = connectSocket(url, {
      transports: ['websocket'],
      timeout: 2000,
      extraHeaders: { Cookie: `hotel_admin_session=${encodeURIComponent(login.sessionToken)}` },
      auth: { clientInstanceId: 'admin-client', clientVersion: '0.1.0' }
    });

    await Promise.all([
      onceEvent<{ sync: string }>(roomSocket, 'connection.ready'),
      onceEvent<{ sync: string }>(areaSocket, 'connection.ready'),
      onceEvent<{ sync: string }>(adminSocket, 'connection.ready')
    ]);
    socket = roomSocket;

    const roomUpdate = onceEvent<{ payload: { room: { id: string; doNotDisturb: boolean } } }>(roomSocket, 'room.updated');
    const areaUpdate = onceEvent<{ payload: { room: { id: string; doNotDisturb: boolean } } }>(areaSocket, 'room.updated');
    const adminUpdate = onceEvent<{ payload: { room: { id: string; doNotDisturb: boolean } } }>(adminSocket, 'room.updated');

    service.setRoomDoNotDisturb(service.authenticateDeviceToken(roomDevice.deviceToken).principal, true, 'room-dnd-realtime', 'room-dnd-realtime');
    realtime.publishPendingEvents();

    await expect(roomUpdate).resolves.toMatchObject({ payload: { room: { id: room.id, doNotDisturb: true } } });
    await expect(areaUpdate).resolves.toMatchObject({ payload: { room: { id: room.id, doNotDisturb: true } } });
    await expect(adminUpdate).resolves.toMatchObject({ payload: { room: { id: room.id, doNotDisturb: true } } });
  });

  it('disconnects connected device sockets when an administrator revokes the device token', async () => {
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const bootstrap = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device');
    service.createAdmin({ username: 'admin', password: adminPassword }, systemActor, 'setup-admin');
    const login = service.loginAdmin('admin', adminPassword, 'login-admin', undefined, undefined);
    const admin = service.authenticateAdmin(login.sessionToken);

    await listen(httpServer);
    socket = connectSocket(`http://127.0.0.1:${httpServer.address() instanceof Object ? httpServer.address().port : 0}/realtime`, {
      transports: ['websocket'],
      timeout: 2000,
      auth: {
        deviceId: bootstrap.device.id,
        deviceToken: bootstrap.deviceToken,
        clientInstanceId: 'client-instance-101',
        clientVersion: '0.1.0'
      }
    });
    await onceEvent<{ sync: string }>(socket, 'connection.ready');

    const disconnected = onceEvent<string>(socket, 'disconnect');
    service.revokeDeviceToken(admin, bootstrap.device.id, 'revoke-device');

    await expect(disconnected).resolves.toBeTruthy();
    expect(() => service.authenticateDeviceToken(bootstrap.deviceToken)).toThrowError('This device token has been revoked.');
  });

  it('disconnects connected device sockets when an administrator retires the device', async () => {
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const bootstrap = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device');
    service.createAdmin({ username: 'admin', password: adminPassword }, systemActor, 'setup-admin');
    const login = service.loginAdmin('admin', adminPassword, 'login-admin', undefined, undefined);
    const admin = service.authenticateAdmin(login.sessionToken);

    await listen(httpServer);
    socket = connectSocket(`http://127.0.0.1:${httpServer.address() instanceof Object ? httpServer.address().port : 0}/realtime`, {
      transports: ['websocket'],
      timeout: 2000,
      auth: {
        deviceId: bootstrap.device.id,
        deviceToken: bootstrap.deviceToken,
        clientInstanceId: 'client-instance-101',
        clientVersion: '0.1.0'
      }
    });
    await onceEvent<{ sync: string }>(socket, 'connection.ready');

    const disconnected = onceEvent<string>(socket, 'disconnect');
    service.retireDevice(admin, bootstrap.device.id, 'retire-device', 'retire-device');

    await expect(disconnected).resolves.toBeTruthy();
    expect(() => service.authenticateDeviceToken(bootstrap.deviceToken)).toThrowError('This device token has been revoked.');
  });

  it('disconnects connected administrator sockets when the session is revoked', async () => {
    service.createAdmin({ username: 'admin', password: adminPassword }, systemActor, 'setup-admin');
    const login = service.loginAdmin('admin', adminPassword, 'login-admin', undefined, undefined);
    const admin = service.authenticateAdmin(login.sessionToken);

    await listen(httpServer);
    socket = connectSocket(`http://127.0.0.1:${httpServer.address() instanceof Object ? httpServer.address().port : 0}/realtime`, {
      transports: ['websocket'],
      timeout: 2000,
      extraHeaders: { Cookie: `hotel_admin_session=${encodeURIComponent(login.sessionToken)}` },
      auth: {
        clientInstanceId: 'admin-client-instance',
        clientVersion: '0.1.0'
      }
    });
    await onceEvent<{ sync: string }>(socket, 'connection.ready');

    const disconnected = onceEvent<string>(socket, 'disconnect');
    service.logoutAdmin(admin, 'logout-admin');

    await expect(disconnected).resolves.toBeTruthy();
    expect(() => service.authenticateAdmin(login.sessionToken)).toThrowError('Administrator session is invalid or expired.');
  });

  it('publishes ephemeral presence transitions during maintenance', async () => {
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const bootstrap = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device');
    const principal = service.authenticateDeviceToken(bootstrap.deviceToken).principal;

    realtime.runMaintenance();
    await listen(httpServer);
    socket = connectSocket(`http://127.0.0.1:${httpServer.address() instanceof Object ? httpServer.address().port : 0}/realtime`, {
      transports: ['websocket'],
      timeout: 2000,
      auth: {
        deviceId: bootstrap.device.id,
        deviceToken: bootstrap.deviceToken,
        clientInstanceId: 'client-instance-101',
        clientVersion: '0.1.0'
      }
    });
    await onceEvent<{ sync: string }>(socket, 'connection.ready');

    const presenceChanged = onceEvent<{ deviceId: string; presence: string; lastSeenAt: string | null }>(socket, 'device.presence.changed');
    service.recordHeartbeat(principal, { clientVersion: '0.1.0', socketConnected: true }, undefined, undefined);
    realtime.runMaintenance();

    await expect(presenceChanged).resolves.toMatchObject({ deviceId: bootstrap.device.id, presence: 'ONLINE' });
  });

  it('moves a connected device to its new assignment rooms before publishing later requests', async () => {
    const area = service.createArea({ code: 'test-housekeeping', displayName: 'Housekeeping' }, systemActor, 'setup-area');
    const firstRoom = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room-101');
    const secondRoom = service.createRoom({ code: '102', displayName: 'Room 102' }, systemActor, 'setup-room-102');
    const catalogService = service.createService({ code: 'test-towels', displayName: 'Fresh towels', areaId: area.id }, systemActor, 'setup-service');
    const bootstrap = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: firstRoom.id
    }, systemActor, 'setup-device');
    service.createAdmin({ username: 'admin', password: adminPassword }, systemActor, 'setup-admin');
    const login = service.loginAdmin('admin', adminPassword, 'login-admin', undefined, undefined);
    const admin = service.authenticateAdmin(login.sessionToken);
    realtime.publishPendingEvents();
    await listen(httpServer);
    socket = connectSocket(`http://127.0.0.1:${httpServer.address() instanceof Object ? httpServer.address().port : 0}/realtime`, {
      transports: ['websocket'],
      timeout: 2000,
      auth: {
        deviceId: bootstrap.device.id,
        deviceToken: bootstrap.deviceToken,
        clientInstanceId: 'client-instance-101',
        clientVersion: '0.1.0'
      }
    });
    await onceEvent<{ sync: string }>(socket, 'connection.ready');

    const configChanged = onceEvent<{ payload: { deviceId: string } }>(socket, 'device.config.changed');
    service.assignDevice(admin, bootstrap.device.id, {
      assignmentMode: 'ROOM',
      roomId: secondRoom.id,
      expectedDeviceConfigVersion: 1,
      reason: 'Move the tablet'
    }, 'assign-device');
    await expect(configChanged).resolves.toMatchObject({ payload: { deviceId: bootstrap.device.id } });

    const requestCreated = onceEvent<{ payload: { request: { roomId: string } } }>(socket, 'request.created');
    const updatedPrincipal = service.authenticateDeviceToken(bootstrap.deviceToken).principal;
    service.createRequest(updatedPrincipal, catalogService.id, 'request-102', 'request-102');
    await expect(requestCreated).resolves.toMatchObject({ payload: { request: { roomId: secondRoom.id } } });
  });

  it('broadcasts settings changes so connected devices refresh runtime values', async () => {
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const bootstrap = service.bootstrapDevice({
      installationId: 'installation-101',
      displayName: 'Room 101 tablet',
      assignmentMode: 'ROOM',
      roomId: room.id
    }, systemActor, 'setup-device');
    service.createAdmin({ username: 'admin', password: adminPassword }, systemActor, 'setup-admin');
    const login = service.loginAdmin('admin', adminPassword, 'login-admin', undefined, undefined);
    const admin = service.authenticateAdmin(login.sessionToken);
    realtime.publishPendingEvents();
    await listen(httpServer);
    socket = connectSocket(`http://127.0.0.1:${httpServer.address() instanceof Object ? httpServer.address().port : 0}/realtime`, {
      transports: ['websocket'],
      timeout: 2000,
      auth: {
        deviceId: bootstrap.device.id,
        deviceToken: bootstrap.deviceToken,
        clientInstanceId: 'client-instance-101',
        clientVersion: '0.1.0'
      }
    });
    await onceEvent<{ sync: string }>(socket, 'connection.ready');

    const settingsChanged = onceEvent<{ eventSequence: number; payload: { message: string } }>(socket, 'system.maintenance');
    service.updateSettings(admin, { 'alerts.pendingRepeatMs': 1000 }, 'update-settings');
    realtime.publishPendingEvents();

    await expect(settingsChanged).resolves.toMatchObject({ payload: { message: expect.stringContaining('Configuration revision') } });
  });
});

type HeartbeatAck = { ok: boolean; errorCode?: string };

function emitHeartbeat(client: Socket, payload: unknown): Promise<HeartbeatAck> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for heartbeat acknowledgement.')), 2000);
    client.emit('device.heartbeat', payload, (acknowledgement: HeartbeatAck) => {
      clearTimeout(timer);
      resolve(acknowledgement);
    });
  });
}

function onceEvent<T>(client: Socket, name: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${name}.`)), 2000);
    client.once(name, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}

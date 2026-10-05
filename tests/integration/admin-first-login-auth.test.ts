import { createServer, type Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { io as connectSocket, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, type ServerConfig } from '../../apps/server/src/config/env';
import { closeDatabase, openDatabase, runMigrations, type SqliteDatabase } from '../../apps/server/src/db/connection';
import { HotelService } from '../../apps/server/src/domain/hotel-service';
import { createApp } from '../../apps/server/src/http/app';
import { attachRealtime, type RealtimeServer } from '../../apps/server/src/realtime/server';
import { verifyPassword } from '../../apps/server/src/security/crypto';

const DEFAULT_ADMIN_PASSWORD = 'admin';
const NEW_ADMIN_PASSWORD = 'operator-new-password';

describe('admin first-login authentication enforcement', () => {
  let database: SqliteDatabase;
  let databaseDirectory: string;
  let config: ServerConfig;
  let service: HotelService;
  let app: ReturnType<typeof createApp>;
  let httpServer: Server | undefined;
  let realtime: RealtimeServer | undefined;
  let socket: Socket | undefined;

  beforeEach(() => {
    databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-admin-first-login-auth-'));
    config = loadConfig({
      nodeEnv: 'test',
      databasePath: path.join(databaseDirectory, 'hotel.sqlite'),
      sessionSecret: 'session-secret',
      tokenPepper: 'token-pepper'
    });
    database = openDatabase(config);
    runMigrations(database);
    service = new HotelService(database, config);
    app = createApp(service, config);
  });

  afterEach(async () => {
    socket?.disconnect();
    if (realtime !== undefined) await realtime.close();
    if (httpServer !== undefined) await closeHttpServer(httpServer);
    closeDatabase(database);
    fs.rmSync(databaseDirectory, { recursive: true, force: true });
  });

  it('exposes the required password-change state in the login response', async () => {
    const login = await request(app).post('/api/v1/auth/admin/login')
      .send({ username: 'admin', password: DEFAULT_ADMIN_PASSWORD })
      .expect(200);

    expect(login.body.data.admin.mustChangePassword).toBe(true);
  });

  it('exposes the required password-change state during session restoration', async () => {
    const client = request.agent(app);
    await client.post('/api/v1/auth/admin/login')
      .send({ username: 'admin', password: DEFAULT_ADMIN_PASSWORD })
      .expect(200);

    const me = await client.get('/api/v1/auth/admin/me').expect(200);
    expect(me.body.data.mustChangePassword).toBe(true);
  });

  it('denies admin snapshot reads while password change is pending', async () => {
    const login = await request(app).post('/api/v1/auth/admin/login')
      .send({ username: 'admin', password: DEFAULT_ADMIN_PASSWORD })
      .expect(200);
    const cookie = getSessionCookie(login);

    const denied = await request(app)
      .get('/api/v1/system/snapshot')
      .set('Cookie', cookie);

    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('ADMIN_PASSWORD_CHANGE_REQUIRED');
  });

  it('denies privileged mutations while password change is pending', async () => {
    const login = await request(app).post('/api/v1/auth/admin/login')
      .send({ username: 'admin', password: DEFAULT_ADMIN_PASSWORD })
      .expect(200);
    const cookie = getSessionCookie(login);
    const csrfToken = login.body.data.csrfToken as string;

    const denied = await request(app)
      .post('/api/v1/areas')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'forced-change-area-create')
      .send({ code: 'forced-change-test-area', displayName: 'Forced Change Test Area' });

    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('ADMIN_PASSWORD_CHANGE_REQUIRED');
  });

  it('denies mixed-principal admin routes while password change is pending', async () => {
    const login = await request(app).post('/api/v1/auth/admin/login')
      .send({ username: 'admin', password: DEFAULT_ADMIN_PASSWORD })
      .expect(200);

    const denied = await request(app)
      .get('/api/v1/requests/unknown-request')
      .set('Cookie', getSessionCookie(login));

    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('ADMIN_PASSWORD_CHANGE_REQUIRED');
  });

  it('allows an administrator with a pending password change to log out', async () => {
    const login = await request(app).post('/api/v1/auth/admin/login')
      .send({ username: 'admin', password: DEFAULT_ADMIN_PASSWORD })
      .expect(200);

    await request(app)
      .post('/api/v1/auth/admin/logout')
      .set('Cookie', getSessionCookie(login))
      .set('X-CSRF-Token', login.body.data.csrfToken as string)
      .expect(204);
  });

  it('rejects Socket.IO connections for an administrator who must change the password', async () => {
    const login = await request(app).post('/api/v1/auth/admin/login')
      .send({ username: 'admin', password: DEFAULT_ADMIN_PASSWORD })
      .expect(200);
    const cookie = getSessionCookie(login);

    httpServer = createServer();
    realtime = attachRealtime(httpServer, service, config);
    await listen(httpServer);
    const address = httpServer.address();
    if (address === null || typeof address === 'string') throw new Error('Realtime test server did not expose a TCP address.');

    socket = connectSocket(`http://127.0.0.1:${address.port}/realtime`, {
      transports: ['websocket'],
      timeout: 2000,
      reconnection: false,
      extraHeaders: { Cookie: cookie },
      auth: { clientInstanceId: 'forced-change-admin-client', clientVersion: '0.1.0' }
    });

    await expect(expectConnectionOutcome(socket)).resolves.toBe('rejected');
  });

  it('clears the forced-change flag and revokes the pending session after password change', async () => {
    const login = await request(app).post('/api/v1/auth/admin/login')
      .send({ username: 'admin', password: DEFAULT_ADMIN_PASSWORD })
      .expect(200);
    const cookie = getSessionCookie(login);
    const csrfToken = login.body.data.csrfToken as string;

    await request(app)
      .post('/api/v1/auth/admin/change-password')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'forced-change-password')
      .send({ currentPassword: DEFAULT_ADMIN_PASSWORD, newPassword: NEW_ADMIN_PASSWORD })
      .expect(200);

    const admin = database.prepare('SELECT id, password_hash, must_change_password FROM admins WHERE username = ?').get('admin') as {
      id: string;
      password_hash: string;
      must_change_password: number;
    };
    expect(verifyPassword(NEW_ADMIN_PASSWORD, admin.password_hash)).toBe(true);
    expect(admin.must_change_password).toBe(0);
    expect((database.prepare('SELECT COUNT(*) AS count FROM audit_log WHERE action = ? AND entity_id = ?').get('ADMIN_PASSWORD_CHANGED', admin.id) as { count: number }).count).toBe(1);

    await request(app)
      .get('/api/v1/auth/admin/me')
      .set('Cookie', cookie)
      .expect(401);
    await request(app).post('/api/v1/auth/admin/login')
      .send({ username: 'admin', password: DEFAULT_ADMIN_PASSWORD })
      .expect(401);

    const freshLogin = await request(app).post('/api/v1/auth/admin/login')
      .send({ username: 'admin', password: NEW_ADMIN_PASSWORD })
      .expect(200);
    expect(freshLogin.body.data.admin.mustChangePassword).toBe(false);
  });
});

function getSessionCookie(response: { headers: Record<string, string | string[] | undefined> }): string {
  const setCookie = response.headers['set-cookie'];
  const sessionCookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';', 1)[0];
  if (sessionCookie === undefined || sessionCookie.length === 0) {
    throw new Error('Admin login did not issue a session cookie.');
  }
  return sessionCookie;
}

function expectConnectionOutcome(socket: Socket): Promise<'connected' | 'rejected'> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for the realtime handshake outcome.')), 2500);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve('connected');
    });
    socket.once('connect_error', () => {
      clearTimeout(timer);
      resolve('rejected');
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

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, type ServerConfig } from '../../apps/server/src/config/env';
import { closeDatabase, openDatabase, runMigrations, type SqliteDatabase } from '../../apps/server/src/db/connection';
import { HotelService } from '../../apps/server/src/domain/hotel-service';
import { createApp } from '../../apps/server/src/http/app';
import type { Actor } from '../../apps/server/src/security/principal';

const systemActor: Actor = { actorType: 'SYSTEM', actorId: null };
const adminPassword = 'correct-horse-battery-staple';

describe('Information image HTTP API', () => {
  let database: SqliteDatabase;
  let temporaryDirectory: string;
  let config: ServerConfig;
  let service: HotelService;
  let app: ReturnType<typeof createApp>;
  let adminClient: ReturnType<typeof request.agent>;
  let csrfToken: string;

  beforeEach(async () => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'information-http-'));
    config = loadConfig({
      nodeEnv: 'test',
      databasePath: path.join(temporaryDirectory, 'hotel.sqlite'),
      informationImageDirectory: path.join(temporaryDirectory, 'images'),
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    closeDatabase(database);
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('uploads images through the admin route and exposes them only to ROOM devices', async () => {
    const uploaded = await adminClient
      .post('/api/v1/information/images')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'information-image-1')
      .attach('image', pngBytes('welcome'), 'welcome.png')
      .expect(201);
    const uploadedRetry = await adminClient
      .post('/api/v1/information/images')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'information-image-1')
      .attach('image', pngBytes('welcome'), 'welcome.png');
    expect(uploadedRetry.status, JSON.stringify(uploadedRetry.body)).toBe(201);
    expect(uploadedRetry.body.idempotentReplay).toBe(true);
    expect(uploadedRetry.body.data).toEqual(uploaded.body.data);
    expect(informationImageRowCount()).toBe(1);
    expect(storedInformationImageFiles()).toHaveLength(1);

    expect(uploaded.body.data).toMatchObject({ originalName: 'welcome.png', mimeType: 'image/png', byteSize: 15, displayOrder: 0 });

    await adminClient
      .get(`/api/v1/information/images/${uploaded.body.data.id}/content`)
      .expect('Content-Type', /image\/png/)
      .expect(200)
      .then((response) => expect(response.body).toEqual(pngBytes('welcome')));

    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const roomDevice = service.bootstrapDevice({ installationId: 'room-101', displayName: 'Room 101 tablet', assignmentMode: 'ROOM', roomId: room.id }, systemActor, 'setup-room-device');
    const area = service.createArea({ code: 'information-housekeeping', displayName: 'Housekeeping' }, systemActor, 'setup-area');
    const areaDevice = service.bootstrapDevice({ installationId: 'area-1', displayName: 'Area tablet', assignmentMode: 'AREA', areaId: area.id }, systemActor, 'setup-area-device');

    const roomImages = await request(app)
      .get('/api/v1/device/information/images')
      .set('Authorization', `Bearer ${roomDevice.deviceToken}`)
      .expect(200);
    expect(roomImages.body.data).toHaveLength(1);

    await request(app)
      .get(`/api/v1/device/information/images/${uploaded.body.data.id}/content`)
      .set('Authorization', `Bearer ${roomDevice.deviceToken}`)
      .expect('Content-Type', /image\/png/)
      .expect(200)
      .then((response) => expect(response.body).toEqual(pngBytes('welcome')));

    const areaImages = await request(app)
      .get('/api/v1/device/information/images')
      .set('Authorization', `Bearer ${areaDevice.deviceToken}`)
      .expect(403);
    expect(areaImages.body.error.code).toBe('FORBIDDEN_ASSIGNMENT');
  });

  it('rejects a different upload body when an idempotency key is reused', async () => {
    await adminClient
      .post('/api/v1/information/images')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'information-image-conflict')
      .attach('image', pngBytes('first'), 'first.png')
      .expect(201);

    const conflict = await adminClient
      .post('/api/v1/information/images')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'information-image-conflict')
      .attach('image', pngBytes('second'), 'first.png')
      .expect(409);

    expect(conflict.body.error.code).toBe('IDEMPOTENCY_KEY_REUSE_MISMATCH');
    expect(informationImageRowCount()).toBe(1);
    expect(storedInformationImageFiles()).toHaveLength(1);
  });

  function informationImageRowCount(): number {
    return (database.prepare('SELECT COUNT(*) AS count FROM information_images').get() as { count: number }).count;
  }

  function storedInformationImageFiles(): string[] {
    return fs.readdirSync(config.informationImageDirectory).filter((file) => file.startsWith('information_')).sort();
  }

  it('preserves binary image bytes that contain the multipart boundary text', async () => {
    const boundary = 'AaB03x';
    const imageBytes = Buffer.concat([
      pngBytes('prefix'),
      Buffer.from(`--${boundary}`),
      Buffer.from([0, 255, 16]),
      pngBytes('suffix')
    ]);
    const multipartBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="boundary.png"\r\nContent-Type: image/png\r\n\r\n`),
      imageBytes,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const uploaded = await adminClient
      .post('/api/v1/information/images')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'information-image-boundary')
      .set('Content-Type', `multipart/form-data; boundary=${boundary}`)
      .send(multipartBody)
      .expect(201);

    expect(uploaded.body.data.byteSize).toBe(imageBytes.length);
    await adminClient
      .get(`/api/v1/information/images/${uploaded.body.data.id}/content`)
      .expect('Content-Type', /image\/png/)
      .expect(200)
      .then((response) => expect(response.body).toEqual(imageBytes));
  });

  it('lets a ROOM device toggle the FreeKiosk screensaver through the server', async () => {
    const room = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room');
    const roomDevice = service.bootstrapDevice({ installationId: 'room-101', displayName: 'Room 101 tablet', assignmentMode: 'ROOM', roomId: room.id }, systemActor, 'setup-room-device');
    const authenticated = service.authenticateDeviceToken(roomDevice.deviceToken);
    service.recordHeartbeat(authenticated.principal, {}, '192.168.1.20', 'test-agent');
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('http://192.168.1.20:8080/api/screensaver/off');
      expect(init?.method).toBe('POST');
      return new Response(JSON.stringify({ success: true, data: { executed: true, command: 'screenSaverOff' } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app)
      .post('/api/v1/device/information/screensaver/off')
      .set('Authorization', `Bearer ${roomDevice.deviceToken}`)
      .expect(200);

    expect(response.body.data).toEqual({ command: 'screenSaverOff', executed: true });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(['off', 'on'] as const)('rate limits the authenticated screensaver-%s mutation per device', async (command) => {
    const room = service.createRoom({ code: `10${command === 'off' ? '1' : '2'}`, displayName: `Room ${command}` }, systemActor, `setup-room-${command}`);
    const roomDevice = service.bootstrapDevice({ installationId: `room-${command}`, displayName: `Room ${command} tablet`, assignmentMode: 'ROOM', roomId: room.id }, systemActor, `setup-device-${command}`);
    const authenticated = service.authenticateDeviceToken(roomDevice.deviceToken);
    service.recordHeartbeat(authenticated.principal, {}, '192.168.1.20', 'test-agent');
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      success: true,
      data: { executed: true, command: command === 'off' ? 'screenSaverOff' : 'screenSaverOn' }
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const routeApp = createApp(service, config);
    const route = `/api/v1/device/information/screensaver/${command}`;

    for (let attempt = 0; attempt < 120; attempt += 1) {
      await request(routeApp)
        .post(route)
        .set('Authorization', `Bearer ${roomDevice.deviceToken}`)
        .expect(200);
    }

    const limited = await request(routeApp)
      .post(route)
      .set('Authorization', `Bearer ${roomDevice.deviceToken}`)
      .expect(429);

    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(fetchMock).toHaveBeenCalledTimes(120);
  });

  it('stores compact and wide variants and serves the requested variant with fallback', async () => {
    const uploaded = await adminClient
      .post('/api/v1/information/images')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'information-image-variants')
      .attach('square480', pngBytes('square'), 'compact.png')
      .attach('wide', pngBytes('wide'), 'wide.png')
      .expect(201);

    expect(uploaded.body.data).toMatchObject({ originalName: 'wide.png', variants: [
      { variant: 'wide', originalName: 'wide.png' },
      { variant: 'square480', originalName: 'compact.png' }
    ] });

    const room = service.createRoom({ code: '102', displayName: 'Room 102' }, systemActor, 'setup-room-variants');
    const roomDevice = service.bootstrapDevice({ installationId: 'room-102', displayName: 'Room 102 tablet', assignmentMode: 'ROOM', roomId: room.id }, systemActor, 'setup-room-device-variants');

    await request(app)
      .get(`/api/v1/device/information/images/${uploaded.body.data.id}/content?variant=square480`)
      .set('Authorization', `Bearer ${roomDevice.deviceToken}`)
      .expect('Content-Type', /image\/png/)
      .expect(200)
      .then((response) => expect(response.body).toEqual(pngBytes('square')));

    await request(app)
      .get(`/api/v1/device/information/images/${uploaded.body.data.id}/content?variant=wide`)
      .set('Authorization', `Bearer ${roomDevice.deviceToken}`)
      .expect('Content-Type', /image\/png/)
      .expect(200)
      .then((response) => expect(response.body).toEqual(pngBytes('wide')));

    const fallback = await adminClient
      .post('/api/v1/information/images')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'information-image-wide-only')
      .attach('wide', pngBytes('fallback'), 'fallback.png')
      .expect(201);

    await request(app)
      .get(`/api/v1/device/information/images/${fallback.body.data.id}/content?variant=square480`)
      .set('Authorization', `Bearer ${roomDevice.deviceToken}`)
      .expect('Content-Type', /image\/png/)
      .expect(200)
      .then((response) => expect(response.body).toEqual(pngBytes('fallback')));
  });

  it('requires both languages for new slides and serves repaired ROOM artwork by language and size', async () => {
    const incomplete = await adminClient
      .post('/api/v1/information/images')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'information-image-only-english')
      .attach('en-wide', pngBytes('English only'), 'welcome-en.png')
      .expect(422);
    expect(incomplete.body.error.code).toBe('VALIDATION_ERROR');

    const uploaded = await adminClient
      .post('/api/v1/information/images')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'information-image-bilingual')
      .attach('en-wide', pngBytes('English wide'), 'welcome-en.png')
      .attach('es-wide', pngBytes('Spanish wide'), 'bienvenida-es.png')
      .expect(201);

    expect(uploaded.body.data.variants).toEqual([
      { language: 'es', variant: 'wide', originalName: 'bienvenida-es.png', mimeType: 'image/png', byteSize: pngBytes('Spanish wide').length },
      { language: 'en', variant: 'wide', originalName: 'welcome-en.png', mimeType: 'image/png', byteSize: pngBytes('English wide').length }
    ]);

    const room = service.createRoom({ code: '103', displayName: 'Room 103' }, systemActor, 'setup-room-localized-images');
    const roomDevice = service.bootstrapDevice({ installationId: 'room-103', displayName: 'Room 103 tablet', assignmentMode: 'ROOM', roomId: room.id }, systemActor, 'setup-room-device-localized-images');
    const contentPath = `/api/v1/device/information/images/${uploaded.body.data.id}/content`;

    await request(app)
      .get(`${contentPath}?language=en&variant=square480`)
      .set('Authorization', `Bearer ${roomDevice.deviceToken}`)
      .expect('Content-Type', /image\/png/)
      .expect(200)
      .then((response) => expect(response.body).toEqual(pngBytes('English wide')));
    await request(app)
      .get(`${contentPath}?language=es&variant=wide`)
      .set('Authorization', `Bearer ${roomDevice.deviceToken}`)
      .expect(200)
      .then((response) => expect(response.body).toEqual(pngBytes('Spanish wide')));

    const repaired = await adminClient
      .post(`/api/v1/information/images/${uploaded.body.data.id}/variants`)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'information-image-bilingual-repair')
      .attach('en-wide', pngBytes('Fixed English'), 'welcome-en-fixed.png')
      .expect(200);
    expect(repaired.body.data.variants.find((variant: { language?: string; originalName: string }) => variant.language === 'en')?.originalName).toBe('welcome-en-fixed.png');

    await request(app)
      .get(`${contentPath}?language=en&variant=wide`)
      .set('Authorization', `Bearer ${roomDevice.deviceToken}`)
      .expect(200)
      .then((response) => expect(response.body).toEqual(pngBytes('Fixed English')));
    await request(app)
      .get(`${contentPath}?language=fr&variant=wide`)
      .set('Authorization', `Bearer ${roomDevice.deviceToken}`)
      .expect(422);
  });
});

function pngBytes(label: string): Buffer {
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from(label)]);
}

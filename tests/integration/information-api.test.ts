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
      .attach('image', pngBytes('welcome'), { filename: 'welcome.gif', contentType: 'image/gif' })
      .expect(201);
    const uploadedRetry = await adminClient
      .post('/api/v1/information/images')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'information-image-1')
      .attach('image', pngBytes('welcome'), { filename: 'welcome.gif', contentType: 'image/gif' });
    expect(uploadedRetry.status, JSON.stringify(uploadedRetry.body)).toBe(201);
    expect(uploadedRetry.body.idempotentReplay).toBe(true);
    expect(uploadedRetry.body.data).toEqual(uploaded.body.data);
    expect(informationImageRowCount()).toBe(1);
    expect(storedInformationImageFiles()).toHaveLength(2);

    expect(uploaded.body.data).toMatchObject({
      originalName: 'welcome.gif', mimeType: 'image/webp', displayOrder: 0,
      variants: [
        { variant: 'wide', originalName: 'welcome.gif', mimeType: 'image/webp' },
        { variant: 'square480', originalName: 'welcome.gif', mimeType: 'image/webp' }
      ]
    });
    expect(uploaded.body.data.byteSize).toBeGreaterThan(0);

    await adminClient
      .get(`/api/v1/information/images/${uploaded.body.data.id}/content`)
      .expect('Content-Type', /image\/webp/)
      .expect(200)
      .then((response) => expect(isWebp(response.body as Buffer)).toBe(true));

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
      .expect('Content-Type', /image\/webp/)
      .expect(200)
      .then((response) => expect(isWebp(response.body as Buffer)).toBe(true));

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
    expect(storedInformationImageFiles()).toHaveLength(2);
  });

  function informationImageRowCount(): number {
    return (database.prepare('SELECT COUNT(*) AS count FROM information_images').get() as { count: number }).count;
  }

  function storedInformationImageFiles(): string[] {
    return fs.readdirSync(config.informationImageDirectory).filter((file) => file.startsWith('information_')).sort();
  }

  it('normalizes a valid image whose binary bytes contain the multipart boundary text', async () => {
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

    expect(uploaded.body.data.mimeType).toBe('image/webp');
    await adminClient
      .get(`/api/v1/information/images/${uploaded.body.data.id}/content`)
      .expect('Content-Type', /image\/webp/)
      .expect(200)
      .then((response) => expect(isWebp(response.body as Buffer)).toBe(true));
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

  it('creates square and horizontal assets from one source and serves the same artwork for both languages', async () => {
    const uploaded = await adminClient
      .post('/api/v1/information/images')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'information-image-shared')
      .attach('image', pngBytes('single shared source'), 'welcome.png')
      .expect(201);

    expect(uploaded.body.data).toMatchObject({ originalName: 'welcome.png', variants: [
      { variant: 'wide', originalName: 'welcome.png' },
      { variant: 'square480', originalName: 'welcome.png' }
    ] });
    expect(uploaded.body.data.variants).toHaveLength(2);

    const room = service.createRoom({ code: '102', displayName: 'Room 102' }, systemActor, 'setup-room-variants');
    const roomDevice = service.bootstrapDevice({ installationId: 'room-102', displayName: 'Room 102 tablet', assignmentMode: 'ROOM', roomId: room.id }, systemActor, 'setup-room-device-variants');

    for (const [variant, dimensions] of [['square480', [480, 480]], ['wide', [1280, 720]]] as const) {
      const contents = await Promise.all((['en', 'es'] as const).map((language) => request(app)
        .get(`/api/v1/device/information/images/${uploaded.body.data.id}/content?variant=${variant}&language=${language}`)
        .set('Authorization', `Bearer ${roomDevice.deviceToken}`)
        .expect('Content-Type', /image\/webp/)
        .expect(200)));
      const english = contents[0]?.body as Buffer;
      const spanish = contents[1]?.body as Buffer;
      expect(isWebp(english)).toBe(true);
      expect(english).toEqual(spanish);
      expect(readWebpDimensions(english)).toEqual({ width: dimensions[0], height: dimensions[1] });
    }
  });

  it('repairs a legacy localized slide into one shared square and wide pair for every locale', async () => {
    const legacy = service.createInformationImageVariants([
      { bytes: pngBytes('legacy English'), originalName: 'welcome-en.png', language: 'en', variant: 'wide' },
      { bytes: pngBytes('legacy Spanish'), originalName: 'bienvenida-es.png', language: 'es', variant: 'wide' }
    ], systemActor, 'setup-legacy-localized-image');
    const room = service.createRoom({ code: '103', displayName: 'Room 103' }, systemActor, 'setup-room-localized-images');
    const roomDevice = service.bootstrapDevice({ installationId: 'room-103', displayName: 'Room 103 tablet', assignmentMode: 'ROOM', roomId: room.id }, systemActor, 'setup-room-device-localized-images');

    const repaired = await adminClient
      .post(`/api/v1/information/images/${legacy.id}/variants`)
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'information-image-shared-repair')
      .attach('image', pngBytes('new shared source'), 'welcome-shared.png')
      .expect(200);

    expect(repaired.body.data).toMatchObject({ originalName: 'welcome-shared.png', variants: [
      { variant: 'wide', originalName: 'welcome-shared.png', mimeType: 'image/webp' },
      { variant: 'square480', originalName: 'welcome-shared.png', mimeType: 'image/webp' }
    ] });
    expect(database.prepare('SELECT COUNT(*) AS count FROM information_image_localized_variants WHERE information_image_id = ?').get(legacy.id)).toMatchObject({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM information_image_variants WHERE information_image_id = ?').get(legacy.id)).toMatchObject({ count: 2 });
    expect(storedInformationImageFiles()).toHaveLength(2);

    for (const [variant, dimensions] of [['square480', [480, 480]], ['wide', [1280, 720]]] as const) {
      const contents = await Promise.all((['en', 'es'] as const).map((language) => request(app)
        .get(`/api/v1/device/information/images/${legacy.id}/content?variant=${variant}&language=${language}`)
        .set('Authorization', `Bearer ${roomDevice.deviceToken}`)
        .expect('Content-Type', /image\/webp/)
        .expect(200)));
      const english = contents[0]?.body as Buffer;
      const spanish = contents[1]?.body as Buffer;
      expect(english).toEqual(spanish);
      expect(readWebpDimensions(english)).toEqual({ width: dimensions[0], height: dimensions[1] });
    }
  });

  it('rejects multiple prebuilt image files and leaves no partial database or file writes', async () => {
    const rejected = await adminClient
      .post('/api/v1/information/images')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'information-image-multiple-sources')
      .attach('image', pngBytes('source one'), 'one.png')
      .attach('wide', pngBytes('source two'), 'two.png')
      .expect(422);

    expect(rejected.body.error.code).toBe('VALIDATION_ERROR');
    expect(informationImageRowCount()).toBe(0);
    expect(storedInformationImageFiles()).toHaveLength(0);
  });

  it('rejects a corrupt source image without persisting any files', async () => {
    const rejected = await adminClient
      .post('/api/v1/information/images')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'information-image-corrupt-source')
      .attach('image', Buffer.from('not a decodable image'), 'broken.gif')
      .expect(422);

    expect(rejected.body.error.code).toBe('VALIDATION_ERROR');
    expect(rejected.body.error.message).not.toMatch(/ffmpeg|decoder|pipe/i);
    expect(informationImageRowCount()).toBe(0);
    expect(storedInformationImageFiles()).toHaveLength(0);
  });
});

function pngBytes(label: string): Buffer {
  const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEElEQVR4nGP8ywACLGCSAQANEQED1LYyQAAAAABJRU5ErkJggg==', 'base64');
  return Buffer.concat([validPng, Buffer.from(label)]);
}

function isWebp(bytes: Buffer): boolean {
  return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
}

function readWebpDimensions(bytes: Buffer): { width: number; height: number } {
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8X') {
    const readUInt24LE = (offset: number): number => (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
    return { width: readUInt24LE(24) + 1, height: readUInt24LE(27) + 1 };
  }
  throw new Error(`Unsupported normalized WebP chunk: ${chunk}`);
}

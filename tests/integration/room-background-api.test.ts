import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isRoomBackgroundValue } from '@hotel/shared';
import { loadConfig, type ServerConfig } from '../../apps/server/src/config/env';
import { closeDatabase, openDatabase, runMigrations, type SqliteDatabase } from '../../apps/server/src/db/connection';
import { HotelService } from '../../apps/server/src/domain/hotel-service';
import { createApp } from '../../apps/server/src/http/app';
import type { Actor } from '../../apps/server/src/security/principal';

const systemActor: Actor = { actorType: 'SYSTEM', actorId: null };
const adminPassword = 'correct-horse-battery-staple';
const ffmpegAvailable = requireFfmpeg();
const describeFfmpeg = ffmpegAvailable ? describe : describe.skip;

function removeMigrationSeededAdmin(database: SqliteDatabase): void {
  database.prepare("DELETE FROM admins WHERE username = 'admin' AND must_change_password = 1").run();
}

describeFfmpeg('ROOM background HTTP API', () => {
  let database: SqliteDatabase;
  let temporaryDirectory: string;
  let config: ServerConfig;
  let service: HotelService;
  let app: ReturnType<typeof createApp>;
  let adminClient: ReturnType<typeof request.agent>;
  let csrfToken: string;

  beforeEach(async () => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'room-background-http-'));
    config = loadConfig({
      nodeEnv: 'test',
      databasePath: path.join(temporaryDirectory, 'hotel.sqlite'),
      informationImageDirectory: path.join(temporaryDirectory, 'images'),
      sessionSecret: 'session-secret',
      tokenPepper: 'token-pepper'
    });
    database = openDatabase(config);
    runMigrations(database);
    removeMigrationSeededAdmin(database);
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

  it('requires the admin CSRF token and safely rejects corrupt bytes without changing settings', async () => {
    const initialRevision = service.getConfigurationRevision();
    const forbidden = await adminClient
      .post('/api/v1/settings/room-background')
      .set('Idempotency-Key', 'room-background-no-csrf')
      .attach('image', ppmFixture(), { filename: 'background.bin', contentType: 'application/octet-stream' })
      .expect(403);
    expect(forbidden.body.error.code).toBe('AUTH_INVALID');

    const invalid = await adminClient
      .post('/api/v1/settings/room-background')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'room-background-invalid')
      .attach('image', Buffer.from('not an image'), { filename: 'background.jpg', contentType: 'image/jpeg' })
      .expect(422);

    expect(invalid.body.error.message).toBe('The image is invalid, unsupported, or exceeds the supported dimensions.');
    expect(invalid.body.error.message).not.toMatch(/ffmpeg|decoder output|pipe/i);
    expect(service.getSettings().roomBackground).toBeNull();
    expect(service.getConfigurationRevision()).toBe(initialRevision);
  });

  it('normalizes uploaded bytes server-side and persists the square and tablet setting variants', async () => {
    const initialRevision = service.getConfigurationRevision();
    const sourceImage = ppmFixture();
    expect(sourceImage.length).toBeGreaterThan(64 * 1024);
    const upload = await adminClient
      .post('/api/v1/settings/room-background')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'room-background-save')
      .set('Content-Type', 'multipart/form-data; boundary=WebKitFormBoundaryABC123')
      .send(multipartImageBody('WebKitFormBoundaryABC123', sourceImage, 'not-an-image.txt'))
      .expect('Cache-Control', 'no-store')
      .expect(200);

    expect(upload.body.data).toEqual({ updated: true });
    expect(upload.body.idempotentReplay).toBe(false);
    expect(service.getConfigurationRevision()).toBe(initialRevision + 1);

    const roomBackground = service.getSettings().roomBackground;
    expect(isRoomBackgroundValue(roomBackground)).toBe(true);
    expect(roomBackground).toMatchObject({
      square480: expect.stringMatching(/^data:image\/webp;base64,/),
      tablet: expect.stringMatching(/^data:image\/webp;base64,/)
    });

    const replay = await adminClient
      .post('/api/v1/settings/room-background')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'room-background-save')
      .attach('image', sourceImage, { filename: 'not-an-image.txt', contentType: 'text/plain' })
      .expect(200);
    expect(replay.body.idempotentReplay).toBe(true);
    expect(service.getConfigurationRevision()).toBe(initialRevision + 1);
  });
});

function ppmFixture(): Buffer {
  const width = 320;
  const height = 180;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      pixels[offset] = x % 256;
      pixels[offset + 1] = y % 256;
      pixels[offset + 2] = (x + y) % 256;
    }
  }
  return Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`, 'ascii'), pixels]);
}

function multipartImageBody(boundary: string, image: Buffer, filename: string): Buffer {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n`, 'ascii'),
    image,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'ascii')
  ]);
}

function requireFfmpeg(): boolean {
  return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
}

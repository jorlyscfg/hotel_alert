import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, type ServerConfig } from '../../apps/server/src/config/env';
import { closeDatabase, openDatabase, runMigrations, type SqliteDatabase } from '../../apps/server/src/db/connection';
import { HotelService } from '../../apps/server/src/domain/hotel-service';
import { createApp, type WeatherUnavailableLogRecord } from '../../apps/server/src/http/app';
import type { Actor } from '../../apps/server/src/security/principal';

const systemActor: Actor = { actorType: 'SYSTEM', actorId: null };
const adminPassword = 'correct-horse-battery-staple';

function removeMigrationSeededAdmin(database: SqliteDatabase): void {
  database.prepare("DELETE FROM admins WHERE username = 'admin' AND must_change_password = 1").run();
}

describe('ROOM weather API', () => {
  let database: SqliteDatabase;
  let databaseDirectory: string;
  let config: ServerConfig;
  let service: HotelService;
  let adminClient: ReturnType<typeof request.agent>;
  let csrfToken: string;

  beforeEach(async () => {
    databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-weather-'));
    config = loadConfig({
      nodeEnv: 'test',
      appOrigin: 'http://hotel-alert.test',
      databasePath: path.join(databaseDirectory, 'hotel.sqlite'),
      sessionSecret: 'session-secret',
      tokenPepper: 'token-pepper',
      geoapifyApiKey: ''
    });
    database = openDatabase(config);
    runMigrations(database);
    removeMigrationSeededAdmin(database);
    service = new HotelService(database, config);
    service.createAdmin({ username: 'admin', password: adminPassword }, systemActor, 'setup-admin');
    const app = createApp(service, config);
    adminClient = request.agent(app);
    const login = await adminClient.post('/api/v1/auth/admin/login').send({ username: 'admin', password: adminPassword }).expect(200);
    csrfToken = login.body.data.csrfToken as string;
  });

  afterEach(() => {
    closeDatabase(database);
    fs.rmSync(databaseDirectory, { recursive: true, force: true });
  });

  it('keeps forecast access device-authenticated and ROOM-only without sending coordinates in snapshots', async () => {
    const area = service.createArea({ code: 'weather-housekeeping', displayName: 'Housekeeping' }, systemActor, 'setup-area');
    const room101 = service.createRoom({ code: '101', displayName: 'Room 101' }, systemActor, 'setup-room-101');
    const room102 = service.createRoom({ code: '102', displayName: 'Room 102' }, systemActor, 'setup-room-102');
    const roomDeviceOne = service.bootstrapDevice({ installationId: 'weather-room-101', displayName: 'Room 101 panel', assignmentMode: 'ROOM', roomId: room101.id }, systemActor, 'weather-room-101');
    const roomDeviceTwo = service.bootstrapDevice({ installationId: 'weather-room-102', displayName: 'Room 102 panel', assignmentMode: 'ROOM', roomId: room102.id }, systemActor, 'weather-room-102');
    const areaDevice = service.bootstrapDevice({ installationId: 'weather-area', displayName: 'Housekeeping panel', assignmentMode: 'AREA', areaId: area.id }, systemActor, 'weather-area');
    const providerFetch = vi.fn<typeof fetch>().mockResolvedValue(forecastResponse());
    const weatherLogs: WeatherUnavailableLogRecord[] = [];
    const app = createApp(service, config, {
      metNorwayFetch: providerFetch,
      weatherLog: (record) => weatherLogs.push(record)
    });

    await request(app).get('/api/v1/device/weather').expect(401);
    const adminOnWeatherApp = request.agent(app);
    await adminOnWeatherApp.post('/api/v1/auth/admin/login').send({ username: 'admin', password: adminPassword }).expect(200);
    await adminOnWeatherApp.get('/api/v1/device/weather').expect(401);
    const areaResponse = await request(app).get('/api/v1/device/weather').set('Authorization', `Bearer ${areaDevice.deviceToken}`).expect(403);
    expect(areaResponse.body.error.code).toBe('FORBIDDEN_ASSIGNMENT');
    const unconfigured = await request(app).get('/api/v1/device/weather')
      .set('Authorization', `Bearer ${roomDeviceOne.deviceToken}`).expect(200);
    expect(unconfigured.body.data).toBeNull();
    expect(providerFetch).not.toHaveBeenCalled();
    expect(weatherLogs).toEqual([{
      event: 'device.weather.unavailable',
      severity: 'warn',
      requestId: unconfigured.body.requestId,
      reason: 'location_not_configured'
    }]);

    await adminClient.patch('/api/v1/settings')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'weather-location-settings')
      .send({ changes: { weatherLocationName: 'Tulum, Mexico', weatherLatitude: 20.2115, weatherLongitude: -87.4653 } })
      .expect(200);

    const [first, second] = await Promise.all([
      request(app).get('/api/v1/device/weather').set('Authorization', `Bearer ${roomDeviceOne.deviceToken}`).expect(200),
      request(app).get('/api/v1/device/weather').set('Authorization', `Bearer ${roomDeviceTwo.deviceToken}`).expect(200)
    ]);
    expect(first.body.data).toEqual({ temperatureC: 28.4, relativeHumidity: 68, condition: 'rain' });
    expect(second.body.data).toEqual(first.body.data);
    expect(providerFetch).toHaveBeenCalledTimes(1);

    const [input, init] = providerFetch.mock.calls[0] ?? [];
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    expect(url.searchParams.get('lat')).toBe('20.2115');
    expect(url.searchParams.get('lon')).toBe('-87.4653');
    expect(headers.get('user-agent')).toMatch(/^HotelAlert\/1\.0 \(ROOM screensaver forecast; contact:/);
    expect(headers.get('user-agent')).toContain('http://hotel-alert.test');

    const snapshot = await request(app).get('/api/v1/device/session')
      .set('Authorization', `Bearer ${roomDeviceOne.deviceToken}`).expect(200);
    expect(JSON.stringify(snapshot.body)).not.toContain('20.2115');
    expect(JSON.stringify(snapshot.body)).not.toContain('-87.4653');
    expect(JSON.stringify(snapshot.body)).not.toContain('weatherLatitude');
    expect(JSON.stringify(snapshot.body)).not.toContain('weatherLongitude');
    expect(weatherLogs).toHaveLength(1);
  });

  it('logs provider failures with a safe reason and never includes location or credentials', async () => {
    const room = service.createRoom({ code: 'provider-error', displayName: 'Provider error room' }, systemActor, 'provider-error-room');
    const device = service.bootstrapDevice({ installationId: 'provider-error-room', displayName: 'Provider error panel', assignmentMode: 'ROOM', roomId: room.id }, systemActor, 'provider-error-device');
    await adminClient.patch('/api/v1/settings')
      .set('X-CSRF-Token', csrfToken)
      .set('Idempotency-Key', 'provider-error-settings')
      .send({ changes: { weatherLocationName: 'Tulum, Mexico', weatherLatitude: 20.2115, weatherLongitude: -87.4653 } })
      .expect(200);

    const weatherLogs: WeatherUnavailableLogRecord[] = [];
    const providerFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response('private upstream detail', { status: 503 }));
    const app = createApp(service, config, {
      metNorwayFetch: providerFetch,
      weatherLog: (record) => weatherLogs.push(record)
    });
    const authorization = { Authorization: `Bearer ${device.deviceToken}` };
    const first = await request(app).get('/api/v1/device/weather').set(authorization).expect(200);
    const cached = await request(app).get('/api/v1/device/weather').set(authorization).expect(200);

    expect(first.body.data).toBeNull();
    expect(cached.body.data).toBeNull();
    expect(providerFetch).toHaveBeenCalledOnce();
    expect(weatherLogs).toEqual([
      {
        event: 'device.weather.unavailable',
        severity: 'warn',
        requestId: first.body.requestId,
        reason: 'provider_unavailable'
      },
      {
        event: 'device.weather.unavailable',
        severity: 'warn',
        requestId: cached.body.requestId,
        reason: 'provider_unavailable'
      }
    ]);
    expect(JSON.stringify(weatherLogs)).not.toContain('20.2115');
    expect(JSON.stringify(weatherLogs)).not.toContain('-87.4653');
    expect(JSON.stringify(weatherLogs)).not.toContain('private upstream detail');
    expect(JSON.stringify(weatherLogs)).not.toContain(device.deviceToken);
  });
});

function forecastResponse(): Response {
  return new Response(JSON.stringify({
    properties: {
      timeseries: [{
        time: new Date(Date.now() + 60_000).toISOString(),
        data: {
          instant: { details: { air_temperature: 28.4, relative_humidity: 68 } },
          next_1_hours: { summary: { symbol_code: 'rainshowers_day' } }
        }
      }]
    }
  }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } });
}

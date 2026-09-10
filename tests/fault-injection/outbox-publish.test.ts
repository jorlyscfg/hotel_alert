import { createServer, type Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, type ServerConfig } from '../../apps/server/src/config/env';
import { closeDatabase, openDatabase, runMigrations, type SqliteDatabase } from '../../apps/server/src/db/connection';
import { HotelService } from '../../apps/server/src/domain/hotel-service';
import { attachRealtime, type RealtimeServer } from '../../apps/server/src/realtime/server';

describe('fault injection: realtime outbox publication', () => {
  let database: SqliteDatabase;
  let databaseDirectory: string;
  let config: ServerConfig;
  let service: HotelService;
  let httpServer: Server;
  let realtime: RealtimeServer;

  beforeEach(() => {
    databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-fault-'));
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
    await realtime.close();
    closeDatabase(database);
    fs.rmSync(databaseDirectory, { recursive: true, force: true });
  });

  it('keeps a malformed event pending and records each publication failure', () => {
    database.prepare('INSERT INTO outbox_events(event_id, event_name, aggregate_type, aggregate_id, aggregate_version, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      'evt-fault', 'request.created', 'REQUEST', 'req-fault', 1, '{malformed', new Date().toISOString()
    );

    realtime.publishPendingEvents();
    const firstAttempt = service.getPendingOutbox()[0];
    expect(firstAttempt?.published_at).toBeNull();
    expect(firstAttempt?.attempt_count).toBe(1);
    expect(firstAttempt?.last_error).toBeTruthy();

    realtime.publishPendingEvents();
    const secondAttempt = service.getPendingOutbox()[0];
    expect(secondAttempt?.published_at).toBeNull();
    expect(secondAttempt?.attempt_count).toBe(2);
  });

  it('does not successfully publish a legacy ephemeral presence row', () => {
    const result = database.prepare('INSERT INTO outbox_events(event_id, event_name, aggregate_type, aggregate_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      'evt-legacy-presence',
      'device.presence.changed',
      'DEVICE',
      'device-1',
      JSON.stringify({ deviceId: 'device-1', presence: 'ONLINE', lastSeenAt: null }),
      new Date().toISOString()
    );

    realtime.publishPendingEvents();

    const row = service.getEvent(Number(result.lastInsertRowid));
    expect(row?.published_at).toBeNull();
    expect(row?.attempt_count).toBe(1);
    expect(row?.last_error).toMatch(/unsupported.*realtime event/i);
  });
});

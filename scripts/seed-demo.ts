import fs from 'node:fs';
import path from 'node:path';
import { adminCreateSchema, areaCreateSchema, deviceCreateSchema, roomCreateSchema, serviceCreateSchema } from '@hotel/shared';
import { loadConfig, resolveRepositoryPath } from '../apps/server/src/config/env';
import { closeDatabase, openDatabase, runMigrations } from '../apps/server/src/db/connection';
import { HotelService } from '../apps/server/src/domain/hotel-service';
import { createRawToken } from '../apps/server/src/security/crypto';

const systemActor = { actorType: 'SYSTEM' as const, actorId: null };

function main(): void {
  if (process.env['SEED_DEMO'] !== 'true' && !process.argv.includes('--confirm')) {
    throw new Error('Demo seeding is opt-in. Set SEED_DEMO=true or pass --confirm.');
  }
  const config = loadConfig();
  if (config.nodeEnv === 'production') {
    throw new Error('Demo seeding is disabled in production.');
  }
  const database = openDatabase(config);
  try {
    runMigrations(database);
    const service = new HotelService(database, config);
    const area = service.listAreas().find((item) => item.code.toLowerCase() === 'housekeeping') ?? service.createArea(
      areaCreateSchema.parse({ code: 'housekeeping', displayName: 'Housekeeping' }), systemActor, 'seed-area'
    );
    const room = service.listRooms().find((item) => item.code.toLowerCase() === '101') ?? service.createRoom(
      roomCreateSchema.parse({ code: '101', displayName: 'Room 101' }), systemActor, 'seed-room'
    );
    const catalogService = service.listServices().find((item) => item.code.toLowerCase() === 'towels') ?? service.createService(
      serviceCreateSchema.parse({ code: 'towels', displayName: 'Fresh towels', areaId: area.id }), systemActor, 'seed-service'
    );
    const existingDevice = service.listDevices().find((item) => item.installationId === 'demo-room-101');
    const device = existingDevice === undefined ? service.bootstrapDevice(
      deviceCreateSchema.parse({ installationId: 'demo-room-101', displayName: 'Demo Room 101 tablet', assignmentMode: 'ROOM', roomId: room.id }),
      systemActor,
      'seed-device'
    ) : null;
    const adminResult = ensureDemoAdmin(service);
    const credentialsPath = resolveRepositoryPath(process.env['SEED_CREDENTIALS_PATH'] ?? './data/seed-credentials.json');
    const credentials = {
      adminUsername: adminResult.username,
      ...(adminResult.password === null ? {} : { adminPassword: adminResult.password }),
      ...(device === null ? {} : { deviceInstallationId: 'demo-room-101', deviceToken: device.deviceToken }),
      generatedAt: new Date().toISOString()
    };
    if (adminResult.password !== null || device !== null) {
      fs.mkdirSync(path.dirname(credentialsPath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    }
    process.stdout.write(JSON.stringify({ ok: true, area, room, service: catalogService, device: device?.device ?? existingDevice ?? null, credentialsPath }) + '\n');
  } finally {
    closeDatabase(database);
  }
}

function ensureDemoAdmin(service: HotelService): { username: string; password: string | null } {
  const username = process.env['SEED_ADMIN_USERNAME'] ?? 'demo-admin';
  const existing = service.listAdmins().find((item) => item.username.toLowerCase() === username.toLowerCase());
  if (existing !== undefined) {
    return { username: existing.username, password: null };
  }
  const password = process.env['SEED_ADMIN_PASSWORD'] ?? createRawToken();
  const admin = service.createAdmin(adminCreateSchema.parse({ username, password }), systemActor, 'seed-admin');
  return { username: admin.username, password };
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Demo seeding failed.'}\n`);
  process.exitCode = 1;
}

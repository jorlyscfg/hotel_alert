import { loadConfig } from '../apps/server/src/config/env';
import { closeDatabase, openDatabase, runMigrations } from '../apps/server/src/db/connection';
import { HotelService } from '../apps/server/src/domain/hotel-service';

function main(): void {
  const config = loadConfig();
  const database = openDatabase(config);
  try {
    runMigrations(database);
    const result = new HotelService(database, config).purgeRetention();
    process.stdout.write(JSON.stringify({ ok: true, ...result }) + '\n');
  } finally {
    closeDatabase(database);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Retention purge failed.'}\n`);
  process.exitCode = 1;
}

import { loadConfig } from '../apps/server/src/config/env';
import { closeDatabase, openDatabase, runMigrations } from '../apps/server/src/db/connection';

function main(): void {
  const config = loadConfig();
  const database = openDatabase(config);
  try {
    runMigrations(database);
    process.stdout.write(JSON.stringify({ ok: true, databasePath: config.databasePath }) + '\n');
  } finally {
    closeDatabase(database);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Migration failed.'}\n`);
  process.exitCode = 1;
}

import { loadConfig } from '../apps/server/src/config/env';
import { closeDatabase, openDatabase, runMigrations } from '../apps/server/src/db/connection';
import { createBackup } from '../apps/server/src/db/operations';

async function main(): Promise<void> {
  const config = loadConfig();
  const database = openDatabase(config);
  try {
    runMigrations(database);
    const result = await createBackup(database, config);
    process.stdout.write(JSON.stringify({
      ok: true,
      backupPath: result.backupPath,
      checksumPath: result.checksumPath,
      sha256: result.sha256,
      integrityCheck: result.integrityCheck,
      removedBackups: result.removedBackups
    }) + '\n');
  } finally {
    closeDatabase(database);
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Backup failed.'}\n`);
  process.exitCode = 1;
});

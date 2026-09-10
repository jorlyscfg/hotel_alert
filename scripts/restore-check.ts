import fs from 'node:fs';
import { readMigrationVersion } from '../apps/server/src/db/operations';
import { verifyBackup, verifyBackupChecksum } from '../apps/server/src/db/operations';
import { resolveRepositoryPath } from '../apps/server/src/config/env';

function main(): void {
  const filePath = resolveRestorePath(process.argv.slice(2));
  if (!fs.existsSync(filePath)) {
    throw new Error(`Restore file does not exist: ${filePath}`);
  }
  const integrity = verifyBackup(filePath);
  const sha256 = verifyBackupChecksum(filePath);
  if (sha256 === null) {
    throw new Error(`Restore checksum sidecar is missing: ${filePath}.sha256`);
  }
  process.stdout.write(JSON.stringify({
    ok: true,
    filePath,
    migrationVersion: readMigrationVersion(filePath),
    integrityCheck: integrity.integrityCheck,
    sha256
  }) + '\n');
}

function resolveRestorePath(args: string[]): string {
  const fileIndex = args.indexOf('--file');
  const value = fileIndex >= 0 ? args[fileIndex + 1] : process.env['RESTORE_FILE'];
  if (args.some((arg, index) => arg !== '--file' && (fileIndex < 0 || index !== fileIndex + 1))) {
    throw new Error('Usage: pnpm restore:check -- --file <backup.sqlite> or RESTORE_FILE=<backup.sqlite>.');
  }
  if (value === undefined || value === '') {
    throw new Error('A restore file is required with --file or RESTORE_FILE.');
  }
  return resolveRepositoryPath(value);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Restore check failed.'}\n`);
  process.exitCode = 1;
}

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { adminCreateSchema } from '@hotel/shared';
import { loadConfig } from '../apps/server/src/config/env';
import { closeDatabase, openDatabase, runMigrations } from '../apps/server/src/db/connection';
import { HotelService } from '../apps/server/src/domain/hotel-service';

const systemActor = { actorType: 'SYSTEM' as const, actorId: null };

async function main(): Promise<void> {
  const config = loadConfig();
  const database = openDatabase(config);
  try {
    runMigrations(database);
    const credentials = await readCredentials();
    const inputValue = adminCreateSchema.parse(credentials);
    const admin = new HotelService(database, config).createAdmin(inputValue, systemActor, `admin-create-${Date.now()}`);
    process.stdout.write(JSON.stringify({ ok: true, admin }) + '\n');
  } finally {
    closeDatabase(database);
  }
}

async function readCredentials(): Promise<{ username: string; password: string }> {
  const username = process.env['ADMIN_USERNAME'] ?? await ask('Admin username: ');
  const password = process.env['ADMIN_PASSWORD'] ?? await askSecret('Admin password: ');
  return { username, password };
}

async function ask(prompt: string): Promise<string> {
  const readline = createInterface({ input, output });
  try {
    return await readline.question(prompt);
  } finally {
    readline.close();
  }
}

async function askSecret(prompt: string): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('ADMIN_PASSWORD is required when the command is not attached to a terminal.');
  }
  output.write(prompt);
  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (chunk: Buffer): void => {
      const character = chunk.toString('utf8');
      if (character === '\u0003') {
        cleanup();
        reject(new Error('Password entry cancelled.'));
        return;
      }
      if (character === '\r' || character === '\n') {
        cleanup();
        output.write('\n');
        resolve(value);
        return;
      }
      if (character === '\u007f') {
        value = value.slice(0, -1);
        return;
      }
      value += character;
    };
    const cleanup = (): void => {
      input.setRawMode?.(false);
      input.off('data', onData);
    };
    input.setRawMode(true);
    input.on('data', onData);
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Administrator creation failed.'}\n`);
  process.exitCode = 1;
});

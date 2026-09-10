import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, type ServerConfig } from '../../apps/server/src/config/env';
import { createServerRuntime, type ServerRuntime } from '../../apps/server/src/main';

describe('server runtime', () => {
  let databaseDirectory: string;
  let config: ServerConfig;
  let runtime: ServerRuntime;

  beforeEach(() => {
    databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-runtime-'));
    config = loadConfig({
      nodeEnv: 'test',
      databasePath: path.join(databaseDirectory, 'hotel.sqlite'),
      sessionSecret: 'session-secret',
      tokenPepper: 'token-pepper'
    });
    runtime = createServerRuntime(config);
  });

  afterEach(async () => {
    await runtime.close();
    fs.rmSync(databaseDirectory, { recursive: true, force: true });
  });

  it('composes migrations, HTTP routes, and realtime transport around one service', async () => {
    const response = await request(runtime.app).get('/api/v1/system/health');

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ status: 'ready', database: 'ready', migrations: 'ready' });
    expect(runtime.realtime).toBeDefined();
  });
});

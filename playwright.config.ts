import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const e2eDataDirectory = path.join(os.tmpdir(), `hotel-local-e2e-${process.pid}`);
const e2eDatabasePath = path.join(e2eDataDirectory, 'hotel.sqlite');
const e2ePort = Number(process.env['E2E_PORT'] ?? 3000);
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;
fs.rmSync(e2eDataDirectory, { recursive: true, force: true });

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: e2eBaseUrl
  },
  webServer: {
    command: 'corepack pnpm build && corepack pnpm db:migrate && corepack pnpm db:seed && corepack pnpm start',
    url: `${e2eBaseUrl}/api/v1/system/health`,
    reuseExistingServer: true,
    env: {
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(e2ePort),
      APP_ORIGIN: e2eBaseUrl,
      DATABASE_PATH: e2eDatabasePath,
      SESSION_SECRET: 'e2e-session-secret',
      TOKEN_PEPPER: 'e2e-token-pepper',
      SEED_DEMO: 'true',
      SEED_ADMIN_USERNAME: 'admin',
      SEED_ADMIN_PASSWORD: 'correct-horse-battery-staple',
      LOGIN_RATE_LIMIT_MAX_REQUESTS: '100',
      SEED_CREDENTIALS_PATH: path.join(e2eDataDirectory, 'seed-credentials.json')
    }
  }
});

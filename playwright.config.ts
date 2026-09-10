import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const e2eDataDirectory = path.join(os.tmpdir(), `hotel-local-e2e-${process.pid}`);
const e2eDatabasePath = path.join(e2eDataDirectory, 'hotel.sqlite');
fs.rmSync(e2eDataDirectory, { recursive: true, force: true });

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://127.0.0.1:3000'
  },
  webServer: {
    command: 'corepack pnpm build && corepack pnpm db:migrate && corepack pnpm db:seed && corepack pnpm start',
    url: 'http://127.0.0.1:3000/api/v1/system/health',
    reuseExistingServer: true,
    env: {
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: '3000',
      APP_ORIGIN: 'http://127.0.0.1:3000',
      DATABASE_PATH: e2eDatabasePath,
      SESSION_SECRET: 'e2e-session-secret',
      TOKEN_PEPPER: 'e2e-token-pepper',
      SEED_DEMO: 'true',
      SEED_ADMIN_USERNAME: 'admin',
      SEED_ADMIN_PASSWORD: 'correct-horse-battery-staple',
      SEED_CREDENTIALS_PATH: path.join(e2eDataDirectory, 'seed-credentials.json')
    }
  }
});

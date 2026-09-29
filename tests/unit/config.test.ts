import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, REPOSITORY_ROOT } from '../../apps/server/src/config/env';

const originalWorkingDirectory = process.cwd();

  afterEach(() => {
  delete process.env['HOST'];
  delete process.env['SOCKET_EVENT_REPLAY_MINUTES'];
  delete process.env['SOCKET_EVENT_REPLAY_MAX_EVENTS'];
  delete process.env['DATABASE_PATH'];
  delete process.env['BACKUP_DIRECTORY'];
   delete process.env['FREEKIOSK_API_PORT'];
   delete process.env['FREEKIOSK_API_KEY'];
   delete process.env['FREEKIOSK_API_TIMEOUT_MS'];
  delete process.env['LOGIN_RATE_LIMIT_MAX_REQUESTS'];
  process.chdir(originalWorkingDirectory);
});

describe('server configuration', () => {
  it('binds to every interface by default for LAN-first deployments', () => {
    delete process.env['HOST'];
    const config = loadConfig({
      nodeEnv: 'test',
      sessionSecret: 'test-session-secret',
      tokenPepper: 'test-token-pepper'
    });

    expect(config.host).toBe('0.0.0.0');
  });

  it('enforces the minimum durable replay retention floors', () => {
    process.env['SOCKET_EVENT_REPLAY_MINUTES'] = '59';
    expect(() => loadConfig({ nodeEnv: 'test' })).toThrow(/replay retention/);

    delete process.env['SOCKET_EVENT_REPLAY_MINUTES'];
    process.env['SOCKET_EVENT_REPLAY_MAX_EVENTS'] = '99999';
    expect(() => loadConfig({ nodeEnv: 'test' })).toThrow(/replay retention/);
  });

  it('resolves repository-relative paths independently of the caller working directory', () => {
    process.env['DATABASE_PATH'] = './data/from-root.sqlite';
    process.env['BACKUP_DIRECTORY'] = './data/from-root-backups';
    process.chdir(path.join(REPOSITORY_ROOT, 'apps', 'server'));

    const config = loadConfig({
      nodeEnv: 'test',
      sessionSecret: 'test-session-secret',
      tokenPepper: 'test-token-pepper'
    });

    expect(config.databasePath).toBe(path.join(REPOSITORY_ROOT, 'data', 'from-root.sqlite'));
    expect(config.backupDirectory).toBe(path.join(REPOSITORY_ROOT, 'data', 'from-root-backups'));
  });

  it('loads bounded FreeKiosk REST settings without exposing a default credential', () => {
    const config = loadConfig({
      nodeEnv: 'test',
      sessionSecret: 'test-session-secret',
      tokenPepper: 'test-token-pepper'
    });

    expect(config.freeKioskApiPort).toBe(8080);
    expect(config.freeKioskApiTimeoutMs).toBe(3000);
    expect(config.freeKioskApiKey).toBeUndefined();
  });

  it('keeps the admin login rate-limit default while allowing an explicit test override', () => {
    expect(loadConfig({ nodeEnv: 'test' }).loginRateLimitMaxRequests).toBe(5);

    process.env['LOGIN_RATE_LIMIT_MAX_REQUESTS'] = '100';
    expect(loadConfig({ nodeEnv: 'test' }).loginRateLimitMaxRequests).toBe(100);
  });

  it('rejects unsafe FreeKiosk port and timeout settings', () => {
    expect(() => loadConfig({ nodeEnv: 'test', freeKioskApiPort: 65536 })).toThrow(/FREEKIOSK_API_PORT/);
    expect(() => loadConfig({ nodeEnv: 'test', freeKioskApiTimeoutMs: 99 })).toThrow(/FREEKIOSK_API_TIMEOUT_MS/);
  });
});

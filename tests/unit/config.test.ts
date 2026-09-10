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
});

import { describe, expect, it, vi } from 'vitest';
import type {
  CursorFileSystem,
  LanRuntimeFactory,
  ProtectedDeviceCredential,
  RedactedDiagnostic,
  ServiceHost,
  WindowsNotificationReceiverConfig
} from '../../apps/windows-notification-receiver/src/index';
import {
  createFileCursorStore,
  createWindowsNotificationReceiver,
  validateWindowsNotificationReceiverConfig
} from '../../apps/windows-notification-receiver/src/index';

describe('Windows notification receiver adapter', () => {
  it('rejects configuration that is not explicitly LAN/VPN-only', () => {
    expect(() => validateWindowsNotificationReceiverConfig({
      ...baseConfig(),
      transport: 'public-internet'
    })).toThrow('LAN/VPN');
  });

  it('rejects an unbounded or invalid retry policy', () => {
    expect(() => validateWindowsNotificationReceiverConfig({
      ...baseConfig(),
      retry: { maxAttempts: 0, initialDelayMs: -1, maxDelayMs: 1 }
    })).toThrow('retry');
  });

  it('rejects whitespace identifiers, non-canonical origins, unsafe cursor paths, and excessive retry delays', () => {
    expect(() => validateWindowsNotificationReceiverConfig({
      ...baseConfig(),
      clientInstanceId: '   '
    })).toThrow('configuration');
    expect(() => validateWindowsNotificationReceiverConfig({
      ...baseConfig(),
      serverOrigin: 'http://hotel.local:3000/'
    })).toThrow('origin');
    expect(() => validateWindowsNotificationReceiverConfig({
      ...baseConfig(),
      cursorFilePath: '../cursor/state.json'
    })).toThrow('configuration');
    expect(() => validateWindowsNotificationReceiverConfig({
      ...baseConfig(),
      retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: Number.MAX_SAFE_INTEGER }
    })).toThrow('retry');
  });

  it('maps service lifecycle events and wires the injected notification sink', async () => {
    const host = new FakeServiceHost();
    const notificationPort = { deliver: vi.fn() };
    const runtime = createRuntime();
    let runtimeOptions: Parameters<LanRuntimeFactory>[0] | undefined;
    const runtimeFactory: LanRuntimeFactory = vi.fn((options) => {
      runtimeOptions = options;
      return runtime;
    });

    createWindowsNotificationReceiver({
      config: baseConfig(),
      serviceHost: host,
      credentialStore: { load: async () => credential() },
      notificationPort,
      runtimeFactory,
      cursorFileSystem: emptyCursorFileSystem()
    });

    await host.start();
    expect(runtime.start).toHaveBeenCalledOnce();
    expect(runtimeOptions?.sink).toBe(notificationPort);
    expect(runtimeOptions?.deviceId).toBe('device-area');
    expect(runtimeOptions?.deviceToken).toBe('device-secret');

    await host.stop();
    expect(runtime.stop).toHaveBeenCalledOnce();
  });

  it('does not start a second runtime when the service is already running', async () => {
    const host = new FakeServiceHost();
    const runtime = createRuntime();
    const runtimeFactory: LanRuntimeFactory = vi.fn(() => runtime);

    createWindowsNotificationReceiver({
      config: baseConfig(),
      serviceHost: host,
      credentialStore: { load: async () => credential() },
      notificationPort: { deliver: vi.fn() },
      runtimeFactory,
      cursorFileSystem: emptyCursorFileSystem()
    });

    await host.start();
    await host.start();

    expect(runtimeFactory).toHaveBeenCalledOnce();
    expect(runtime.start).toHaveBeenCalledOnce();
    await host.stop();
  });

  it('does not create or start a runtime after stopping during credential loading', async () => {
    const host = new FakeServiceHost();
    let markCredentialLoadStarted!: () => void;
    let resolveCredential!: (value: ProtectedDeviceCredential) => void;
    const credentialLoadStarted = new Promise<void>((resolve) => {
      markCredentialLoadStarted = resolve;
    });
    const credentialLoading = new Promise<ProtectedDeviceCredential>((resolve) => {
      resolveCredential = resolve;
    });
    const runtimeFactory: LanRuntimeFactory = vi.fn(() => createRuntime());

    createWindowsNotificationReceiver({
      config: baseConfig(),
      serviceHost: host,
      credentialStore: {
        load: async () => {
          markCredentialLoadStarted();
          return credentialLoading;
        }
      },
      notificationPort: { deliver: vi.fn() },
      runtimeFactory,
      cursorFileSystem: emptyCursorFileSystem()
    });

    const startPromise = host.start();
    await credentialLoadStarted;
    await host.stop();
    resolveCredential(credential());

    await expect(startPromise).rejects.toMatchObject({ errorCode: 'SERVICE_STOPPED' });
    expect(runtimeFactory).not.toHaveBeenCalled();
  });

  it('treats authentication and token-rotation failures as terminal', async () => {
    const host = new FakeServiceHost();
    const diagnostics: RedactedDiagnostic[] = [];
    const runtimeFactory: LanRuntimeFactory = vi.fn((options) => ({
      start: vi.fn(async () => {
        options.onAuthFailure?.({ errorCode: 'TOKEN_ROTATION_EXPIRED', token: 'device-secret' });
        throw new Error('device-secret must never escape');
      }),
      stop: vi.fn(),
      getSnapshot: vi.fn()
    }));

    createWindowsNotificationReceiver({
      config: baseConfig(),
      serviceHost: host,
      credentialStore: { load: async () => credential() },
      notificationPort: { deliver: vi.fn() },
      runtimeFactory,
      cursorFileSystem: emptyCursorFileSystem(),
      diagnostics: (diagnostic) => diagnostics.push(diagnostic),
      sleep: vi.fn(async () => undefined)
    });

    await expect(host.start()).rejects.toMatchObject({ errorCode: 'TOKEN_ROTATION_EXPIRED' });
    expect(runtimeFactory).toHaveBeenCalledOnce();
    expect(diagnostics.map(({ code }) => code)).toContain('auth-failed');
    expect(JSON.stringify(diagnostics)).not.toContain('device-secret');
  });

  it('retries transient startup failures with bounded backoff and no hot loop', async () => {
    const host = new FakeServiceHost();
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    const diagnostics: RedactedDiagnostic[] = [];
    let attempts = 0;
    const runtimeFactory: LanRuntimeFactory = vi.fn(() => ({
      start: vi.fn(async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('temporary LAN failure');
      }),
      stop: vi.fn(),
      getSnapshot: vi.fn()
    }));

    createWindowsNotificationReceiver({
      config: baseConfig({ retry: { maxAttempts: 3, initialDelayMs: 5, maxDelayMs: 8 } }),
      serviceHost: host,
      credentialStore: { load: async () => credential() },
      notificationPort: { deliver: vi.fn() },
      runtimeFactory,
      cursorFileSystem: emptyCursorFileSystem(),
      sleep,
      diagnostics: (diagnostic) => diagnostics.push(diagnostic)
    });

    await host.start();
    expect(runtimeFactory).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([5, 8]);
    expect(diagnostics.filter(({ code }) => code === 'retrying')).toHaveLength(2);
  });

  it('stops after the configured transient-attempt budget', async () => {
    const host = new FakeServiceHost();
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    const runtimeFactory: LanRuntimeFactory = vi.fn(() => ({
      start: vi.fn(async () => {
        throw new Error('temporary LAN failure');
      }),
      stop: vi.fn(),
      getSnapshot: vi.fn()
    }));
    const diagnostics: RedactedDiagnostic[] = [];

    createWindowsNotificationReceiver({
      config: baseConfig({ retry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1 } }),
      serviceHost: host,
      credentialStore: { load: async () => credential() },
      notificationPort: { deliver: vi.fn() },
      runtimeFactory,
      cursorFileSystem: emptyCursorFileSystem(),
      sleep,
      diagnostics: (diagnostic) => diagnostics.push(diagnostic)
    });

    await expect(host.start()).rejects.toMatchObject({ errorCode: 'RUNTIME_UNAVAILABLE' });
    expect(runtimeFactory).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
    expect(diagnostics.map(({ code }) => code)).toContain('retries-exhausted');
  });

  it('does not synthesize a token when protected credential loading is incomplete', async () => {
    const host = new FakeServiceHost();
    const runtimeFactory: LanRuntimeFactory = vi.fn(() => createRuntime());

    createWindowsNotificationReceiver({
      config: baseConfig(),
      serviceHost: host,
      credentialStore: { load: async () => ({ deviceId: 'device-area', deviceToken: '' }) },
      notificationPort: { deliver: vi.fn() },
      runtimeFactory,
      cursorFileSystem: emptyCursorFileSystem()
    });

    await expect(host.start()).rejects.toMatchObject({ errorCode: 'CREDENTIAL_UNAVAILABLE' });
    expect(runtimeFactory).not.toHaveBeenCalled();
  });

  it('serializes atomic cursor writes and rejects regressions', async () => {
    const fileSystem = trackingCursorFileSystem();
    const cursor = await createFileCursorStore('cursor/state.json', fileSystem);

    const firstWrite = cursor.advanceTo(12);
    await expect(cursor.advanceTo(11)).rejects.toMatchObject({ errorCode: 'CURSOR_REGRESSION' });
    await firstWrite;
    await cursor.advanceTo(14);

    expect(cursor.lastSeenEventSequence).toBe(14);
    expect(fileSystem.maxConcurrentWrites).toBe(1);
    expect(fileSystem.writePaths).toEqual(['cursor/state.json.tmp', 'cursor/state.json.tmp']);
    expect(fileSystem.replacePaths).toEqual([
      ['cursor/state.json.tmp', 'cursor/state.json'],
      ['cursor/state.json.tmp', 'cursor/state.json']
    ]);
    expect(JSON.parse(fileSystem.contents)).toEqual({ lastSeenEventSequence: 14 });
  });
});

function baseConfig(overrides: Partial<WindowsNotificationReceiverConfig> = {}): WindowsNotificationReceiverConfig {
  return {
    transport: 'lan-vpn',
    serverOrigin: 'http://hotel.local:3000',
    clientInstanceId: 'windows-client-instance',
    clientVersion: '1.0.0',
    cursorFilePath: 'cursor/state.json',
    retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 10 },
    ...overrides
  };
}

function credential(): ProtectedDeviceCredential {
  return { deviceId: 'device-area', deviceToken: 'device-secret' };
}

function createRuntime(): ReturnType<LanRuntimeFactory> {
  return { start: vi.fn(async () => undefined), stop: vi.fn(), getSnapshot: vi.fn() };
}

function emptyCursorFileSystem(): CursorFileSystem {
  return {
    readFile: vi.fn(async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    }),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    replaceFile: vi.fn(async () => undefined)
  };
}

function trackingCursorFileSystem(): CursorFileSystem & {
  contents: string;
  maxConcurrentWrites: number;
  replacePaths: Array<[string, string]>;
  writePaths: string[];
} {
  let contents = JSON.stringify({ lastSeenEventSequence: 0 });
  let pendingWriteContents = '';
  let activeWrites = 0;
  let maxConcurrentWrites = 0;
  const writePaths: string[] = [];
  const replacePaths: Array<[string, string]> = [];
  return {
    get contents() {
      return contents;
    },
    get maxConcurrentWrites() {
      return maxConcurrentWrites;
    },
    replacePaths,
    writePaths,
    readFile: vi.fn(async () => contents),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async (filePath, nextContents) => {
      activeWrites += 1;
      maxConcurrentWrites = Math.max(maxConcurrentWrites, activeWrites);
      writePaths.push(filePath);
      pendingWriteContents = nextContents;
      await Promise.resolve();
      activeWrites -= 1;
    }),
    replaceFile: vi.fn(async (temporaryPath, targetPath) => {
      replacePaths.push([temporaryPath, targetPath]);
      contents = pendingWriteContents;
    })
  };
}

class FakeServiceHost implements ServiceHost {
  private lifecycle: { start(): Promise<void>; stop(): Promise<void> } | undefined;

  public register(lifecycle: { start(): Promise<void>; stop(): Promise<void> }): void {
    this.lifecycle = lifecycle;
  }

  public start(): Promise<void> {
    if (this.lifecycle === undefined) throw new Error('Lifecycle was not registered.');
    return this.lifecycle.start();
  }

  public stop(): Promise<void> {
    if (this.lifecycle === undefined) throw new Error('Lifecycle was not registered.');
    return this.lifecycle.stop();
  }
}

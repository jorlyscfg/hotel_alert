import * as nodeFs from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import type { LanNotificationReceiver, LanNotificationReceiverOptions } from '@hotel/notification-receiver-lan';
import type { DurableCursorStore, NotificationSink, RequestNotification } from '@hotel/notification-receiver';

const MAX_RETRY_DELAY_MS = 60_000;
const AUTH_FAILURE_CODES = new Set([
  'AUTH_REQUIRED',
  'AUTH_INVALID',
  'AUTH_AMBIGUOUS_CREDENTIALS',
  'DEVICE_INACTIVE',
  'DEVICE_TOKEN_REVOKED',
  'TOKEN_ROTATION_EXPIRED',
  'FORBIDDEN_ASSIGNMENT'
]);

export interface WindowsNotificationReceiverConfig {
  transport: 'lan-vpn';
  serverOrigin: string;
  clientInstanceId: string;
  clientVersion: string;
  cursorFilePath: string;
  retry: RetryPolicy;
}

export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

export interface ProtectedDeviceCredential {
  deviceId: string;
  deviceToken: string;
}

export interface ProtectedDeviceCredentialStore {
  load(): Promise<ProtectedDeviceCredential>;
}

export interface WindowsNotificationPort extends NotificationSink {
  deliver(notification: RequestNotification): void | Promise<void>;
}

export interface ServiceLifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ServiceHost {
  register(lifecycle: ServiceLifecycle): void;
}

/**
 * The replace operation is a platform filesystem boundary. Implementations
 * must replace the target atomically within the same filesystem volume.
 */
export interface CursorFileSystem {
  readFile(filePath: string): Promise<string>;
  mkdir(directoryPath: string): Promise<void>;
  writeFile(filePath: string, contents: string): Promise<void>;
  replaceFile(temporaryPath: string, targetPath: string): Promise<void>;
}

export type LanRuntimeFactory = (options: LanNotificationReceiverOptions) => LanNotificationReceiver;

export type DiagnosticCode =
  | 'started'
  | 'stopped'
  | 'auth-failed'
  | 'runtime-error'
  | 'retrying'
  | 'retries-exhausted';

export interface RedactedDiagnostic {
  readonly code: DiagnosticCode;
  readonly attempt?: number;
  readonly delayMs?: number;
}

export interface WindowsNotificationReceiverOptions {
  config: WindowsNotificationReceiverConfig;
  serviceHost: ServiceHost;
  credentialStore: ProtectedDeviceCredentialStore;
  notificationPort: WindowsNotificationPort;
  runtimeFactory?: LanRuntimeFactory;
  cursorFileSystem?: CursorFileSystem;
  sleep?: (milliseconds: number) => Promise<void>;
  diagnostics?: (diagnostic: RedactedDiagnostic) => void;
}

export class WindowsNotificationReceiverError extends Error {
  public readonly errorCode: string;

  public constructor(errorCode: string, message: string) {
    super(message);
    this.name = 'WindowsNotificationReceiverError';
    this.errorCode = errorCode;
  }
}

export type WindowsNotificationReceiver = ServiceLifecycle;

export function validateWindowsNotificationReceiverConfig(value: unknown): WindowsNotificationReceiverConfig {
  if (!isRecord(value) || value['transport'] !== 'lan-vpn') {
    throw new WindowsNotificationReceiverError('CONFIG_INVALID', 'The Windows receiver transport must be LAN/VPN-only.');
  }

  const serverOrigin = value['serverOrigin'];
  const clientInstanceId = value['clientInstanceId'];
  const clientVersion = value['clientVersion'];
  const cursorFilePath = value['cursorFilePath'];
  const retry = value['retry'];
  if (!isRetryPolicy(retry)) {
    throw new WindowsNotificationReceiverError('CONFIG_INVALID', 'The Windows receiver retry policy is invalid.');
  }
  if (!isNonEmptyString(serverOrigin)
    || !isNonEmptyString(clientInstanceId)
    || !isNonEmptyString(clientVersion)
    || !isSafeCursorFilePath(cursorFilePath)) {
    throw new WindowsNotificationReceiverError('CONFIG_INVALID', 'The Windows receiver configuration is invalid.');
  }

  try {
    const origin = new URL(serverOrigin);
    if (origin.protocol !== 'http:' && origin.protocol !== 'https:') throw new Error('protocol');
    if (origin.username !== '' || origin.password !== '' || origin.search !== '' || origin.hash !== '') throw new Error('credentials');
    if (origin.pathname !== '/') throw new Error('path');
    if (origin.origin !== serverOrigin) throw new Error('canonical');
  } catch {
    throw new WindowsNotificationReceiverError('CONFIG_INVALID', 'The Windows receiver server origin is invalid.');
  }

  return {
    transport: 'lan-vpn',
    serverOrigin,
    clientInstanceId,
    clientVersion,
    cursorFilePath,
    retry
  };
}

export function createWindowsNotificationReceiver(
  options: WindowsNotificationReceiverOptions
): WindowsNotificationReceiver {
  const config = validateWindowsNotificationReceiverConfig(options.config);
  const cursorFileSystem = options.cursorFileSystem ?? defaultCursorFileSystem;
  const sleep = options.sleep ?? defaultSleep;
  let defaultRuntimeFactory: Promise<LanRuntimeFactory> | undefined;

  let activeRuntime: LanNotificationReceiver | undefined;
  let cursor: DurableCursorStore | undefined;
  let runningStart: Promise<void> | undefined;
  let stopRequested = false;
  let terminalFailure: WindowsNotificationReceiverError | undefined;

  const start = (): Promise<void> => {
    if (terminalFailure !== undefined) return Promise.reject(terminalFailure);
    if (runningStart !== undefined) return runningStart;
    if (activeRuntime !== undefined) return Promise.resolve();

    stopRequested = false;
    runningStart = startWithRetries()
      .then(() => {
        if (stopRequested) throw serviceStoppedError();
        emitDiagnostic({ code: 'started' });
      })
      .finally(() => {
        runningStart = undefined;
      });
    return runningStart;
  };

  const stop = async (): Promise<void> => {
    stopRequested = true;
    const runtime = activeRuntime;
    activeRuntime = undefined;
    if (runtime !== undefined) {
      try {
        await runtime.stop();
      } catch {
        // Stopping is best effort; no runtime error is safe to expose here.
      }
    }
    emitDiagnostic({ code: 'stopped' });
  };

  const lifecycle: WindowsNotificationReceiver = { start, stop };
  options.serviceHost.register(lifecycle);
  return lifecycle;

  async function startWithRetries(): Promise<void> {
    let attempt = 0;
    while (attempt < config.retry.maxAttempts) {
      if (stopRequested) throw serviceStoppedError();
      attempt += 1;
      let runtime: LanNotificationReceiver | undefined;
      let authFailureCode: string | undefined;

      try {
        cursor ??= await createFileCursorStore(config.cursorFilePath, cursorFileSystem);
        throwIfStopped();
        const credential = await loadCredential();
        throwIfStopped();
        const runtimeFactory = options.runtimeFactory ?? await loadDefaultRuntimeFactory();
        throwIfStopped();
        const runtimeOptions: LanNotificationReceiverOptions = {
          serverOrigin: config.serverOrigin,
          deviceId: credential.deviceId,
          deviceToken: credential.deviceToken,
          clientInstanceId: config.clientInstanceId,
          clientVersion: config.clientVersion,
          cursor,
          sink: options.notificationPort,
          onAuthFailure: (error) => {
            authFailureCode = authFailureCodeOf(error) ?? 'AUTH_FAILED';
            terminalFailure = authenticationError(authFailureCode);
            emitDiagnostic({ code: 'auth-failed' });
            void stopRuntime(runtime);
          },
          onError: () => {
            emitDiagnostic({ code: 'runtime-error' });
          }
        };
        runtime = runtimeFactory(runtimeOptions);
        throwIfStopped();
        activeRuntime = runtime;
        await runtime.start();
        throwIfStopped();
        if (authFailureCode !== undefined || terminalFailure !== undefined) {
          throw terminalFailure ?? authenticationError(authFailureCode ?? 'AUTH_FAILED');
        }
        return;
      } catch (error) {
        await stopRuntime(runtime);
        if (stopRequested || isServiceStopped(error)) throw serviceStoppedError();
        if (terminalFailure !== undefined) throw terminalFailure;
        if (authFailureCode !== undefined || isAuthenticationFailure(error)) {
          const code = authFailureCode ?? authFailureCodeOf(error) ?? 'AUTH_FAILED';
          terminalFailure = authenticationError(code);
          emitDiagnostic({ code: 'auth-failed' });
          throw terminalFailure;
        }
        if (isTerminalAdapterError(error)) throw error;
        if (attempt >= config.retry.maxAttempts) {
          emitDiagnostic({ code: 'retries-exhausted', attempt });
          throw new WindowsNotificationReceiverError('RUNTIME_UNAVAILABLE', 'The Windows receiver runtime is unavailable.');
        }
        const delayMs = retryDelay(config.retry, attempt);
        emitDiagnostic({ code: 'retrying', attempt, delayMs });
        await sleep(delayMs);
      }
    }
    throw new WindowsNotificationReceiverError('RUNTIME_UNAVAILABLE', 'The Windows receiver runtime is unavailable.');
  }

  async function loadCredential(): Promise<ProtectedDeviceCredential> {
    let credential: unknown;
    try {
      credential = await options.credentialStore.load();
    } catch {
      throw new WindowsNotificationReceiverError('CREDENTIAL_UNAVAILABLE', 'The protected device credential is unavailable.');
    }
    if (!isRecord(credential)
      || !isNonEmptyString(credential['deviceId'])
      || !isNonEmptyString(credential['deviceToken'])) {
      throw new WindowsNotificationReceiverError('CREDENTIAL_UNAVAILABLE', 'The protected device credential is unavailable.');
    }
    return { deviceId: credential['deviceId'], deviceToken: credential['deviceToken'] };
  }

  async function loadDefaultRuntimeFactory(): Promise<LanRuntimeFactory> {
    defaultRuntimeFactory ??= importDefaultRuntimeFactory();
    return defaultRuntimeFactory;
  }

  async function stopRuntime(runtime: LanNotificationReceiver | undefined): Promise<void> {
    if (runtime === undefined) return;
    if (activeRuntime === runtime) activeRuntime = undefined;
    try {
      await runtime.stop();
    } catch {
      // The adapter never emits provider error details.
    }
  }

  function throwIfStopped(): void {
    if (stopRequested) throw serviceStoppedError();
  }

  function emitDiagnostic(diagnostic: RedactedDiagnostic): void {
    try {
      options.diagnostics?.(diagnostic);
    } catch {
      // Diagnostics cannot change lifecycle or expose provider failures.
    }
  }
}

export async function createFileCursorStore(
  filePath: string,
  fileSystem: CursorFileSystem = defaultCursorFileSystem
): Promise<DurableCursorStore> {
  const initialSequence = await readCursor(filePath, fileSystem);
  let lastSeenEventSequence = initialSequence;
  let highestScheduledSequence = initialSequence;
  let writeQueue = Promise.resolve();
  let pendingSequence: number | undefined;
  let pendingOperation: Promise<void> | undefined;

  return {
    get lastSeenEventSequence() {
      return lastSeenEventSequence;
    },
    advanceTo(eventSequence) {
      if (!isNonNegativeInteger(eventSequence)) {
        return Promise.reject(new WindowsNotificationReceiverError('CURSOR_INVALID', 'The durable cursor sequence is invalid.'));
      }
      if (eventSequence < lastSeenEventSequence || eventSequence < highestScheduledSequence) {
        return Promise.reject(new WindowsNotificationReceiverError('CURSOR_REGRESSION', 'The durable cursor cannot move backwards.'));
      }
      if (eventSequence === lastSeenEventSequence) return Promise.resolve();
      if (eventSequence === pendingSequence && pendingOperation !== undefined) return pendingOperation;

      highestScheduledSequence = eventSequence;
      const operation = writeQueue.then(async () => {
        if (eventSequence <= lastSeenEventSequence) return;
        await writeCursor(filePath, eventSequence, fileSystem);
        lastSeenEventSequence = eventSequence;
      });
      pendingSequence = eventSequence;
      pendingOperation = operation;
      writeQueue = operation.then(
        () => clearPending(eventSequence),
        () => clearPending(eventSequence)
      );
      return operation;
    }
  };

  function clearPending(eventSequence: number): void {
    if (pendingSequence !== eventSequence) return;
    pendingSequence = undefined;
    pendingOperation = undefined;
    highestScheduledSequence = lastSeenEventSequence;
  }
}

const defaultCursorFileSystem: CursorFileSystem = {
  async readFile(filePath) {
    return nodeFs.readFile(filePath, { encoding: 'utf8' });
  },
  async mkdir(directoryPath) {
    await nodeFs.mkdir(directoryPath, { recursive: true });
  },
  async writeFile(filePath, contents) {
    await nodeFs.writeFile(filePath, contents, { encoding: 'utf8', mode: 0o600 });
  },
  async replaceFile(temporaryPath, targetPath) {
    await nodeFs.rename(temporaryPath, targetPath);
  }
};

async function readCursor(filePath: string, fileSystem: CursorFileSystem): Promise<number> {
  let contents: string;
  try {
    contents = await fileSystem.readFile(filePath);
  } catch (error) {
    if (isMissingFile(error)) return 0;
    throw new WindowsNotificationReceiverError('CURSOR_UNAVAILABLE', 'The durable cursor is unavailable.');
  }
  try {
    const parsed: unknown = JSON.parse(contents);
    if (!isRecord(parsed) || !isNonNegativeInteger(parsed['lastSeenEventSequence'])) throw new Error('invalid');
    return parsed['lastSeenEventSequence'];
  } catch {
    throw new WindowsNotificationReceiverError('CURSOR_INVALID', 'The durable cursor is invalid.');
  }
}

async function writeCursor(filePath: string, eventSequence: number, fileSystem: CursorFileSystem): Promise<void> {
  const temporaryPath = `${filePath}.tmp`;
  try {
    await fileSystem.mkdir(dirname(filePath));
    await fileSystem.writeFile(temporaryPath, `${JSON.stringify({ lastSeenEventSequence: eventSequence })}\n`);
    await fileSystem.replaceFile(temporaryPath, filePath);
  } catch {
    throw new WindowsNotificationReceiverError('CURSOR_UNAVAILABLE', 'The durable cursor could not be persisted.');
  }
}

function retryDelay(policy: RetryPolicy, attempt: number): number {
  return Math.min(policy.maxDelayMs, policy.initialDelayMs * (2 ** (attempt - 1)));
}

function authenticationError(errorCode: string): WindowsNotificationReceiverError {
  return new WindowsNotificationReceiverError(errorCode, 'The device authentication failed and requires operator intervention.');
}

function serviceStoppedError(): WindowsNotificationReceiverError {
  return new WindowsNotificationReceiverError('SERVICE_STOPPED', 'The Windows receiver service was stopped.');
}

function isTerminalAdapterError(error: unknown): error is WindowsNotificationReceiverError {
  return error instanceof WindowsNotificationReceiverError
    && (error.errorCode === 'CREDENTIAL_UNAVAILABLE' || error.errorCode === 'CURSOR_INVALID');
}

function isAuthenticationFailure(error: unknown): boolean {
  const code = authFailureCodeOf(error);
  return code !== undefined;
}

function authFailureCodeOf(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  for (const key of ['errorCode', 'code', 'name']) {
    const value = error[key];
    if (typeof value === 'string' && AUTH_FAILURE_CODES.has(value)) return value;
  }
  return undefined;
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error['code'] === 'ENOENT';
}

function isRetryPolicy(value: unknown): value is RetryPolicy {
  return isRecord(value)
    && isPositiveInteger(value['maxAttempts'])
    && value['maxAttempts'] <= 10
    && isPositiveInteger(value['initialDelayMs'])
    && isNonNegativeInteger(value['maxDelayMs'])
    && value['maxDelayMs'] <= MAX_RETRY_DELAY_MS
    && value['maxDelayMs'] >= value['initialDelayMs'];
}

function isSafeCursorFilePath(value: unknown): value is string {
  if (!isNonEmptyString(value) || value.includes('\0')) return false;
  if (value.endsWith('/') || value.endsWith('\\') || /^\\\\/.test(value)) return false;
  if (isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
    return !value.split(/[\\/]+/).some((segment) => segment === '.' || segment === '..');
  }
  return !value.split(/[\\/]+/).some((segment) => segment === '.' || segment === '..');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function isServiceStopped(error: unknown): boolean {
  return error instanceof WindowsNotificationReceiverError && error.errorCode === 'SERVICE_STOPPED';
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function importDefaultRuntimeFactory(): Promise<LanRuntimeFactory> {
  const moduleName = '@hotel/notification-receiver-lan';
  const runtimeModule = await import(moduleName) as unknown as {
    createLanNotificationReceiver: LanRuntimeFactory;
  };
  return runtimeModule.createLanNotificationReceiver;
}

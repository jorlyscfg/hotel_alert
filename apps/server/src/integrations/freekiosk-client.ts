import { isIP } from 'node:net';
import { z } from 'zod';
import type { ServerConfig } from '../config/env';
import { AppError } from '../errors';

const FREEKIOSK_BEEP_PATH = '/api/audio/beep';
const FREEKIOSK_SCREENSAVER_ON_PATH = '/api/screensaver/on';
const FREEKIOSK_SCREENSAVER_OFF_PATH = '/api/screensaver/off';
const freeKioskBeepResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    executed: z.boolean().optional(),
    command: z.string().optional()
  }).optional()
}).passthrough();

export interface FreeKioskClientOptions {
  apiPort: number;
  apiKey: string | undefined;
  timeoutMs: number;
  requireApiKey: boolean;
  allowLoopback: boolean;
  fetchFn?: typeof fetch;
}

export interface FreeKioskBeepResult {
  command: 'audioBeep';
  executed: true;
}

export interface FreeKioskScreensaverResult {
  command: 'screenSaverOff' | 'screenSaverOn';
  executed: true;
}

export class FreeKioskClient {
  private readonly fetchFn: typeof fetch;

  public constructor(private readonly options: FreeKioskClientOptions) {
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
  }

  public async beep(lastIp: string): Promise<FreeKioskBeepResult> {
    return this.executeCommand(lastIp, FREEKIOSK_BEEP_PATH, 'audioBeep', 'audio beep');
  }

  public async setScreensaver(lastIp: string, enabled: boolean): Promise<FreeKioskScreensaverResult> {
    const command = enabled ? 'screenSaverOn' : 'screenSaverOff';
    const path = enabled ? FREEKIOSK_SCREENSAVER_ON_PATH : FREEKIOSK_SCREENSAVER_OFF_PATH;
    return this.executeCommand(lastIp, path, command, enabled ? 'screensaver-on' : 'screensaver-off');
  }

  private async executeCommand<T extends 'audioBeep' | 'screenSaverOff' | 'screenSaverOn'>(lastIp: string, commandPath: string, expectedCommand: T, commandLabel: string): Promise<{ command: T; executed: true }> {
    if (this.options.requireApiKey && this.options.apiKey === undefined) {
      throw new AppError('DEVICE_CONTROL_NOT_CONFIGURED', 'FreeKiosk API authentication is not configured.', 503);
    }

    const targetUrl = buildFreeKioskUrl(lastIp, this.options.apiPort, this.options.allowLoopback, commandPath);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (this.options.apiKey !== undefined) {
        headers['X-Api-Key'] = this.options.apiKey;
      }
      const response = await this.fetchFn(targetUrl, {
        method: 'POST',
        headers,
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal
      });

      if (!response.ok) {
        throw new AppError('DEVICE_CONTROL_REJECTED', `FreeKiosk rejected the ${commandLabel} command.`, 502);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new AppError('DEVICE_CONTROL_INVALID_RESPONSE', 'FreeKiosk returned an invalid response.', 502);
      }

      const parsed = freeKioskBeepResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw new AppError('DEVICE_CONTROL_INVALID_RESPONSE', 'FreeKiosk returned an invalid response.', 502);
      }
      if (parsed.data.success !== true || parsed.data.data?.executed === false) {
        throw new AppError('DEVICE_CONTROL_REJECTED', `FreeKiosk rejected the ${commandLabel} command.`, 502);
      }
      if (parsed.data.data?.executed !== true || parsed.data.data.command !== expectedCommand) {
        throw new AppError('DEVICE_CONTROL_INVALID_RESPONSE', 'FreeKiosk returned an invalid response.', 502);
      }

      return { command: expectedCommand, executed: true };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        'DEVICE_CONTROL_UNAVAILABLE',
        controller.signal.aborted ? 'FreeKiosk did not respond within the configured timeout.' : 'FreeKiosk could not be reached.',
        controller.signal.aborted ? 504 : 502
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createFreeKioskClient(config: ServerConfig): FreeKioskClient {
  return new FreeKioskClient({
    apiPort: config.freeKioskApiPort,
    apiKey: config.freeKioskApiKey,
    timeoutMs: config.freeKioskApiTimeoutMs,
    requireApiKey: config.nodeEnv !== 'test',
    allowLoopback: config.nodeEnv === 'test'
  });
}

function buildFreeKioskUrl(lastIp: string, apiPort: number, allowLoopback: boolean, commandPath: string): string {
  const host = normalizeIpAddress(lastIp);
  const ipVersion = isIP(host);
  if (ipVersion === 0 || !isPrivateAddress(host, ipVersion, allowLoopback)) {
    throw new AppError('DEVICE_CONTROL_UNAVAILABLE', 'The device does not have a private network address.', 409);
  }

  const urlHost = ipVersion === 6 ? `[${host}]` : host;
  return `http://${urlHost}:${apiPort}${commandPath}`;
}

function normalizeIpAddress(value: string): string {
  const host = value.trim();
  const mappedIpv4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(host);
  return mappedIpv4?.[1] ?? host;
}

function isPrivateAddress(host: string, ipVersion: number, allowLoopback: boolean): boolean {
  if (ipVersion === 4) {
    return isPrivateIpv4(host, allowLoopback);
  }
  if (ipVersion === 6) {
    if (allowLoopback && isIpv6Loopback(host)) return true;
    const firstHextet = Number.parseInt(host.split(':')[0] ?? '', 16);
    return Number.isInteger(firstHextet)
      && ((firstHextet & 0xfe00) === 0xfc00 || (firstHextet & 0xffc0) === 0xfe80);
  }
  return false;
}

function isPrivateIpv4(host: string, allowLoopback: boolean): boolean {
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  const [first, second] = octets;
  if (first === undefined || second === undefined) return false;
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (allowLoopback && first === 127);
}

function isIpv6Loopback(host: string): boolean {
  return host.toLowerCase() === '::1' || host === '0:0:0:0:0:0:0:1';
}

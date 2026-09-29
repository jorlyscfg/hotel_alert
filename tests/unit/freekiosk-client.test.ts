import { afterEach, describe, expect, it, vi } from 'vitest';
import { FreeKioskClient } from '../../apps/server/src/integrations/freekiosk-client';

afterEach(() => {
  vi.useRealTimers();
});

describe('FreeKioskClient', () => {
  it('sends an authenticated beep to a private IPv4 address', async () => {
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('http://192.168.1.20:8080/api/audio/beep');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('X-Api-Key')).toBe('server-side-key');
      expect(init?.redirect).toBe('error');
      expect(init?.cache).toBe('no-store');
      return new Response(JSON.stringify({ success: true, data: { executed: true, command: 'audioBeep' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });
    const client = new FreeKioskClient({
      apiPort: 8080,
      apiKey: 'server-side-key',
      timeoutMs: 1000,
      requireApiKey: true,
      allowLoopback: false,
      fetchFn
    });

    await expect(client.beep('192.168.1.20')).resolves.toEqual({ command: 'audioBeep', executed: true });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('controls the screensaver only through the exact FreeKiosk screensaver endpoints', async () => {
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('http://10.0.0.20:8080/api/screensaver/off');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('X-Api-Key')).toBe('server-side-key');
      return new Response(JSON.stringify({ success: true, data: { executed: true, command: 'screenSaverOff' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });
    const client = new FreeKioskClient({
      apiPort: 8080,
      apiKey: 'server-side-key',
      timeoutMs: 1000,
      requireApiKey: true,
      allowLoopback: false,
      fetchFn
    });

    await expect(client.setScreensaver('10.0.0.20', false)).resolves.toEqual({ command: 'screenSaverOff', executed: true });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('rejects public addresses before making a request', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const client = new FreeKioskClient({
      apiPort: 8080,
      apiKey: 'server-side-key',
      timeoutMs: 1000,
      requireApiKey: true,
      allowLoopback: false,
      fetchFn
    });

    await expect(client.beep('203.0.113.10')).rejects.toMatchObject({
      code: 'DEVICE_CONTROL_UNAVAILABLE',
      statusCode: 409
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('maps an upstream rejection without exposing its response body', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: 'secret upstream detail' }), { status: 401 }));
    const client = new FreeKioskClient({
      apiPort: 8080,
      apiKey: 'server-side-key',
      timeoutMs: 1000,
      requireApiKey: true,
      allowLoopback: false,
      fetchFn
    });

    const error = await client.beep('10.0.0.20').catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'DEVICE_CONTROL_REJECTED', statusCode: 502 });
    expect(String(error)).not.toContain('secret upstream detail');
  });

  it('maps a device-reported command failure without exposing its details', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ success: true, data: { executed: false, error: 'sensitive device detail' } }), { status: 200 }));
    const client = new FreeKioskClient({
      apiPort: 8080,
      apiKey: 'server-side-key',
      timeoutMs: 1000,
      requireApiKey: true,
      allowLoopback: false,
      fetchFn
    });

    const error = await client.beep('10.0.0.20').catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'DEVICE_CONTROL_REJECTED', statusCode: 502 });
    expect(String(error)).not.toContain('sensitive device detail');
  });

  it('maps a structurally invalid success response separately', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ success: true, data: { command: 'audioBeep' } }), { status: 200 }));
    const client = new FreeKioskClient({
      apiPort: 8080,
      apiKey: 'server-side-key',
      timeoutMs: 1000,
      requireApiKey: true,
      allowLoopback: false,
      fetchFn
    });

    await expect(client.beep('10.0.0.20')).rejects.toMatchObject({ code: 'DEVICE_CONTROL_INVALID_RESPONSE', statusCode: 502 });
  });

  it('requires an API key in production mode', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const client = new FreeKioskClient({
      apiPort: 8080,
      apiKey: undefined,
      timeoutMs: 1000,
      requireApiKey: true,
      allowLoopback: false,
      fetchFn
    });

    await expect(client.beep('10.0.0.20')).rejects.toMatchObject({ code: 'DEVICE_CONTROL_NOT_CONFIGURED', statusCode: 503 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('maps a timed out request to a bounded gateway timeout', async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const client = new FreeKioskClient({
      apiPort: 8080,
      apiKey: 'server-side-key',
      timeoutMs: 1000,
      requireApiKey: true,
      allowLoopback: false,
      fetchFn
    });

    const promise = client.beep('10.0.0.20');
    const rejection = expect(promise).rejects.toMatchObject({ code: 'DEVICE_CONTROL_UNAVAILABLE', statusCode: 504 });
    await vi.advanceTimersByTimeAsync(1000);
    await rejection;
  });
});

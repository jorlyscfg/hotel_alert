import { describe, expect, it, vi } from 'vitest';
import { MetNorwayWeatherClient } from '../../apps/server/src/integrations/met-norway-weather-client';

describe('MetNorwayWeatherClient', () => {
  const now = Date.parse('2026-10-01T18:00:00.000Z');

  it('maps current temperature, humidity, and MET condition codes using four-decimal coordinates', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(weatherResponse('rainshowers_day'));
    const client = new MetNorwayWeatherClient({ userAgent: 'HotelAlert test weather client', fetchFn, now: () => now });

    await expect(client.getWeather(20.2114567, -87.4653456)).resolves.toEqual({
      temperatureC: 28.4,
      relativeHumidity: 68,
      condition: 'rain'
    });

    const [input, init] = fetchFn.mock.calls[0] ?? [];
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    expect(url.pathname).toBe('/weatherapi/locationforecast/2.0/compact');
    expect(url.searchParams.get('lat')).toBe('20.2115');
    expect(url.searchParams.get('lon')).toBe('-87.4653');
    expect(headers.get('user-agent')).toContain('HotelAlert');
  });

  it('uses the provider max-age before making another request', async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(weatherResponse('clearsky_day', { 'cache-control': 'public, max-age=30' }))
      .mockResolvedValueOnce(weatherResponse('cloudy', { 'cache-control': 'max-age=60' }));
    let currentTime = now;
    const client = new MetNorwayWeatherClient({ userAgent: 'HotelAlert test weather client', fetchFn, now: () => currentTime });

    const first = await client.getWeather(20.2, -87.4);
    currentTime += 29_000;
    await expect(client.getWeather(20.2, -87.4)).resolves.toEqual(first);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    currentTime += 2_000;
    expect((await client.getWeather(20.2, -87.4))?.condition).toBe('cloudy');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('uses Expires when max-age is absent', async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(weatherResponse('clearsky_day', { expires: new Date(now + 10_000).toUTCString() }))
      .mockResolvedValueOnce(weatherResponse('cloudy', { expires: new Date(now + 120_000).toUTCString() }));
    let currentTime = now;
    const client = new MetNorwayWeatherClient({ userAgent: 'HotelAlert test weather client', fetchFn, now: () => currentTime });

    await client.getWeather(20.2, -87.4);
    currentTime += 9_000;
    await client.getWeather(20.2, -87.4);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    currentTime += 2_000;
    expect((await client.getWeather(20.2, -87.4))?.condition).toBe('cloudy');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('revalidates expired data with If-Modified-Since and keeps cached values after 304', async () => {
    const lastModified = 'Thu, 01 Oct 2026 17:00:00 GMT';
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(weatherResponse('fair_day', { 'cache-control': 'max-age=0', 'last-modified': lastModified }))
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: { 'cache-control': 'max-age=60' } }));
    const client = new MetNorwayWeatherClient({ userAgent: 'HotelAlert test weather client', fetchFn, now: () => now });

    const first = await client.getWeather(20.2, -87.4);
    await expect(client.getWeather(20.2, -87.4)).resolves.toEqual(first);
    const secondHeaders = new Headers(fetchFn.mock.calls[1]?.[1]?.headers);
    expect(secondHeaders.get('if-modified-since')).toBe(lastModified);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('coalesces simultaneous requests for the same rounded location', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const delayedResponse = new Promise<Response>((resolve) => { resolveFetch = resolve; });
    const fetchFn = vi.fn<typeof fetch>().mockReturnValue(delayedResponse);
    const client = new MetNorwayWeatherClient({ userAgent: 'HotelAlert test weather client', fetchFn, now: () => now });

    const first = client.getWeather(20.21141, -87.46531);
    const second = client.getWeather(20.21144, -87.46534);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    resolveFetch?.(weatherResponse('cloudy'));

    await expect(Promise.all([first, second])).resolves.toEqual([
      { temperatureC: 28.4, relativeHumidity: 68, condition: 'cloudy' },
      { temperatureC: 28.4, relativeHumidity: 68, condition: 'cloudy' }
    ]);
  });

  it.each([
    ['clearsky_night', 'clear'],
    ['partlycloudy_day', 'partly-cloudy'],
    ['cloudy', 'cloudy'],
    ['fog', 'fog'],
    ['heavysleet', 'sleet'],
    ['snowshowers_day', 'snow'],
    ['thunderstorm', 'thunderstorm']
  ] as const)('maps %s to the local %s condition icon category', async (symbolCode, condition) => {
    const client = new MetNorwayWeatherClient({
      userAgent: 'HotelAlert test weather client',
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(weatherResponse(symbolCode)),
      now: () => now
    });
    await expect(client.getWeather(20, -87)).resolves.toMatchObject({ condition });
  });

  it('keeps available fields when other forecast fields are absent and omits an empty forecast', async () => {
    const partial = new MetNorwayWeatherClient({
      userAgent: 'HotelAlert test weather client',
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(weatherResponseWithout({ relative_humidity: 43 })),
      now: () => now
    });
    await expect(partial.getWeather(20, -87)).resolves.toEqual({
      temperatureC: null,
      relativeHumidity: 43,
      condition: null
    });

    const empty = new MetNorwayWeatherClient({
      userAgent: 'HotelAlert test weather client',
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(weatherResponseWithout({})),
      now: () => now
    });
    const unavailable = vi.fn();
    await expect(empty.getWeather(20, -87, unavailable)).resolves.toBeNull();
    expect(unavailable).toHaveBeenCalledWith('no_forecast_data');
    unavailable.mockClear();
    await expect(empty.getWeather(20, -87, unavailable)).resolves.toBeNull();
    expect(unavailable).toHaveBeenCalledWith('no_forecast_data');
  });

  it('reports provider, malformed-payload, and invalid-coordinate reasons without throwing', async () => {
    const unavailable = new MetNorwayWeatherClient({
      userAgent: 'HotelAlert test weather client',
      fetchFn: vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')),
      now: () => now
    });
    const providerReason = vi.fn();
    await expect(unavailable.getWeather(20, -87, providerReason)).resolves.toBeNull();
    expect(providerReason).toHaveBeenCalledWith('provider_unavailable');

    const malformed = new MetNorwayWeatherClient({
      userAgent: 'HotelAlert test weather client',
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(new Response('{not json', { status: 200 })),
      now: () => now
    });
    const malformedReason = vi.fn();
    await expect(malformed.getWeather(20, -87, malformedReason)).resolves.toBeNull();
    expect(malformedReason).toHaveBeenCalledWith('invalid_forecast');

    const invalidCoordinates = vi.fn<typeof fetch>();
    const invalid = new MetNorwayWeatherClient({ userAgent: 'HotelAlert test weather client', fetchFn: invalidCoordinates, now: () => now });
    const invalidReason = vi.fn();
    await expect(invalid.getWeather(100, -87, invalidReason)).resolves.toBeNull();
    expect(invalidReason).toHaveBeenCalledWith('invalid_coordinates');
    expect(invalidCoordinates).not.toHaveBeenCalled();
  });

  it('reports a provider HTTP error without exposing its response body', async () => {
    const client = new MetNorwayWeatherClient({
      userAgent: 'HotelAlert test weather client',
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(new Response('sensitive provider details', { status: 503 })),
      now: () => now
    });
    const unavailable = vi.fn();

    await expect(client.getWeather(20, -87, unavailable)).resolves.toBeNull();
    expect(unavailable).toHaveBeenCalledWith('provider_unavailable');
  });

  it('returns no weather after a request timeout', async () => {
    const fetchFn = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const client = new MetNorwayWeatherClient({ userAgent: 'HotelAlert test weather client', fetchFn, timeoutMs: 5, now: () => now });
    const unavailable = vi.fn();

    await expect(client.getWeather(20, -87, unavailable)).resolves.toBeNull();
    expect(unavailable).toHaveBeenCalledWith('provider_unavailable');
  });
});

function weatherResponse(
  symbolCode: string,
  headers: Record<string, string> = { 'cache-control': 'max-age=3600' }
): Response {
  return new Response(JSON.stringify({
    properties: {
      timeseries: [{
        time: new Date(Date.parse('2026-10-01T18:00:00.000Z') + 60_000).toISOString(),
        data: {
          instant: { details: { air_temperature: 28.4, relative_humidity: 68 } },
          next_1_hours: { summary: { symbol_code: symbolCode } }
        }
      }]
    }
  }), { status: 200, headers: { 'content-type': 'application/json', ...headers } });
}

function weatherResponseWithout(details: Record<string, number>): Response {
  return new Response(JSON.stringify({
    properties: { timeseries: [{ time: '2026-10-01T18:01:00.000Z', data: { instant: { details } } }] }
  }), { status: 200, headers: { 'cache-control': 'max-age=3600' } });
}

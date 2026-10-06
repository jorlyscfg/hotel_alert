import { describe, expect, it, vi } from 'vitest';
import { GeoapifyClient } from '../../apps/server/src/integrations/geoapify-client';

describe('Geoapify city search client', () => {
  it('reports missing server configuration without making a provider request', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const client = new GeoapifyClient({ apiKey: undefined, fetchFn });

    expect(client.isConfigured()).toBe(false);
    await expect(client.searchCities('Cancun')).rejects.toMatchObject({
      code: 'LOCATION_SEARCH_NOT_CONFIGURED',
      statusCode: 503
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects city text containing control characters before making a provider request', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const client = new GeoapifyClient({ apiKey: 'unit-test-geoapify-key', fetchFn });

    await expect(client.searchCities('Can\u0001cun')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 422
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('bounds the query and result count, requests cities on the server, and rounds coordinates', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      results: [
        { place_id: 'place-tulum', formatted: 'Tulum, Quintana Roo, Mexico', lat: 20.2114_567, lon: -87.4653_456 },
        { place_id: 'place-cancun', name: 'Cancún', city: 'Cancún', country: 'Mexico', lat: 21.1619, lon: -86.8515 }
      ]
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = new GeoapifyClient({ apiKey: 'unit-test-geoapify-key', fetchFn });

    const cities = await client.searchCities('  Tulum  ');

    expect(client.isConfigured()).toBe(true);
    expect(cities).toEqual([
      { id: 'place-tulum', displayName: 'Tulum, Quintana Roo, Mexico', latitude: 20.2115, longitude: -87.4653 },
      { id: 'place-cancun', displayName: 'Cancún, Mexico', latitude: 21.1619, longitude: -86.8515 }
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [input, init] = fetchFn.mock.calls[0] ?? [];
    const url = new URL(String(input));
    expect(url.origin).toBe('https://api.geoapify.com');
    expect(url.pathname).toBe('/v1/geocode/autocomplete');
    expect(url.searchParams.get('text')).toBe('Tulum');
    expect(url.searchParams.get('type')).toBe('city');
    expect(url.searchParams.get('format')).toBe('json');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('apiKey')).toBe('unit-test-geoapify-key');
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' });
    expect((init?.headers as Record<string, string>)['accept']).toBe('application/json');
  });

  it('returns a sanitized unavailable error when the provider cannot be reached', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new Error('provider connection failed'));
    const client = new GeoapifyClient({ apiKey: 'unit-test-geoapify-key', fetchFn });
    const search = client.searchCities('Cancun');

    await expect(search).rejects.toMatchObject({
      code: 'LOCATION_SEARCH_UNAVAILABLE',
      statusCode: 503
    });
    await expect(search).rejects.toThrow('City search is temporarily unavailable.');
  });

  it('rejects malformed provider results without exposing provider details', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ results: [{ place_id: 'bad', lat: 999, lon: 0 }] }), { status: 200 }));
    const client = new GeoapifyClient({ apiKey: 'unit-test-geoapify-key', fetchFn });
    const search = client.searchCities('Cancun');

    await expect(search).rejects.toMatchObject({
      code: 'LOCATION_SEARCH_INVALID_RESPONSE',
      statusCode: 502
    });
    await expect(search).rejects.toThrow('City search returned an invalid response.');
  });
});

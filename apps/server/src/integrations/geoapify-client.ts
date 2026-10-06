import { z } from 'zod';
import type { ServerConfig } from '../config/env';
import { AppError } from '../errors';

const GEOAPIFY_AUTOCOMPLETE_URL = 'https://api.geoapify.com/v1/geocode/autocomplete';
const GEOAPIFY_TIMEOUT_MS = 5000;
const CITY_RESULT_LIMIT = 5;

const optionalPlaceText = z.string().trim().min(1).max(240).nullable().optional();
const geoapifyPlaceSchema = z.object({
  place_id: z.string().trim().min(1).max(256).optional(),
  formatted: optionalPlaceText,
  name: optionalPlaceText,
  city: optionalPlaceText,
  state: optionalPlaceText,
  country: optionalPlaceText,
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180)
}).passthrough();
const geoapifyResponseSchema = z.object({
  results: z.array(geoapifyPlaceSchema).max(25)
}).passthrough();

export interface GeoapifyCityResult {
  id: string;
  displayName: string;
  latitude: number;
  longitude: number;
}

export interface GeoapifyClientOptions {
  apiKey: string | undefined;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class GeoapifyClient {
  private readonly fetchFn: typeof fetch;

  public constructor(private readonly options: GeoapifyClientOptions) {
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
  }

  public isConfigured(): boolean {
    return this.options.apiKey !== undefined;
  }

  public async searchCities(rawQuery: string): Promise<GeoapifyCityResult[]> {
    const query = rawQuery.trim();
    // eslint-disable-next-line no-control-regex -- Reject C0/DEL control characters before sending user text to Geoapify.
    if (query.length < 2 || query.length > 120 || /[\u0000-\u001f\u007f]/.test(query)) {
      throw new AppError('VALIDATION_ERROR', 'City search text must be between 2 and 120 characters.', 422);
    }
    const apiKey = this.options.apiKey;
    if (apiKey === undefined) {
      throw new AppError('LOCATION_SEARCH_NOT_CONFIGURED', 'City search is not configured on this server.', 503);
    }

    const url = new URL(GEOAPIFY_AUTOCOMPLETE_URL);
    url.searchParams.set('text', query);
    url.searchParams.set('type', 'city');
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', String(CITY_RESULT_LIMIT));
    url.searchParams.set('apiKey', apiKey);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? GEOAPIFY_TIMEOUT_MS);
    try {
      const response = await this.fetchFn(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal
      });
      if (!response.ok) {
        throw new AppError('LOCATION_SEARCH_UNAVAILABLE', 'City search is temporarily unavailable.', 503);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new AppError('LOCATION_SEARCH_INVALID_RESPONSE', 'City search returned an invalid response.', 502);
      }
      const parsed = geoapifyResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw new AppError('LOCATION_SEARCH_INVALID_RESPONSE', 'City search returned an invalid response.', 502);
      }

      return parsed.data.results
        .map((place) => mapGeoapifyPlace(place))
        .filter((place): place is GeoapifyCityResult => place !== null)
        .slice(0, CITY_RESULT_LIMIT);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        'LOCATION_SEARCH_UNAVAILABLE',
        controller.signal.aborted ? 'City search timed out.' : 'City search is temporarily unavailable.',
        controller.signal.aborted ? 504 : 503
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createGeoapifyClient(config: ServerConfig, fetchFn?: typeof fetch): GeoapifyClient {
  return new GeoapifyClient({ apiKey: config.geoapifyApiKey, ...(fetchFn === undefined ? {} : { fetchFn }) });
}

function mapGeoapifyPlace(place: z.infer<typeof geoapifyPlaceSchema>): GeoapifyCityResult | null {
  const displayName = place.formatted
    ?? [...new Set([place.name, place.city, place.state, place.country]
      .filter((part): part is string => typeof part === 'string')
      .map((part) => part.trim())
      .filter((part) => part.length > 0))].join(', ');
  const normalizedName = displayName.trim().slice(0, 240);
  if (normalizedName.length === 0) return null;

  const latitude = roundCoordinate(place.lat);
  const longitude = roundCoordinate(place.lon);
  return {
    id: place.place_id ?? `${normalizedName}:${latitude}:${longitude}`,
    displayName: normalizedName,
    latitude,
    longitude
  };
}

function roundCoordinate(value: number): number {
  const rounded = Math.round(value * 10_000) / 10_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

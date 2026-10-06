import { z } from 'zod';
import type { DeviceWeatherCondition, DeviceWeatherDTO } from '@hotel/shared';
import type { ServerConfig } from '../config/env';

const LOCATION_FORECAST_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
const REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const FAILURE_RETRY_MS = 30 * 1000;

export type WeatherUnavailableReason = 'invalid_coordinates' | 'provider_unavailable' | 'invalid_forecast' | 'no_forecast_data';

const detailsSchema = z.object({
  air_temperature: z.number().finite().optional(),
  relative_humidity: z.number().finite().min(0).max(100).optional()
}).passthrough();

const symbolSchema = z.object({
  symbol_code: z.string().trim().min(1).max(80).optional()
}).passthrough();

const forecastPointSchema = z.object({
  time: z.string().datetime({ offset: true }).optional(),
  data: z.object({
    instant: z.object({ details: detailsSchema }).passthrough().optional(),
    next_1_hours: z.object({ summary: symbolSchema.optional() }).passthrough().optional(),
    next_6_hours: z.object({ summary: symbolSchema.optional() }).passthrough().optional(),
    next_12_hours: z.object({ summary: symbolSchema.optional() }).passthrough().optional()
  }).passthrough()
}).passthrough();

const forecastResponseSchema = z.object({
  properties: z.object({ timeseries: z.array(forecastPointSchema).min(1).max(500) }).passthrough()
}).passthrough();

interface ForecastCacheEntry {
  weather: DeviceWeatherDTO | null;
  unavailableReason: WeatherUnavailableReason | null;
  expiresAt: number;
  lastModified?: string;
}

interface WeatherLookupResult {
  weather: DeviceWeatherDTO | null;
  unavailableReason: WeatherUnavailableReason | null;
}

interface CachePolicy {
  expiresAt: number;
  noStore: boolean;
}

export interface MetNorwayWeatherClientOptions {
  userAgent: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  now?: () => number;
}

export class MetNorwayWeatherClient {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly cache = new Map<string, ForecastCacheEntry>();
  private readonly inFlight = new Map<string, Promise<WeatherLookupResult>>();

  public constructor(private readonly options: MetNorwayWeatherClientOptions) {
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
  }

  public async getWeather(
    latitude: number,
    longitude: number,
    onUnavailable?: (reason: WeatherUnavailableReason) => void
  ): Promise<DeviceWeatherDTO | null> {
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      notifyUnavailable(onUnavailable, 'invalid_coordinates');
      return null;
    }

    const roundedLatitude = roundCoordinate(latitude);
    const roundedLongitude = roundCoordinate(longitude);
    const key = `${roundedLatitude},${roundedLongitude}`;
    const now = this.now();
    const existing = this.cache.get(key);
    if (existing !== undefined && existing.expiresAt > now) {
      notifyUnavailable(onUnavailable, existing.unavailableReason);
      return existing.weather;
    }

    const pending = this.inFlight.get(key);
    if (pending !== undefined) {
      const result = await pending;
      notifyUnavailable(onUnavailable, result.unavailableReason);
      return result.weather;
    }

    const refresh = this.fetchWeather(key, roundedLatitude, roundedLongitude, existing);
    this.inFlight.set(key, refresh);
    try {
      const result = await refresh;
      notifyUnavailable(onUnavailable, result.unavailableReason);
      return result.weather;
    } finally {
      if (this.inFlight.get(key) === refresh) this.inFlight.delete(key);
    }
  }

  private async fetchWeather(
    key: string,
    latitude: number,
    longitude: number,
    previous: ForecastCacheEntry | undefined
  ): Promise<WeatherLookupResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const url = new URL(LOCATION_FORECAST_URL);
    url.searchParams.set('lat', latitude.toFixed(4));
    url.searchParams.set('lon', longitude.toFixed(4));
    const headers = new Headers({ accept: 'application/json', 'user-agent': this.options.userAgent });
    if (previous?.lastModified !== undefined) headers.set('if-modified-since', previous.lastModified);

    try {
      const response = await this.fetchFn(url, {
        method: 'GET',
        headers,
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal
      });

      if (response.status === 304) {
        if (previous === undefined) return this.cacheFailure(key, 'invalid_forecast');
        const cachePolicy = readCachePolicy(response.headers, this.now());
        if (cachePolicy.noStore) {
          this.cache.delete(key);
        } else {
          const lastModified = response.headers.get('last-modified') ?? previous.lastModified;
          this.cache.set(key, {
            weather: previous.weather,
            unavailableReason: previous.unavailableReason,
            expiresAt: cachePolicy.expiresAt,
            ...(lastModified === undefined ? {} : { lastModified })
          });
        }
        return previous;
      }

      if (!response.ok) return this.cacheFailure(key, 'provider_unavailable', response.headers);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return this.cacheFailure(key, 'invalid_forecast', response.headers);
      }

      const parsed = forecastResponseSchema.safeParse(body);
      if (!parsed.success) return this.cacheFailure(key, 'invalid_forecast', response.headers);

      const weather = mapForecast(parsed.data.properties.timeseries, this.now());
      const result = {
        weather,
        unavailableReason: weather === null ? 'no_forecast_data' as const : null
      };
      const cachePolicy = readCachePolicy(response.headers, this.now());
      if (cachePolicy.noStore) {
        this.cache.delete(key);
      } else {
        const lastModified = response.headers.get('last-modified');
        this.cache.set(key, {
          ...result,
          expiresAt: cachePolicy.expiresAt,
          ...(lastModified === null ? {} : { lastModified })
        });
      }
      return result;
    } catch {
      return this.cacheFailure(key, 'provider_unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }

  private cacheFailure(key: string, unavailableReason: WeatherUnavailableReason, headers?: Headers): WeatherLookupResult {
    const now = this.now();
    const result: WeatherLookupResult = { weather: null, unavailableReason };
    if (headers === undefined) {
      this.cache.set(key, { ...result, expiresAt: now + FAILURE_RETRY_MS });
      return result;
    }
    const policy = readCachePolicy(headers, now);
    if (policy.noStore) this.cache.delete(key);
    else this.cache.set(key, { ...result, expiresAt: Math.max(policy.expiresAt, now + FAILURE_RETRY_MS) });
    return result;
  }
}

function notifyUnavailable(
  callback: ((reason: WeatherUnavailableReason) => void) | undefined,
  reason: WeatherUnavailableReason | null
): void {
  if (callback === undefined || reason === null) return;
  try {
    callback(reason);
  } catch {
    // Diagnostics must not make the optional weather endpoint fail.
  }
}

export function createMetNorwayWeatherClient(config: ServerConfig, fetchFn?: typeof fetch): MetNorwayWeatherClient {
  let contact = 'configured Hotel Alert server';
  try {
    contact = new URL(config.appOrigin).origin;
  } catch {
    // Keep a descriptive User-Agent even if APP_ORIGIN is unavailable.
  }
  return new MetNorwayWeatherClient({
    userAgent: `HotelAlert/1.0 (ROOM screensaver forecast; contact: ${contact})`,
    ...(fetchFn === undefined ? {} : { fetchFn })
  });
}

function mapForecast(
  points: z.infer<typeof forecastResponseSchema>['properties']['timeseries'],
  now: number
): DeviceWeatherDTO | null {
  const current = points.find((point) => point.time === undefined || Date.parse(point.time) >= now)
    ?? points.at(-1);
  if (current === undefined) return null;

  const details = current.data.instant?.details;
  const temperatureC = isFiniteNumber(details?.air_temperature) ? details.air_temperature : null;
  const relativeHumidity = isFiniteNumber(details?.relative_humidity) && details.relative_humidity >= 0 && details.relative_humidity <= 100
    ? details.relative_humidity
    : null;
  const symbolCode = current.data.next_1_hours?.summary?.symbol_code
    ?? current.data.next_6_hours?.summary?.symbol_code
    ?? current.data.next_12_hours?.summary?.symbol_code;
  const condition = symbolCode === undefined ? null : mapSymbolCode(symbolCode);

  if (temperatureC === null && relativeHumidity === null && condition === null) return null;
  return { temperatureC, relativeHumidity, condition };
}

function mapSymbolCode(symbolCode: string): DeviceWeatherCondition | null {
  const code = symbolCode.toLowerCase().split('_', 1)[0] ?? '';
  if (code.includes('thunder')) return 'thunderstorm';
  if (code.includes('snow')) return 'snow';
  if (code.includes('sleet')) return 'sleet';
  if (code.includes('rain')) return 'rain';
  if (code.includes('fog')) return 'fog';
  if (code.includes('cloudy')) return code === 'partlycloudy' ? 'partly-cloudy' : 'cloudy';
  if (code === 'fair' || code === 'partlycloudy') return 'partly-cloudy';
  if (code === 'clearsky') return 'clear';
  return null;
}

function readCachePolicy(headers: Headers, now: number): CachePolicy {
  const cacheControl = headers.get('cache-control')?.toLowerCase() ?? '';
  const noStore = /(?:^|,)\s*no-store(?:\s|,|$)/.test(cacheControl);
  const ageMs = parseNonNegativeSeconds(headers.get('age')) * 1000;
  const sharedMaxAge = /(?:^|,)\s*s-maxage\s*=\s*"?(\d+)"?/i.exec(cacheControl)?.[1];
  const maxAge = /(?:^|,)\s*max-age\s*=\s*"?(\d+)"?/i.exec(cacheControl)?.[1];
  const maxAgeValue = sharedMaxAge ?? maxAge;
  let lifetimeMs: number;

  if (/(?:^|,)\s*no-cache(?:\s|,|$)/.test(cacheControl)) {
    lifetimeMs = 0;
  } else if (maxAgeValue !== undefined) {
    lifetimeMs = Math.max(0, Number(maxAgeValue) * 1000 - ageMs);
  } else {
    const expiresAt = Date.parse(headers.get('expires') ?? '');
    lifetimeMs = Number.isFinite(expiresAt) ? Math.max(0, expiresAt - now - ageMs) : DEFAULT_CACHE_TTL_MS;
  }

  return { expiresAt: now + lifetimeMs, noStore };
}

function parseNonNegativeSeconds(value: string | null): number {
  const parsed = value === null ? 0 : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function roundCoordinate(value: number): number {
  const rounded = Math.round(value * 10_000) / 10_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../apps/web/src/api';
import { ROOM_SCREENSAVER_WEATHER_POLL_INTERVAL_MS, RoomScreensaver, startRoomWeatherPolling } from '../../apps/web/src/features/device/RoomScreensaver';
import type { DeviceWeatherDTO } from '@hotel/shared';

afterEach(() => vi.useRealTimers());

describe('ROOM screensaver weather presentation', () => {
  it('shows localized accessible readings, an icon-only condition, and MET attribution', () => {
    const markup = renderToStaticMarkup(createElement(RoomScreensaver, {
      label: 'Salvapantallas de la habitación',
      time: '12:00',
      date: 'jueves, 1 de octubre de 2026',
      dateTime: '2026-10-01T18:00:00.000Z',
      locale: 'es',
      weather: { temperatureC: 28.4, relativeHumidity: 68, condition: 'rain' }
    }));

    expect(markup).toContain('aria-label="Temperatura: 28,4 °C"');
    expect(markup).toContain('aria-label="Humedad relativa: 68%"');
    expect(markup).toContain('data-weather-condition="rain"');
    expect(markup).toContain('aria-label="Lluvia"');
    expect(markup).not.toContain('>Lluvia<');
    expect(markup).toContain('aria-label="Clima"');
    expect(markup).not.toContain('Pronóstico de ubicación');
    expect(markup).not.toContain('no son mediciones del panel');
    expect(markup).not.toContain('Datos meteorológicos de');
    expect(markup).not.toContain('Weather data from');
    expect(markup).toContain('MET Norway</a> · <a');
    expect(markup).toContain('href="https://www.met.no/en"');
    expect(markup).toContain('href="https://creativecommons.org/licenses/by/4.0/"');
    expect(markup).toContain('>CC BY 4.0</a>');
  });

  it('shows a localized unavailable state when the server has no forecast', () => {
    const markup = renderToStaticMarkup(createElement(RoomScreensaver, {
      label: 'ROOM screensaver', time: '12:00', date: 'Thursday', dateTime: '2026-10-01T18:00:00.000Z',
      locale: 'es', weatherStatus: 'unavailable'
    }));
    expect(markup).toContain('data-room-weather="true"');
    expect(markup).toContain('data-weather-unavailable="true"');
    expect(markup).toContain('El clima no está disponible en este momento');
    expect(markup).not.toContain('data-weather-temperature');
    expect(markup).not.toContain('data-weather-humidity');
  });

  it('shows localized physical-control hints aligned to the two button actions', () => {
    const markup = renderToStaticMarkup(createElement(RoomScreensaver, {
      label: 'Salvapantallas', time: '12:00', date: 'jueves', dateTime: '2026-10-01T18:00:00.000Z', locale: 'es'
    }));

    expect(markup).toContain('data-screensaver-control="dnd"');
    expect(markup).toContain('aria-label="No molestar"');
    expect(markup).toContain('data-screensaver-control="screen-off"');
    expect(markup).toContain('aria-label="Apagar pantalla"');
  });

  it('marks the DND hint active only when ROOM Do Not Disturb is enabled', () => {
    const activeMarkup = renderToStaticMarkup(createElement(RoomScreensaver, {
      label: 'ROOM screensaver', time: '12:00', date: 'Thursday', dateTime: '2026-10-01T18:00:00.000Z',
      doNotDisturbEnabled: true
    }));
    const inactiveMarkup = renderToStaticMarkup(createElement(RoomScreensaver, {
      label: 'ROOM screensaver', time: '12:00', date: 'Thursday', dateTime: '2026-10-01T18:00:00.000Z',
      doNotDisturbEnabled: false
    }));

    expect(activeMarkup).toContain('room-screensaver__control-hint--active');
    expect(inactiveMarkup).not.toContain('room-screensaver__control-hint--active');
  });

  it('does not show a false unavailable state while the first forecast is loading', () => {
    const markup = renderToStaticMarkup(createElement(RoomScreensaver, {
      label: 'ROOM screensaver', time: '12:00', date: 'Thursday', dateTime: '2026-10-01T18:00:00.000Z',
      weatherStatus: 'loading'
    }));

    expect(markup).not.toContain('data-room-weather');
    expect(markup).not.toContain('data-weather-unavailable');
  });
});

describe('ROOM screensaver weather polling lifecycle', () => {
  it('fetches once immediately and uses a one-hour default refresh cadence', async () => {
    vi.useFakeTimers();
    const fetchWeather = vi.fn(async () => null);
    const stop = startRoomWeatherPolling({
      deviceToken: 'room-device-token',
      onWeather: vi.fn(),
      onAuthFailure: vi.fn(),
      fetchWeather
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchWeather).toHaveBeenCalledTimes(1);
    expect(ROOM_SCREENSAVER_WEATHER_POLL_INTERVAL_MS).toBe(60 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(ROOM_SCREENSAVER_WEATHER_POLL_INTERVAL_MS - 1);
    expect(fetchWeather).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchWeather).toHaveBeenCalledTimes(2);

    stop();
  });

  it('fetches immediately, polls only until cleanup, and aborts on unmount', async () => {
    vi.useFakeTimers();
    const weather: DeviceWeatherDTO = { temperatureC: 25, relativeHumidity: 50, condition: 'clear' };
    const fetchWeather = vi.fn(async () => weather);
    const onWeather = vi.fn();
    const controller: AbortSignal[] = [];
    const fetchWithSignal = vi.fn((token: string, signal: AbortSignal) => {
      expect(token).toBe('room-device-token');
      controller.push(signal);
      return fetchWeather();
    });
    const stop = startRoomWeatherPolling({
      deviceToken: 'room-device-token',
      onWeather,
      onAuthFailure: vi.fn(),
      fetchWeather: fetchWithSignal,
      intervalMs: 1000
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchWithSignal).toHaveBeenCalledTimes(1);
    expect(onWeather).toHaveBeenLastCalledWith(weather);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchWithSignal).toHaveBeenCalledTimes(2);

    stop();
    expect(controller[0]?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchWithSignal).toHaveBeenCalledTimes(2);
  });

  it('stops polling after device authentication fails and clears unavailable values', async () => {
    vi.useFakeTimers();
    const failure = new ApiError(401, { error: { code: 'AUTH_INVALID' } });
    const fetchWeather = vi.fn().mockRejectedValue(failure);
    const onWeather = vi.fn();
    const onAuthFailure = vi.fn();
    const stop = startRoomWeatherPolling({
      deviceToken: 'room-device-token',
      onWeather,
      onAuthFailure,
      fetchWeather,
      intervalMs: 1000
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchWeather).toHaveBeenCalledTimes(1);
    expect(onWeather).toHaveBeenCalledWith(null);
    expect(onAuthFailure).toHaveBeenCalledWith(failure);
    stop();
  });
});

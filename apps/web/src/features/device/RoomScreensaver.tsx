import { useEffect, useRef, useState } from 'react';
import { Moon, MonitorOff } from 'lucide-react';
import type { DeviceWeatherCondition, DeviceWeatherDTO } from '@hotel/shared';
import { getDeviceWeather, isDeviceAuthFailure } from '../../api';
import { createTranslator, type Locale, type MessageKey } from '../../i18n';
import { subscribeToNativeRoomScreensaverButtons } from '../../native-bridge';

export const ROOM_SCREENSAVER_WEATHER_POLL_INTERVAL_MS = 60 * 60 * 1000;

const WEATHER_CONDITION_LABELS: Record<DeviceWeatherCondition, MessageKey> = {
  clear: 'screensaver.weather.clear',
  'partly-cloudy': 'screensaver.weather.partlyCloudy',
  cloudy: 'screensaver.weather.cloudy',
  fog: 'screensaver.weather.fog',
  rain: 'screensaver.weather.rain',
  sleet: 'screensaver.weather.sleet',
  snow: 'screensaver.weather.snow',
  thunderstorm: 'screensaver.weather.thunderstorm'
};

export interface RoomScreensaverProps {
  label: string;
  time: string;
  date: string;
  dateTime: string;
  locale?: Locale;
  weather?: DeviceWeatherDTO | null;
  weatherStatus?: 'loading' | 'available' | 'unavailable';
  doNotDisturbEnabled?: boolean;
  doNotDisturbError?: string | null;
}

export interface RoomScreensaverContainerProps extends Omit<RoomScreensaverProps, 'weather'> {
  deviceToken: string;
  onAuthFailure: (error?: unknown) => void;
  onToggleDoNotDisturb: () => void | Promise<void>;
}

export function RoomScreensaverContainer({ deviceToken, onAuthFailure, onToggleDoNotDisturb, ...screensaverProps }: RoomScreensaverContainerProps) {
  const [weatherResult, setWeatherResult] = useState<{ weather: DeviceWeatherDTO | null; status: 'loading' | 'available' | 'unavailable' }>({
    weather: null,
    status: 'loading'
  });
  const onAuthFailureRef = useRef(onAuthFailure);
  onAuthFailureRef.current = onAuthFailure;
  const onToggleDoNotDisturbRef = useRef(onToggleDoNotDisturb);
  onToggleDoNotDisturbRef.current = onToggleDoNotDisturb;

  useEffect(() => startRoomWeatherPolling({
    deviceToken,
    onWeather: (weather) => setWeatherResult({ weather, status: weather === null ? 'unavailable' : 'available' }),
    onAuthFailure: (error) => onAuthFailureRef.current(error)
  }), [deviceToken]);

  useEffect(() => subscribeToNativeRoomScreensaverButtons(() => {
    void onToggleDoNotDisturbRef.current();
  }), []);

  return <RoomScreensaver {...screensaverProps} weather={weatherResult.weather} weatherStatus={weatherResult.status} />;
}

export function startRoomWeatherPolling(
  options: {
    deviceToken: string;
    onWeather: (weather: DeviceWeatherDTO | null) => void;
    onAuthFailure: (error?: unknown) => void;
    fetchWeather?: (deviceToken: string, signal: AbortSignal) => Promise<DeviceWeatherDTO | null>;
    intervalMs?: number;
  }
): () => void {
  const controller = new AbortController();
  let disposed = false;
  let pending = false;
  let authenticationFailed = false;
  const fetchWeather = options.fetchWeather ?? (async (deviceToken, signal) => (
    await getDeviceWeather(deviceToken, { signal })
  ).data);

  const refresh = async (): Promise<void> => {
    if (disposed || pending || authenticationFailed) return;
    pending = true;
    try {
      const weather = await fetchWeather(options.deviceToken, controller.signal);
      if (!disposed) options.onWeather(weather);
    } catch (error) {
      if (!disposed) {
        options.onWeather(null);
        if (isDeviceAuthFailure(error)) {
          authenticationFailed = true;
          options.onAuthFailure(error);
        }
      }
    } finally {
      pending = false;
    }
  };

  void refresh();
  const timer = setInterval(() => void refresh(), options.intervalMs ?? ROOM_SCREENSAVER_WEATHER_POLL_INTERVAL_MS);
  return () => {
    disposed = true;
    controller.abort();
    clearInterval(timer);
  };
}

export function RoomScreensaver({
  label,
  time,
  date,
  dateTime,
  locale = 'en',
  weather = null,
  weatherStatus = weather === null ? 'loading' : 'available',
  doNotDisturbEnabled = false,
  doNotDisturbError = null
}: RoomScreensaverProps) {
  const hasWeatherData = weather !== null && (
    weather.temperatureC !== null || weather.relativeHumidity !== null || weather.condition !== null
  );

  return (
    <section className="room-screensaver" aria-label={label} data-room-screensaver="true" tabIndex={0}>
      <div className="room-screensaver__content">
        <time className="room-screensaver__time" dateTime={dateTime}>{time}</time>
        <time className="room-screensaver__date" dateTime={dateTime}>{date}</time>
        {weatherStatus !== 'loading' && (hasWeatherData
          ? <RoomScreensaverWeather weather={weather} locale={locale} />
          : <RoomScreensaverWeatherUnavailable locale={locale} />)}
      </div>
      <RoomScreensaverControlHints
        locale={locale}
        doNotDisturbEnabled={doNotDisturbEnabled}
        doNotDisturbError={doNotDisturbError}
      />
    </section>
  );
}

function RoomScreensaverControlHints({
  locale,
  doNotDisturbEnabled,
  doNotDisturbError
}: {
  locale: Locale;
  doNotDisturbEnabled: boolean;
  doNotDisturbError: string | null;
}) {
  const t = createTranslator(locale);
  const doNotDisturbLabel = doNotDisturbEnabled
    ? t('screensaver.doNotDisturbActive')
    : t('screensaver.doNotDisturb');

  return (
    <>
      <aside className="room-screensaver__controls" aria-label={t('screensaver.controls')}>
        <span className={`room-screensaver__control-hint${doNotDisturbEnabled ? ' room-screensaver__control-hint--active' : ''}`} data-screensaver-control="dnd" aria-label={doNotDisturbLabel}>
          <Moon size={57} strokeWidth={2} aria-hidden="true" />
          <span>{t('screensaver.doNotDisturb')}</span>
        </span>
        <span className="room-screensaver__control-hint" data-screensaver-control="screen-off" aria-label={t('screensaver.screenOff')}>
          <MonitorOff size={57} strokeWidth={2} aria-hidden="true" />
          <span>{t('screensaver.screenOff')}</span>
        </span>
      </aside>
      {doNotDisturbError !== null && <p className="room-screensaver__control-error" role="alert">{doNotDisturbError}</p>}
    </>
  );
}

function RoomScreensaverWeatherUnavailable({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);

  return (
    <section className="room-screensaver__weather" aria-label={t('screensaver.weather')} data-room-weather="true">
      <p className="room-screensaver__weather-value" data-weather-unavailable="true">{t('screensaver.weatherUnavailable')}</p>
    </section>
  );
}

function RoomScreensaverWeather({ weather, locale }: { weather: DeviceWeatherDTO; locale: Locale }) {
  const t = createTranslator(locale);
  const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const conditionLabel = weather.condition === null ? null : t(WEATHER_CONDITION_LABELS[weather.condition]);

  return (
    <section className="room-screensaver__weather" aria-label={t('screensaver.weather')} data-room-weather="true">
      <div className="room-screensaver__weather-readings">
        {weather.temperatureC !== null && (
          <div className="room-screensaver__weather-reading" role="group" aria-label={`${t('screensaver.temperature')}: ${numberFormat.format(weather.temperatureC)} °C`}>
            <span className="room-screensaver__weather-label">{t('screensaver.temperature')}</span>
            <span className="room-screensaver__weather-value" data-weather-temperature="true">{numberFormat.format(weather.temperatureC)} °C</span>
          </div>
        )}
        {weather.relativeHumidity !== null && (
          <div className="room-screensaver__weather-reading" role="group" aria-label={`${t('screensaver.humidity')}: ${numberFormat.format(weather.relativeHumidity)}%`}>
            <span className="room-screensaver__weather-label">{t('screensaver.humidity')}</span>
            <span className="room-screensaver__weather-value" data-weather-humidity="true">{numberFormat.format(weather.relativeHumidity)}%</span>
          </div>
        )}
        {weather.condition !== null && conditionLabel !== null && (
          <WeatherConditionIcon condition={weather.condition} label={conditionLabel} />
        )}
      </div>
      <p className="room-screensaver__weather-attribution">
        <a href="https://www.met.no/en" target="_blank" rel="noreferrer">MET Norway</a>
        {' · '}<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">{t('screensaver.weatherLicense')}</a>
      </p>
    </section>
  );
}

function WeatherConditionIcon({ condition, label }: { condition: DeviceWeatherCondition; label: string }) {
  const common = { className: 'room-screensaver__weather-icon', viewBox: '0 0 64 64', role: 'img' as const, 'aria-label': label, 'data-weather-condition': condition };
  const cloud = <path d="M18 43h29a10 10 0 0 0 1-20 16 16 0 0 0-30-3A12 12 0 0 0 18 43Z" />;

  switch (condition) {
    case 'clear':
      return <svg {...common}><circle cx="32" cy="31" r="11" /><path d="M32 5v8m0 36v8M5 32h8m38 0h8M13 13l6 6m26 26 6 6m0-38-6 6m-26 26-6 6" /></svg>;
    case 'partly-cloudy':
      return <svg {...common}><circle cx="24" cy="25" r="10" /><path d="M24 7v5m0 26v5M6 25h5m26 0h5m-31-13 4 4m18 18 4 4m0-26-4 4m-18 18-4 4" />{cloud}</svg>;
    case 'cloudy':
      return <svg {...common}>{cloud}</svg>;
    case 'fog':
      return <svg {...common}>{cloud}<path d="M12 50h40M17 57h30" /></svg>;
    case 'rain':
      return <svg {...common}>{cloud}<path d="m22 49-3 7m15-7-3 7m15-7-3 7" /></svg>;
    case 'sleet':
      return <svg {...common}>{cloud}<path d="m21 49-3 7m14-7-3 7m15-7-3 7" /><circle cx="25" cy="57" r="1" /><circle cx="40" cy="57" r="1" /></svg>;
    case 'snow':
      return <svg {...common}>{cloud}<path d="M22 49v10m-4-5h8m8-5v10m-4-5h8m8-5v10m-4-5h8" /></svg>;
    case 'thunderstorm':
      return <svg {...common}>{cloud}<path d="m34 45-8 11h8l-4 7 13-14h-8l4-4" /></svg>;
  }
}

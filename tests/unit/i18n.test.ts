import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  LOCALE_STORAGE_KEY,
  I18nProvider,
  SpanishI18nProvider,
  createTranslator,
  getDocumentMetadata,
  getStoredLocale,
  resolveAreaDescription,
  resolveAreaDisplayName,
  resolveServiceDescription,
  resolveServiceDisplayName,
  resolveLocale,
  saveLocale,
  translateCount,
  useI18n,
  type LocaleStorage
} from '../../apps/web/src/i18n';
import { formatElapsed } from '../../apps/web/src/app-model';

describe('web localization helpers', () => {
  it('pins staff-facing descendants to Spanish while the outer ROOM locale remains English', () => {
    const previousWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: { getItem: () => 'en', setItem: () => undefined } }
    });

    try {
      const markup = renderToStaticMarkup(createElement(I18nProvider, {
        children: createElement(SpanishI18nProvider, { children: createElement(LocaleProbe) })
      }));

      expect(markup).toContain('es:Buenos días, operaciones.');
    } finally {
      if (previousWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
    }
  });

  it('accepts only the supported locales and falls back to English', () => {
    expect(resolveLocale('es')).toBe('es');
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('fr')).toBe('en');
    expect(resolveLocale(undefined)).toBe('en');
  });

  it('translates Spanish labels and interpolated messages', () => {
    const translate = createTranslator('es');

    expect(translate('language.spanish')).toBe('Español');
    expect(translate('requests.waitingToSend', { count: 2 })).toBe('2 solicitudes pendientes de envío.');
    expect(translate('device.nativeDeviceCommandsUnavailable')).toBe('Las acciones de solicitudes no están disponibles en esta consola Android. Usa la consola web para gestionarlas.');
  });

  it('localizes DND activation age and unknown legacy activation time', () => {
    expect(createTranslator('en')('device.doNotDisturbActiveFor', { time: '2h 5m' })).toBe('Active for 2h 5m');
    expect(createTranslator('es')('device.doNotDisturbActiveFor', { time: '2 h 5 min' })).toBe('Activo desde hace 2 h 5 min');
    expect(createTranslator('en')('device.doNotDisturbTimeUnavailable')).toBe('Time unavailable');
    expect(createTranslator('es')('device.doNotDisturbTimeUnavailable')).toBe('Tiempo no disponible');
  });

  it('provides a localized label for horizontally overflowing room services', () => {
    expect(createTranslator('en')('device.moreServices')).toBe('More services');
    expect(createTranslator('es')('device.moreServices')).toBe('Más servicios');
  });

  it('localizes default service labels by stable code while preserving custom names', () => {
    const defaultService = { id: 'svc_default_fresh-towels', code: 'fresh-towels', displayName: 'Fresh towels' };
    const customService = { id: 'svc_custom_late-checkout', code: 'late-checkout', displayName: 'Late checkout' };
    const collidingCustomService = { id: 'svc_custom_fresh-towels', code: 'fresh-towels', displayName: 'Hotel towels' };

    expect(resolveServiceDisplayName(defaultService, 'es')).toBe('Toallas limpias');
    expect(resolveServiceDisplayName(customService, 'es')).toBe('Late checkout');
    expect(resolveServiceDisplayName(collidingCustomService, 'es')).toBe('Hotel towels');
  });

  it('localizes every default service description while preserving custom descriptions', () => {
    const defaultDescriptions = [
      ['front-desk-assistance', 'Reception and general guest assistance', 'Asistencia de recepción y atención general al huésped'],
      ['wake-up-call', 'Scheduled wake-up call', 'Llamada despertador programada'],
      ['fresh-towels', 'Fresh bath towels', 'Toallas de baño limpias'],
      ['room-cleaning', 'Guest room cleaning', 'Limpieza de la habitación'],
      ['extra-room-amenities', 'Additional room amenities', 'Amenidades adicionales para la habitación'],
      ['room-repair', 'Repairs and technical issues', 'Reparaciones y problemas técnicos'],
      ['air-conditioning', 'Air conditioning issue', 'Problema con el aire acondicionado'],
      ['plumbing-issue', 'Plumbing issue', 'Problema de fontanería'],
      ['concierge-assistance', 'Guest assistance and local arrangements', 'Asistencia al huésped y gestiones locales'],
      ['bell-service', 'Luggage and bell service', 'Equipaje y servicio de botones'],
      ['room-service', 'Food and beverages delivered to the room', 'Comida y bebidas entregadas en la habitación'],
      ['breakfast-request', 'Breakfast request', 'Solicitud de desayuno'],
      ['drinks-and-ice', 'Drinks and ice', 'Bebidas y hielo']
    ] as const;

    for (const [code, english, spanish] of defaultDescriptions) {
      const service = { id: `svc_default_${code}`, code, description: english };
      expect(resolveServiceDescription(service, 'en')).toBe(english);
      expect(resolveServiceDescription(service, 'es')).toBe(spanish);
    }

    expect(resolveServiceDescription({
      id: 'svc_custom_fresh-towels',
      code: 'fresh-towels',
      description: 'A custom towel arrangement'
    }, 'es')).toBe('A custom towel arrangement');
  });

  it('localizes every default area label and description while preserving custom areas', () => {
    const defaultAreas = [
      ['front-desk', 'Front Desk', 'Recepción', 'Reception and general guest assistance', 'Recepción y atención general al huésped'],
      ['housekeeping', 'Housekeeping', 'Limpieza', 'Room cleaning and guest-room amenities', 'Limpieza de habitaciones y amenidades para huéspedes'],
      ['maintenance', 'Maintenance', 'Mantenimiento', 'Repairs and technical issues', 'Reparaciones y problemas técnicos'],
      ['concierge', 'Concierge', 'Conserjería', 'Guest assistance, arrivals, and local arrangements', 'Asistencia al huésped, llegadas y gestiones locales'],
      ['food-beverage', 'Food & Beverage', 'Alimentos y bebidas', 'Room service and refreshments', 'Servicio de habitaciones y bebidas']
    ] as const;

    for (const [code, englishName, spanishName, englishDescription, spanishDescription] of defaultAreas) {
      const area = {
        id: `area_default_${code}`,
        code,
        displayName: englishName,
        description: englishDescription
      };
      expect(resolveAreaDisplayName(area, 'en')).toBe(englishName);
      expect(resolveAreaDisplayName(area, 'es')).toBe(spanishName);
      expect(resolveAreaDescription(area, 'en')).toBe(englishDescription);
      expect(resolveAreaDescription(area, 'es')).toBe(spanishDescription);
    }

    const customArea = {
      id: 'area_custom_front-desk',
      code: 'front-desk',
      displayName: 'Guest relations',
      description: 'A custom guest-relations team'
    };
    expect(resolveAreaDisplayName(customArea, 'es')).toBe('Guest relations');
    expect(resolveAreaDescription(customArea, 'es')).toBe('A custom guest-relations team');
  });

  it('persists and reads the selected locale through the browser storage contract', () => {
    const values = new Map<string, string>();
    const storage: LocaleStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    };

    saveLocale(storage, 'es');

    expect(values.get(LOCALE_STORAGE_KEY)).toBe('es');
    expect(getStoredLocale(storage)).toBe('es');
  });

  it('localizes elapsed request ages without changing the default English contract', () => {
    const now = new Date('2026-08-31T12:05:00.000Z');

    expect(formatElapsed('2026-08-31T12:05:00.000Z', now)).toBe('just now');
    expect(formatElapsed('2026-08-31T12:05:00.000Z', now, 'es')).toBe('ahora');
    expect(formatElapsed('2026-08-31T12:03:00.000Z', now, 'es')).toBe('2 min');
    expect(formatElapsed('2026-08-31T10:00:00.000Z', now, 'es')).toBe('2 h 5 min');
  });

  it('uses locale-aware singular and plural count messages', () => {
    expect(translateCount('en', 'device.options', 1)).toBe('1 option');
    expect(translateCount('en', 'device.options', 2)).toBe('2 options');
    expect(translateCount('es', 'admin.services', 1)).toBe('1 servicio');
    expect(translateCount('es', 'admin.services', 2)).toBe('2 servicios');
  });

  it('translates required selection errors', () => {
    expect(createTranslator('es')('errors.requiredSelection', { label: 'área' })).toBe('Selecciona área.');
  });

  it('provides localized document metadata for the active locale', () => {
    expect(getDocumentMetadata('es')).toEqual({
      lang: 'es',
      title: 'Hotel Local App',
      description: 'Consola de operaciones de Hotel Local'
    });
  });
});

function LocaleProbe() {
  const { locale, t } = useI18n();
  return createElement('span', null, `${locale}:${t('admin.overviewTitle')}`);
}

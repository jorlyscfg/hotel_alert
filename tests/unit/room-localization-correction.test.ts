import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DeviceSyncSnapshot, RequestDTO } from '@hotel/shared';
import { describe, expect, it } from 'vitest';
import { DeviceScreen } from '../../apps/web/src/features/device/DeviceScreen';
import {
  createTranslator,
  getDocumentMetadata,
    getLocaleOptions,
    getSupportedLocales,
    resolveAreaDisplayName,
    resolveLocalizedValue,
  resolveRouteLocale,
  resolveServiceDescription,
  resolveServiceDisplayName,
  SpanishI18nProvider,
  syncDocumentMetadata,
  type DocumentMetadataTarget
} from '../../apps/web/src/i18n';

describe('ROOM localization correction', () => {
  it('derives supported locales, native selector labels, and catalogs from one registry', () => {
    expect(getSupportedLocales()).toEqual(['en', 'es']);
    expect(getLocaleOptions()).toEqual([
      { value: 'en', label: 'English' },
      { value: 'es', label: 'Español' }
    ]);

    for (const locale of getSupportedLocales()) {
      expect(createTranslator(locale)('language.label')).toBe(locale === 'en' ? 'Language' : 'Idioma');
    }
  });

  it('assigns English metadata only to ROOM and restores Spanish for every staff route', () => {
    const roomDocument = createMetadataTarget();
    syncDocumentMetadata(roomDocument, resolveRouteLocale('room', 'en'));
    expect(readMetadata(roomDocument)).toEqual(getDocumentMetadata('en'));

    for (const route of ['loading', 'bootstrap', 'area', 'admin'] as const) {
      const staffDocument = createMetadataTarget();
      syncDocumentMetadata(staffDocument, resolveRouteLocale(route, 'en'));
      expect(readMetadata(staffDocument)).toEqual(getDocumentMetadata('es'));
    }
  });

  it('uses explicit ROOM text variants and falls back to canonical source text', () => {
    expect(resolveLocalizedValue('Habitación 101', 'en', { en: 'Room 101' })).toBe('Room 101');
    expect(resolveLocalizedValue('Habitación 101', 'fr', { en: 'Room 101' })).toBe('Habitación 101');
    expect(resolveLocalizedValue('Canonical source', 'en', { en: '   ' })).toBe('Canonical source');
    expect(resolveLocalizedValue(null, 'en', { en: 'Translated description' })).toBeNull();

    expect(resolveServiceDisplayName({
      id: 'svc_custom_breakfast',
      code: 'breakfast-request',
      displayName: 'Solicitud de desayuno personalizada',
      displayNameVariants: { en: 'Custom breakfast request' }
    }, 'en')).toBe('Custom breakfast request');
    expect(resolveServiceDisplayName({
      id: 'svc_custom_breakfast',
      code: 'breakfast-request',
      displayName: 'Solicitud de desayuno personalizada'
    }, 'en')).toBe('Solicitud de desayuno personalizada');
    expect(resolveServiceDescription({
      id: 'svc_custom_breakfast',
      code: 'breakfast-request',
      description: 'Descripción de desayuno personalizada',
      descriptionVariants: { en: 'Custom breakfast description' }
    }, 'en')).toBe('Custom breakfast description');
    expect(resolveServiceDisplayName({
      id: 'svc_default_fresh-towels',
      code: 'fresh-towels',
      displayName: 'Nombre almacenado alterado',
      displayNameVariants: { es: 'Toallas traducidas por datos' }
    }, 'es')).toBe('Toallas limpias');
  });

  it('uses localized compact request values while keeping AREA staff UI Spanish-only', () => {
    const request = createAreaRequest();
    const snapshot = createAreaSnapshot(request);
    const markup = renderToStaticMarkup(createElement(SpanishI18nProvider, {
      children: createElement(DeviceScreen, {
        snapshot,
        deviceToken: 'device-token',
        connectionStatus: 'online',
        onRefresh: async () => undefined,
        onOpenAdmin: () => undefined,
        onAuthFailure: () => undefined
      })
    }));

    expect(markup).toContain('Consola de área');
    expect(markup).toContain('Nombre de servicio');
    expect(markup).toContain('Habitación 101');
    expect(markup).not.toContain('language-selector');
  });

  it('localizes a built-in AREA label from its stable identity', () => {
    const request = createAreaRequest();
    const snapshot = createAreaSnapshot(request);
    snapshot.config.area = { id: 'area_default_front-desk', code: 'front-desk', displayName: 'Front Desk' };
    const markup = renderToStaticMarkup(createElement(SpanishI18nProvider, {
      children: createElement(DeviceScreen, {
        snapshot,
        deviceToken: 'device-token',
        connectionStatus: 'online',
        onRefresh: async () => undefined,
        onOpenAdmin: () => undefined,
        onAuthFailure: () => undefined
      })
    }));

    expect(resolveAreaDisplayName(snapshot.config.area, 'es')).toBe('Recepción');
    expect(markup).toContain('Recepción');
    expect(markup).not.toContain('Front Desk');
  });
});

function createMetadataTarget(): DocumentMetadataTarget & { description: string } {
  const target: DocumentMetadataTarget & { description: string } = {
    title: '',
    description: '',
    documentElement: { lang: '' },
    querySelector: () => ({
      setAttribute: (_name: string, value: string): void => {
        target.description = value;
      }
    })
  };
  return target;
}

function readMetadata(target: DocumentMetadataTarget & { description: string }): { lang: string; title: string; description: string } {
  return { lang: target.documentElement.lang, title: target.title, description: target.description };
}

function createAreaRequest(): RequestDTO {
  return {
    id: 'request-1',
    roomId: 'room-1',
    serviceId: 'service-1',
    responsibleAreaId: 'area-1',
    room: {
      id: 'room-1',
      code: '101',
      displayName: 'Habitación canónica',
      displayNameVariants: { es: 'Habitación 101' },
      doNotDisturb: false
    },
    service: {
      id: 'service-1',
      code: 'custom-service',
      displayName: 'Nombre de servicio',
      displayNameVariants: { es: 'Nombre de servicio' },
      iconKey: 'bell'
    },
    responsibleArea: { id: 'area-1', code: 'front-desk', displayName: 'Recepción' },
    status: 'PENDING',
    version: 1,
    createdAt: '2026-08-31T12:05:00.000Z',
    acceptedAt: null,
    inProgressAt: null,
    completedAt: null,
    updatedAt: '2026-08-31T12:05:00.000Z'
  };
}

function createAreaSnapshot(request: RequestDTO): DeviceSyncSnapshot {
  return {
    snapshotSequence: 1,
    currentEventSequence: 1,
    configurationRevision: 1,
    deviceConfigVersion: 1,
    serverTime: '2026-08-31T12:05:00.000Z',
    device: {
      id: 'device-1',
      installationId: 'installation-1',
      displayName: 'Tableta de área',
      displayNameVariants: { es: 'Tableta de área' },
      assignmentMode: 'AREA',
      roomId: null,
      areaId: 'area-1',
      active: true,
      deviceConfigVersion: 1,
      lastHeartbeatAt: '2026-08-31T12:05:00.000Z',
      presence: 'ONLINE'
    },
    config: {
      mode: 'AREA',
      room: null,
      area: { id: 'area-1', code: 'front-desk', displayName: 'Recepción' },
      services: [],
      hotelName: 'Hotel canónico',
      hotelLogo: null,
      roomBackground: null,
      clockFormat: '12h',
      offlineQueueTtlHours: 24,
      heartbeatIntervalMs: 15_000,
      heartbeatStaleAfterMs: 45_000,
      heartbeatOfflineAfterMs: 120_000,
      pendingAlertIntervalMs: 5_000
    },
    activeRequests: [request],
    pendingTokenRotation: null
  };
}

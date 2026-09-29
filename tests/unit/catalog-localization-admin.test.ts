import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AreaDTO, ServiceDTO } from '@hotel/shared';
import { CreateAreaForm, CreateServiceForm } from '../../apps/web/src/features/admin/AdminScreen';
import { AreaEditForm, CatalogPanels, getMissingEnglishCatalogFields, ServiceEditForm } from '../../apps/web/src/features/admin/SetupPanels';
import { SpanishI18nProvider } from '../../apps/web/src/i18n';
import { describe, expect, it } from 'vitest';

const legacyArea: AreaDTO = {
  id: 'area-night-cleaning',
  code: 'night-cleaning',
  displayName: 'Limpieza nocturna',
  description: 'Limpieza de habitaciones durante la noche',
  displayOrder: 1,
  active: true,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z'
};

const legacyService: ServiceDTO = {
  id: 'svc-crib',
  code: 'crib',
  displayName: 'Preparar cuna',
  description: 'Solicitar una cuna para bebé',
  iconKey: 'bell',
  areaId: legacyArea.id,
  active: true,
  displayOrder: 1,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z'
};

function renderSpanish(node: ReactNode): string {
  return renderToStaticMarkup(createElement(SpanishI18nProvider, { children: node }));
}

describe('Admin bilingual guest catalog forms', () => {
  it('requires English guest-facing names and exposes editable English fields for both catalog types', () => {
    const createAreaMarkup = renderSpanish(createElement(CreateAreaForm, { busy: false, onSubmit: async () => true }));
    const createServiceMarkup = renderSpanish(createElement(CreateServiceForm, { areas: [legacyArea], busy: false, onSubmit: async () => true }));
    const editAreaMarkup = renderSpanish(createElement(AreaEditForm, { area: legacyArea, busy: false, onCancel: () => undefined, onSubmit: async () => true }));
    const editServiceMarkup = renderSpanish(createElement(ServiceEditForm, { service: legacyService, areas: [legacyArea], busy: false, onCancel: () => undefined, onSubmit: async () => true }));

    for (const markup of [createAreaMarkup, createServiceMarkup, editAreaMarkup, editServiceMarkup]) {
      expect(markup).toContain('Nombre visible (inglés)');
      expect(markup).toContain('Descripción (inglés)');
    }
    expect(createAreaMarkup).toMatch(/Nombre visible \(inglés\)<\/label><input[^>]*required=""/);
    expect(createServiceMarkup).toMatch(/Nombre visible \(inglés\)<\/label><input[^>]*required=""/);
    expect(editAreaMarkup).toMatch(/Descripción \(inglés\)<\/label><input[^>]*required=""/);
    expect(editServiceMarkup).toMatch(/Descripción \(inglés\)<\/label><input[^>]*required=""/);
  });

  it('shows actionable missing-English warnings for legacy custom areas and services, but not built-ins', () => {
    expect(getMissingEnglishCatalogFields(legacyArea)).toEqual(['name', 'description']);
    expect(getMissingEnglishCatalogFields(legacyService)).toEqual(['name', 'description']);
    expect(getMissingEnglishCatalogFields({ ...legacyArea, id: 'area_default_front-desk', code: 'front-desk' })).toEqual([]);

    const areasMarkup = renderSpanish(createElement(CatalogPanels, {
      resource: 'areas', rooms: [], areas: [legacyArea], services: [], busy: false,
      onToggleRoom: async () => undefined,
      onPatchRoom: async () => true,
      onToggleArea: async () => undefined,
      onPatchArea: async () => true,
      onToggleService: async () => undefined,
      onPatchService: async () => true
    }));
    const servicesMarkup = renderSpanish(createElement(CatalogPanels, {
      resource: 'services', rooms: [], areas: [legacyArea], services: [legacyService], busy: false,
      onToggleRoom: async () => undefined,
      onPatchRoom: async () => true,
      onToggleArea: async () => undefined,
      onPatchArea: async () => true,
      onToggleService: async () => undefined,
      onPatchService: async () => true
    }));

    expect(areasMarkup.match(/Falta la traducción al inglés/g)).toHaveLength(2);
    expect(servicesMarkup.match(/Falta la traducción al inglés/g)).toHaveLength(2);
    expect(areasMarkup).toContain('Nombre visible (inglés)');
    expect(areasMarkup).toContain('Descripción (inglés)');
  });
});

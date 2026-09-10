import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AdminSystemSnapshot } from '@hotel/shared';
import { AdminScreen, adminWarningLabel, actorTypeLabel, auditActionLabel, devicePresenceLabel, entityTypeLabel, formatAdminRoomAreaCounts, SETUP_SECTIONS, SetupTab } from '../../apps/web/src/features/admin/AdminScreen';
import { getServiceIconLabelKey, SERVICE_ICON_OPTIONS } from '../../apps/web/src/features/admin/SetupPanels';
import { createTranslator, I18nProvider, SpanishI18nProvider } from '../../apps/web/src/i18n';
import { describe, expect, it } from 'vitest';

const snapshot: AdminSystemSnapshot = {
  configurationRevision: 1,
  rooms: [{ id: 'room-1', code: '101', displayName: 'Room 101', floor: '1', displayOrder: 1, active: true, createdAt: '2026-08-31T10:00:00.000Z', updatedAt: '2026-08-31T10:00:00.000Z' }],
  areas: [],
  services: [],
  devices: [{ id: 'device-1', installationId: 'install-1', displayName: 'Room 101 tablet', assignmentMode: 'ROOM', roomId: '101', areaId: null, active: true, deviceConfigVersion: 1, lastHeartbeatAt: '2026-08-31T10:00:00.000Z', presence: 'ONLINE' }],
  requests: [],
  admins: [],
  settings: [],
  auditLog: [{ id: 1, actorType: 'SYSTEM', actorId: null, action: 'ROOM_CREATED', entityType: 'ROOM', entityId: 'room-1', requestId: null, metadata: null, createdAt: '2026-08-31T10:00:00.000Z' }],
  outboxBacklog: 0,
  warnings: []
};

describe('admin dynamic localization', () => {
  it('keeps the Admin view in Spanish after ROOM selects English', () => {
    const previousWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: { getItem: () => 'en', setItem: () => undefined } }
    });

    try {
       const markup = renderToStaticMarkup(createElement(I18nProvider, {
         children: createElement(SpanishI18nProvider, {
           children: createElement(AdminScreen, {
             snapshot,
             csrfToken: 'csrf-token',
             installationId: 'install-1',
             connectionStatus: 'online',
             onRefresh: async () => undefined,
             onLogout: async () => undefined,
             onUseDeviceToken: async () => undefined
           })
         })
       }));

      expect(markup).toContain('Buenos días, operaciones.');
      expect(markup).not.toContain('Good morning, operations.');
      expect(markup).not.toContain('language-selector');
    } finally {
      if (previousWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
    }
  });

  it('renders independent configuration sections behind an accessible tablist', () => {
    const markup = renderToStaticMarkup(createElement(SetupTab, {
      snapshot,
      busy: false,
      initialInstallationId: 'install-1',
      onCreateRoom: async () => true,
      onCreateArea: async () => true,
      onCreateService: async () => true,
      onProvisionDevice: async () => true,
      onToggleDevice: async () => undefined,
      onRotateToken: async () => undefined,
      onRebindDevice: async () => true,
      onToggleRoom: async () => undefined,
      onPatchRoom: async () => true,
      onToggleArea: async () => undefined,
      onPatchArea: async () => true,
      onToggleService: async () => undefined,
      onPatchService: async () => true,
      onSaveSettings: async () => undefined,
      onCreateAdmin: async () => true,
      onToggleAdmin: async () => undefined,
      onRevokeToken: async () => undefined,
      onAssignDevice: async () => true
    }));

    expect(SETUP_SECTIONS).toEqual(['rooms', 'areas', 'services', 'devices', 'settings', 'admins']);
    expect(markup.match(/role="tab"/g)).toHaveLength(SETUP_SECTIONS.length);
    expect(markup.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(markup).toContain('role="tabpanel"');
    expect(markup).toContain('id="setup-panel-rooms"');
    expect(markup).toContain('id="catalog-rooms"');
    expect(markup).not.toContain('id="catalog-areas"');
    expect(markup).not.toContain('id="catalog-services"');
    expect(markup).not.toContain('id="device-management-title"');
    expect(markup).not.toContain('id="settings-title"');
    expect(markup).not.toContain('id="admin-management-title"');
  });

  it('renders human-readable labels for enum-backed presence and audit values', () => {
    const markup = renderToStaticMarkup(createElement(AdminScreen, {
      snapshot,
      csrfToken: 'csrf-token',
      installationId: 'install-1',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onLogout: async () => undefined,
      onUseDeviceToken: async () => undefined
    }));

    expect(markup).toContain('class="presence-status">Online</span>');
    expect(markup).toContain('>Room created</strong>');
    expect(markup).not.toContain('class="presence-status">online</span>');
    expect(markup).not.toContain('>ROOM CREATED</strong>');
  });

  it('translates dynamic labels in Spanish and keeps unknown actions readable', () => {
    expect(devicePresenceLabel('OFFLINE', 'es')).toBe('Sin conexión');
    expect(actorTypeLabel('DEVICE', 'es')).toBe('Dispositivo');
    expect(entityTypeLabel('REQUEST', 'es')).toBe('Solicitud');
    expect(auditActionLabel('ROOM_CREATED', 'es')).toBe('Habitación creada');
    expect(auditActionLabel('CUSTOM_EVENT', 'es')).toBe('Acción desconocida: Custom event');
  });

  it('localizes configuration warnings without exposing server warning codes', () => {
    const markup = renderToStaticMarkup(createElement(AdminScreen, {
      snapshot: { ...snapshot, warnings: ['NO_ACTIVE_AREAS'] },
      csrfToken: 'csrf-token',
      installationId: 'install-1',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onLogout: async () => undefined,
      onUseDeviceToken: async () => undefined
    }));

    expect(markup).toContain('No active operational areas are configured.');
    expect(markup).not.toContain('NO_ACTIVE_AREAS');
    expect(adminWarningLabel('NO_ACTIVE_AREAS', 'es')).toBe('No hay áreas operativas activas configuradas.');
  });

  it('marks the presence indicator as decorative because the status has text', () => {
    const markup = renderToStaticMarkup(createElement(AdminScreen, {
      snapshot,
      csrfToken: 'csrf-token',
      installationId: 'install-1',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onLogout: async () => undefined,
      onUseDeviceToken: async () => undefined
    }));

    expect(markup).toContain('class="presence-dot presence-dot--online" aria-hidden="true"');
  });

  it('uses an accessible icon-only logout control', () => {
    const markup = renderToStaticMarkup(createElement(AdminScreen, {
      snapshot,
      csrfToken: 'csrf-token',
      installationId: 'install-1',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onLogout: async () => undefined,
      onUseDeviceToken: async () => undefined
    }));

    expect(markup).toContain('class="icon-button admin-logout"');
    expect(markup).toContain('aria-label="Sign out"');
    expect(markup).toContain('title="Sign out"');
    expect(markup).not.toContain('>Sign out</button>');
  });

  it('keeps the admin shell quiet and marks the active navigation item', () => {
    const markup = renderToStaticMarkup(createElement(AdminScreen, {
      snapshot,
      csrfToken: 'csrf-token',
      installationId: 'install-1',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onLogout: async () => undefined,
      onUseDeviceToken: async () => undefined
    }));

    expect(markup).not.toContain('class="admin-main" aria-live="polite"');
    expect(markup).toContain('aria-current="page"');
  });

  it('renders desktop and mobile Admin navigation variants for the same tabs', () => {
    const markup = renderToStaticMarkup(createElement(AdminScreen, {
      snapshot,
      csrfToken: 'csrf-token',
      installationId: 'install-1',
      connectionStatus: 'online',
      onRefresh: async () => undefined,
      onLogout: async () => undefined,
      onUseDeviceToken: async () => undefined
    }));

    expect(markup).toContain('data-admin-navigation="desktop"');
    expect(markup).toContain('data-admin-navigation="mobile"');
    expect(markup.match(/data-admin-nav-item="(overview|queue|setup|audit)"/g)).toHaveLength(8);
    expect(markup.match(/aria-current="page"/g)).toHaveLength(2);
  });

  it('translates setup examples and service icon labels', () => {
    const translate = createTranslator('es');

    expect(translate('admin.roomNamePlaceholder')).toBe('Habitación 101');
    expect(translate('admin.areaDescriptionPlaceholder')).toBe('El equipo detrás de alimentos y bebidas');
    expect(translate('admin.serviceNamePlaceholder')).toBe('Salida tardía');
    expect(translate('admin.stationNamePlaceholder')).toBe('Tableta de la habitación 101');
    expect(translate('admin.iconHousekeeping')).toBe('Limpieza');
    expect(translate(getServiceIconLabelKey('housekeeping'))).toBe('Limpieza');
  });

  it('keeps every service creation icon option paired with a rendered icon', () => {
    expect(SERVICE_ICON_OPTIONS).toHaveLength(8);
    expect(SERVICE_ICON_OPTIONS.every((option) => option.icon !== undefined)).toBe(true);
    const markup = renderToStaticMarkup(createElement('div', null, SERVICE_ICON_OPTIONS.map((option) => createElement('span', { key: option.value }, option.icon))));
    expect(markup.match(/<svg/g)).toHaveLength(8);
  });

  it('uses singular and plural room and area labels in each locale', () => {
    expect(formatAdminRoomAreaCounts('en', 1, 1)).toBe('1 room · 1 area');
    expect(formatAdminRoomAreaCounts('en', 2, 3)).toBe('2 rooms · 3 areas');
    expect(formatAdminRoomAreaCounts('es', 1, 1)).toBe('1 habitación · 1 área');
    expect(formatAdminRoomAreaCounts('es', 2, 3)).toBe('2 habitaciones · 3 áreas');
  });
});

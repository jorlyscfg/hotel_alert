import { describe, expect, it } from 'vitest';
import type { AdminSystemSnapshot, RequestDTO } from '@hotel/shared';
import { AdminConfirmationDialog, AdminScreen, filterAdminRequests, type AdminRequestFilters } from '../../apps/web/src/features/admin/AdminScreen';
import { buildSettingsChanges, CatalogPanels, SettingsPanel } from '../../apps/web/src/features/admin/SetupPanels';
import { I18nProvider } from '../../apps/web/src/i18n';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

describe('admin request filters', () => {
  it('serializes cleared branding images as null settings', () => {
    expect(buildSettingsChanges([
      { key: 'hotelLogo', value: 'data:image/png;base64,AAAA', updatedAt: '2026-08-31T09:05:00.000Z', updatedByAdminId: null },
      { key: 'roomBackground', value: 'data:image/png;base64,BBBB', updatedAt: '2026-08-31T09:05:00.000Z', updatedByAdminId: null }
    ], { hotelLogo: '', roomBackground: '' })).toEqual({ hotelLogo: null, roomBackground: null });
  });

  it('renders a localized room background upload control', () => {
    const roomBackgroundVariants = {
      square480: 'data:image/webp;base64,SQUARE',
      tablet: 'data:image/webp;base64,TABLET'
    };
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(SettingsPanel, {
        settings: [{ key: 'roomBackground', value: roomBackgroundVariants, updatedAt: '2026-08-31T09:05:00.000Z', updatedByAdminId: null } as never],
        busy: false,
        onSave: async () => undefined
      })
    }));

    expect(markup).toContain('setting-roomBackground');
    expect(markup).toContain('Room background');
    expect(markup).toContain('data:image/webp;base64,SQUARE');
    expect(markup).not.toContain('[object Object]');
  });

  it('combines status, device, date range, and search filters', () => {
    const requests = [
      makeRequest({
        id: 'matching-request',
        status: 'IN_PROGRESS',
        createdByDeviceId: 'device-101',
        createdAt: '2026-08-15T09:00:00.000Z',
        room: { id: 'room-101', code: '101', displayName: 'Room 101' },
        service: { id: 'service-towels', code: 'towels', displayName: 'Fresh towels', iconKey: 'towels' }
      }),
      makeRequest({
        id: 'wrong-device',
        status: 'IN_PROGRESS',
        createdByDeviceId: 'device-202',
        createdAt: '2026-08-15T09:00:00.000Z'
      }),
      makeRequest({
        id: 'outside-range',
        status: 'IN_PROGRESS',
        createdByDeviceId: 'device-101',
        createdAt: '2026-09-01T09:00:00.000Z'
      })
    ];
    const filters: AdminRequestFilters = {
      status: 'IN_PROGRESS',
      roomId: '',
      serviceId: '',
      areaId: '',
      deviceId: 'device-101',
      from: '2026-08-01',
      to: '2026-08-31',
      search: 'fresh towels'
    };

    expect(filterAdminRequests(requests, filters).map((request) => request.id)).toEqual(['matching-request']);
  });

  it('shows the room do-not-disturb state in the room catalog', () => {
    const room = {
      id: 'room-101',
      code: '101',
      displayName: 'Room 101',
      floor: '1',
      displayOrder: 1,
      active: true,
      doNotDisturb: true,
      createdAt: '2026-08-15T09:00:00.000Z',
      updatedAt: '2026-08-15T09:00:00.000Z'
    };
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(CatalogPanels, {
        resource: 'rooms',
        rooms: [room],
        areas: [],
        services: [],
        busy: false,
        onToggleRoom: async () => undefined,
        onPatchRoom: async () => true,
        onToggleArea: async () => undefined,
        onPatchArea: async () => true,
        onToggleService: async () => undefined,
        onPatchService: async () => true
      })
    }));

    expect(markup).toContain('room-dnd-status');
    expect(markup).toContain('Do not disturb');
    expect(markup).toContain('lucide-moon');
  });

  it('uses library icons for administrative navigation and actions', () => {
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(AdminScreen, {
        snapshot: createAdminSnapshot(),
        csrfToken: 'csrf-token',
        installationId: null,
        connectionStatus: 'online',
        onRefresh: async () => undefined,
        onLogout: async () => undefined,
        onUseDeviceToken: async () => undefined
      })
    }));

    expect(markup).toContain('lucide-log-out');
    expect(markup).toContain('lucide-layout-dashboard');
    expect(markup).toContain('lucide-list');
    expect(markup).toContain('lucide-panels-top-left');
    expect(markup).toContain('lucide-scroll-text');
    expect(markup).not.toMatch(/>◉<|>≡<|>＋<|>⌁<|>↪<\/span>/);
  });

  it('renders the Admin confirmation as a constrained, targetable modal', () => {
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(AdminConfirmationDialog, {
        title: 'Deactivate room',
        copy: 'Guests will no longer be able to request services from this room.',
        danger: true,
        busy: false,
        onClose: () => undefined,
        onConfirm: () => undefined
      })
    }));

    expect(markup).toContain('admin-confirmation-modal');
    expect(markup).toContain('Deactivate room');
    expect(markup).toContain('Guests will no longer be able to request services from this room.');
    expect(markup).toContain('button--danger');
  });

  it('uses the configured clock format for administrative timestamps', () => {
    const snapshot = createAdminSnapshot();
    snapshot.settings = [{ key: 'clockFormat', value: '24h', updatedAt: '2026-08-31T09:05:00.000Z', updatedByAdminId: null }];
    snapshot.auditLog = [{
      id: 1,
      actorType: 'SYSTEM',
      actorId: null,
      action: 'SETTINGS_UPDATED',
      entityType: 'SYSTEM',
      entityId: null,
      requestId: null,
      metadata: null,
      createdAt: '2026-08-31T09:05:00.000Z'
    }];
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(AdminScreen, {
        snapshot,
        csrfToken: 'csrf-token',
        installationId: null,
        connectionStatus: 'online',
        onRefresh: async () => undefined,
        onLogout: async () => undefined,
        onUseDeviceToken: async () => undefined
      })
    }));

    expect(markup).toMatch(/Aug 31.*\d{2}:\d{2}/);
    expect(markup).not.toMatch(/Aug 31.*[AP]M/);
  });
});

function createAdminSnapshot(): AdminSystemSnapshot {
  return {
    configurationRevision: 1,
    rooms: [],
    areas: [],
    services: [],
    devices: [],
    requests: [],
    admins: [],
    settings: [],
    auditLog: [],
    outboxBacklog: 0,
    warnings: []
  };
}

function makeRequest(overrides: Partial<RequestDTO>): RequestDTO {
  return {
    id: 'request-default',
    roomId: 'room-default',
    serviceId: 'service-default',
    responsibleAreaId: 'area-default',
    room: { id: 'room-default', code: '101', displayName: 'Room 101' },
    service: { id: 'service-default', code: 'default', displayName: 'Default service', iconKey: null },
    responsibleArea: { id: 'area-default', code: 'housekeeping', displayName: 'Housekeeping' },
    status: 'PENDING',
    version: 1,
    createdAt: '2026-08-15T09:00:00.000Z',
    acceptedAt: null,
    inProgressAt: null,
    completedAt: null,
    updatedAt: '2026-08-15T09:00:00.000Z',
    ...overrides
  };
}

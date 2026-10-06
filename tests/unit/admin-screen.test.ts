import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AdminSystemSnapshot, InformationImageDTO, RequestDTO } from '@hotel/shared';
import { AdminConfirmationDialog, AdminScreen, DeviceManagement, filterAdminRequests, SETUP_SECTIONS, SetupTab, type AdminRequestFilters } from '../../apps/web/src/features/admin/AdminScreen';
import { getMissingInformationImageVariantFields, INFORMATION_IMAGE_UPLOAD_FIELDS, InformationImageSourceField, InformationPanel } from '../../apps/web/src/features/admin/InformationPanel';
import { buildSettingsChanges, CatalogPanels, SettingsPanel } from '../../apps/web/src/features/admin/SetupPanels';
import { filterAdminItems } from '../../apps/web/src/features/admin/admin-search';
import { I18nProvider, SpanishI18nProvider } from '../../apps/web/src/i18n';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as adminScreenModule from '../../apps/web/src/features/admin/AdminScreen';

const validateAdminPasswordChangeInput = (adminScreenModule as unknown as {
  validateAdminPasswordChangeInput?: (currentPassword: string, newPassword: string, confirmation: string) => string | null;
}).validateAdminPasswordChangeInput;

const informationPanelSource = readFileSync(fileURLToPath(new URL('../../apps/web/src/features/admin/InformationPanel.tsx', import.meta.url)), 'utf8');
const adminScreenSource = readFileSync(fileURLToPath(new URL('../../apps/web/src/features/admin/AdminScreen.tsx', import.meta.url)), 'utf8');
const stylesSource = readFileSync(fileURLToPath(new URL('../../apps/web/src/styles.css', import.meta.url)), 'utf8');

describe('admin request filters', () => {
  it.each([
    ['', 'replacement-password', 'replacement-password', 'currentPasswordRequired'],
    ['current-password', 'short', 'short', 'passwordTooShort'],
    ['current-password', 'replacement-password', 'different-password', 'passwordConfirmationMismatch']
  ])('validates administrator password changes before submission', (currentPassword, newPassword, confirmation, expectedError) => {
    expect(validateAdminPasswordChangeInput?.(currentPassword, newPassword, confirmation)).toBe(expectedError);
  });

  it('accepts matching administrator passwords that satisfy the server length limits', () => {
    expect(validateAdminPasswordChangeInput?.('admin', 'replacement-password', 'replacement-password')).toBeNull();
    expect(validateAdminPasswordChangeInput?.('current-password', 'x'.repeat(256), 'x'.repeat(256))).toBeNull();
  });

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
        onSave: async () => undefined,
        onUploadRoomBackground: async () => true
      })
    }));

    expect(markup).toContain('setting-roomBackground');
    expect(markup).toContain('Room background');
    expect(markup).toContain('data:image/webp;base64,SQUARE');
    expect(markup).toContain('accept="image/*"');
    expect(markup).toContain('The server prepares square and tablet versions for room displays.');
    expect(markup).not.toContain('120 KB');
    expect(markup).not.toContain('[object Object]');
  });

  it('renders ordered information images with accessible controls', () => {
    const images: InformationImageDTO[] = [{
      id: 'information_image-1',
      originalName: 'pool.png',
      mimeType: 'image/png',
      byteSize: 2048,
      displayOrder: 0,
      createdAt: '2026-09-11T09:00:00.000Z',
      updatedAt: '2026-09-11T09:00:00.000Z'
    }];
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(InformationPanel, {
        images,
        busy: false,
        onUpload: async () => true,
        onRepair: async () => true,
        onDelete: async () => true,
        onReorder: async () => true
      })
    }));

    expect(markup).toContain('Information');
    expect(markup).toContain('/api/v1/information/images/information_image-1/content');
    expect(markup).toContain('Move image up');
    expect(markup).toContain('title="Move image up"');
    expect(markup).toContain('Move image down');
    expect(markup).toContain('title="Move image down"');
    expect(markup).toContain('Delete image');
    expect(markup).toContain('title="Delete image"');
  });

  it('renders one source image field for both new information and legacy-image repair', () => {
    expect(INFORMATION_IMAGE_UPLOAD_FIELDS).toEqual(['image']);
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(InformationImageSourceField, {
        files: null, inputRef: { current: null }, disabled: false, onFileChange: () => undefined
      })
    }));

    expect(markup).toContain('name="image"');
    expect(markup).toContain('Source image');
    expect(markup.match(/type="file"/g)).toHaveLength(1);
    expect(markup.match(/accept="image\/\*"/g)).toHaveLength(1);
    expect(markup).not.toContain('accept="image/png,image/jpeg,image/webp"');
    expect(informationPanelSource.match(/<InformationImageSourceField/g)).toHaveLength(2);
    expect(informationPanelSource).toContain('data-admin-information-upload-form="true"');
    expect(informationPanelSource).toContain('data-admin-information-repair-form="true"');
  });

  it('shows a visible warning when localized legacy artwork has not been converted to shared variants', () => {
    const legacyImage: InformationImageDTO = {
      id: 'legacy-information-image', originalName: 'welcome.png', mimeType: 'image/png', byteSize: 128, displayOrder: 0,
      createdAt: '2026-09-11T09:00:00.000Z', updatedAt: '2026-09-11T09:00:00.000Z',
      variants: [
        { language: 'en', variant: 'wide', originalName: 'welcome-en-wide.png', mimeType: 'image/png', byteSize: 128 },
        { language: 'es', variant: 'wide', originalName: 'welcome-es-wide.png', mimeType: 'image/png', byteSize: 128 }
      ]
    };
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(InformationPanel, {
        images: [legacyImage], busy: false, onUpload: async () => true, onRepair: async () => true,
        onDelete: async () => true, onReorder: async () => true
      })
    }));

    expect(getMissingInformationImageVariantFields(legacyImage)).toEqual(['square480', 'wide']);
    expect(markup).toContain('role="status"');
    expect(markup).toContain('Missing shared image sizes:');
    expect(markup).toContain('Compact image (square480)');
    expect(markup).toContain('Wide image');
    expect(markup).toContain('current image remains available as a fallback');
  });

  it('uses one hidden source input with an accessible upload control', () => {
    expect(informationPanelSource.match(/className="visually-hidden branding-file-input"/g)).toHaveLength(1);
    expect(informationPanelSource.match(/className="icon-button branding-upload-button"/g)).toHaveLength(1);
    expect(informationPanelSource).toContain('name="image"');
    expect(informationPanelSource).toContain('inputRef.current?.click()');
    expect(informationPanelSource).not.toContain('informationLanguageEnglish');
    expect(informationPanelSource).not.toContain('informationLanguageSpanish');
    expect(stylesSource).not.toContain('.information-upload__grid input[type="file"]');
  });

  it('renders Information timing controls in an accessible settings modal outside Runtime policy', () => {
    const settings = [
      { key: 'information.idleTimeoutSeconds', value: 12, updatedAt: '2026-09-11T09:00:00.000Z', updatedByAdminId: null },
      { key: 'information.slideIntervalSeconds', value: 18, updatedAt: '2026-09-11T09:00:00.000Z', updatedByAdminId: null }
    ] as const;
    const informationMarkup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(InformationPanel, {
        images: [],
        settings: [...settings],
        busy: false,
        onSaveSettings: async () => undefined,
        onUpload: async () => true,
        onRepair: async () => true,
        onDelete: async () => true,
        onReorder: async () => true
      })
    }));
    const runtimePolicyMarkup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(SettingsPanel, {
        settings: [...settings],
        busy: false,
        onSave: async () => undefined,
        onUploadRoomBackground: async () => true
      })
    }));

    expect(informationMarkup).not.toContain('data-admin-information-timing="true"');
    expect(informationMarkup).not.toContain('id="information-idle-timeout-seconds"');
    expect(informationMarkup).not.toContain('id="information-slide-interval-seconds"');
    expect(informationMarkup).toContain('data-admin-information-settings="true"');
    expect(informationMarkup).toContain('aria-label="Configure information display"');
    expect(informationMarkup).toContain('title="Configure information display"');
    expect(informationMarkup).toContain('lucide-settings-2');
    expect(informationMarkup).toContain('data-admin-information-upload="true"');
    expect(informationMarkup).toContain('aria-label="Upload image"');
    expect(informationMarkup).toContain('title="Upload image"');
    expect(informationMarkup).toContain('lucide-upload');
    expect(informationMarkup).not.toContain('>Upload image</button>');
    expect(informationPanelSource).toContain('<Modal');
    expect(informationPanelSource).toContain('data-admin-information-timing="true"');
    expect(informationPanelSource).toContain('id="information-idle-timeout-seconds"');
    expect(informationPanelSource).toContain('id="information-slide-interval-seconds"');
    expect(informationPanelSource).toContain('min="1" max="300"');
    expect(informationPanelSource).toContain('value={idleTimeoutSeconds}');
    expect(informationPanelSource).toContain('value={slideIntervalSeconds}');
    expect(informationPanelSource).toContain('const result = await onSaveSettings({');
    expect(informationPanelSource).toContain('if (result !== false) setTimingOpen(false);');
    expect(informationPanelSource).not.toContain('busyRef');

    const uploadIndex = informationMarkup.indexOf('data-admin-information-upload="true"');
    const settingsIndex = informationMarkup.indexOf('data-admin-information-settings="true"');
    const countIndex = informationMarkup.indexOf('data-admin-information-count="true"');
    expect(uploadIndex).toBeGreaterThanOrEqual(0);
    expect(settingsIndex).toBeGreaterThan(uploadIndex);
    expect(countIndex).toBeGreaterThan(settingsIndex);
    expect(runtimePolicyMarkup).not.toContain('information.idleTimeoutSeconds');
    expect(runtimePolicyMarkup).not.toContain('information.slideIntervalSeconds');
  });

  it('returns the settings mutation result to the Information panel', () => {
    const start = adminScreenSource.indexOf('async function updateSettings');
    const end = adminScreenSource.indexOf('async function uploadInformationImage', start);
    const updateSettingsSource = adminScreenSource.slice(start, end);

    expect(updateSettingsSource).toContain('async function updateSettings(changes: Record<string, unknown>): Promise<boolean>');
    expect(updateSettingsSource).toContain('const result = await perform');
    expect(updateSettingsSource).toContain('return mutationSucceeded(result);');
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

  it('matches every queue search term across searchable request fields', () => {
    const requests = [
      makeRequest({
        id: 'cross-field-match',
        room: { id: 'room-101', code: '101', displayName: 'Ocean Suite' },
        service: { id: 'service-towels', code: 'towels', displayName: 'Fresh towels', iconKey: 'towels' },
        responsibleArea: { id: 'area-housekeeping', code: 'housekeeping', displayName: 'Housekeeping' },
        createdByDeviceId: 'device-101'
      }),
      makeRequest({
        id: 'missing-area-term',
        room: { id: 'room-102', code: '102', displayName: 'Garden Room' },
        service: { id: 'service-towels', code: 'towels', displayName: 'Fresh towels', iconKey: 'towels' },
        responsibleArea: { id: 'area-front-desk', code: 'front-desk', displayName: 'Front desk' },
        createdByDeviceId: 'device-102'
      })
    ];
    const filters: AdminRequestFilters = {
      status: 'ALL',
      roomId: '',
      serviceId: '',
      areaId: '',
      deviceId: '',
      from: '',
      to: '',
      search: '101 towels housekeeping device-101'
    };

    expect(filterAdminRequests(requests, filters).map((request) => request.id)).toEqual(['cross-field-match']);
  });

  it('searches default request labels in Spanish while retaining custom catalog text', () => {
    const requests = [
      makeRequest({
        id: 'built-in-labels',
        room: { id: 'room-101', code: '101', displayName: 'Ocean Suite' },
        service: { id: 'svc_default_fresh-towels', code: 'fresh-towels', displayName: 'Fresh towels', iconKey: 'towels' },
        responsibleArea: { id: 'area_default_front-desk', code: 'front-desk', displayName: 'Front Desk' }
      }),
      makeRequest({
        id: 'custom-labels',
        room: { id: 'room-102', code: '102', displayName: 'Garden Room' },
        service: { id: 'svc_custom_fresh-towels', code: 'fresh-towels', displayName: 'Hotel towels', iconKey: 'towels' },
        responsibleArea: { id: 'area_custom_front-desk', code: 'front-desk', displayName: 'Guest relations' }
      })
    ];
    const filters: AdminRequestFilters = {
      status: 'ALL',
      roomId: '',
      serviceId: '',
      areaId: '',
      deviceId: '',
      from: '',
      to: '',
      search: 'recepción toallas'
    };

    expect(filterAdminRequests(requests, filters).map((request) => request.id)).toEqual(['built-in-labels']);
  });

  it('renders localized built-in catalog labels without translating custom labels', () => {
    const areas = [
      { id: 'area_default_front-desk', code: 'front-desk', displayName: 'Front Desk', description: 'Reception and general guest assistance', displayOrder: 10, active: true, createdAt: '2026-08-31T10:00:00.000Z', updatedAt: '2026-08-31T10:00:00.000Z' },
      { id: 'area_custom_front-desk', code: 'front-desk', displayName: 'Guest relations', description: 'A custom guest-relations team', displayOrder: 20, active: true, createdAt: '2026-08-31T10:00:00.000Z', updatedAt: '2026-08-31T10:00:00.000Z' }
    ];
    const services = [
      { id: 'svc_default_fresh-towels', code: 'fresh-towels', displayName: 'Fresh towels', description: 'Fresh bath towels', iconKey: 'towels', areaId: areas[0].id, displayOrder: 10, active: true, createdAt: '2026-08-31T10:00:00.000Z', updatedAt: '2026-08-31T10:00:00.000Z' },
      { id: 'svc_custom_fresh-towels', code: 'fresh-towels', displayName: 'Hotel towels', description: 'A custom towel arrangement', iconKey: 'towels', areaId: areas[1].id, displayOrder: 20, active: true, createdAt: '2026-08-31T10:00:00.000Z', updatedAt: '2026-08-31T10:00:00.000Z' }
    ];
    const callbacks = {
      onToggleRoom: async () => undefined,
      onPatchRoom: async () => true,
      onToggleArea: async () => undefined,
      onPatchArea: async () => true,
      onToggleService: async () => undefined,
      onPatchService: async () => true
    };
    const areaMarkup = renderToStaticMarkup(createElement(SpanishI18nProvider, {
      children: createElement(CatalogPanels, { resource: 'areas', rooms: [], areas, services: [], busy: false, ...callbacks })
    }));
    const serviceMarkup = renderToStaticMarkup(createElement(SpanishI18nProvider, {
      children: createElement(CatalogPanels, { resource: 'services', rooms: [], areas, services, busy: false, ...callbacks })
    }));

    expect(areaMarkup).toContain('Recepción');
    expect(areaMarkup).toContain('Guest relations');
    expect(areaMarkup).not.toContain('Front Desk');
    expect(serviceMarkup).toContain('Toallas limpias');
    expect(serviceMarkup).toContain('Hotel towels');
    expect(serviceMarkup).not.toContain('Fresh towels');
  });

  it('requires every whitespace-delimited term to match catalog fields', () => {
    const resources = [
      { id: 'room-101', code: '101', displayName: 'Ocean Suite', floor: '2' },
      { id: 'room-102', code: '102', displayName: 'Garden Room', floor: '2' },
      { id: 'room-201', code: '201', displayName: 'Ocean Room', floor: '3' }
    ];

    expect(filterAdminItems(resources, 'OCEAN 2', (resource) => [resource.code, resource.displayName, resource.floor])).toEqual([resources[0]]);
    expect(filterAdminItems(resources, 'ocean missing', (resource) => [resource.code, resource.displayName, resource.floor])).toEqual([]);
    expect(filterAdminItems(resources, '  ', (resource) => [resource.code, resource.displayName, resource.floor])).toEqual(resources);
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

  it('renders catalog creation as a modal trigger instead of an inline form', () => {
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(CatalogPanels, {
        resource: 'rooms',
        rooms: [],
        areas: [],
        services: [],
        busy: false,
        onToggleRoom: async () => undefined,
        onPatchRoom: async () => true,
        onToggleArea: async () => undefined,
        onPatchArea: async () => true,
        onToggleService: async () => undefined,
        onPatchService: async () => true,
        renderCreateRoom: () => createElement('p', null, 'room form'),
        renderCreateArea: () => createElement('p', null, 'area form'),
        renderCreateService: () => createElement('p', null, 'service form')
      } as never)
    }));

    expect(markup).toContain('data-admin-resource-search="rooms"');
    expect(markup).toContain('data-admin-resource-add="rooms"');
    expect(markup).not.toContain('room form');
    expect(markup).not.toContain('data-admin-resource-modal="rooms"');
  });

  it('marks selectors inside admin modals for modal-layer interaction', () => {
    const serviceStart = adminScreenSource.indexOf('function CreateServiceForm');
    const provisionStart = adminScreenSource.indexOf('function ProvisionDeviceForm');
    const assignmentStart = adminScreenSource.indexOf('function DeviceAssignmentForm');
    const assignmentEnd = adminScreenSource.indexOf('function DeviceRebindForm');
    const selectInputStart = adminScreenSource.indexOf('function SelectInput');
    const serviceSource = adminScreenSource.slice(serviceStart, provisionStart);
    const provisionSource = adminScreenSource.slice(provisionStart, assignmentStart);
    const assignmentSource = adminScreenSource.slice(assignmentStart, assignmentEnd);
    const selectInputSource = adminScreenSource.slice(selectInputStart);

    expect(selectInputSource).toContain('modal = false');
    expect(serviceSource.match(/\bmodal\s*\/>/g)).toHaveLength(2);
    expect(provisionSource.match(/\bmodal\s*\/>/g)).toHaveLength(3);
    expect(assignmentSource).not.toContain('modal');
  });

  it('renders catalog actions as inline icon-only controls with accessible names', () => {
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(CatalogPanels, {
        resource: 'rooms',
        rooms: [{
          id: 'room-101',
          code: '101',
          displayName: 'Room 101',
          floor: '1',
          displayOrder: 1,
          active: true,
          doNotDisturb: false,
          createdAt: '2026-08-15T09:00:00.000Z',
          updatedAt: '2026-08-15T09:00:00.000Z'
        }],
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

    expect(markup).toContain('class="icon-button admin-item-action"');
    expect(markup).toContain('aria-label="Edit"');
    expect(markup).toContain('title="Edit"');
    expect(markup).toContain('aria-label="Deactivate"');
    expect(markup).toContain('title="Deactivate"');
    expect(markup).toContain('lucide-pencil');
    expect(markup).toContain('lucide-power-off');
    expect(markup).not.toContain('>Edit</button>');
    expect(markup).not.toContain('>Deactivate</button>');
  });

  it('renders station search between its title and count and keeps actions inline', () => {
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(DeviceManagement, {
        devices: [{
          id: 'device-101',
          installationId: 'install-101',
          displayName: 'Room 101 tablet',
          assignmentMode: 'ROOM',
          roomId: 'room-101',
          areaId: null,
          active: true,
          deviceConfigVersion: 1,
          lastHeartbeatAt: null,
          presence: 'ONLINE'
        }],
        rooms: [{
          id: 'room-101',
          code: '101',
          displayName: 'Room 101',
          floor: '1',
          displayOrder: 1,
          active: true,
          doNotDisturb: false,
          createdAt: '2026-08-15T09:00:00.000Z',
          updatedAt: '2026-08-15T09:00:00.000Z'
        }],
        areas: [],
        busy: false,
        initialInstallationId: null,
        onProvision: async () => true,
        onToggle: async () => undefined,
        onRotate: async () => undefined,
        onRebind: async () => true,
        onRevoke: async () => undefined,
        onRetire: async () => undefined,
        onAssign: async () => true
      } as never)
    }));

    const titleIndex = markup.indexOf('id="device-management-title"');
    const searchIndex = markup.indexOf('data-admin-resource-search="devices"');
    const countIndex = markup.indexOf('data-admin-resource-count="1"');

    expect(titleIndex).toBeGreaterThanOrEqual(0);
    expect(searchIndex).toBeGreaterThan(titleIndex);
    expect(countIndex).toBeGreaterThan(searchIndex);
    expect(markup).toContain('data-admin-resource-search="devices"');
    expect(markup).toContain('data-admin-resource-add="devices"');
    expect(markup).toContain('data-admin-resource-count="1"');
    expect(markup).toContain('aria-label="Deactivate"');
    expect(markup).toContain('title="Deactivate"');
    expect(markup).toContain('aria-label="Rotate token"');
    expect(markup).toContain('aria-label="Reassign"');
    expect(markup).toContain('aria-label="Revoke token"');
    expect(markup).toContain('aria-label="Rebind"');
    expect(markup).toContain('aria-label="Retire"');
    expect(markup).not.toContain('>Rotate token</button>');
    expect(markup).not.toContain('>Reassign</button>');
    expect(markup).not.toContain('>Revoke token</button>');
    expect(markup).not.toContain('>Rebind</button>');
    expect(markup).not.toContain('>Retire</button>');
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

  it('renders the Overview refresh action as an accessible icon-only control', () => {
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

    expect(markup).toContain('data-admin-refresh="true"');
    expect(markup).toContain('class="icon-button overview-refresh"');
    expect(markup).toContain('aria-label="Refresh data"');
    expect(markup).toContain('title="Refresh data"');
    expect(markup).toContain('lucide-refresh-cw');
    expect(markup).not.toContain('>Refresh data</button>');
  });

  it('renders compact icon-only branding upload and remove controls', () => {
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(SettingsPanel, {
        settings: [
          { key: 'hotelName', value: 'Hotel Local', updatedAt: '2026-08-31T09:05:00.000Z', updatedByAdminId: null },
          { key: 'hotelLogo', value: 'data:image/png;base64,AAAA', updatedAt: '2026-08-31T09:05:00.000Z', updatedByAdminId: null },
          { key: 'roomBackground', value: null, updatedAt: '2026-08-31T09:05:00.000Z', updatedByAdminId: null }
        ],
        busy: false,
        onSave: async () => undefined,
        onUploadRoomBackground: async () => true
      })
    }));

    expect(markup.match(/class="visually-hidden branding-file-input"/g)).toHaveLength(2);
    expect(markup).toContain('aria-label="Upload hotel logo"');
    expect(markup).toContain('title="Upload hotel logo"');
    expect(markup).toContain('aria-label="Upload room background"');
    expect(markup).toContain('title="Upload room background"');
    expect(markup).toContain('aria-label="Remove logo"');
    expect(markup).toContain('aria-label="Remove background"');
    expect(markup).not.toContain('>Remove logo</button>');
    expect(markup).not.toContain('>Remove background</button>');
  });

  it('renders the Admin command-center presentation landmarks', () => {
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

    expect(markup).toContain('admin-command-header');
    expect(markup).toContain('admin-main__canvas');
    expect(markup).toContain('admin-sidebar__footer');
  });

  it('renders the accessible self-service password action in English and Spanish', () => {
    const onChangePassword = async (): Promise<void> => undefined;
    const props = {
      snapshot: createAdminSnapshot(),
      csrfToken: 'csrf-token',
      installationId: null,
      connectionStatus: 'online' as const,
      onRefresh: async () => undefined,
      onLogout: async () => undefined,
      onUseDeviceToken: async () => undefined,
      onChangePassword
    } as Parameters<typeof AdminScreen>[0] & { onChangePassword: typeof onChangePassword };
    const englishMarkup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(AdminScreen, props)
    }));
    const spanishMarkup = renderToStaticMarkup(createElement(SpanishI18nProvider, {
      children: createElement(AdminScreen, props)
    }));

    expect(englishMarkup).toContain('Change password');
    expect(englishMarkup).toContain('aria-label="Change password"');
    expect(spanishMarkup).toContain('Cambiar contraseña');
    expect(spanishMarkup).toContain('aria-label="Cambiar contraseña"');
  });

  it('propagates the assignment mode with a provisioned one-time credential', () => {
    expect(adminScreenSource).toContain('assignmentMode: result.data.device.assignmentMode');
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

  it('removes administrator management while keeping self-service password change in the Admin screen', () => {
    const setupMarkup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(SetupTab, {
        snapshot: createAdminSnapshot(),
        busy: false,
        initialInstallationId: null
      } as never)
    }));
    const adminMarkup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(AdminScreen, {
        snapshot: createAdminSnapshot(),
        csrfToken: 'csrf-token',
        installationId: null,
        connectionStatus: 'online',
        onRefresh: async () => undefined,
        onLogout: async () => undefined,
        onUseDeviceToken: async () => undefined,
        onChangePassword: async () => undefined
      })
    }));

    expect(SETUP_SECTIONS).not.toContain('admins');
    expect(setupMarkup).not.toContain('data-admin-setup-tab="admins"');
    expect(setupMarkup).not.toContain('id="setup-panel-admins"');
    expect(adminMarkup).toContain('Change password');
    expect(adminMarkup).toContain('aria-label="Change password"');
    const commandHeaderStart = adminMarkup.indexOf('admin-command-header');
    const passwordButton = adminMarkup.indexOf('aria-label="Change password"');
    const commandHeaderEnd = adminMarkup.indexOf('</header>', commandHeaderStart);
    expect(passwordButton).toBeGreaterThan(commandHeaderStart);
    expect(passwordButton).toBeLessThan(commandHeaderEnd);
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

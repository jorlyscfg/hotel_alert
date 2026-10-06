import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AdminSystemSnapshot, InformationImageDTO, RequestDTO, RequestHistoryDTO } from '@hotel/shared';
import { AdminConfirmationDialog, AdminQueueTab, AdminScreen, DeviceManagement, filterAdminRequests, RequestHistoryDialog, SETUP_SECTIONS, SetupTab, type AdminRequestFilters } from '../../apps/web/src/features/admin/AdminScreen';
import { ADMIN_QUEUE_CLOCK_TICK_MS, ADMIN_QUEUE_TABS, buildAdminRequestLifecycle, formatAdminDuration, getAdminRequestDelayState, resolveAdminQueueDelayThresholds } from '../../apps/web/src/features/admin/admin-request-timing';
import { getMissingInformationImageVariantFields, INFORMATION_IMAGE_UPLOAD_FIELDS, InformationImageSourceField, InformationPanel } from '../../apps/web/src/features/admin/InformationPanel';
import { buildSettingsChanges, CatalogPanels, RoomBackgroundPreview, SettingsPanel } from '../../apps/web/src/features/admin/SetupPanels';
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

  it('renders one source preview while a room background upload is pending', () => {
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(RoomBackgroundPreview, {
        value: {
          square480: 'data:image/webp;base64,SAVED-SQUARE',
          tablet: 'data:image/webp;base64,SAVED-TABLET'
        },
        pendingPreviewUrl: 'blob:pending-room-background'
      })
    }));

    expect(markup.match(/<img\b/g)).toHaveLength(1);
    expect(markup).toContain('src="blob:pending-room-background"');
    expect(markup).not.toContain('data:image/webp;base64,SAVED-SQUARE');
    expect(markup).not.toContain('data:image/webp;base64,SAVED-TABLET');
  });

  it('renders the square crop once as the representative saved room background preview', () => {
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(RoomBackgroundPreview, {
        value: {
          square480: 'data:image/webp;base64,SQUARE',
          tablet: 'data:image/webp;base64,TABLET'
        },
        pendingPreviewUrl: null
      })
    }));

    expect(markup.match(/<img\b/g)).toHaveLength(1);
    expect(markup).toContain('data-room-background-variant="square480"');
    expect(markup).toContain('src="data:image/webp;base64,SQUARE"');
    expect(markup).not.toContain('src="data:image/webp;base64,TABLET"');
  });

  it('keeps timezone settings available without exposing manual location coordinate inputs', () => {
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(SettingsPanel, {
        settings: [
          { key: 'timeZone', value: 'America/Cancun', updatedAt: '2026-08-31T09:05:00.000Z', updatedByAdminId: null },
          { key: 'weatherLocationName', value: '', updatedAt: '2026-08-31T09:05:00.000Z', updatedByAdminId: null },
          { key: 'weatherLatitude', value: null, updatedAt: '2026-08-31T09:05:00.000Z', updatedByAdminId: null },
          { key: 'weatherLongitude', value: null, updatedAt: '2026-08-31T09:05:00.000Z', updatedByAdminId: null }
        ] as never,
        busy: false,
        onSave: async () => undefined,
        onUploadRoomBackground: async () => true
      })
    }));

    expect(markup).toContain('setting-timeZone');
    expect(markup).toContain('Checking city search availability');
    expect(markup).toContain('class="form-field city-search-field"');
    expect(markup).toContain('href="https://www.geoapify.com/pricing/"');
    expect(markup).toContain('target="_blank" rel="noopener noreferrer">Powered by Geoapify</a>');
    expect(markup).not.toContain('setting-weatherLatitude');
    expect(markup).not.toContain('setting-weatherLongitude');
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

describe('responsible attribution in Admin request views', () => {
  it('shows the responsible person or localized unassigned fallback in every queue lifecycle state', () => {
    for (const status of ['PENDING', 'IN_PROGRESS', 'COMPLETED'] as const) {
      const assigned = makeRequest({
        id: `request-${status.toLowerCase()}`,
        status,
        acceptedAt: status === 'PENDING' ? null : '2026-08-15T09:05:00.000Z',
        inProgressAt: status === 'PENDING' ? null : '2026-08-15T09:10:00.000Z',
        completedAt: status === 'COMPLETED' ? '2026-08-15T09:25:00.000Z' : null,
        responsibleName: 'Taylor Morgan'
      });
      const assignedMarkup = renderQueueRequest(assigned, 'en');
      expect(assignedMarkup).toContain('Taylor Morgan');
      expect(assignedMarkup).toContain('Responsible');

      const legacyMarkup = renderQueueRequest({ ...assigned, responsibleName: null }, 'es');
      expect(legacyMarkup).toContain('Sin asignar');
      expect(legacyMarkup).toContain('Responsable');
    }
  });

  it('keeps the entered responsible separate from the actor in request history', () => {
    const request = makeRequest({ status: 'COMPLETED', responsibleName: 'Taylor Morgan' });
    const history: RequestHistoryDTO[] = [
      {
        id: 'history-start', requestId: request.id, fromStatus: 'PENDING', toStatus: 'IN_PROGRESS',
        actorType: 'DEVICE', actorId: 'device-actor-1', requestVersion: 2, createdAt: '2026-08-15T09:10:00.000Z',
        responsibleName: 'Taylor Morgan'
      },
      {
        id: 'history-complete', requestId: request.id, fromStatus: 'IN_PROGRESS', toStatus: 'COMPLETED',
        actorType: 'ADMIN', actorId: 'admin-actor-1', requestVersion: 3, createdAt: '2026-08-15T09:25:00.000Z',
        responsibleName: null
      }
    ];
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(RequestHistoryDialog, {
        request, history, busy: false, error: null, clockFormat: '24h', onClose: () => undefined
      })
    }));

    expect(markup).toContain('Taylor Morgan');
    expect(markup).toContain('device-actor-1');
    expect(markup).toContain('admin-actor-1');
    expect(markup).not.toContain('Unassigned');

    const legacyMarkup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(RequestHistoryDialog, {
        request: { ...request, responsibleName: null },
        history: [{ ...history[0]!, responsibleName: null }],
        busy: false, error: null, clockFormat: '24h', onClose: () => undefined
      })
    }));
    expect(legacyMarkup).toContain('Unassigned');
  });

  it('formats request-history timestamps in the shared configured timezone', () => {
    const request = makeRequest({ id: 'request-timezone' });
    const history: RequestHistoryDTO[] = [{
      id: 'history-timezone', requestId: request.id, fromStatus: null, toStatus: 'PENDING',
      actorType: 'SYSTEM', actorId: null, requestVersion: 1, createdAt: '2026-10-01T02:15:00.000Z'
    }];
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(RequestHistoryDialog, {
        request, history, busy: false, error: null, clockFormat: '12h', timeZone: 'America/Cancun', onClose: () => undefined
      })
    }));

    expect(markup).toContain('Sep 30, 9:15 PM');
    expect(markup).not.toContain('Oct 1, 2:15 AM');
  });
});

function renderQueueRequest(request: RequestDTO, locale: 'en' | 'es'): string {
  const Provider = locale === 'es' ? SpanishI18nProvider : I18nProvider;
  const snapshot = { ...createAdminSnapshot(), requests: [request] };
  return renderToStaticMarkup(createElement(Provider, {
    children: createElement(AdminQueueTab, {
      snapshot,
      onViewHistory: () => undefined,
      initialStatus: request.status === 'PENDING' ? 'PENDING' : request.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
      initialNow: new Date('2026-08-15T09:30:00.000Z')
    })
  }));
}

describe('admin live queue lifecycle and delay timing', () => {
  it('exposes pending, in-progress, completed, and No molestar queue tabs', () => {
    expect(ADMIN_QUEUE_TABS).toEqual(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DO_NOT_DISTURB']);
  });

  it.each([
    [59_999, 'just now', 'ahora'],
    [60_000, '1min', '1min'],
    [59 * 60_000, '59min', '59min'],
    [60 * 60_000, '1h', '1h'],
    [24 * 60 * 60_000 - 60_000, '23h 59min', '23h 59min'],
    [24 * 60 * 60_000, '1d', '1d'],
    [25 * 60 * 60_000 + 5 * 60_000, '1d 1h 5min', '1d 1h 5min']
  ])('formats %i ms as compact days, hours, and minutes', (durationMs, english, spanish) => {
    expect(formatAdminDuration(durationMs, 'en')).toBe(english);
    expect(formatAdminDuration(durationMs, 'es')).toBe(spanish);
  });

  it('calculates the complete direct pending-to-in-progress lifecycle', () => {
    const lifecycle = buildAdminRequestLifecycle(makeRequest({
      status: 'COMPLETED',
      createdAt: '2026-09-29T09:00:00.000Z',
      inProgressAt: '2026-09-29T09:03:00.000Z',
      completedAt: '2026-09-29T09:18:00.000Z'
    }));

    expect(lifecycle.segments.map(({ stage, durationMs }) => [stage, durationMs])).toEqual([
      ['PENDING', 3 * 60_000],
      ['IN_PROGRESS', 15 * 60_000]
    ]);
    expect(lifecycle.totalDurationMs).toBe(18 * 60_000);
  });

  it('includes the legacy accepted interval when both accepted and in-progress timestamps exist', () => {
    const lifecycle = buildAdminRequestLifecycle(makeRequest({
      status: 'COMPLETED',
      createdAt: '2026-09-29T09:00:00.000Z',
      acceptedAt: '2026-09-29T09:02:00.000Z',
      inProgressAt: '2026-09-29T09:07:00.000Z',
      completedAt: '2026-09-29T09:17:00.000Z'
    }));

    expect(lifecycle.segments.map(({ stage, durationMs }) => [stage, durationMs])).toEqual([
      ['PENDING', 2 * 60_000],
      ['ACCEPTED', 5 * 60_000],
      ['IN_PROGRESS', 10 * 60_000]
    ]);
    expect(lifecycle.totalDurationMs).toBe(17 * 60_000);
  });

  it('marks each active stage overdue at its configured threshold and refreshes elapsed age', () => {
    const pending = makeRequest({ status: 'PENDING', createdAt: '2026-09-29T09:00:00.000Z' });
    const thresholds = { pendingMinutes: 3, inProgressMinutes: 15 };
    const beforeWarning = getAdminRequestDelayState(pending, new Date('2026-09-29T09:02:59.000Z'), thresholds);
    const afterWarning = getAdminRequestDelayState(pending, new Date('2026-09-29T09:03:00.000Z'), thresholds);

    expect(beforeWarning).toMatchObject({ elapsedMs: 179_000, overdue: false });
    expect(afterWarning).toMatchObject({ elapsedMs: 180_000, overdue: true });
    expect(ADMIN_QUEUE_CLOCK_TICK_MS).toBeGreaterThan(0);
  });

  it('uses acceptedAt as a legacy in-progress start and applies its own configured threshold', () => {
    const request = makeRequest({ status: 'ACCEPTED', acceptedAt: '2026-09-29T09:00:00.000Z' });
    const delay = getAdminRequestDelayState(request, new Date('2026-09-29T09:15:00.000Z'), { pendingMinutes: 3, inProgressMinutes: 15 });

    expect(delay).toMatchObject({ stage: 'IN_PROGRESS', startedAt: '2026-09-29T09:00:00.000Z', elapsedMs: 900_000, overdue: true });
  });

  it('uses the persisted threshold settings and falls back to defaults when missing or invalid', () => {
    expect(resolveAdminQueueDelayThresholds([
      { key: 'requests.pendingDelayWarningMinutes', value: 6 },
      { key: 'requests.inProgressDelayWarningMinutes', value: 'invalid' }
    ])).toEqual({ pendingMinutes: 6, inProgressMinutes: 15 });
  });

  it('renders four queue tabs and marks an active request overdue at the configured boundary', () => {
    const snapshot = createAdminSnapshot();
    snapshot.requests = [makeRequest({ status: 'PENDING', createdAt: '2026-09-29T09:00:00.000Z' })];
    snapshot.settings = [
      { key: 'requests.pendingDelayWarningMinutes', value: 3, updatedAt: '2026-09-29T09:00:00.000Z', updatedByAdminId: null },
      { key: 'requests.inProgressDelayWarningMinutes', value: 15, updatedAt: '2026-09-29T09:00:00.000Z', updatedByAdminId: null }
    ];
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(AdminQueueTab, {
        snapshot,
        initialNow: new Date('2026-09-29T09:03:00.000Z'),
        onViewHistory: () => undefined
      })
    }));

    expect(markup.match(/data-admin-queue-tab=/g)).toHaveLength(4);
    expect(markup).not.toContain('data-admin-queue-tab="ALL"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('data-admin-stage-overdue="true"');
    expect(markup).toContain('Overdue');
    expect(adminScreenSource).toContain('setInterval(() => setNow(new Date()), ADMIN_QUEUE_CLOCK_TICK_MS)');
  });

  it('renders the completed request lifecycle and total from its recorded timestamps', () => {
    const snapshot = createAdminSnapshot();
    snapshot.requests = [makeRequest({
      status: 'COMPLETED',
      createdAt: '2026-09-29T09:00:00.000Z',
      inProgressAt: '2026-09-29T09:03:00.000Z',
      completedAt: '2026-09-29T09:18:00.000Z'
    })];
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(AdminQueueTab, { snapshot, initialStatus: 'COMPLETED', onViewHistory: () => undefined })
    }));

    expect(markup).toContain('Lifecycle');
    expect(markup).toContain('Pending');
    expect(markup).toContain('In progress');
    expect(markup).toContain('Total elapsed');
    expect(markup).toContain('3min');
    expect(markup).toContain('15min');
    expect(markup).toContain('18min');
  });

  it('labels a legacy accepted interval separately from in-progress work', () => {
    const snapshot = createAdminSnapshot();
    snapshot.requests = [makeRequest({
      status: 'COMPLETED',
      createdAt: '2026-09-29T09:00:00.000Z',
      acceptedAt: '2026-09-29T09:02:00.000Z',
      inProgressAt: '2026-09-29T09:07:00.000Z',
      completedAt: '2026-09-29T09:17:00.000Z'
    })];
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(AdminQueueTab, { snapshot, initialStatus: 'COMPLETED', onViewHistory: () => undefined })
    }));

    expect(markup).toContain('Accepted');
    expect(markup).toContain('In progress');
    expect(markup).toContain('5min');
  });

  it('renders long active-stage ages with localized ago copy', () => {
    const snapshot = createAdminSnapshot();
    snapshot.requests = [makeRequest({ status: 'PENDING', createdAt: '2026-09-27T00:00:00.000Z' })];
    const now = new Date('2026-09-29T03:05:00.000Z');
    const englishMarkup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(AdminQueueTab, { snapshot, initialNow: now, onViewHistory: () => undefined })
    }));
    const spanishMarkup = renderToStaticMarkup(createElement(SpanishI18nProvider, {
      children: createElement(AdminQueueTab, { snapshot, initialNow: now, onViewHistory: () => undefined })
    }));

    expect(englishMarkup).toContain('2d 3h 5min ago');
    expect(spanishMarkup).toContain('hace 2d 3h 5min');
  });

  it('renders the active No molestar rooms tab with Area-matching time and severity', () => {
    const snapshot = Object.assign(createAdminSnapshot(), {
      activeDoNotDisturbRooms: [
        { id: 'room-101', code: '101', displayName: 'Room 101', doNotDisturb: true, doNotDisturbActivatedAt: '2026-08-31T11:06:00.000Z' },
        { id: 'room-202', code: '202', displayName: 'Room 202', doNotDisturb: true, doNotDisturbActivatedAt: null }
      ]
    });
    const renderAt = (initialNow: Date, activeSnapshot = snapshot) => renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(AdminQueueTab, { snapshot: activeSnapshot, initialStatus: 'DO_NOT_DISTURB' as never, initialNow, onViewHistory: () => undefined })
    }));
    const baselineMarkup = renderAt(new Date('2026-08-31T12:05:00.000Z'));

    expect(baselineMarkup).toContain('data-admin-queue-tab="DO_NOT_DISTURB"');
    expect(baselineMarkup).toContain('Do not disturb');
    expect(baselineMarkup).toContain('area-dnd-tab-count--gray');
    expect(baselineMarkup).toContain('>2</span>');
    expect(baselineMarkup).toContain('area-dnd-room--gray');
    expect(baselineMarkup).toContain('Active for 59m');
    expect(baselineMarkup).toContain('Time unavailable');
    expect(baselineMarkup).toContain('202');

    const warningMarkup = renderAt(new Date('2026-08-31T12:06:00.000Z'));
    expect(warningMarkup).toContain('area-dnd-tab-count--yellow');
    expect(warningMarkup).toContain('area-dnd-room--yellow');

    const criticalMarkup = renderAt(new Date('2026-08-31T14:06:00.000Z'));
    expect(criticalMarkup).toContain('area-dnd-tab-count--red');
    expect(criticalMarkup).toContain('area-dnd-room--red');

    const refreshedSnapshot = { ...snapshot, activeDoNotDisturbRooms: snapshot.activeDoNotDisturbRooms.slice(0, 1) };
    const refreshedMarkup = renderAt(new Date('2026-08-31T12:06:00.000Z'), refreshedSnapshot);
    expect(refreshedMarkup).toContain('area-dnd-tab-count--yellow');
    expect(refreshedMarkup).toContain('>1</span>');
    expect(refreshedMarkup).not.toContain('Room 202');

    const longDurationSnapshot = { ...snapshot, activeDoNotDisturbRooms: [{
      id: 'room-long', code: '303', displayName: 'Room 303', doNotDisturb: true, doNotDisturbActivatedAt: '2026-08-29T09:00:00.000Z'
    }] };
    expect(renderAt(new Date('2026-08-31T12:05:00.000Z'), longDurationSnapshot)).toContain('Active for 2d 3h 5min');

    const spanishMarkup = renderToStaticMarkup(createElement(SpanishI18nProvider, {
      children: createElement(AdminQueueTab, { snapshot, initialStatus: 'DO_NOT_DISTURB' as never, initialNow: new Date('2026-08-31T12:05:00.000Z'), onViewHistory: () => undefined })
    }));
    expect(spanishMarkup).toContain('No molestar');
    expect(spanishMarkup).toContain('Activo desde hace 59min');

    const emptySnapshot = { ...snapshot, activeDoNotDisturbRooms: [] };
    const emptyMarkup = renderAt(new Date('2026-08-31T12:06:00.000Z'), emptySnapshot);
    expect(emptyMarkup).toContain('data-admin-queue-tab="DO_NOT_DISTURB"');
    expect(emptyMarkup).not.toContain('area-dnd-tab-count');
    expect(emptyMarkup).not.toContain('area-dnd-strip');
  });

  it('localizes a legacy accepted lifecycle interval in Spanish', () => {
    const snapshot = createAdminSnapshot();
    snapshot.requests = [makeRequest({
      status: 'COMPLETED',
      createdAt: '2026-09-29T09:00:00.000Z',
      acceptedAt: '2026-09-29T09:02:00.000Z',
      inProgressAt: '2026-09-29T09:07:00.000Z',
      completedAt: '2026-09-29T09:17:00.000Z'
    })];
    const markup = renderToStaticMarkup(createElement(SpanishI18nProvider, {
      children: createElement(AdminQueueTab, { snapshot, initialStatus: 'COMPLETED', onViewHistory: () => undefined })
    }));

    expect(markup).toContain('Aceptada');
    expect(markup).toContain('En proceso');
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

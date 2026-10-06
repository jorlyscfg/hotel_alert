import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { AMERICA_TIME_ZONES, type AdminSystemSnapshot, type SettingDTO } from '@hotel/shared';
import { AdminScreen, adminWarningLabel, actorTypeLabel, auditActionLabel, devicePresenceLabel, entityTypeLabel, formatAdminRoomAreaCounts, SETUP_SECTIONS, SetupTab } from '../../apps/web/src/features/admin/AdminScreen';
import { AMERICA_TIME_ZONE_OPTIONS, buildSettingsChanges, getServiceIconLabelKey, SERVICE_ICON_OPTIONS, SettingsPanel } from '../../apps/web/src/features/admin/SetupPanels';
import { createTranslator, I18nProvider, SpanishI18nProvider, type MessageKey } from '../../apps/web/src/i18n';
import { describe, expect, it } from 'vitest';

const adminScreenSource = readFileSync(fileURLToPath(new URL('../../apps/web/src/features/admin/AdminScreen.tsx', import.meta.url)), 'utf8');
const setupPanelsSource = readFileSync(fileURLToPath(new URL('../../apps/web/src/features/admin/SetupPanels.tsx', import.meta.url)), 'utf8');

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
  it('uses the bundled America timezone catalog in the server settings selector', () => {
    expect(AMERICA_TIME_ZONE_OPTIONS.map((option) => option.value)).toEqual(AMERICA_TIME_ZONES);
    expect(AMERICA_TIME_ZONE_OPTIONS.find((option) => option.value === 'America/Cancun')).toEqual({ value: 'America/Cancun', label: 'America/Cancun' });
  });

  it('formats admin audit timestamps in the configured shared timezone', () => {
    const timeZoneSnapshot: AdminSystemSnapshot = {
      ...snapshot,
      settings: [{ key: 'timeZone', value: 'America/Cancun', updatedAt: '2026-10-01T02:15:00.000Z', updatedByAdminId: null }],
      auditLog: [{ ...snapshot.auditLog[0]!, createdAt: '2026-10-01T02:15:00.000Z' }]
    };
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(AdminScreen, {
        snapshot: timeZoneSnapshot,
        csrfToken: 'csrf-token',
        installationId: null,
        connectionStatus: 'online',
        onRefresh: async () => undefined,
        onLogout: async () => undefined,
        onUseDeviceToken: async () => undefined
      })
    }));

    expect(markup).toContain('Sep 30, 9:15 PM');
    expect(markup).not.toContain('Oct 1, 2:15 AM');
  });

  it('localizes live queue stage and overdue copy in English and Spanish', () => {
    expect(createTranslator('en')('admin.currentStageAge' as MessageKey)).toBe('Current stage age');
    expect(createTranslator('en')('admin.delayWarning' as MessageKey)).toBe('Overdue');
    expect(createTranslator('en')('admin.lifecycleTitle' as MessageKey)).toBe('Lifecycle');
    expect(createTranslator('en')('admin.totalElapsed' as MessageKey)).toBe('Total elapsed');
    expect(createTranslator('en')('admin.lifecycleAccepted' as MessageKey)).toBe('Accepted');
    expect(createTranslator('es')('admin.currentStageAge' as MessageKey)).toBe('Tiempo en etapa actual');
    expect(createTranslator('es')('admin.delayWarning' as MessageKey)).toBe('Demorada');
    expect(createTranslator('es')('admin.lifecycleTitle' as MessageKey)).toBe('Ciclo de atención');
    expect(createTranslator('es')('admin.totalElapsed' as MessageKey)).toBe('Tiempo total');
    expect(createTranslator('es')('admin.lifecycleAccepted' as MessageKey)).toBe('Aceptada');
  });

  it('shows the legacy missing-English hotel-name warning and exposes both editable language values', () => {
    const settings: SettingDTO[] = [
      { key: 'hotelName', value: 'Hotel Costa Azul', updatedAt: '2026-09-23T10:00:00.000Z', updatedByAdminId: null },
      { key: 'hotelNameEn', value: '', updatedAt: '2026-09-23T10:00:00.000Z', updatedByAdminId: null }
    ];
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(SettingsPanel, { settings, busy: false, onSave: async () => undefined })
    }));

    expect(markup).toContain('id="setting-hotelName"');
    expect(markup).toContain('id="setting-hotelNameEn"');
    expect(markup).toContain('Hotel name (English)');
    expect(markup).toContain('English is not set yet. ROOM displays the Spanish hotel name until you complete it.');
    expect(markup).toContain('id="setting-hotelNameEn" type="text"');
    expect(buildSettingsChanges(settings, { hotelName: 'Hotel Costa Azul', hotelNameEn: 'Azure Coast Hotel' })).toEqual({
      hotelName: 'Hotel Costa Azul', hotelNameEn: 'Azure Coast Hotel'
    });
  });

  it('localizes editable Admin queue delay thresholds in both supported languages', () => {
    const settings: SettingDTO[] = [
      { key: 'requests.pendingDelayWarningMinutes', value: 3, updatedAt: '2026-09-29T10:00:00.000Z', updatedByAdminId: null },
      { key: 'requests.inProgressDelayWarningMinutes', value: 15, updatedAt: '2026-09-29T10:00:00.000Z', updatedByAdminId: null }
    ];
    const englishMarkup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(SettingsPanel, { settings, busy: false, onSave: async () => undefined })
    }));
    const spanishMarkup = renderToStaticMarkup(createElement(SpanishI18nProvider, {
      children: createElement(SettingsPanel, { settings, busy: false, onSave: async () => undefined })
    }));

    expect(englishMarkup).toContain('Pending request delay warning (minutes)');
    expect(englishMarkup).toContain('In-progress request delay warning (minutes)');
    expect(spanishMarkup).toContain('Aviso de demora en solicitudes pendientes (minutos)');
    expect(spanishMarkup).toContain('Aviso de demora en solicitudes en proceso (minutos)');
    expect(englishMarkup).toContain('id="setting-requests.pendingDelayWarningMinutes" type="number"');
    expect(englishMarkup).toContain('id="setting-requests.inProgressDelayWarningMinutes" type="number"');
    expect(englishMarkup).toContain('min="1" max="1440" step="1"');
    expect(englishMarkup).toContain('value="3"');
    expect(englishMarkup).toContain('value="15"');
  });

  it('localizes the Information settings modal title and trigger name', () => {
    expect(createTranslator('en')('admin.informationSettingsTitle' as MessageKey)).toBe('Information display settings');
    expect(createTranslator('en')('admin.openInformationSettings' as MessageKey)).toBe('Configure information display');
    expect(createTranslator('es')('admin.informationSettingsTitle' as MessageKey)).toBe('Configuración de información');
    expect(createTranslator('es')('admin.openInformationSettings' as MessageKey)).toBe('Configurar información');
  });

  it('keeps the Admin view in Spanish without the removed Overview intro copy', () => {
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

       expect(markup).toContain('Resumen');
       expect(markup).not.toContain('Buenos días, operaciones.');
       expect(markup).not.toContain('Una vista viva de lo que requiere atención en el establecimiento.');
      expect(markup).not.toContain('language-selector');
    } finally {
      if (previousWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
      else Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
    }
  });

  it('keeps system configuration as a top-level tab with five nested settings options', () => {
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
      onUploadInformationImage: async () => true,
      onRepairInformationImage: async () => true,
      onDeleteInformationImage: async () => true,
      onReorderInformationImages: async () => true,
      onRevokeToken: async () => undefined,
      onAssignDevice: async () => true
    }));

    expect(SETUP_SECTIONS).toEqual(['rooms', 'areas', 'services', 'devices', 'information', 'settings']);
    expect(markup).toContain('role="tablist"');
    expect(markup.match(/role="tab"/g)).toHaveLength(SETUP_SECTIONS.length);
    expect(markup.match(/data-admin-setup-tab="/g)).toHaveLength(SETUP_SECTIONS.length);
    expect(markup.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(markup.match(/role="tabpanel"/g)).toHaveLength(1);
    expect(markup).toContain('id="setup-panel-rooms"');
    expect(markup).toContain('data-admin-setup-panel="rooms"');
    for (const section of SETUP_SECTIONS) expect(markup).toContain(`data-admin-setup-tab="${section}"`);
    expect(markup).toContain('id="setup-tab-settings"');
    expect(markup).toContain('aria-controls="setup-panel-settings"');
    expect(markup).toContain('data-admin-setup-tab="settings"');
    expect(markup).toContain('class="setup-tab__label">Rooms</span><span class="setup-tab__count" data-admin-setup-count="rooms">1</span>');
    expect(markup).toContain('class="setup-tab__label">Areas</span><span class="setup-tab__count" data-admin-setup-count="areas">0</span>');
    expect(markup).toContain('class="setup-tab__label">Services</span><span class="setup-tab__count" data-admin-setup-count="services">0</span>');
    expect(markup).toContain('class="setup-tab__label">Stations</span><span class="setup-tab__count" data-admin-setup-count="devices">1</span>');
    expect(markup).not.toContain('data-admin-setup-accordion=');
    expect(adminScreenSource).toContain("if (value === 'settings') return <SettingsPanel");

    const settings: SettingDTO[] = [
      { key: 'hotelName', value: 'Hotel Local', updatedAt: '2026-08-31T10:00:00.000Z', updatedByAdminId: null },
      { key: 'hotelLogo', value: null, updatedAt: '2026-08-31T10:00:00.000Z', updatedByAdminId: null },
      { key: 'clockFormat', value: '12h', updatedAt: '2026-08-31T10:00:00.000Z', updatedByAdminId: null },
      { key: 'roomBackground', value: { square480: 'data:image/webp;base64,SQUARE', tablet: 'data:image/webp;base64,TABLET' }, updatedAt: '2026-08-31T10:00:00.000Z', updatedByAdminId: null },
      { key: 'timeZone', value: 'America/Cancun', updatedAt: '2026-08-31T10:00:00.000Z', updatedByAdminId: null },
      { key: 'weatherLocationName', value: 'Playa del Carmen', updatedAt: '2026-08-31T10:00:00.000Z', updatedByAdminId: null },
      { key: 'weatherLatitude', value: 20.6275, updatedAt: '2026-08-31T10:00:00.000Z', updatedByAdminId: null },
      { key: 'weatherLongitude', value: -87.0799, updatedAt: '2026-08-31T10:00:00.000Z', updatedByAdminId: null },
      { key: 'heartbeat.intervalMs', value: 10000, updatedAt: '2026-08-31T10:00:00.000Z', updatedByAdminId: null }
    ];
    const settingsWithInformationTiming: SettingDTO[] = [
      ...settings,
      { key: 'information.idleTimeoutSeconds', value: 12, updatedAt: '2026-08-31T10:00:00.000Z', updatedByAdminId: null },
      { key: 'information.slideIntervalSeconds', value: 18, updatedAt: '2026-08-31T10:00:00.000Z', updatedByAdminId: null }
    ];
    const settingsMarkup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(SettingsPanel, { settings: settingsWithInformationTiming, busy: false, onSave: async () => undefined })
    }));

    expect(settingsMarkup).toContain('data-admin-settings-panel="true"');
    expect(settingsMarkup).toContain('data-admin-settings-carousel="true"');
    expect(settingsMarkup.match(/data-admin-settings-option="[^"]+"/g)).toEqual([
      'data-admin-settings-option="station-identity"',
      'data-admin-settings-option="clock-format"',
      'data-admin-settings-option="time-zone-location"',
      'data-admin-settings-option="room-background"',
      'data-admin-settings-option="runtime-policy"'
    ]);
    expect(settingsMarkup.match(/data-admin-settings-accordion="[^"]+"/g)).toEqual([
      'data-admin-settings-accordion="station-identity"',
      'data-admin-settings-accordion="clock-format"',
      'data-admin-settings-accordion="time-zone-location"',
      'data-admin-settings-accordion="room-background"',
      'data-admin-settings-accordion="runtime-policy"'
    ]);
    expect(settingsMarkup.match(/data-admin-settings-option-panel="[^"]+"/g)).toEqual([
      'data-admin-settings-option-panel="station-identity"',
      'data-admin-settings-option-panel="clock-format"',
      'data-admin-settings-option-panel="time-zone-location"',
      'data-admin-settings-option-panel="room-background"',
      'data-admin-settings-option-panel="runtime-policy"'
    ]);
    expect(settingsMarkup).not.toContain('data-admin-settings-option="base"');
    expect(settingsMarkup).not.toContain('data-admin-settings-accordion="base"');
    expect(settingsMarkup).toContain('Station identity');
    expect(settingsMarkup).toContain('Clock format');
    expect(settingsMarkup).toContain('Time zone &amp; location');
    expect(settingsMarkup).toContain('Room background');
    expect(settingsMarkup).toContain('class="setup-accordion__label">Runtime policy</span>');
    expect(settingsMarkup.match(/data-admin-settings-accordion="[^"]+" aria-expanded="true"/g)).toHaveLength(1);
    expect(settingsMarkup.match(/data-admin-settings-accordion="[^"]+" aria-expanded="false"/g)).toHaveLength(4);
    expect(settingsMarkup).toContain('aria-controls="admin-settings-option-station-identity"');
    expect(settingsMarkup).toContain('aria-controls="admin-settings-option-clock-format"');
    expect(settingsMarkup).toContain('aria-controls="admin-settings-option-time-zone-location"');
    expect(settingsMarkup).toContain('aria-controls="admin-settings-option-room-background"');
    expect(settingsMarkup).toContain('aria-controls="admin-settings-option-runtime-policy"');
    expect(settingsMarkup.match(/id="admin-settings-option-(station-identity|clock-format|time-zone-location|room-background|runtime-policy)"/g)).toHaveLength(5);
    expect(settingsMarkup.match(/id="admin-settings-accordion-(station-identity|clock-format|time-zone-location|room-background|runtime-policy)"/g)).toHaveLength(5);
    expect(settingsMarkup.match(/hidden=""/g)).toHaveLength(4);
    const panelMarkup = (option: 'station-identity' | 'clock-format' | 'time-zone-location' | 'room-background' | 'runtime-policy'): string => {
      const start = settingsMarkup.indexOf(`data-admin-settings-option-panel="${option}"`);
      const nextPanel = settingsMarkup.indexOf('data-admin-settings-option-panel="', start + 1);
      return settingsMarkup.slice(start, nextPanel === -1 ? settingsMarkup.length : nextPanel);
    };
    const stationIdentityPanel = panelMarkup('station-identity');
    const clockFormatPanel = panelMarkup('clock-format');
    const timeZoneLocationPanel = panelMarkup('time-zone-location');
    const roomBackgroundPanel = panelMarkup('room-background');
    const runtimePolicyPanel = panelMarkup('runtime-policy');

    expect(stationIdentityPanel).not.toContain('hidden=""');
    expect(clockFormatPanel).toContain('hidden=""');
    expect(timeZoneLocationPanel).toContain('hidden=""');
    expect(roomBackgroundPanel).toContain('hidden=""');
    expect(runtimePolicyPanel).toContain('hidden=""');
    for (const option of ['station-identity', 'clock-format', 'time-zone-location', 'room-background', 'runtime-policy']) {
      expect(settingsMarkup).toContain(`id="admin-settings-option-${option}" aria-labelledby="admin-settings-accordion-${option}"`);
    }
    expect(stationIdentityPanel).toContain('data-admin-settings-controls="station-identity"');
    expect(stationIdentityPanel).toContain('id="setting-hotelName"');
    expect(stationIdentityPanel).toContain('id="setting-hotelLogo"');
    expect(stationIdentityPanel).not.toContain('id="setting-clockFormat"');
    expect(stationIdentityPanel).not.toContain('id="setting-roomBackground"');
    expect(clockFormatPanel).toContain('data-admin-settings-controls="clock-format"');
    expect(clockFormatPanel).toContain('id="setting-clockFormat"');
    expect(clockFormatPanel).not.toContain('id="setting-hotelName"');
    expect(clockFormatPanel).not.toContain('id="setting-roomBackground"');
    expect(timeZoneLocationPanel).toContain('data-admin-settings-controls="time-zone-location"');
    expect(timeZoneLocationPanel).toContain('id="setting-timeZone"');
    expect(timeZoneLocationPanel).toContain('America/Cancun');
    expect(timeZoneLocationPanel).toContain('Checking city search availability');
    expect(timeZoneLocationPanel).not.toContain('id="setting-weatherLocationName"');
    expect(timeZoneLocationPanel).not.toContain('id="setting-hotelName"');
    expect(timeZoneLocationPanel).not.toContain('id="setting-clockFormat"');
    expect(roomBackgroundPanel).toContain('data-admin-settings-controls="room-background"');
    expect(roomBackgroundPanel).toContain('id="setting-roomBackground"');
    expect(roomBackgroundPanel).toContain('data-room-background-variant="square480"');
    expect(roomBackgroundPanel).not.toContain('data-room-background-variant="tablet"');
    expect(roomBackgroundPanel).not.toContain('id="setting-hotelName"');
    expect(roomBackgroundPanel).not.toContain('id="setting-clockFormat"');
    expect(runtimePolicyPanel).toContain('data-admin-settings-runtime-policy="true"');
    expect(runtimePolicyPanel).toContain('data-admin-settings-controls="runtime-policy"');
    expect(runtimePolicyPanel).toContain('id="setting-heartbeat.intervalMs"');
    expect(runtimePolicyPanel).not.toContain('information.idleTimeoutSeconds');
    expect(runtimePolicyPanel).not.toContain('information.slideIntervalSeconds');
    expect(runtimePolicyPanel).not.toContain('weatherLatitude');
    expect(runtimePolicyPanel).not.toContain('weatherLongitude');
    expect(runtimePolicyPanel).not.toContain('id="setting-hotelName"');
    expect(runtimePolicyPanel).not.toContain('id="setting-clockFormat"');
    expect(runtimePolicyPanel).not.toContain('id="setting-roomBackground"');
    const settingsWithoutRuntimePolicyPanel = settingsMarkup.replace(runtimePolicyPanel, '');
    expect(settingsWithoutRuntimePolicyPanel).not.toContain('data-admin-settings-runtime-policy="true"');
    expect(settingsWithoutRuntimePolicyPanel).not.toContain('id="setting-heartbeat.intervalMs"');
    expect(settingsMarkup).not.toContain('role="tab"');
    expect(buildSettingsChanges(settings.filter((setting) => setting.key === 'hotelName' || setting.key === 'hotelLogo'), { hotelName: 'Updated Hotel', hotelLogo: 'logo-data', clockFormat: '24h' })).toEqual({ hotelName: 'Updated Hotel', hotelLogo: 'logo-data' });
    expect(buildSettingsChanges(settings.filter((setting) => setting.key === 'clockFormat'), { hotelName: 'Updated Hotel', hotelLogo: 'logo-data', clockFormat: '24h' })).toEqual({ clockFormat: '24h' });
    expect(buildSettingsChanges(settings.filter((setting) => setting.key === 'weatherLocationName' || setting.key === 'weatherLatitude' || setting.key === 'weatherLongitude'), { weatherLocationName: '', weatherLatitude: '', weatherLongitude: '' })).toEqual({ weatherLocationName: '', weatherLatitude: null, weatherLongitude: null });
    expect(buildSettingsChanges(settings.filter((setting) => setting.key === 'heartbeat.intervalMs'), { 'heartbeat.intervalMs': 20000, clockFormat: '24h' })).toEqual({ 'heartbeat.intervalMs': 20000 });
    expect(markup).not.toContain('Catalog, stations, and assignments stay explicit');
    expect(markup).toContain('id="catalog-rooms"');
    expect(markup).not.toContain('id="catalog-areas"');
    expect(markup).not.toContain('id="catalog-services"');
    expect(markup).not.toContain('id="device-management-title"');
    expect(markup).not.toContain('id="settings-title"');
    expect(markup).not.toContain('id="admin-management-title"');
  });

  it('memoizes settings inputs used by stateful child panels', () => {
    expect(setupPanelsSource).toMatch(/const stationIdentitySettings = useMemo\(\(\) => props\.settings\.filter\([\s\S]*?\), \[props\.settings\]\);/);
    expect(setupPanelsSource).toMatch(/const clockFormatSettings = useMemo\(\(\) => props\.settings\.filter\([\s\S]*?\), \[props\.settings\]\);/);
    expect(setupPanelsSource).toMatch(/const numericSettings = useMemo\(\(\) => props\.settings\.filter\([\s\S]*?\), \[props\.settings\]\);/);
    expect(setupPanelsSource).toMatch(/const roomBackgroundSetting = useMemo\(\(\) => props\.settings\.find\([\s\S]*?\), \[props\.settings\]\);/);
  });

  it('removes unreachable legacy settings implementations', () => {
    expect(setupPanelsSource).not.toContain('function _LegacySettingsPanel');
    expect(setupPanelsSource).not.toContain('export function RoomBackgroundPanel');
    expect(setupPanelsSource).toContain('function CompactRoomBackgroundPanel');
  });

  it('keeps the live queue limited to date and search filters with status controls last', () => {
    const queueStart = adminScreenSource.indexOf('export function AdminQueueTab');
    const queueSource = adminScreenSource.slice(queueStart, adminScreenSource.indexOf('function AdminRequestStageTiming', queueStart));
    const filtersIndex = queueSource.indexOf('className="queue-filter-grid"');
    const statusesIndex = queueSource.indexOf('className="setup-tabs filter-row"');

    expect(queueSource).toContain('<CalendarDatePicker');
    expect(queueSource).not.toContain('<SelectInput');
    expect(queueSource).not.toContain('queue-filter-clear');
    expect(queueSource).not.toContain('common.clearFilters');
    expect(queueSource).toContain('className="setup-tabs filter-row"');
    expect(queueSource).toContain('setup-tab--active');
    expect(queueSource).toContain('setup-tab__label');
    expect(queueSource).toContain('ADMIN_QUEUE_TABS.map');
    expect(queueSource).not.toContain("t('admin.all')");
    expect(queueSource).not.toContain('filter-pill');
    expect(adminScreenSource).not.toContain('type="date"');
    expect(adminScreenSource).toContain('role="grid"');
    expect(statusesIndex).toBeGreaterThan(filtersIndex);
  });

  it('provides a localized calendar-only clear action without changing calendar navigation', () => {
    const calendarSource = adminScreenSource.slice(adminScreenSource.indexOf('function CalendarDatePicker'), adminScreenSource.indexOf('function parseCalendarDate'));

    expect(calendarSource).toContain('date-picker__clear');
    expect(calendarSource).toContain("onChange('')");
    expect(calendarSource).toContain("aria-label={t('admin.clearDate')}");
    expect(calendarSource).toContain("title={t('admin.clearDate')}");
    expect(createTranslator('en')('admin.clearDate' as MessageKey)).toBe('Clear date');
    expect(createTranslator('es')('admin.clearDate' as MessageKey)).toBe('Limpiar fecha');
  });

  it('keeps the custom calendar keyboard grid navigable', () => {
    const calendarSource = adminScreenSource.slice(adminScreenSource.indexOf('function CalendarDatePicker'), adminScreenSource.indexOf('function parseCalendarDate'));

    expect(calendarSource).toContain('role="dialog"');
    expect(calendarSource).toContain('role="grid"');
    for (const key of ['Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) {
      expect(calendarSource).toContain(`event.key === '${key}'`);
    }
    expect(calendarSource).toContain('event.preventDefault()');
    expect(calendarSource).toContain('tabIndex={formatCalendarValue(focusDate)');
  });

  it('removes explanatory PageHeading blocks from the queue, setup, and audit sections', () => {
    expect(adminScreenSource).not.toContain('<PageHeading');
    expect(adminScreenSource).not.toContain('function PageHeading');
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

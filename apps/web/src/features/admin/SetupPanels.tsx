import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Moon, Pencil, Plus, Power, PowerOff, Upload, X } from 'lucide-react';
import * as Shared from '@hotel/shared';
import type { AreaDTO, LocalizedTextVariants, RoomBackgroundValue, RoomDTO, ServiceDTO, SettingDTO, SettingKey } from '@hotel/shared';
import { Modal } from '../../components/Modal';
import { TouchSelect, type TouchSelectOption } from '../../components/TouchSelect';
import { ServiceIcon } from '../../components/ServiceIcon';
import { resolveAreaDescription, resolveAreaDisplayName, resolveServiceDisplayName, useI18n, type MessageKey, formatNumber } from '../../i18n';
import { filterAdminItems } from './admin-search';

const { isRoomBackgroundValue, MAX_HOTEL_LOGO_LENGTH } = Shared;

interface ServiceIconOption {
  value: string;
  label: MessageKey;
  icon: ReactNode;
}

export const SERVICE_ICON_OPTIONS: ReadonlyArray<ServiceIconOption> = [
  { value: 'bell', label: 'admin.iconBell', icon: <ServiceIcon iconKey="bell" /> },
  { value: 'food', label: 'admin.iconFood', icon: <ServiceIcon iconKey="food" /> },
  { value: 'drink', label: 'admin.iconDrink', icon: <ServiceIcon iconKey="drink" /> },
  { value: 'towels', label: 'admin.iconTowels', icon: <ServiceIcon iconKey="towels" /> },
  { value: 'housekeeping', label: 'admin.iconHousekeeping', icon: <ServiceIcon iconKey="housekeeping" /> },
  { value: 'maintenance', label: 'admin.iconMaintenance', icon: <ServiceIcon iconKey="maintenance" /> },
  { value: 'concierge', label: 'admin.iconConcierge', icon: <ServiceIcon iconKey="concierge" /> },
  { value: 'spa', label: 'admin.iconSpa', icon: <ServiceIcon iconKey="spa" /> }
];

export function getServiceIconLabelKey(value: string): MessageKey | null {
  return SERVICE_ICON_OPTIONS.find((option) => option.value === value)?.label ?? null;
}

interface CatalogPanelsProps {
  resource: CatalogResource;
  rooms: RoomDTO[];
  areas: AreaDTO[];
  services: ServiceDTO[];
  busy: boolean;
  onToggleRoom: (room: RoomDTO) => Promise<void>;
  onPatchRoom: (room: RoomDTO, values: { code: string; displayName: string; floor: string; displayOrder: number; doNotDisturb: boolean }) => Promise<boolean>;
  onToggleArea: (area: AreaDTO) => Promise<void>;
  onPatchArea: (area: AreaDTO, values: { code: string; displayName: string; displayNameVariants?: LocalizedTextVariants; description: string; descriptionVariants?: LocalizedTextVariants; displayOrder: number }) => Promise<boolean>;
  onToggleService: (service: ServiceDTO) => Promise<void>;
  onPatchService: (service: ServiceDTO, values: { code: string; displayName: string; displayNameVariants?: LocalizedTextVariants; description: string; descriptionVariants?: LocalizedTextVariants; iconKey: string; areaId: string; displayOrder: number }) => Promise<boolean>;
  renderCreateRoom?: (close: () => void) => ReactNode;
  renderCreateArea?: (close: () => void) => ReactNode;
  renderCreateService?: (close: () => void) => ReactNode;
}

export type CatalogResource = 'rooms' | 'areas' | 'services';

export function CatalogPanels(props: CatalogPanelsProps) {
  const { locale, t } = useI18n();
  const renderCreateRoom = props.renderCreateRoom ?? (() => null);
  const renderCreateArea = props.renderCreateArea ?? (() => null);
  const renderCreateService = props.renderCreateService ?? (() => null);
  return <div className="catalog-panels">
    {props.resource === 'rooms' && <CatalogResourceList resource="rooms" title={t('admin.rooms')} eyebrow={t('admin.guestLocations')} createLabel={t('admin.addRoom')} searchLabel={t('admin.searchRooms')} items={props.rooms} busy={props.busy} onToggle={props.onToggleRoom} getSearchableValues={(room) => [room.code, room.displayName, room.floor, ...Object.values(room.displayNameVariants ?? {})]} renderCreate={renderCreateRoom} renderEdit={(room, close) => <RoomEditForm room={room} busy={props.busy} onCancel={close} onSubmit={(values) => props.onPatchRoom(room, values)} />} />}
    {props.resource === 'areas' && <CatalogResourceList resource="areas" title={t('admin.areas')} eyebrow={t('admin.responsibleTeams')} createLabel={t('admin.addArea')} searchLabel={t('admin.searchAreas')} items={props.areas} busy={props.busy} onToggle={props.onToggleArea} getDisplayName={(area) => resolveAreaDisplayName(area, locale)} getMissingEnglishFields={getMissingEnglishCatalogFields} getSearchableValues={(area) => [area.code, resolveAreaDisplayName(area, locale), resolveAreaDescription(area, locale), area.displayName, area.description, ...Object.values(area.displayNameVariants ?? {}), ...Object.values(area.descriptionVariants ?? {})]} renderCreate={renderCreateArea} renderEdit={(area, close) => <AreaEditForm area={area} busy={props.busy} onCancel={close} onSubmit={(values) => props.onPatchArea(area, values)} />} />}
    {props.resource === 'services' && <CatalogResourceList resource="services" title={t('admin.servicesTitle')} eyebrow={t('admin.guestFacingChoices')} createLabel={t('admin.addService')} searchLabel={t('admin.searchServices')} items={props.services} busy={props.busy} onToggle={props.onToggleService} getDisplayName={(service) => resolveServiceDisplayName(service, locale)} getMissingEnglishFields={getMissingEnglishCatalogFields} getSearchableValues={(service) => [service.code, resolveServiceDisplayName(service, locale), service.displayName, service.description, service.iconKey, props.areas.find((area) => area.id === service.areaId) === undefined ? '' : resolveAreaDisplayName(props.areas.find((area) => area.id === service.areaId)!, locale), props.areas.find((area) => area.id === service.areaId)?.displayName, ...Object.values(service.displayNameVariants ?? {}), ...Object.values(service.descriptionVariants ?? {})]} renderCreate={renderCreateService} renderEdit={(service, close) => <ServiceEditForm service={service} areas={props.areas} busy={props.busy} onCancel={close} onSubmit={(values) => props.onPatchService(service, values)} />} />}
  </div>;
}

interface CatalogItem {
  id: string;
  code: string;
  displayName: string;
  displayNameVariants?: LocalizedTextVariants;
  description?: string | null;
  descriptionVariants?: LocalizedTextVariants;
  active: boolean;
  displayOrder: number;
}

export function getMissingEnglishCatalogFields(item: Pick<CatalogItem, 'id' | 'code' | 'displayNameVariants' | 'description' | 'descriptionVariants'>): Array<'name' | 'description'> {
  const normalizedCode = item.code.trim().toLowerCase();
  if (item.id === `area_default_${normalizedCode}` || item.id === `svc_default_${normalizedCode}`) return [];
  const missing: Array<'name' | 'description'> = [];
  if (!hasEnglishVariant(item.displayNameVariants)) missing.push('name');
  if (item.description !== undefined && item.description !== null && item.description.trim().length > 0 && !hasEnglishVariant(item.descriptionVariants)) {
    missing.push('description');
  }
  return missing;
}

function hasEnglishVariant(variants: LocalizedTextVariants | undefined): boolean {
  return typeof variants?.['en'] === 'string' && variants['en'].trim().length > 0;
}

function CatalogResourceList<T extends CatalogItem>({ resource, title, eyebrow, createLabel, searchLabel, items, busy, onToggle, getDisplayName, getMissingEnglishFields, getSearchableValues, renderCreate, renderEdit }: { resource: CatalogResource; title: string; eyebrow: string; createLabel: string; searchLabel: string; items: T[]; busy: boolean; onToggle: (item: T) => Promise<void>; getDisplayName?: (item: T) => string; getMissingEnglishFields?: (item: T) => Array<'name' | 'description'>; getSearchableValues: (item: T) => readonly unknown[]; renderCreate: (close: () => void) => ReactNode; renderEdit: (item: T, close: () => void) => ReactNode }) {
  const { locale, t } = useI18n();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const visibleItems = useMemo(() => filterAdminItems(items, search, getSearchableValues), [getSearchableValues, items, search]);
  return (
    <>
    <section className="surface-card catalog-card" aria-labelledby={`catalog-${resource}`}>
      <div className="panel-card__heading">
        <div><p className="eyebrow eyebrow--muted">{eyebrow}</p><h2 id={`catalog-${resource}`}>{title}</h2></div>
        <label className="catalog-search"><span className="visually-hidden">{searchLabel}</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('admin.catalogSearchPlaceholder')} aria-label={searchLabel} data-admin-resource-search={resource} /></label>
        <div className="catalog-card__tools"><span className="section-count" data-admin-resource-count={items.length}>{formatNumber(items.length, locale)}</span><button className="icon-button catalog-add-button" type="button" onClick={() => setCreateOpen(true)} aria-label={createLabel} title={createLabel} data-admin-resource-add={resource}><Plus aria-hidden="true" size={18} strokeWidth={2} /></button></div>
      </div>
      {search.length > 0 && <div className="catalog-list__toolbar"><span className="catalog-results" aria-live="polite">{t('admin.searchResults', { shown: formatNumber(visibleItems.length, locale), total: formatNumber(items.length, locale) })}</span></div>}
      <div className="catalog-list">
        {items.length === 0 ? <p className="catalog-empty">{t('admin.nothingHereYet')}</p> : visibleItems.length === 0 ? <p className="catalog-empty" role="status">{t('admin.noMatchingResources')}</p> : visibleItems.map((item) => (
          <div className="catalog-row" key={item.id}>
            {editingId === item.id ? renderEdit(item, () => setEditingId(null)) : (
              <>
                <div>
                  <strong>{getDisplayName?.(item) ?? item.displayName}</strong>
                  <span>{item.code} · {t('admin.orderValue', { order: item.displayOrder })} · {item.active ? t('admin.active') : t('admin.inactive')}</span>
                  {getMissingEnglishFields?.(item).map((field) => <span key={field} role="status">{t('admin.englishTranslationMissing', { field: t(field === 'name' ? 'admin.displayNameEnglish' : 'admin.descriptionEnglish') })}</span>)}
                  {'doNotDisturb' in item && item.doNotDisturb === true && <span className="room-dnd-status" role="status"><Moon aria-hidden="true" size={13} strokeWidth={1.8} />{t('admin.doNotDisturb')}</span>}
                </div>
                <div className="catalog-row__actions">
                  <button className="icon-button admin-item-action" type="button" onClick={() => setEditingId(item.id)} aria-label={t('admin.edit')} title={t('admin.edit')}><Pencil aria-hidden="true" size={17} strokeWidth={1.9} /></button>
                  <button className="icon-button admin-item-action" type="button" onClick={() => void onToggle(item)} disabled={busy} aria-label={item.active ? t('admin.deactivate') : t('admin.reactivate')} title={item.active ? t('admin.deactivate') : t('admin.reactivate')} data-admin-action={item.active ? 'danger' : undefined}>{item.active ? <PowerOff aria-hidden="true" size={17} strokeWidth={1.9} /> : <Power aria-hidden="true" size={17} strokeWidth={1.9} />}</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
    <Modal open={createOpen} title={createLabel} onClose={() => setCreateOpen(false)} closeLabel={t('common.closeDialog')} className="admin-resource-create-modal" >
      {renderCreate(() => setCreateOpen(false))}
    </Modal>
    </>
  );
}

function RoomEditForm({ room, busy, onCancel, onSubmit }: { room: RoomDTO; busy: boolean; onCancel: () => void; onSubmit: (values: { code: string; displayName: string; floor: string; displayOrder: number; doNotDisturb: boolean }) => Promise<boolean> }) {
  const { t } = useI18n();
  const [code, setCode] = useState(room.code); const [displayName, setDisplayName] = useState(room.displayName); const [floor, setFloor] = useState(room.floor ?? ''); const [displayOrder, setDisplayOrder] = useState(String(room.displayOrder)); const [doNotDisturb, setDoNotDisturb] = useState(room.doNotDisturb);
  return <InlineEditForm onCancel={onCancel} busy={busy} onSubmit={async () => { if (await onSubmit({ code, displayName, floor, displayOrder: Number(displayOrder), doNotDisturb })) onCancel(); }}><div className="form-grid form-grid--compact"><Field label={t('admin.code')} value={code} onChange={setCode} required /><Field label={t('admin.displayName')} value={displayName} onChange={setDisplayName} required /><Field label={t('admin.floor')} value={floor} onChange={setFloor} /><Field label={t('admin.order')} type="number" value={displayOrder} onChange={setDisplayOrder} required /><label className="checkbox-field"><input type="checkbox" checked={doNotDisturb} onChange={(event) => setDoNotDisturb(event.target.checked)} /><span>{t('admin.doNotDisturb')}</span></label></div></InlineEditForm>;
}

export function AreaEditForm({ area, busy, onCancel, onSubmit }: { area: AreaDTO; busy: boolean; onCancel: () => void; onSubmit: (values: { code: string; displayName: string; displayNameVariants?: LocalizedTextVariants; description: string; descriptionVariants?: LocalizedTextVariants; displayOrder: number }) => Promise<boolean> }) {
  const { t } = useI18n();
  const isDefault = area.id === `area_default_${area.code.trim().toLowerCase()}`;
  const [code, setCode] = useState(area.code); const [displayName, setDisplayName] = useState(area.displayName); const [displayNameEnglish, setDisplayNameEnglish] = useState(area.displayNameVariants?.['en'] ?? ''); const [description, setDescription] = useState(area.description ?? ''); const [descriptionEnglish, setDescriptionEnglish] = useState(area.descriptionVariants?.['en'] ?? ''); const [displayOrder, setDisplayOrder] = useState(String(area.displayOrder));
  const missingFields = getMissingEnglishCatalogFields(area);
  return <InlineEditForm onCancel={onCancel} busy={busy} onSubmit={async () => { if (await onSubmit({ code, displayName, ...(isDefault ? {} : { displayNameVariants: toEnglishVariant(displayNameEnglish) }), description, ...(isDefault ? {} : { descriptionVariants: toEnglishVariant(descriptionEnglish) }), displayOrder: Number(displayOrder) })) onCancel(); }}><div className="form-grid form-grid--compact"><Field label={t('admin.code')} value={code} onChange={setCode} required /><Field label={t('admin.displayName')} value={displayName} onChange={setDisplayName} required />{!isDefault && <Field label={t('admin.displayNameEnglish')} value={displayNameEnglish} onChange={setDisplayNameEnglish} required />}{!isDefault && <><Field label={t('admin.description')} value={description} onChange={setDescription} /><Field label={t('admin.descriptionEnglish')} value={descriptionEnglish} onChange={setDescriptionEnglish} required={description.trim().length > 0} /></>}<Field label={t('admin.order')} type="number" value={displayOrder} onChange={setDisplayOrder} required />{missingFields.map((field) => <p key={field} role="status">{t('admin.englishTranslationMissing', { field: t(field === 'name' ? 'admin.displayNameEnglish' : 'admin.descriptionEnglish') })}</p>)}</div></InlineEditForm>;
}

export function ServiceEditForm({ service, areas, busy, onCancel, onSubmit }: { service: ServiceDTO; areas: AreaDTO[]; busy: boolean; onCancel: () => void; onSubmit: (values: { code: string; displayName: string; displayNameVariants?: LocalizedTextVariants; description: string; descriptionVariants?: LocalizedTextVariants; iconKey: string; areaId: string; displayOrder: number }) => Promise<boolean> }) {
  const { t } = useI18n();
  const isDefault = service.id === `svc_default_${service.code.trim().toLowerCase()}`;
  const [code, setCode] = useState(service.code); const [displayName, setDisplayName] = useState(service.displayName); const [displayNameEnglish, setDisplayNameEnglish] = useState(service.displayNameVariants?.['en'] ?? ''); const [description, setDescription] = useState(service.description ?? ''); const [descriptionEnglish, setDescriptionEnglish] = useState(service.descriptionVariants?.['en'] ?? ''); const [iconKey, setIconKey] = useState(service.iconKey ?? 'bell'); const [areaId, setAreaId] = useState(service.areaId); const [displayOrder, setDisplayOrder] = useState(String(service.displayOrder));
  const { locale } = useI18n();
  const missingFields = getMissingEnglishCatalogFields(service);
  return <InlineEditForm onCancel={onCancel} busy={busy} onSubmit={async () => { if (await onSubmit({ code, displayName, ...(isDefault ? {} : { displayNameVariants: toEnglishVariant(displayNameEnglish) }), description, ...(isDefault ? {} : { descriptionVariants: toEnglishVariant(descriptionEnglish) }), iconKey, areaId, displayOrder: Number(displayOrder) })) onCancel(); }}><div className="form-grid form-grid--compact"><Field label={t('admin.code')} value={code} onChange={setCode} required /><Field label={t('admin.displayName')} value={displayName} onChange={setDisplayName} required />{!isDefault && <Field label={t('admin.displayNameEnglish')} value={displayNameEnglish} onChange={setDisplayNameEnglish} required />}{!isDefault && <><Field label={t('admin.description')} value={description} onChange={setDescription} /><Field label={t('admin.descriptionEnglish')} value={descriptionEnglish} onChange={setDescriptionEnglish} required={description.trim().length > 0} /></>}<Field label={t('admin.order')} type="number" value={displayOrder} onChange={setDisplayOrder} required /><FieldSelect label={t('admin.area')} value={areaId} onChange={setAreaId} options={areas.map((area) => ({ value: area.id, label: resolveAreaDisplayName(area, locale) }))} /><FieldSelect label={t('admin.icon')} value={iconKey} onChange={setIconKey} options={SERVICE_ICON_OPTIONS.map((option) => ({ value: option.value, label: t(option.label), icon: option.icon }))} />{missingFields.map((field) => <p key={field} role="status">{t('admin.englishTranslationMissing', { field: t(field === 'name' ? 'admin.displayNameEnglish' : 'admin.descriptionEnglish') })}</p>)}</div></InlineEditForm>;
}

function toEnglishVariant(value: string): LocalizedTextVariants {
  const english = value.trim();
  return english.length === 0 ? {} : { en: english };
}

function InlineEditForm({ children, busy, onCancel, onSubmit }: { children: ReactNode; busy: boolean; onCancel: () => void; onSubmit: () => Promise<void> }) {
  const { t } = useI18n();
  return <form className="catalog-edit" onSubmit={(event) => { event.preventDefault(); void onSubmit(); }}>{children}<div className="form-actions"><button className="button button--ghost button--small" type="button" onClick={onCancel}>{t('common.cancel')}</button><button className="button button--dark button--small" type="submit" disabled={busy}>{t('common.saveChanges')}</button></div></form>;
}

function Field({ label, value, onChange, type = 'text', required = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) {
  const id = `field-${label.toLowerCase().replaceAll(' ', '-')}-${useUniqueId()}`;
  return <div className="form-field"><label htmlFor={id}>{label}</label><input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} /></div>;
}

function FieldSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: TouchSelectOption[] }) {
  return <TouchSelect label={label} value={value} onChange={onChange} options={options} />;
}

let uniqueId = 0;
function useUniqueId(): string {
  const [id] = useState(() => { uniqueId += 1; return String(uniqueId); });
  return id;
}

interface SettingsPanelProps {
  settings: SettingDTO[];
  busy: boolean;
  onSave: (changes: Record<string, unknown>) => Promise<boolean | void>;
}

interface SettingsPanelWithRoomBackgroundProps extends SettingsPanelProps {
  onUploadRoomBackground: (file: File) => Promise<boolean>;
}

const SETTING_LABEL_KEYS: Record<SettingKey, MessageKey> = {
  'heartbeat.intervalMs': 'settings.heartbeatInterval',
  'heartbeat.staleAfterMs': 'settings.staleThreshold',
  'heartbeat.offlineAfterMs': 'settings.offlineThreshold',
  'alerts.pendingRepeatMs': 'settings.pendingAlertRepeat',
  'realtime.replayMinMinutes': 'settings.replayRetention',
  'realtime.replayMaxEvents': 'settings.replayEventFloor',
  'requests.pageSizeDefault': 'settings.requestPageSize',
  'requests.historyRetentionDays': 'settings.historyRetention',
  'idempotency.retentionHours': 'settings.idempotencyRetention',
  'client.offlineQueueTtlHours': 'settings.offlineQueueTtl',
  'audit.retentionDays': 'settings.auditRetention',
  hotelName: 'settings.hotelName',
  hotelNameEn: 'settings.hotelNameEnglish',
  hotelLogo: 'settings.hotelLogo',
  roomBackground: 'settings.roomBackground',
  clockFormat: 'settings.clockFormat',
  'information.idleTimeoutSeconds': 'settings.informationIdleTimeout',
  'information.slideIntervalSeconds': 'settings.informationSlideInterval'
};

type SettingsFormValue = string | number;
type SettingsChangeValue = SettingsFormValue | RoomBackgroundValue;

export function buildSettingsChanges(settings: SettingDTO[], values: Record<string, SettingsChangeValue>): Record<string, unknown> {
  return Object.fromEntries(settings.map((setting) => {
    const value = values[setting.key];
    if (setting.key === 'hotelLogo' || setting.key === 'roomBackground') return [setting.key, value === null || value === undefined || value === '' ? null : value];
    if (typeof setting.value === 'number') return [setting.key, Number(value ?? '')];
    return [setting.key, value ?? ''];
  }));
}

function RuntimePolicyPanel({ settings, busy, onSave }: SettingsPanelProps) {
  const { t } = useI18n();
  const [values, setValues] = useState<Record<string, SettingsChangeValue>>(() => initialSettingsValues(settings));
  useEffect(() => setValues(initialSettingsValues(settings)), [settings]);
  const numericSettings = settings.filter((setting): setting is SettingDTO & { value: number } => typeof setting.value === 'number');

  function submitSettings(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void onSave(buildSettingsChanges(settings, values));
  }

  return <section className="surface-card settings-card settings-runtime-policy" aria-labelledby="runtime-policy-title" data-admin-settings-runtime-policy="true"><div className="panel-card__heading"><div><p className="eyebrow eyebrow--muted">{t('admin.runtimePolicy')}</p><h2 id="runtime-policy-title">{t('admin.runtimePolicy')}</h2></div><span className="section-count">{t('admin.validated')}</span></div><form className="settings-grid" data-admin-settings-controls="runtime-policy" onSubmit={submitSettings}><div className="settings-numeric-grid">{numericSettings.map((setting) => { const value = values[setting.key]; return <div className="form-field" key={setting.key}><label htmlFor={`setting-${setting.key}`}>{t(SETTING_LABEL_KEYS[setting.key])}</label><input id={`setting-${setting.key}`} type="number" value={typeof value === 'number' || typeof value === 'string' ? value : ''} onChange={(event) => setValues((current) => ({ ...current, [setting.key]: event.target.value }))} required /></div>; })}</div><button className="button button--dark" type="submit" disabled={busy}>{t('common.saveChanges')}</button></form></section>;
}

export function SettingsPanel(props: SettingsPanelWithRoomBackgroundProps) {
  const { t } = useI18n();
  const [activeOption, setActiveOption] = useState<SettingsOption>('station-identity');
  const stationIdentitySettings = useMemo(() => props.settings.filter((setting) => setting.key === 'hotelName' || setting.key === 'hotelNameEn' || setting.key === 'hotelLogo'), [props.settings]);
  const clockFormatSettings = useMemo(() => props.settings.filter((setting) => setting.key === 'clockFormat'), [props.settings]);
  const numericSettings = useMemo(() => props.settings.filter((setting) => typeof setting.value === 'number' && !isInformationCarouselSetting(setting.key)), [props.settings]);
  const roomBackgroundSetting = useMemo(() => props.settings.find((setting) => setting.key === 'roomBackground'), [props.settings]);

  return <div className="settings-panels" data-admin-settings-panel="true"><div className="setup-accordions" data-admin-settings-carousel="true">{SETTINGS_OPTIONS.map((option) => { const isOpen = activeOption === option; const panelId = `admin-settings-option-${option}`; const triggerId = `admin-settings-accordion-${option}`; return <section className={`setup-accordion${isOpen ? ' setup-accordion--open' : ''}`} data-admin-settings-option={option} key={option}><h3 className="setup-accordion__heading"><button className="setup-accordion__trigger" type="button" id={triggerId} data-admin-settings-accordion={option} aria-expanded={isOpen} aria-controls={panelId} onClick={() => setActiveOption(option)}><span className="setup-accordion__label">{t(SETTINGS_OPTION_LABEL_KEYS[option])}</span><ChevronDown className="setup-accordion__icon" aria-hidden="true" size={18} strokeWidth={1.8} /></button></h3><div className="setup-accordion__panel" id={panelId} aria-labelledby={triggerId} data-admin-settings-option-panel={option} hidden={!isOpen}>{option === 'station-identity' ? <CompactStationIdentityPanel settings={stationIdentitySettings} busy={props.busy} onSave={props.onSave} /> : option === 'clock-format' ? <CompactClockFormatPanel settings={clockFormatSettings} busy={props.busy} onSave={props.onSave} /> : option === 'room-background' ? <CompactRoomBackgroundPanel setting={roomBackgroundSetting} busy={props.busy} onSave={props.onSave} onUploadRoomBackground={props.onUploadRoomBackground} /> : <RuntimePolicyPanel settings={numericSettings} busy={props.busy} onSave={props.onSave} />}</div></section>; })}</div></div>;
}

const SETTINGS_OPTIONS = ['station-identity', 'clock-format', 'room-background', 'runtime-policy'] as const;
type SettingsOption = (typeof SETTINGS_OPTIONS)[number];

const SETTINGS_OPTION_LABEL_KEYS: Record<SettingsOption, MessageKey> = {
  'station-identity': 'settings.stationIdentity',
  'clock-format': 'settings.clockFormat',
  'room-background': 'settings.roomBackground',
  'runtime-policy': 'admin.runtimePolicy'
};

function initialSettingsValues(settings: SettingDTO[]): Record<string, SettingsChangeValue> {
  return Object.fromEntries(Shared.SETTING_KEYS.map((key) => {
    const setting = settings.find((candidate) => candidate.key === key);
    return [key, setting?.value ?? Shared.DEFAULT_SETTINGS[key]];
  })) as Record<string, SettingsChangeValue>;
}

function isInformationCarouselSetting(key: SettingKey): boolean {
  return key === 'information.idleTimeoutSeconds' || key === 'information.slideIntervalSeconds';
}

function CompactStationIdentityPanel({ settings, busy, onSave }: SettingsPanelProps) {
  const { t } = useI18n();
  const [values, setValues] = useState<Record<string, SettingsChangeValue>>(() => initialSettingsValues(settings));
  const [uploadError, setUploadError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setValues(initialSettingsValues(settings)), [settings]);

  const hotelName = typeof values['hotelName'] === 'string' ? values['hotelName'] : '';
  const hotelNameEn = typeof values['hotelNameEn'] === 'string' ? values['hotelNameEn'] : '';
  const hotelLogo = typeof values['hotelLogo'] === 'string' ? values['hotelLogo'] : null;

  async function handleLogoChange(file: File | undefined): Promise<void> {
    if (file === undefined) return;
    setUploadError(null);
    try {
      const image = await resizeHotelImage(file);
      setValues((current) => ({ ...current, hotelLogo: image }));
    } catch {
      setUploadError(t('settings.logoUploadError'));
    }
  }

  function submitSettings(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void onSave(buildSettingsChanges(settings, values));
  }

  return <section className="surface-card settings-card" aria-labelledby="station-identity-title"><div className="panel-card__heading"><div><p className="eyebrow eyebrow--muted">{t('settings.branding')}</p><h2 id="station-identity-title">{t('settings.stationIdentity')}</h2></div><span className="section-count">{t('admin.validated')}</span></div><form className="settings-grid" data-admin-settings-controls="station-identity" onSubmit={submitSettings}><div className="settings-branding"><div className="settings-branding__heading"><p className="eyebrow eyebrow--muted">{t('settings.branding')}</p><span>{t('settings.brandingCopy')}</span></div><div className="branding-fields"><div className="form-field"><label htmlFor="setting-hotelName">{t(SETTING_LABEL_KEYS.hotelName)}</label><input id="setting-hotelName" type="text" value={hotelName} onChange={(event) => setValues((current) => ({ ...current, hotelName: event.target.value }))} maxLength={120} required /></div><div className="form-field"><label htmlFor="setting-hotelNameEn">{t(SETTING_LABEL_KEYS.hotelNameEn)}</label><input id="setting-hotelNameEn" type="text" value={hotelNameEn} onChange={(event) => setValues((current) => ({ ...current, hotelNameEn: event.target.value }))} maxLength={120} required />{hotelNameEn.trim().length === 0 && <p className="field-hint" role="status">{t('settings.hotelNameEnglishMissing')}</p>}</div><div className="form-field"><span className="form-field__label">{t(SETTING_LABEL_KEYS.hotelLogo)}</span><div className="branding-media-actions"><input ref={logoInputRef} className="visually-hidden branding-file-input" id="setting-hotelLogo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => void handleLogoChange(event.target.files?.[0])} aria-label={t('settings.uploadHotelLogo')} tabIndex={-1} /><button className="icon-button branding-upload-button" type="button" onClick={() => logoInputRef.current?.click()} disabled={busy} aria-label={t('settings.uploadHotelLogo')} title={t('settings.uploadHotelLogo')}><Upload aria-hidden="true" size={17} strokeWidth={1.9} /></button>{hotelLogo !== null && <img className="branding-logo-preview" src={hotelLogo} alt={hotelName || t('settings.hotelLogo')} />}<button className="icon-button branding-remove-button" type="button" onClick={() => setValues((current) => ({ ...current, hotelLogo: null }))} disabled={busy || hotelLogo === null} aria-label={t('settings.removeLogo')} title={t('settings.removeLogo')}><X aria-hidden="true" size={17} strokeWidth={1.9} /></button></div>{uploadError !== null && <p className="form-error" role="alert">{uploadError}</p>}</div></div></div><button className="button button--dark" type="submit" disabled={busy}>{t('common.saveChanges')}</button></form></section>;
}

function CompactClockFormatPanel({ settings, busy, onSave }: SettingsPanelProps) {
  const { t } = useI18n();
  const [values, setValues] = useState<Record<string, SettingsChangeValue>>(() => initialSettingsValues(settings));

  useEffect(() => setValues(initialSettingsValues(settings)), [settings]);

  const clockFormat = values['clockFormat'] === '24h' ? '24h' : '12h';

  function submitSettings(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void onSave(buildSettingsChanges(settings, values));
  }

  return <section className="surface-card settings-card clock-format-settings" aria-labelledby="clock-format-title"><div className="panel-card__heading"><div><p className="eyebrow eyebrow--muted">{t('settings.clockFormat')}</p><h2 id="clock-format-title">{t('settings.clockFormat')}</h2></div><span className="section-count">{t('admin.validated')}</span></div><form className="settings-grid" data-admin-settings-controls="clock-format" onSubmit={submitSettings}><div className="form-field"><label htmlFor="setting-clockFormat">{t(SETTING_LABEL_KEYS.clockFormat)}</label><TouchSelect id="setting-clockFormat" label={t(SETTING_LABEL_KEYS.clockFormat)} value={clockFormat} onChange={(value) => setValues((current) => ({ ...current, clockFormat: value }))} options={[{ value: '12h', label: t('settings.clock12h') }, { value: '24h', label: t('settings.clock24h') }]} /></div><button className="button button--dark" type="submit" disabled={busy}>{t('common.saveChanges')}</button></form></section>;
}

function CompactRoomBackgroundPanel({ setting, busy, onSave, onUploadRoomBackground }: RoomBackgroundPanelProps) {
  const { t } = useI18n();
  const [roomBackground, setRoomBackground] = useState<RoomBackgroundValue>(() => isRoomBackgroundValue(setting?.value) ? setting.value : null);
  const [pendingBackgroundFile, setPendingBackgroundFile] = useState<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setRoomBackground(isRoomBackgroundValue(setting?.value) ? setting.value : null), [setting]);

  useEffect(() => {
    if (pendingBackgroundFile === null) {
      setPendingPreviewUrl(null);
      return;
    }
    const previewUrl = URL.createObjectURL(pendingBackgroundFile);
    setPendingPreviewUrl(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [pendingBackgroundFile]);

  async function submitBackground(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pendingBackgroundFile !== null) {
      if (await onUploadRoomBackground(pendingBackgroundFile)) {
        setPendingBackgroundFile(null);
        setUploadError(null);
      } else {
        setUploadError(t('settings.roomBackgroundUploadError'));
      }
      return;
    }
    void onSave({ roomBackground });
  }

  return <section className="surface-card settings-card room-background-settings" aria-labelledby="room-background-title"><div className="panel-card__heading"><div><p className="eyebrow eyebrow--muted">{t('settings.roomBackground')}</p><h2 id="room-background-title">{t('settings.roomBackgroundTitle')}</h2></div><span className="section-count">{t('admin.validated')}</span></div><form className="settings-grid" data-admin-settings-controls="room-background" onSubmit={(event) => void submitBackground(event)}><div className="form-field"><span className="form-field__label">{t('settings.roomBackground')}</span><div className="branding-media-actions"><input ref={backgroundInputRef} className="visually-hidden branding-file-input" id="setting-roomBackground" type="file" accept="image/*" onChange={(event) => { setPendingBackgroundFile(event.currentTarget.files?.[0] ?? null); setUploadError(null); event.currentTarget.value = ''; }} aria-label={t('settings.uploadRoomBackground')} tabIndex={-1} /><button className="icon-button branding-upload-button" type="button" onClick={() => backgroundInputRef.current?.click()} disabled={busy} aria-label={t('settings.uploadRoomBackground')} title={t('settings.uploadRoomBackground')}><Upload aria-hidden="true" size={17} strokeWidth={1.9} /></button><RoomBackgroundPreview value={roomBackground} pendingPreviewUrl={pendingPreviewUrl} /><button className="icon-button branding-remove-button" type="button" onClick={() => { if (pendingBackgroundFile === null) setRoomBackground(null); else setPendingBackgroundFile(null); setUploadError(null); }} disabled={busy || (roomBackground === null && pendingBackgroundFile === null)} aria-label={t('settings.removeRoomBackground')} title={t('settings.removeRoomBackground')}><X aria-hidden="true" size={17} strokeWidth={1.9} /></button></div>{uploadError !== null && <p className="form-error" role="alert">{uploadError}</p>}<p className="field-hint">{t('settings.roomBackgroundCopy')}</p></div><button className="button button--dark" type="submit" disabled={busy}>{t('common.saveChanges')}</button></form></section>;
}

interface RoomBackgroundPanelProps {
  setting: SettingDTO | undefined;
  busy: boolean;
  onSave: (changes: Record<string, unknown>) => Promise<boolean | void>;
  onUploadRoomBackground: (file: File) => Promise<boolean>;
}

async function resizeHotelImage(file: File): Promise<string> {
  if (!SUPPORTED_IMAGE_TYPES.some((type) => type === file.type)) throw new Error('Unsupported logo type.');
  const source = await loadImage(await readFileAsDataUrl(file));
  const scale = Math.min(1, 320 / Math.max(source.naturalWidth, source.naturalHeight));
  return encodeWebp(source, Math.max(1, Math.round(source.naturalWidth * scale)), Math.max(1, Math.round(source.naturalHeight * scale)), MAX_HOTEL_LOGO_LENGTH, false);
}

const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;

function encodeWebp(source: HTMLImageElement, width: number, height: number, maximumLength: number, crop: boolean): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Unable to prepare image.');

  if (crop) {
    const scale = Math.max(width / source.naturalWidth, height / source.naturalHeight);
    const drawnWidth = source.naturalWidth * scale;
    const drawnHeight = source.naturalHeight * scale;
    context.drawImage(source, (width - drawnWidth) / 2, (height - drawnHeight) / 2, drawnWidth, drawnHeight);
  } else {
    context.drawImage(source, 0, 0, width, height);
  }

  for (const quality of [0.86, 0.76, 0.66, 0.56, 0.46, 0.36]) {
    const dataUrl = canvas.toDataURL('image/webp', quality);
    if (dataUrl.startsWith('data:image/webp;base64,') && dataUrl.length < maximumLength) return dataUrl;
  }
  throw new Error('Image is too large.');
}

function RoomBackgroundPreview({ value, pendingPreviewUrl }: { value: RoomBackgroundValue; pendingPreviewUrl: string | null }): ReactNode {
  if (pendingPreviewUrl !== null) return <div className="branding-background-previews"><img className="branding-background-preview" data-room-background-variant="square480" src={pendingPreviewUrl} alt="" /><img className="branding-background-preview" data-room-background-variant="tablet" src={pendingPreviewUrl} alt="" /></div>;
  if (value === null) return null;
  if (typeof value === 'string') return <img className="branding-background-preview" src={value} alt="" />;
  return <div className="branding-background-previews"><img className="branding-background-preview" data-room-background-variant="square480" src={value.square480} alt="" /><img className="branding-background-preview" data-room-background-variant="tablet" src={value.tablet} alt="" /></div>;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to read logo.'));
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read logo.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to decode logo.'));
    image.src = source;
  });
}

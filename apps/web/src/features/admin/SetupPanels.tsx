import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Moon } from 'lucide-react';
import * as Shared from '@hotel/shared';
import type { AdminDTO, AreaDTO, RoomBackgroundVariants, RoomBackgroundValue, RoomDTO, ServiceDTO, SettingDTO, SettingKey } from '@hotel/shared';
import { TouchSelect, type TouchSelectOption } from '../../components/TouchSelect';
import { ServiceIcon } from '../../components/ServiceIcon';
import { useI18n, type MessageKey } from '../../i18n';

const { isRoomBackgroundValue, MAX_HOTEL_LOGO_LENGTH, MAX_ROOM_BACKGROUND_LENGTH } = Shared;

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
  onPatchArea: (area: AreaDTO, values: { code: string; displayName: string; description: string; displayOrder: number }) => Promise<boolean>;
  onToggleService: (service: ServiceDTO) => Promise<void>;
  onPatchService: (service: ServiceDTO, values: { code: string; displayName: string; description: string; iconKey: string; areaId: string; displayOrder: number }) => Promise<boolean>;
}

export type CatalogResource = 'rooms' | 'areas' | 'services';

export function CatalogPanels(props: CatalogPanelsProps) {
  const { t } = useI18n();
  return <div className="catalog-panels">
    {props.resource === 'rooms' && <CatalogResourceList title={t('admin.rooms')} eyebrow={t('admin.guestLocations')} items={props.rooms} busy={props.busy} onToggle={props.onToggleRoom} renderEdit={(room, close) => <RoomEditForm room={room} busy={props.busy} onCancel={close} onSubmit={(values) => props.onPatchRoom(room, values)} />} />}
    {props.resource === 'areas' && <CatalogResourceList title={t('admin.areas')} eyebrow={t('admin.responsibleTeams')} items={props.areas} busy={props.busy} onToggle={props.onToggleArea} renderEdit={(area, close) => <AreaEditForm area={area} busy={props.busy} onCancel={close} onSubmit={(values) => props.onPatchArea(area, values)} />} />}
    {props.resource === 'services' && <CatalogResourceList title={t('admin.servicesTitle')} eyebrow={t('admin.guestFacingChoices')} items={props.services} busy={props.busy} onToggle={props.onToggleService} renderEdit={(service, close) => <ServiceEditForm service={service} areas={props.areas} busy={props.busy} onCancel={close} onSubmit={(values) => props.onPatchService(service, values)} />} />}
  </div>;
}

interface CatalogItem { id: string; code: string; displayName: string; active: boolean; displayOrder: number; }

function CatalogResourceList<T extends CatalogItem>({ title, eyebrow, items, busy, onToggle, renderEdit }: { title: string; eyebrow: string; items: T[]; busy: boolean; onToggle: (item: T) => Promise<void>; renderEdit: (item: T, close: () => void) => ReactNode }) {
  const { t } = useI18n();
  const [editingId, setEditingId] = useState<string | null>(null);
  return (
    <section className="surface-card catalog-card" aria-labelledby={`catalog-${title.toLowerCase()}`}>
      <div className="panel-card__heading">
        <div><p className="eyebrow eyebrow--muted">{eyebrow}</p><h2 id={`catalog-${title.toLowerCase()}`}>{title}</h2></div>
        <span className="section-count">{items.length}</span>
      </div>
      <div className="catalog-list">
        {items.length === 0 ? <p className="catalog-empty">{t('admin.nothingHereYet')}</p> : items.map((item) => (
          <div className="catalog-row" key={item.id}>
            {editingId === item.id ? renderEdit(item, () => setEditingId(null)) : (
              <>
                <div>
                  <strong>{item.displayName}</strong>
                  <span>{item.code} · {t('admin.orderValue', { order: item.displayOrder })} · {item.active ? t('admin.active') : t('admin.inactive')}</span>
                  {'doNotDisturb' in item && item.doNotDisturb === true && <span className="room-dnd-status" role="status"><Moon aria-hidden="true" size={13} strokeWidth={1.8} />{t('admin.doNotDisturb')}</span>}
                </div>
                <div className="catalog-row__actions">
                  <button className="text-button" type="button" onClick={() => setEditingId(item.id)}>{t('admin.edit')}</button>
                  <button className={`text-button${item.active ? ' text-button--danger' : ''}`} type="button" onClick={() => void onToggle(item)} disabled={busy}>{item.active ? t('admin.deactivate') : t('admin.reactivate')}</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function RoomEditForm({ room, busy, onCancel, onSubmit }: { room: RoomDTO; busy: boolean; onCancel: () => void; onSubmit: (values: { code: string; displayName: string; floor: string; displayOrder: number; doNotDisturb: boolean }) => Promise<boolean> }) {
  const { t } = useI18n();
  const [code, setCode] = useState(room.code); const [displayName, setDisplayName] = useState(room.displayName); const [floor, setFloor] = useState(room.floor ?? ''); const [displayOrder, setDisplayOrder] = useState(String(room.displayOrder)); const [doNotDisturb, setDoNotDisturb] = useState(room.doNotDisturb);
  return <InlineEditForm onCancel={onCancel} busy={busy} onSubmit={async () => { if (await onSubmit({ code, displayName, floor, displayOrder: Number(displayOrder), doNotDisturb })) onCancel(); }}><div className="form-grid form-grid--compact"><Field label={t('admin.code')} value={code} onChange={setCode} required /><Field label={t('admin.displayName')} value={displayName} onChange={setDisplayName} required /><Field label={t('admin.floor')} value={floor} onChange={setFloor} /><Field label={t('admin.order')} type="number" value={displayOrder} onChange={setDisplayOrder} required /><label className="checkbox-field"><input type="checkbox" checked={doNotDisturb} onChange={(event) => setDoNotDisturb(event.target.checked)} /><span>{t('admin.doNotDisturb')}</span></label></div></InlineEditForm>;
}

function AreaEditForm({ area, busy, onCancel, onSubmit }: { area: AreaDTO; busy: boolean; onCancel: () => void; onSubmit: (values: { code: string; displayName: string; description: string; displayOrder: number }) => Promise<boolean> }) {
  const { t } = useI18n();
  const [code, setCode] = useState(area.code); const [displayName, setDisplayName] = useState(area.displayName); const [description, setDescription] = useState(area.description ?? ''); const [displayOrder, setDisplayOrder] = useState(String(area.displayOrder));
  return <InlineEditForm onCancel={onCancel} busy={busy} onSubmit={async () => { if (await onSubmit({ code, displayName, description, displayOrder: Number(displayOrder) })) onCancel(); }}><div className="form-grid form-grid--compact"><Field label={t('admin.code')} value={code} onChange={setCode} required /><Field label={t('admin.displayName')} value={displayName} onChange={setDisplayName} required /><Field label={t('admin.description')} value={description} onChange={setDescription} /><Field label={t('admin.order')} type="number" value={displayOrder} onChange={setDisplayOrder} required /></div></InlineEditForm>;
}

function ServiceEditForm({ service, areas, busy, onCancel, onSubmit }: { service: ServiceDTO; areas: AreaDTO[]; busy: boolean; onCancel: () => void; onSubmit: (values: { code: string; displayName: string; description: string; iconKey: string; areaId: string; displayOrder: number }) => Promise<boolean> }) {
  const { t } = useI18n();
  const [code, setCode] = useState(service.code); const [displayName, setDisplayName] = useState(service.displayName); const [description, setDescription] = useState(service.description ?? ''); const [iconKey, setIconKey] = useState(service.iconKey ?? 'bell'); const [areaId, setAreaId] = useState(service.areaId); const [displayOrder, setDisplayOrder] = useState(String(service.displayOrder));
  return <InlineEditForm onCancel={onCancel} busy={busy} onSubmit={async () => { if (await onSubmit({ code, displayName, description, iconKey, areaId, displayOrder: Number(displayOrder) })) onCancel(); }}><div className="form-grid form-grid--compact"><Field label={t('admin.code')} value={code} onChange={setCode} required /><Field label={t('admin.displayName')} value={displayName} onChange={setDisplayName} required /><Field label={t('admin.description')} value={description} onChange={setDescription} /><Field label={t('admin.order')} type="number" value={displayOrder} onChange={setDisplayOrder} required /><FieldSelect label={t('admin.area')} value={areaId} onChange={setAreaId} options={areas.map((area) => ({ value: area.id, label: area.displayName }))} /><FieldSelect label={t('admin.icon')} value={iconKey} onChange={setIconKey} options={SERVICE_ICON_OPTIONS.map((option) => ({ value: option.value, label: t(option.label), icon: option.icon }))} /></div></InlineEditForm>;
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
  onSave: (changes: Record<string, unknown>) => Promise<void>;
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
  hotelLogo: 'settings.hotelLogo',
  roomBackground: 'settings.roomBackground',
  clockFormat: 'settings.clockFormat'
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

function BaseSettingsPanel({ settings, busy, onSave }: SettingsPanelProps) {
  const { t } = useI18n();
  const [values, setValues] = useState<Record<string, SettingsFormValue>>({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const editableSettings = useMemo(() => settings.filter((setting) => setting.key !== 'roomBackground'), [settings]);
  useEffect(() => setValues(Object.fromEntries(editableSettings.map((setting) => [setting.key, setting.value === null ? '' : typeof setting.value === 'string' || typeof setting.value === 'number' ? setting.value : '']))), [editableSettings]);
  const numericSettings = settings.filter((setting): setting is SettingDTO & { value: number } => typeof setting.value === 'number');
  const hotelName = typeof values['hotelName'] === 'string' ? values['hotelName'] : '';
  const hotelLogo = typeof values['hotelLogo'] === 'string' ? values['hotelLogo'] : '';
  const clockFormat = typeof values['clockFormat'] === 'string' ? values['clockFormat'] : '12h';

  async function handleImageChange(file: File | undefined): Promise<void> {
    if (file === undefined) return;
    setUploadError(null);
    try {
      const image = await resizeHotelImage(file);
      setValues((current) => ({ ...current, hotelLogo: image }));
    } catch {
      setUploadError(t('settings.logoUploadError'));
    }
  }

  async function handleLogoChange(file: File | undefined): Promise<void> {
    await handleImageChange(file);
  }

  function submitSettings(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const changes = buildSettingsChanges(editableSettings, values);
    void onSave(changes);
  }

  return <section className="surface-card settings-card" aria-labelledby="settings-title"><div className="panel-card__heading"><div><p className="eyebrow eyebrow--muted">{t('admin.runtimePolicy')}</p><h2 id="settings-title">{t('admin.systemSettings')}</h2></div><span className="section-count">{t('admin.validated')}</span></div><form className="settings-grid" onSubmit={submitSettings}><div className="settings-branding"><div className="settings-branding__heading"><p className="eyebrow eyebrow--muted">{t('settings.branding')}</p><span>{t('settings.brandingCopy')}</span></div><div className="branding-fields"><div className="form-field"><label htmlFor="setting-hotelName">{t(SETTING_LABEL_KEYS.hotelName)}</label><input id="setting-hotelName" type="text" value={hotelName} onChange={(event) => setValues((current) => ({ ...current, hotelName: event.target.value }))} maxLength={120} required /></div><div className="form-field"><label htmlFor="setting-hotelLogo">{t(SETTING_LABEL_KEYS.hotelLogo)}</label><input id="setting-hotelLogo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => void handleLogoChange(event.target.files?.[0])} /><div className="branding-logo-actions">{hotelLogo.length > 0 && <img className="branding-logo-preview" src={hotelLogo} alt={hotelName || t('settings.hotelLogo')} />}<button className="text-button" type="button" onClick={() => setValues((current) => ({ ...current, hotelLogo: '' }))} disabled={busy || hotelLogo.length === 0}>{t('settings.removeLogo')}</button></div>{uploadError !== null && <p className="form-error" role="alert">{uploadError}</p>}</div><div className="form-field"><label htmlFor="setting-clockFormat">{t(SETTING_LABEL_KEYS.clockFormat)}</label><TouchSelect id="setting-clockFormat" label={t(SETTING_LABEL_KEYS.clockFormat)} value={clockFormat} onChange={(value) => setValues((current) => ({ ...current, clockFormat: value }))} options={[{ value: '12h', label: t('settings.clock12h') }, { value: '24h', label: t('settings.clock24h') }]} /></div></div></div>{numericSettings.map((setting) => <div className="setting-row" key={setting.key}><label htmlFor={`setting-${setting.key}`}>{t(SETTING_LABEL_KEYS[setting.key])}</label><input id={`setting-${setting.key}`} type="number" value={values[setting.key] ?? setting.value} onChange={(event) => setValues((current) => ({ ...current, [setting.key]: event.target.value }))} required /><span>{setting.key}</span></div>)}<button className="button button--dark" type="submit" disabled={busy}>{t('common.saveChanges')}</button></form></section>;
}

export function SettingsPanel(props: SettingsPanelProps) {
  return <div className="settings-panels"><BaseSettingsPanel {...props} /><RoomBackgroundPanel setting={props.settings.find((setting) => setting.key === 'roomBackground')} busy={props.busy} onSave={props.onSave} /></div>;
}

interface RoomBackgroundPanelProps {
  setting: SettingDTO | undefined;
  busy: boolean;
  onSave: (changes: Record<string, unknown>) => Promise<void>;
}

export function RoomBackgroundPanel({ setting, busy, onSave }: RoomBackgroundPanelProps) {
  const { t } = useI18n();
  const [roomBackground, setRoomBackground] = useState<RoomBackgroundValue>(() => isRoomBackgroundValue(setting?.value) ? setting.value : null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => setRoomBackground(isRoomBackgroundValue(setting?.value) ? setting.value : null), [setting]);

  async function handleBackgroundChange(file: File | undefined): Promise<void> {
    if (file === undefined) return;
    setUploadError(null);
    try {
      setRoomBackground(await resizeRoomBackgroundImage(file));
    } catch {
      setUploadError(t('settings.roomBackgroundUploadError'));
    }
  }

  function submitBackground(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void onSave({ roomBackground });
  }

  return <section className="surface-card settings-card room-background-settings" aria-labelledby="room-background-title"><div className="panel-card__heading"><div><p className="eyebrow eyebrow--muted">{t('settings.roomBackground')}</p><h2 id="room-background-title">{t('settings.roomBackgroundTitle')}</h2></div><span className="section-count">{t('admin.validated')}</span></div><form className="settings-grid" onSubmit={submitBackground}><div className="form-field"><label htmlFor="setting-roomBackground">{t('settings.roomBackground')}</label><input id="setting-roomBackground" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => void handleBackgroundChange(event.target.files?.[0])} /><div className="branding-logo-actions"><RoomBackgroundPreview value={roomBackground} /><button className="text-button" type="button" onClick={() => setRoomBackground(null)} disabled={busy || roomBackground === null}>{t('settings.removeRoomBackground')}</button></div>{uploadError !== null && <p className="form-error" role="alert">{uploadError}</p>}<p className="field-hint">{t('settings.roomBackgroundCopy')}</p></div><button className="button button--dark" type="submit" disabled={busy}>{t('common.saveChanges')}</button></form></section>;
}

async function resizeHotelImage(file: File): Promise<string> {
  if (!SUPPORTED_IMAGE_TYPES.some((type) => type === file.type)) throw new Error('Unsupported logo type.');
  const source = await loadImage(await readFileAsDataUrl(file));
  const scale = Math.min(1, 320 / Math.max(source.naturalWidth, source.naturalHeight));
  return encodeWebp(source, Math.max(1, Math.round(source.naturalWidth * scale)), Math.max(1, Math.round(source.naturalHeight * scale)), MAX_HOTEL_LOGO_LENGTH, false);
}

async function resizeRoomBackgroundImage(file: File): Promise<RoomBackgroundVariants> {
  if (!SUPPORTED_IMAGE_TYPES.some((type) => type === file.type)) throw new Error('Unsupported room background type.');
  const source = await loadImage(await readFileAsDataUrl(file));
  const square480 = encodeWebp(source, 480, 480, MAX_ROOM_BACKGROUND_LENGTH, true);
  const tablet = encodeWebp(source, 1024, 768, MAX_ROOM_BACKGROUND_LENGTH, true);
  if (square480.length + tablet.length >= MAX_ROOM_BACKGROUND_LENGTH) throw new Error('Room background is too large.');
  return { square480, tablet };
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

function RoomBackgroundPreview({ value }: { value: RoomBackgroundValue }): ReactNode {
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

interface AdminManagementProps {
  admins: AdminDTO[];
  busy: boolean;
  onCreate: (username: string, password: string) => Promise<boolean>;
  onToggle: (admin: AdminDTO) => Promise<void>;
}

export function AdminManagement({ admins, busy, onCreate, onToggle }: AdminManagementProps) {
  const { locale, t } = useI18n();
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  return <section className="surface-card admin-management" aria-labelledby="admin-management-title"><div className="panel-card__heading"><div><p className="eyebrow eyebrow--muted">{t('admin.access')}</p><h2 id="admin-management-title">{t('admin.administrators')}</h2></div><span className="section-count">{admins.length}</span></div><div className="admin-management__body"><form className="admin-create-form" onSubmit={async (event) => { event.preventDefault(); if (await onCreate(username, password)) { setUsername(''); setPassword(''); } }}><Field label={t('auth.username')} value={username} onChange={setUsername} required /><Field label={t('auth.password')} type="password" value={password} onChange={setPassword} required /><button className="button button--dark" type="submit" disabled={busy}>{t('admin.addAdministrator')}</button></form><div className="admin-list">{admins.map((admin) => <div className="admin-row" key={admin.id}><div><strong>{admin.username}</strong><span>{admin.active ? t('admin.active') : t('admin.inactive')} · {admin.lastLoginAt === null ? t('admin.neverSignedIn') : t('admin.lastSeen', { time: formatAdminDate(admin.lastLoginAt, locale) })}</span></div><button className={`text-button${admin.active ? ' text-button--danger' : ''}`} type="button" onClick={() => void onToggle(admin)} disabled={busy}>{admin.active ? t('admin.deactivate') : t('admin.reactivate')}</button></div>)}</div></div></section>;
}

function formatAdminDate(value: string, locale: 'en' | 'es'): string { return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(value)); }

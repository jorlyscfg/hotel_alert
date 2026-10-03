import { ArrowDown, ArrowUp, Pencil, Settings2, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type RefObject } from 'react';
import { DEFAULT_SETTINGS, INFORMATION_IMAGE_VARIANTS, type InformationImageDTO, type InformationImageVariant, type SettingDTO } from '@hotel/shared';
import type { InformationImageUploadField, InformationImageUploadSet } from '../../api';
import { Modal } from '../../components/Modal';
import { useI18n } from '../../i18n';

export interface InformationPanelProps {
  images: InformationImageDTO[];
  busy: boolean;
  onUpload: (file: InformationImageUploadSet) => Promise<boolean>;
  onRepair: (id: string, file: InformationImageUploadSet) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onReorder: (ids: string[]) => Promise<boolean>;
  settings?: SettingDTO[];
  onSaveSettings?: (changes: Record<string, unknown>) => Promise<boolean | void>;
}

export const INFORMATION_IMAGE_UPLOAD_FIELDS: InformationImageUploadField[] = ['image'];

export type InformationImageFiles = File | null;
export type InformationImageInputRefs = HTMLInputElement | null;

interface InformationImageSourceFieldProps {
  files: InformationImageFiles;
  inputRef: RefObject<HTMLInputElement>;
  disabled: boolean;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

export function InformationImageSourceField({ files, inputRef, disabled, onFileChange }: InformationImageSourceFieldProps) {
  const { t } = useI18n();
  const inputLabel = t('common.select', { label: t('admin.informationSourceImage') });
  return <div className="form-field">
    <span className="form-field__label">{t('admin.informationSourceImage')}</span>
    <div className="branding-media-actions">
      <input ref={inputRef} className="visually-hidden branding-file-input" id="information-image-source" name="image" type="file" accept="image/*" onChange={onFileChange} disabled={disabled} aria-label={inputLabel} tabIndex={-1} />
      <button className="icon-button branding-upload-button" type="button" onClick={() => inputRef.current?.click()} disabled={disabled} aria-label={inputLabel} title={inputLabel}>
        <Upload aria-hidden="true" size={17} strokeWidth={1.9} />
      </button>
    </div>
    <span className="field-hint">{files?.name ?? t('admin.informationNoFileSelected')}</span>
  </div>;
}

export function getMissingInformationImageVariantFields(image: InformationImageDTO): InformationImageVariant[] {
  const present = new Set(image.variants?.filter((variant) => variant.language === undefined).map((variant) => variant.variant));
  return INFORMATION_IMAGE_VARIANTS.filter((variant) => !present.has(variant));
}

export function InformationPanel({ images, busy, onUpload, onRepair, onDelete, onReorder, settings = [], onSaveSettings }: InformationPanelProps) {
  const { t } = useI18n();
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const repairInputRef = useRef<HTMLInputElement>(null);
  const [idleTimeoutSeconds, setIdleTimeoutSeconds] = useState(() => String(readTimingSetting(settings, 'information.idleTimeoutSeconds')));
  const [slideIntervalSeconds, setSlideIntervalSeconds] = useState(() => String(readTimingSetting(settings, 'information.slideIntervalSeconds')));
  const [uploadFile, setUploadFile] = useState<InformationImageFiles>(null);
  const [repairFile, setRepairFile] = useState<InformationImageFiles>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadSaving, setUploadSaving] = useState(false);
  const [repairImageId, setRepairImageId] = useState<string | null>(null);
  const [repairSaving, setRepairSaving] = useState(false);
  const [timingOpen, setTimingOpen] = useState(false);
  const [timingSaving, setTimingSaving] = useState(false);

  useEffect(() => {
    setIdleTimeoutSeconds(String(readTimingSetting(settings, 'information.idleTimeoutSeconds')));
    setSlideIntervalSeconds(String(readTimingSetting(settings, 'information.slideIntervalSeconds')));
  }, [settings]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>, setFile: (file: File | null) => void): void {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file !== undefined) setFile(file);
  }

  function resetFile(setFile: (file: File | null) => void, inputRef: { current: HTMLInputElement | null }): void {
    setFile(null);
    if (inputRef.current !== null) inputRef.current.value = '';
  }

  function closeUpload(): void {
    if (busy || uploadSaving) return;
    setUploadOpen(false);
    resetFile(setUploadFile, uploadInputRef);
  }

  async function submitUpload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || uploadSaving || uploadFile === null) return;
    setUploadSaving(true);
    try {
      const succeeded = await onUpload(uploadFile);
      if (succeeded) {
        setUploadOpen(false);
        resetFile(setUploadFile, uploadInputRef);
      }
    } finally {
      setUploadSaving(false);
    }
  }

  function openRepair(imageId: string): void {
    resetFile(setRepairFile, repairInputRef);
    setRepairImageId(imageId);
  }

  function closeRepair(): void {
    if (busy || repairSaving) return;
    setRepairImageId(null);
    resetFile(setRepairFile, repairInputRef);
  }

  async function submitRepair(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (repairImageId === null || busy || repairSaving || repairFile === null) return;
    setRepairSaving(true);
    try {
      const succeeded = await onRepair(repairImageId, repairFile);
      if (succeeded) closeRepair();
    } finally {
      setRepairSaving(false);
    }
  }

  async function moveImage(index: number, direction: -1 | 1): Promise<void> {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= images.length) return;
    const ids = images.map((image) => image.id);
    [ids[index], ids[nextIndex]] = [ids[nextIndex] ?? '', ids[index] ?? ''];
    await onReorder(ids);
  }

  function closeTimingSettings(): void {
    if (busy || timingSaving) return;
    setTimingOpen(false);
  }

  async function saveTimingSettings(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || timingSaving || onSaveSettings === undefined) return;
    setTimingSaving(true);
    try {
      const result = await onSaveSettings({
        'information.idleTimeoutSeconds': Number(idleTimeoutSeconds),
        'information.slideIntervalSeconds': Number(slideIntervalSeconds)
      });
      if (result !== false) setTimingOpen(false);
    } catch {
      return;
    } finally {
      setTimingSaving(false);
    }
  }

  const repairImage = images.find((image) => image.id === repairImageId);
  return (
    <>
      <section className="surface-card information-panel" aria-labelledby="information-panel-title" data-admin-information-panel="true">
        <div className="panel-card__heading">
          <div>
            <p className="eyebrow eyebrow--muted">{t('admin.information')}</p>
            <h2 id="information-panel-title">{t('admin.informationTitle')}</h2>
          </div>
          <div className="information-panel__heading-actions" data-admin-information-actions="true">
            <button className="icon-button information-panel__heading-action" type="button" onClick={() => setUploadOpen(true)} disabled={busy || uploadSaving} aria-label={t('admin.uploadInformationImage')} title={t('admin.uploadInformationImage')} data-admin-information-upload="true">
              <Upload aria-hidden="true" size={18} strokeWidth={1.9} />
            </button>
            <button className="icon-button information-panel__heading-action" type="button" onClick={() => setTimingOpen(true)} disabled={busy || timingSaving} aria-label={t('admin.openInformationSettings')} title={t('admin.openInformationSettings')} data-admin-information-settings="true">
              <Settings2 aria-hidden="true" size={18} strokeWidth={1.9} />
            </button>
            <span className="section-count" data-admin-information-count="true">{images.length}</span>
          </div>
        </div>
        <p className="panel-card__copy">{t('admin.informationCopy')}</p>
        {images.length === 0 ? (
          <p className="empty-panel">{t('admin.noInformationImages')}</p>
        ) : (
          <ol className="information-image-list">
            {images.map((image, index) => {
              const missingFields = getMissingInformationImageVariantFields(image);
              const missingLabels = missingFields.map((variant) => {
                return t(variant === 'square480' ? 'admin.informationSquareVariant' : 'admin.informationWideVariant');
              }).join(', ');
              return (
                <li className="information-image-item" key={image.id}>
                  <img className="information-image-item__preview" src={`/api/v1/information/images/${encodeURIComponent(image.id)}/content?language=es&variant=wide`} alt={image.originalName} />
                  <div className="information-image-item__details">
                    <strong>{image.originalName}</strong>
                    <span>{formatByteSize(image.byteSize)} · {image.mimeType}</span>
                    {missingFields.length > 0 && <p className="field-hint information-image-item__warning" role="status">{t('admin.informationVariantsMissing', { variants: missingLabels })}</p>}
                  </div>
                  <div className="information-image-item__actions">
                    <button className="icon-button" type="button" onClick={() => openRepair(image.id)} disabled={busy || repairSaving} aria-label={t('admin.repairInformationImage')} title={t('admin.repairInformationImage')}>
                      <Pencil aria-hidden="true" size={17} strokeWidth={1.9} />
                    </button>
                    <button className="icon-button" type="button" onClick={() => void moveImage(index, -1)} disabled={busy || index === 0} aria-label={t('admin.moveInformationImageUp')} title={t('admin.moveInformationImageUp')}>
                      <ArrowUp aria-hidden="true" size={17} strokeWidth={1.9} />
                    </button>
                    <button className="icon-button" type="button" onClick={() => void moveImage(index, 1)} disabled={busy || index === images.length - 1} aria-label={t('admin.moveInformationImageDown')} title={t('admin.moveInformationImageDown')}>
                      <ArrowDown aria-hidden="true" size={17} strokeWidth={1.9} />
                    </button>
                    <button className="icon-button branding-remove-button" type="button" onClick={() => void onDelete(image.id)} disabled={busy} aria-label={t('admin.deleteInformationImage')} title={t('admin.deleteInformationImage')}>
                      <Trash2 aria-hidden="true" size={17} strokeWidth={1.9} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
      <Modal open={uploadOpen} title={t('admin.informationUploadTitle')} onClose={closeUpload} closeLabel={t('common.closeDialog')} className="information-upload-modal">
        <form className="information-upload" data-admin-information-upload-form="true" onSubmit={(event) => void submitUpload(event)}>
          <p className="panel-card__copy">{t('admin.informationUploadCopy')}</p>
          <div className="information-upload__grid">
            <InformationImageSourceField files={uploadFile} inputRef={uploadInputRef} disabled={busy || uploadSaving} onFileChange={(event) => handleFileChange(event, setUploadFile)} />
          </div>
          {uploadFile === null && <p className="field-hint" role="status">{t('admin.informationImageSourceRequired')}</p>}
          <div className="form-actions">
            <button className="button button--ghost" type="button" onClick={closeUpload} disabled={busy || uploadSaving}>{t('common.cancel')}</button>
            <button className="button button--dark" type="submit" disabled={busy || uploadSaving || uploadFile === null}>{t('admin.uploadInformationImage')}</button>
          </div>
        </form>
      </Modal>
      <Modal open={repairImage !== undefined} title={t('admin.informationRepairTitle')} onClose={closeRepair} closeLabel={t('common.closeDialog')} className="information-upload-modal">
        {repairImage !== undefined && <form className="information-upload" data-admin-information-repair-form="true" onSubmit={(event) => void submitRepair(event)}>
          <p className="panel-card__copy">{t('admin.informationRepairCopy')}</p>
          <div className="information-upload__grid">
            <InformationImageSourceField files={repairFile} inputRef={repairInputRef} disabled={busy || repairSaving} onFileChange={(event) => handleFileChange(event, setRepairFile)} />
          </div>
          <div className="form-actions">
            <button className="button button--ghost" type="button" onClick={closeRepair} disabled={busy || repairSaving}>{t('common.cancel')}</button>
            <button className="button button--dark" type="submit" disabled={busy || repairSaving || repairFile === null}>{t('admin.repairInformationImage')}</button>
          </div>
        </form>}
      </Modal>
      <Modal open={timingOpen} title={t('admin.informationSettingsTitle')} onClose={closeTimingSettings} closeLabel={t('common.closeDialog')} className="information-settings-modal">
        <form className="information-panel__timing" data-admin-information-timing="true" onSubmit={(event) => void saveTimingSettings(event)}>
          <div className="form-field">
            <label htmlFor="information-idle-timeout-seconds">{t('settings.informationIdleTimeout')}</label>
            <input id="information-idle-timeout-seconds" type="number" min="1" max="300" value={idleTimeoutSeconds} onChange={(event) => setIdleTimeoutSeconds(event.target.value)} required />
          </div>
          <div className="form-field">
            <label htmlFor="information-slide-interval-seconds">{t('settings.informationSlideInterval')}</label>
            <input id="information-slide-interval-seconds" type="number" min="1" max="300" value={slideIntervalSeconds} onChange={(event) => setSlideIntervalSeconds(event.target.value)} required />
          </div>
          <div className="form-actions">
            <button className="button button--dark" type="submit" disabled={busy || timingSaving || onSaveSettings === undefined} data-autofocus>{t('common.saveChanges')}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readTimingSetting(settings: SettingDTO[], key: 'information.idleTimeoutSeconds' | 'information.slideIntervalSeconds'): number {
  const value = settings.find((setting) => setting.key === key)?.value;
  return typeof value === 'number' ? value : DEFAULT_SETTINGS[key];
}

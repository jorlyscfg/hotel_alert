import { ArrowDown, ArrowUp, Pencil, Settings2, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { DEFAULT_SETTINGS, INFORMATION_IMAGE_LANGUAGES, INFORMATION_IMAGE_VARIANTS, type InformationImageDTO, type InformationImageLanguage, type InformationImageVariant, type SettingDTO } from '@hotel/shared';
import type { InformationImageUploadField, InformationImageUploadSet } from '../../api';
import { Modal } from '../../components/Modal';
import { useI18n } from '../../i18n';

export interface InformationPanelProps {
  images: InformationImageDTO[];
  busy: boolean;
  onUpload: (files: InformationImageUploadSet) => Promise<boolean>;
  onRepair: (id: string, files: InformationImageUploadSet) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onReorder: (ids: string[]) => Promise<boolean>;
  settings?: SettingDTO[];
  onSaveSettings?: (changes: Record<string, unknown>) => Promise<boolean | void>;
}

export const INFORMATION_IMAGE_UPLOAD_FIELDS = INFORMATION_IMAGE_LANGUAGES.flatMap((language) => INFORMATION_IMAGE_VARIANTS.map((variant) => `${language}-${variant}` as const)) as InformationImageUploadField[];

export type InformationImageFiles = Partial<Record<InformationImageUploadField, File>>;
type InformationImageFileSetter = Dispatch<SetStateAction<InformationImageFiles>>;
export type InformationImageInputRefs = Partial<Record<InformationImageUploadField, HTMLInputElement | null>>;

interface InformationImageVariantFieldsProps {
  files: InformationImageFiles;
  refs: InformationImageInputRefs;
  disabled: boolean;
  onFileChange: (field: InformationImageUploadField, event: ChangeEvent<HTMLInputElement>) => void;
}

export function InformationImageVariantFields({ files, refs, disabled, onFileChange }: InformationImageVariantFieldsProps) {
  const { t } = useI18n();

  return <>
    {INFORMATION_IMAGE_UPLOAD_FIELDS.map((field) => {
      const [language, variant] = field.split('-') as [InformationImageLanguage, InformationImageVariant];
      const languageLabel = t(language === 'en' ? 'admin.informationLanguageEnglish' : 'admin.informationLanguageSpanish');
      const variantLabel = t(variant === 'square480' ? 'admin.informationSquareVariant' : 'admin.informationWideVariant');
      const inputLabel = t('common.select', { label: `${languageLabel} · ${variantLabel}` });
      const id = `information-image-${field}`;
      return (
        <div className="form-field" key={field}>
          <span className="form-field__label">{languageLabel} · {variantLabel}</span>
          <div className="branding-media-actions">
            <input ref={(input) => { refs[field] = input; }} className="visually-hidden branding-file-input" id={id} name={field} type="file" accept="image/*" onChange={(event) => onFileChange(field, event)} disabled={disabled} aria-label={inputLabel} tabIndex={-1} />
            <button className="icon-button branding-upload-button" type="button" onClick={() => refs[field]?.click()} disabled={disabled} aria-label={inputLabel} title={inputLabel}>
              <Upload aria-hidden="true" size={17} strokeWidth={1.9} />
            </button>
          </div>
          <span className="field-hint">{files[field]?.name ?? t('admin.informationNoFileSelected')} · {variantLabel}</span>
        </div>
      );
    })}
  </>;
}

export function getMissingInformationImageVariantFields(image: InformationImageDTO): InformationImageUploadField[] {
  const present = new Set(image.variants?.filter((variant) => variant.language !== undefined).map((variant) => `${variant.language}-${variant.variant}`));
  return INFORMATION_IMAGE_UPLOAD_FIELDS.filter((field) => !present.has(field));
}

export function InformationPanel({ images, busy, onUpload, onRepair, onDelete, onReorder, settings = [], onSaveSettings }: InformationPanelProps) {
  const { t } = useI18n();
  const uploadInputRefs = useRef<InformationImageInputRefs>({});
  const repairInputRefs = useRef<InformationImageInputRefs>({});
  const [idleTimeoutSeconds, setIdleTimeoutSeconds] = useState(() => String(readTimingSetting(settings, 'information.idleTimeoutSeconds')));
  const [slideIntervalSeconds, setSlideIntervalSeconds] = useState(() => String(readTimingSetting(settings, 'information.slideIntervalSeconds')));
  const [uploadFiles, setUploadFiles] = useState<InformationImageFiles>({});
  const [repairFiles, setRepairFiles] = useState<InformationImageFiles>({});
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

  function handleFileChange(field: InformationImageUploadField, event: ChangeEvent<HTMLInputElement>, setFiles: InformationImageFileSetter): void {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file !== undefined) setFiles((current) => ({ ...current, [field]: file }));
  }

  function resetFiles(setFiles: InformationImageFileSetter, refs: InformationImageInputRefs): void {
    setFiles({});
    Object.values(refs).forEach((input) => {
      if (input !== null && input !== undefined) input.value = '';
    });
  }

  function closeUpload(): void {
    if (busy || uploadSaving) return;
    setUploadOpen(false);
    resetFiles(setUploadFiles, uploadInputRefs.current);
  }

  async function submitUpload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const includesSpanish = INFORMATION_IMAGE_LANGUAGES.some((language) => language === 'es' && INFORMATION_IMAGE_VARIANTS.some((variant) => uploadFiles[`${language}-${variant}`] !== undefined));
    const includesEnglish = INFORMATION_IMAGE_LANGUAGES.some((language) => language === 'en' && INFORMATION_IMAGE_VARIANTS.some((variant) => uploadFiles[`${language}-${variant}`] !== undefined));
    if (busy || uploadSaving || !includesSpanish || !includesEnglish) return;
    setUploadSaving(true);
    try {
      const succeeded = await onUpload(uploadFiles);
      if (succeeded) {
        setUploadOpen(false);
        resetFiles(setUploadFiles, uploadInputRefs.current);
      }
    } finally {
      setUploadSaving(false);
    }
  }

  function openRepair(imageId: string): void {
    resetFiles(setRepairFiles, repairInputRefs.current);
    setRepairImageId(imageId);
  }

  function closeRepair(): void {
    if (busy || repairSaving) return;
    setRepairImageId(null);
    resetFiles(setRepairFiles, repairInputRefs.current);
  }

  async function submitRepair(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (repairImageId === null || busy || repairSaving || Object.keys(repairFiles).length === 0) return;
    setRepairSaving(true);
    try {
      const succeeded = await onRepair(repairImageId, repairFiles);
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
  const uploadHasSpanish = INFORMATION_IMAGE_VARIANTS.some((variant) => uploadFiles[`es-${variant}`] !== undefined);
  const uploadHasEnglish = INFORMATION_IMAGE_VARIANTS.some((variant) => uploadFiles[`en-${variant}`] !== undefined);

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
              const missingLabels = missingFields.map((field) => {
                const [language, variant] = field.split('-') as [InformationImageLanguage, InformationImageVariant];
                return `${t(language === 'en' ? 'admin.informationLanguageEnglish' : 'admin.informationLanguageSpanish')} · ${t(variant === 'square480' ? 'admin.informationSquareVariant' : 'admin.informationWideVariant')}`;
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
          <div className="information-upload__grid information-upload__grid--localized">
            <InformationImageVariantFields files={uploadFiles} refs={uploadInputRefs.current} disabled={busy || uploadSaving} onFileChange={(field, event) => handleFileChange(field, event, setUploadFiles)} />
          </div>
          {(!uploadHasSpanish || !uploadHasEnglish) && <p className="field-hint" role="status">{t('admin.informationUploadLanguagesRequired')}</p>}
          <div className="form-actions">
            <button className="button button--ghost" type="button" onClick={closeUpload} disabled={busy || uploadSaving}>{t('common.cancel')}</button>
            <button className="button button--dark" type="submit" disabled={busy || uploadSaving || !uploadHasSpanish || !uploadHasEnglish}>{t('admin.uploadInformationImage')}</button>
          </div>
        </form>
      </Modal>
      <Modal open={repairImage !== undefined} title={t('admin.informationRepairTitle')} onClose={closeRepair} closeLabel={t('common.closeDialog')} className="information-upload-modal">
        {repairImage !== undefined && <form className="information-upload" data-admin-information-repair-form="true" onSubmit={(event) => void submitRepair(event)}>
          <p className="panel-card__copy">{t('admin.informationRepairCopy')}</p>
          <div className="information-upload__grid information-upload__grid--localized">
            <InformationImageVariantFields files={repairFiles} refs={repairInputRefs.current} disabled={busy || repairSaving} onFileChange={(field, event) => handleFileChange(field, event, setRepairFiles)} />
          </div>
          <div className="form-actions">
            <button className="button button--ghost" type="button" onClick={closeRepair} disabled={busy || repairSaving}>{t('common.cancel')}</button>
            <button className="button button--dark" type="submit" disabled={busy || repairSaving || Object.keys(repairFiles).length === 0}>{t('admin.repairInformationImage')}</button>
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

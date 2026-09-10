import { TouchSelect } from './TouchSelect';
import { getLocaleOptions, useI18n, resolveLocale } from '../i18n';

export function LanguageSelector() {
  const { locale, setLocale, t } = useI18n();

  return (
    <TouchSelect
      label={t('language.label')}
      value={locale}
      className="language-selector"
      modal
      selectedLabel={locale.toUpperCase()}
       options={getLocaleOptions()}
      onChange={(value) => setLocale(resolveLocale(value))}
    />
  );
}

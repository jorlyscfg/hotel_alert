import { useState } from 'react';
import { ArrowUpRight, Check, CircleAlert, Clipboard } from 'lucide-react';
import type { AdminLoginResult, BootstrapState } from '@hotel/shared';
import { useI18n } from '../../i18n';
import { AdminLoginForm } from '../auth/AdminLoginForm';

interface BootstrapScreenProps {
  installationId: string;
  bootstrapState: BootstrapState | null;
  error: string | null;
  onRetry: () => void;
  onAdminLogin: (result: AdminLoginResult) => Promise<void>;
}

export function BootstrapScreen({ installationId, bootstrapState, error, onRetry, onAdminLogin }: BootstrapScreenProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const configured = bootstrapState?.configured ?? false;

  async function copyInstallationId() {
    try {
      await navigator.clipboard.writeText(installationId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="app-frame app-frame--centered">
      <div className="ambient-mark ambient-mark--top" aria-hidden="true" />
      <div className="auth-layout">
        <section className="intro-panel" aria-labelledby="welcome-title">
          <div className="eyebrow"><span className="eyebrow__line" /> {t('bootstrap.productName')}</div>
          <h1 id="welcome-title">{t('bootstrap.headline')}</h1>
          <p className="intro-panel__copy">
            {t('bootstrap.copy')}
          </p>
          <div className="intro-panel__note">
             <span className="note-icon" aria-hidden="true"><ArrowUpRight size={16} strokeWidth={1.8} /></span>
            <span>{t('bootstrap.offlineNote')}</span>
          </div>
        </section>

        <section className="surface-card bootstrap-card" aria-labelledby="setup-title">
          <div className="card-heading">
            <div>
               <p className="eyebrow eyebrow--muted">{t('bootstrap.setup')}</p>
               <h2 id="setup-title">{t('bootstrap.adminSignIn')}</h2>
            </div>
            <span className={`status-chip ${configured ? 'status-chip--ready' : 'status-chip--waiting'}`}>
              <span className="status-chip__dot" aria-hidden="true" />
               {configured ? t('bootstrap.paired') : t('bootstrap.waitingToPair')}
            </span>
          </div>

          <p className="card-copy">
            {configured
               ? t('bootstrap.pairedCopy')
               : t('bootstrap.unpairedCopy')}
          </p>

          <div className="installation-code">
            <div>
               <span className="installation-code__label">{t('bootstrap.installationId')}</span>
              <code>{installationId}</code>
            </div>
             <button className="icon-button" type="button" onClick={copyInstallationId} aria-label={copied ? t('common.copied') : t('bootstrap.copyInstallationId')} title={copied ? t('common.copied') : t('bootstrap.copyInstallationId')}>
               {copied ? <Check aria-hidden="true" size={19} strokeWidth={1.8} /> : <Clipboard aria-hidden="true" size={19} strokeWidth={1.8} />}
            </button>
          </div>

          <AdminLoginForm onSuccess={onAdminLogin} />

          {error !== null && (
            <div className="inline-alert" role="alert">
               <span aria-hidden="true"><CircleAlert size={16} strokeWidth={1.8} /></span>
              <span>{error}</span>
               <button className="text-button" type="button" onClick={onRetry}>{t('common.retry')}</button>
            </div>
          )}
        </section>
      </div>
       <p className="build-stamp">{t('bootstrap.buildStamp')}</p>
    </main>
  );
}

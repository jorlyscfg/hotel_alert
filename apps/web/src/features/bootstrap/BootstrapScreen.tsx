import { CircleAlert } from 'lucide-react';
import type { AdminLoginResult, BootstrapState } from '@hotel/shared';
import { useI18n } from '../../i18n';
import { AdminLoginForm } from '../auth/AdminLoginForm';

interface BootstrapScreenProps {
  installationId: string;
  bootstrapState: BootstrapState | null;
  error: string | null;
  onRetry: () => void;
  onAdminLogin: (result: AdminLoginResult, role: 'ADMIN' | 'ROOM' | 'AREA') => Promise<void>;
}

export function BootstrapScreen({ error, onRetry, onAdminLogin }: BootstrapScreenProps) {
  const { t } = useI18n();

  return (
    <main className="app-frame app-frame--centered bootstrap-login-screen">
      <section className="surface-card bootstrap-card bootstrap-login-card" aria-label={t('bootstrap.adminSignIn')}>
        <AdminLoginForm allowStationRoles onSuccess={onAdminLogin} />

        {error !== null && (
          <div className="inline-alert" role="alert">
            <span aria-hidden="true"><CircleAlert size={16} strokeWidth={1.8} /></span>
            <span>{error}</span>
            <button className="text-button" type="button" onClick={onRetry}>{t('common.retry')}</button>
          </div>
        )}
      </section>
    </main>
  );
}

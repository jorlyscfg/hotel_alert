import { useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { AdminLoginResult } from '@hotel/shared';
import { api, errorMessage, isApiError } from '../../api';
import { useI18n } from '../../i18n';

interface AdminLoginFormProps {
  onSuccess: (result: AdminLoginResult) => Promise<void> | void;
  onCancel?: () => void;
  compact?: boolean;
}

export const ADMIN_LOGIN_ERROR_ID = 'admin-login-error';

export function resolveAdminLoginFieldAccessibility(error: string | null, credentialsRejected: boolean): {
  describedBy: string | undefined;
  invalid: boolean | undefined;
} {
  return {
    describedBy: error === null ? undefined : ADMIN_LOGIN_ERROR_ID,
    invalid: error !== null && credentialsRejected ? true : undefined
  };
}

export function resolveAdminLoginPasswordInputType(visible: boolean): 'password' | 'text' {
  return visible ? 'text' : 'password';
}

export function AdminLoginError({ message }: { message: string }) {
  return <p id={ADMIN_LOGIN_ERROR_ID} className="form-error" role="alert" aria-live="assertive">{message}</p>;
}

export function AdminLoginForm({ onSuccess, onCancel, compact = false }: AdminLoginFormProps) {
  const { locale, t } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credentialsRejected, setCredentialsRejected] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fieldAccessibility = resolveAdminLoginFieldAccessibility(error, credentialsRejected);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCredentialsRejected(false);
    setSubmitting(true);
    try {
      const result = await api.post<AdminLoginResult>('/auth/admin/login', { username, password });
      await onSuccess(result.data);
    } catch (submissionError) {
      setCredentialsRejected(isApiError(submissionError) && submissionError.code === 'AUTH_INVALID');
      setError(errorMessage(submissionError, t('errors.signInFailed'), locale));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={`auth-form${compact ? ' auth-form--compact' : ''}`} onSubmit={submit} aria-describedby={error === null ? undefined : ADMIN_LOGIN_ERROR_ID}>
      <div className="form-field">
         <label htmlFor="admin-username">{t('auth.username')}</label>
        <input
          id="admin-username"
          name="username"
          value={username}
           onChange={(event) => setUsername(event.target.value)}
           autoComplete="username"
            placeholder={t('auth.usernamePlaceholder')}
           aria-describedby={fieldAccessibility.describedBy}
           aria-invalid={fieldAccessibility.invalid}
           required
          maxLength={64}
        />
      </div>
      <div className="form-field">
          <label htmlFor="admin-password">{t('auth.password')}</label>
         <div className="password-input">
           <input
             id="admin-password"
             name="password"
             type={resolveAdminLoginPasswordInputType(passwordVisible)}
             value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
               placeholder={t('auth.passwordPlaceholder')}
              aria-describedby={fieldAccessibility.describedBy}
              aria-invalid={fieldAccessibility.invalid}
              required
             maxLength={256}
           />
           <button
             className="icon-button admin-login-password-toggle"
             type="button"
             onClick={() => setPasswordVisible((visible) => !visible)}
             aria-label={passwordVisible ? t('auth.hidePassword') : t('auth.showPassword')}
             title={passwordVisible ? t('auth.hidePassword') : t('auth.showPassword')}
           >
               {passwordVisible ? <EyeOff aria-hidden="true" size={20} strokeWidth={1.8} /> : <Eye aria-hidden="true" size={20} strokeWidth={1.8} />}
           </button>
         </div>
      </div>
      {error !== null && <AdminLoginError message={error} />}
      <div className="form-actions">
        {onCancel !== undefined && (
          <button className="button button--ghost" type="button" onClick={onCancel} disabled={submitting}>
             {t('common.cancel')}
          </button>
        )}
        <button className="button button--primary" type="submit" disabled={submitting}>
           {submitting ? t('common.signingIn') : t('common.signIn')}
        </button>
      </div>
    </form>
  );
}

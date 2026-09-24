import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_LOGIN_ERROR_ID,
  AdminLoginForm,
  AdminLoginError,
  resolveAdminLoginFieldAccessibility,
  resolveAdminLoginPasswordInputType
} from '../../apps/web/src/features/auth/AdminLoginForm';
import { createTranslator } from '../../apps/web/src/i18n';

describe('admin login error semantics', () => {
  it('explains invalid credentials clearly without identifying which field failed', () => {
    expect(createTranslator('en')('errors.authInvalid')).toBe('Incorrect username or password.');
    expect(createTranslator('es')('errors.authInvalid')).toBe('Usuario o contraseña incorrectos.');
  });

  it('associates the form error with both fields and marks rejected credentials invalid', () => {
    expect(resolveAdminLoginFieldAccessibility(null, false)).toEqual({
      describedBy: undefined,
      invalid: undefined
    });
    expect(resolveAdminLoginFieldAccessibility('Sign-in failed.', true)).toEqual({
      describedBy: ADMIN_LOGIN_ERROR_ID,
      invalid: true
    });
    expect(resolveAdminLoginFieldAccessibility('Try again later.', false)).toEqual({
      describedBy: ADMIN_LOGIN_ERROR_ID,
      invalid: undefined
    });
  });

  it('renders a stable, assertive error announcement for authentication failures', () => {
    const markup = renderToStaticMarkup(createElement(AdminLoginError, { message: 'Sign-in failed.' }));

    expect(markup).toContain(`id="${ADMIN_LOGIN_ERROR_ID}"`);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-live="assertive"');
    expect(markup).toContain('Sign-in failed.');
  });
});

describe('admin login password visibility', () => {
  it('starts masked and exposes a localized native toggle without submitting the form', () => {
    const markup = renderToStaticMarkup(createElement(AdminLoginForm, { onSuccess: () => undefined }));

    expect(markup).toContain('id="admin-password"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain('class="icon-button admin-login-password-toggle" type="button"');
    expect(markup).toContain('aria-label="Show password"');
    expect(markup).toContain('title="Show password"');
    expect(markup).toMatch(/class="icon-button admin-login-password-toggle"[^>]*><svg[^>]*aria-hidden="true"[^>]*>/);
    expect(markup).toContain('lucide-eye');
    expect(markup).not.toContain('◉');
    expect(markup).not.toContain('◌');
  });

  it('maps visibility changes from masked to visible and back to masked', () => {
    expect(resolveAdminLoginPasswordInputType(false)).toBe('password');
    expect(resolveAdminLoginPasswordInputType(true)).toBe('text');
    expect(resolveAdminLoginPasswordInputType(false)).toBe('password');
  });

  it('provides localized labels for both password visibility states', () => {
    const english = createTranslator('en');
    const spanish = createTranslator('es');

    expect(english('auth.showPassword')).toBe('Show password');
    expect(english('auth.hidePassword')).toBe('Hide password');
    expect(spanish('auth.showPassword')).toBe('Mostrar contraseña');
    expect(spanish('auth.hidePassword')).toBe('Ocultar contraseña');
    expect(english('auth.roleAdmin')).toBe('Admin');
    expect(english('auth.roleRoom')).toBe('Room');
    expect(english('auth.roleArea')).toBe('Area');
    expect(spanish('auth.roleAdmin')).toBe('Admin');
    expect(spanish('auth.roleRoom')).toBe('Habitación');
    expect(spanish('auth.roleArea')).toBe('Área');
  });
});

describe('station role selection', () => {
  it('renders the three station roles only when station onboarding is enabled', () => {
    const adminMarkup = renderToStaticMarkup(createElement(AdminLoginForm, { onSuccess: () => undefined }));
    const stationMarkup = renderToStaticMarkup(createElement(AdminLoginForm, { allowStationRoles: true, onSuccess: () => undefined }));

    expect(adminMarkup).not.toContain('station-role-picker');
    expect(stationMarkup).toContain('station-role-picker');
    expect(stationMarkup).toContain('role="group"');
    expect(stationMarkup).toContain('aria-pressed="true"');
    expect(stationMarkup).toContain('station-role-option__label">Admin</span>');
    expect(stationMarkup).toContain('station-role-option__label">Room</span>');
    expect(stationMarkup).toContain('station-role-option__label">Area</span>');
    expect(stationMarkup).not.toContain('name="station-role"');
    expect(stationMarkup).not.toContain('lucide-shield-check');
    expect(stationMarkup).not.toContain('lucide-tv');
    expect(stationMarkup).not.toContain('lucide-monitor');
  });
});

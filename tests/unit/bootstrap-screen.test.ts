import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BootstrapState } from '@hotel/shared';
import { BootstrapScreen } from '../../apps/web/src/features/bootstrap/BootstrapScreen';
import { I18nProvider } from '../../apps/web/src/i18n';

const styles = readFileSync(fileURLToPath(new URL('../../apps/web/src/styles.css', import.meta.url)), 'utf8');

describe('bootstrap screen', () => {
  it('keeps the login surface limited to the form and its actionable error', () => {
    const bootstrapState: BootstrapState = {
      installationId: 'installation-1',
      configured: false,
      displayHint: null
    };
    const markup = renderToStaticMarkup(createElement(I18nProvider, {
      children: createElement(BootstrapScreen, {
        installationId: 'installation-1',
        bootstrapState,
        error: 'Local service unavailable.',
        onRetry: () => undefined,
        onAdminLogin: async () => undefined
      })
    }));

    expect(markup).toContain('lucide-circle-alert');
    expect(markup).toContain('auth-form');
    expect(markup).toContain('station-role-picker');
    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).not.toContain('name="station-role"');
    expect(markup).not.toContain('station-role-option__icon');
    expect(markup).not.toContain('intro-panel');
    expect(markup).not.toContain('ambient-mark');
    expect(markup).not.toContain('installation-code');
    expect(markup).not.toContain('build-stamp');
  });

  it('keeps square kiosks compact while preserving a three-column tablet form', () => {
    expect(styles).toContain('@media (max-width: 520px) and (max-height: 520px)');
    expect(styles).toContain('.bootstrap-login-card .station-role-picker__options { gap: 4px; grid-template-columns: repeat(3, minmax(0, 1fr)); }');
    expect(styles).toContain('.bootstrap-login-card .station-role-option__label { font-size: 0.62rem; line-height: 1.1; }');
    expect(styles).toContain('@media (min-width: 721px)');
    expect(styles).toContain('.bootstrap-login-card .station-role-picker__options { grid-template-columns: repeat(3, minmax(0, 1fr)); }');
  });
});

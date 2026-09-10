import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BootstrapState } from '@hotel/shared';
import { BootstrapScreen } from '../../apps/web/src/features/bootstrap/BootstrapScreen';
import { I18nProvider } from '../../apps/web/src/i18n';

describe('bootstrap screen icons', () => {
  it('uses library icons for setup guidance, copy, and errors', () => {
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

    expect(markup).toContain('lucide-arrow-up-right');
    expect(markup).toContain('lucide-clipboard');
    expect(markup).toContain('lucide-circle-alert');
    expect(markup).not.toMatch(/>↗<|>⧉<|>!<\/span>/);
  });
});

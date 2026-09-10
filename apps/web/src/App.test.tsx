import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as appModule from './App';
import { LoadingScreen } from './App';
import { startupErrorMessage } from './api';
import { BootstrapScreen } from './features/bootstrap/BootstrapScreen';

describe('web application startup states', () => {
  it('renders initial loading as an accessible layout-preserving skeleton', () => {
    const markup = renderToStaticMarkup(createElement(LoadingScreen));

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('aria-label="Loading hotel operations"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('loading-shell');
    expect(markup).toContain('loading-skeleton');
    expect(markup).toContain('loading-shell__services');
    expect(markup).toContain('Loading hotel operations.');
    expect(markup).not.toContain('app-frame--centered');
  });

  it('shows local service unavailability and preserves the retry control', () => {
    const error = startupErrorMessage(new Error('private stack trace'));
    const markup = renderToStaticMarkup(createElement(BootstrapScreen, {
      installationId: 'install-1',
      bootstrapState: null,
      error,
      onRetry: () => undefined,
      onAdminLogin: async () => undefined
    }));

    expect(markup).toContain('The local service is unavailable.');
    expect(markup).toContain('Automatic retry will continue with bounded backoff.');
    expect(markup).toContain('>Retry</button>');
    expect(markup).not.toContain('private stack trace');
  });

  it('scopes the ROOM admin login dialog with the shared modal theme', () => {
    const candidate = Reflect.get(appModule, 'AdminLoginDialog');
    expect(typeof candidate).toBe('function');
    if (typeof candidate !== 'function') return;

    const markup = renderToStaticMarkup(createElement(candidate as ComponentType<{
      onSuccess: () => Promise<void>;
      onCancel: () => void;
    }>, {
      onSuccess: async () => undefined,
      onCancel: () => undefined
    }));

    expect(markup).toContain('room-modal');
    expect(markup).toContain('room-admin-login-modal');
    expect(markup).toContain('auth-form--compact');
  });
});

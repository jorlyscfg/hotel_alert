import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Modal, getFocusableSelector, getInitialFocusSelector } from '../../apps/web/src/components/Modal';

describe('accessible modal', () => {
  it('renders the dialog semantics and close control', () => {
    const markup = renderToStaticMarkup(createElement(Modal, {
      open: true,
      title: 'Confirm request',
      onClose: () => undefined,
      children: createElement('p', null, 'The team will see this request.')
    }));

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby=');
    expect(markup).toContain('aria-label="Close dialog"');
    expect(markup).toContain('lucide-x');
    expect(markup).not.toContain('>×</button>');
  });

  it('applies a caller-provided scrim class for anchored panels', () => {
    const props = {
      open: true,
      title: 'Request status',
      onClose: () => undefined,
      children: createElement('p', null, 'Requests are listed here.'),
      scrimClassName: 'room-request-status-scrim'
    };
    const markup = renderToStaticMarkup(createElement(Modal, props));

    expect(markup).toContain('class="modal-scrim room-request-status-scrim"');
  });

  it('uses a conservative focusable-element selector for focus trapping', () => {
    expect(getFocusableSelector()).toContain('button:not([disabled])');
    expect(getFocusableSelector()).toContain('[tabindex]:not([tabindex="-1"])');
  });

  it('prioritizes an explicitly marked initial focus target', () => {
    expect(getInitialFocusSelector()).toBe('[data-autofocus]');
  });
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LanguageSelector } from '../../apps/web/src/components/LanguageSelector';
import { TouchSelect, getNextOptionIndex, hasSelectableValue } from '../../apps/web/src/components/TouchSelect';

describe('touch select', () => {
  it('moves through options with bounded keyboard navigation', () => {
    expect(getNextOptionIndex(0, 3, 'next')).toBe(1);
    expect(getNextOptionIndex(2, 3, 'next')).toBe(0);
    expect(getNextOptionIndex(0, 3, 'previous')).toBe(2);
    expect(getNextOptionIndex(1, 3, 'first')).toBe(0);
    expect(getNextOptionIndex(1, 3, 'last')).toBe(2);
    expect(getNextOptionIndex(0, 0, 'next')).toBe(-1);
  });

  it('starts at the nearest edge when opening without a selection', () => {
    expect(getNextOptionIndex(-1, 3, 'next')).toBe(0);
    expect(getNextOptionIndex(-1, 3, 'previous')).toBe(2);
  });

  it('accepts only values present in the option list', () => {
    const options = [{ value: 'area-1', label: 'Housekeeping' }];

    expect(hasSelectableValue('area-1', options)).toBe(true);
    expect(hasSelectableValue('', options)).toBe(false);
    expect(hasSelectableValue('missing', options)).toBe(false);
  });

  it('renders a labeled listbox trigger instead of a native select', () => {
    const markup = renderToStaticMarkup(createElement(TouchSelect, {
      label: 'Language',
      value: 'en',
      options: [
        { value: 'en', label: 'English' },
        { value: 'es', label: 'Español' }
      ],
      onChange: () => undefined
    }));

    expect(markup).not.toContain('<select');
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-haspopup="listbox"');
    expect(markup).toContain('aria-labelledby="touch-select-');
    expect(markup).toContain('English');
    expect(markup).toContain('lucide-chevron-down');
    expect(markup).not.toContain('⌄');
  });

  it('renders an option icon before its selected label', () => {
    const markup = renderToStaticMarkup(createElement(TouchSelect, {
      label: 'Icon',
      value: 'bell',
      options: [{ value: 'bell', label: 'Bell', icon: '◉' }],
      onChange: () => undefined
    }));

    expect(markup).toContain('class="touch-select__option-icon"');
    expect(markup.indexOf('◉')).toBeLessThan(markup.indexOf('Bell'));
  });

  it('renders a component icon before its selected label', () => {
    const markup = renderToStaticMarkup(createElement(TouchSelect, {
      label: 'Icon',
      value: 'bell',
      options: [{ value: 'bell', label: 'Bell', icon: createElement('svg', { 'aria-label': 'Bell icon' }) }],
      onChange: () => undefined
    }));

    expect(markup).toContain('aria-label="Bell icon"');
    expect(markup.indexOf('Bell icon')).toBeLessThan(markup.indexOf('Bell</span>'));
  });

  it('keeps the language trigger compact while preserving its accessible label', () => {
    const markup = renderToStaticMarkup(createElement(LanguageSelector));

    expect(markup).toContain('class="form-field touch-select');
    expect(markup).toContain('language-selector');
    expect(markup).toContain('touch-select--modal');
    expect(markup).toContain('>EN</span>');
    expect(markup).toContain('>Language</label>');
  });

  it('marks modal selects as interaction blockers without changing regular select markup', () => {
    const modalMarkup = renderToStaticMarkup(createElement(TouchSelect, {
      label: 'Language',
      value: 'en',
      options: [{ value: 'en', label: 'English' }],
      onChange: () => undefined,
      modal: true
    }));
    const regularMarkup = renderToStaticMarkup(createElement(TouchSelect, {
      label: 'Area',
      value: 'area-1',
      options: [{ value: 'area-1', label: 'Housekeeping' }],
      onChange: () => undefined
    }));

    expect(modalMarkup).toContain('touch-select--modal');
    expect(modalMarkup).toContain('data-modal-interaction-blocker="true"');
    expect(regularMarkup).not.toContain('data-modal-interaction-blocker');
  });

  it('uses a localized label-based placeholder when no placeholder is supplied', () => {
    const markup = renderToStaticMarkup(createElement(TouchSelect, {
      label: 'Language',
      value: '',
      options: [],
      onChange: () => undefined
    }));

    expect(markup).toContain('Select language');
    expect(markup).not.toContain('Select an option');
  });

  it('associates a validation error with the trigger', () => {
    const markup = renderToStaticMarkup(createElement(TouchSelect, {
      label: 'Area',
      value: '',
      options: [{ value: 'area-1', label: 'Housekeeping' }],
      onChange: () => undefined,
      error: 'Area is required.'
    }));

    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('aria-describedby="touch-select-');
    expect(markup).toContain('Area is required.');
  });

  it('participates in native form validation when required', () => {
    const markup = renderToStaticMarkup(createElement(TouchSelect, {
      label: 'Area',
      value: '',
      options: [{ value: 'area-1', label: 'Housekeeping' }],
      onChange: () => undefined,
      required: true
    }));

    expect(markup).toContain('class="touch-select__validation"');
    expect(markup).toContain('required=""');
  });
});

import {
  DEFAULT_SETTINGS,
  isLegalRequestTransition,
  validateSettings
} from '@hotel/shared';

describe('shared domain contracts', () => {
  it('allows only the forward request lifecycle', () => {
    expect(isLegalRequestTransition('PENDING', 'ACCEPTED')).toBe(true);
    expect(isLegalRequestTransition('ACCEPTED', 'IN_PROGRESS')).toBe(true);
    expect(isLegalRequestTransition('IN_PROGRESS', 'COMPLETED')).toBe(true);
    expect(isLegalRequestTransition('PENDING', 'COMPLETED')).toBe(false);
    expect(isLegalRequestTransition('COMPLETED', 'PENDING')).toBe(false);
  });

  it('rejects settings that violate bounds or cross-setting invariants', () => {
    const result = validateSettings({
      'heartbeat.intervalMs': 60000,
      'heartbeat.staleAfterMs': 15000
    }, DEFAULT_SETTINGS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.key)).toContain('heartbeat.staleAfterMs');
    }
  });

  it('accepts normalized hotel branding and explicit clock settings', () => {
    const result = validateSettings({
      hotelName: '  Hotel Aurora  ',
      hotelLogo: 'data:image/png;base64,AAAA',
      clockFormat: '24h'
    }, DEFAULT_SETTINGS);

    expect(result).toEqual({
      ok: true,
      values: {
        ...DEFAULT_SETTINGS,
        hotelName: 'Hotel Aurora',
        hotelLogo: 'data:image/png;base64,AAAA',
        clockFormat: '24h'
      }
    });
  });

  it('accepts legacy and responsive local room background values', () => {
    const roomBackground = 'data:image/jpeg;base64,AAAA';
    const roomBackgroundVariants = {
      square480: 'data:image/webp;base64,SQUARE',
      tablet: 'data:image/webp;base64,TABLET'
    };

    expect(validateSettings({ roomBackground }, DEFAULT_SETTINGS)).toEqual({
      ok: true,
      values: {
        ...DEFAULT_SETTINGS,
        roomBackground
      }
    });

    expect(validateSettings({ roomBackground: null }, { ...DEFAULT_SETTINGS, roomBackground })).toEqual({
      ok: true,
      values: {
        ...DEFAULT_SETTINGS,
        roomBackground: null
      }
    });

    expect(validateSettings({ roomBackground: roomBackgroundVariants }, DEFAULT_SETTINGS)).toEqual({
      ok: true,
      values: {
        ...DEFAULT_SETTINGS,
        roomBackground: roomBackgroundVariants
      }
    });
  });

  it('rejects remote, malformed, and aggregate-oversized room backgrounds', () => {
    const invalidValues = [
      'https://example.com/room.jpg',
      'data:text/plain;base64,AAAA',
      `data:image/png;base64,${'A'.repeat(60 * 1024)}`,
      {
        square480: `data:image/png;base64,${'A'.repeat(60 * 1024)}`,
        tablet: `data:image/png;base64,${'A'.repeat(60 * 1024)}`
      }
    ];

    for (const roomBackground of invalidValues) {
      const result = validateSettings({ roomBackground }, DEFAULT_SETTINGS);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.map((error) => error.key)).toContain('roomBackground');
    }
  });

  it('rejects remote, malformed, and oversized hotel logos', () => {
    const invalidValues = [
      'https://example.com/logo.png',
      'data:text/plain;base64,AAAA',
      `data:image/png;base64,${'A'.repeat(64 * 1024)}`
    ];

    for (const hotelLogo of invalidValues) {
      const result = validateSettings({ hotelLogo }, DEFAULT_SETTINGS);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.map((error) => error.key)).toContain('hotelLogo');
    }
  });

  it('rejects logos that leave no headroom below the JSON request limit', () => {
    const hotelLogo = `data:image/png;base64,${'A'.repeat(64 * 1024 - 64)}`;

    const result = validateSettings({ hotelLogo }, DEFAULT_SETTINGS);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((error) => error.key)).toContain('hotelLogo');
  });

  it('rejects blank hotel names and unsupported clock formats', () => {
    const result = validateSettings({ hotelName: '   ', clockFormat: 'locale' }, DEFAULT_SETTINGS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.key)).toEqual(expect.arrayContaining(['hotelName', 'clockFormat']));
    }
  });
});

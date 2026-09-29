import {
  areaCreateSchema,
  areaPatchSchema,
  DEFAULT_SETTINGS,
  isLegalRequestTransition,
  SETTING_KEYS,
  serviceCreateSchema,
  servicePatchSchema,
  validateSettings
} from '@hotel/shared';

describe('shared domain contracts', () => {
  it('defaults request history retention to one year', () => {
    expect(DEFAULT_SETTINGS['requests.historyRetentionDays']).toBe(365);
  });

  it('validates optional English and Spanish catalog variants while rejecting unsupported locale keys', () => {
    expect(areaCreateSchema.safeParse({
      code: 'night-cleaning',
      displayName: 'Limpieza nocturna',
      displayNameVariants: { en: 'Night cleaning' },
      description: 'Servicio de noche',
      descriptionVariants: { en: 'Night service' }
    }).success).toBe(true);
    expect(serviceCreateSchema.safeParse({
      code: 'custom-crib',
      displayName: 'Preparar cuna',
      displayNameVariants: { en: 'Prepare a crib' },
      areaId: 'area-1'
    }).success).toBe(true);
    expect(areaPatchSchema.safeParse({ displayNameVariants: {} }).success).toBe(true);
    expect(servicePatchSchema.safeParse({ descriptionVariants: { es: 'Descripción traducida' } }).success).toBe(true);
    expect(areaCreateSchema.safeParse({ code: 'invalid-locale', displayName: 'Área', displayNameVariants: { fr: 'Zone' } }).success).toBe(false);
    expect(serviceCreateSchema.safeParse({ code: 'invalid-name', displayName: 'Servicio', displayNameVariants: { en: '   ' }, areaId: 'area-1' }).success).toBe(false);
  });

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

  it('accepts bounded Information carousel timing settings and rejects values outside the UI range', () => {
    const idleTimeoutKey = 'information.idleTimeoutSeconds';
    const slideIntervalKey = 'information.slideIntervalSeconds';
    const defaults = DEFAULT_SETTINGS as Record<string, unknown>;

    expect(SETTING_KEYS).toEqual(expect.arrayContaining([idleTimeoutKey, slideIntervalKey]));
    expect(defaults[idleTimeoutKey]).toBe(5);
    expect(defaults[slideIntervalKey]).toBe(5);
    expect(validateSettings({ [idleTimeoutKey]: 1, [slideIntervalKey]: 300 }, DEFAULT_SETTINGS).ok).toBe(true);

    for (const value of [0, 301]) {
      const result = validateSettings({ [idleTimeoutKey]: value }, DEFAULT_SETTINGS);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.map((error) => error.key)).toContain(idleTimeoutKey);
    }
  });

  it('accepts normalized hotel branding and explicit clock settings', () => {
    const result = validateSettings({
      hotelName: '  Hotel Aurora  ',
      hotelNameEn: '  Aurora Hotel  ',
      hotelLogo: 'data:image/png;base64,AAAA',
      clockFormat: '24h'
    }, DEFAULT_SETTINGS);

    expect(result).toEqual({
      ok: true,
      values: {
        ...DEFAULT_SETTINGS,
        hotelName: 'Hotel Aurora',
        hotelNameEn: 'Aurora Hotel',
        hotelLogo: 'data:image/png;base64,AAAA',
        clockFormat: '24h'
      }
    });

    expect(validateSettings({ hotelName: 'Hotel Aurora' }, DEFAULT_SETTINGS)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ key: 'hotelNameEn' })])
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

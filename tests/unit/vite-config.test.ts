import { describe, expect, it } from 'vitest';
import { resolveViteServerHost } from '../../apps/web/vite.config';

describe('Vite development server configuration', () => {
  it('binds to every interface by default while allowing an explicit override', () => {
    expect(resolveViteServerHost({})).toBe('0.0.0.0');
    expect(resolveViteServerHost({ HOST: '127.0.0.1' })).toBe('127.0.0.1');
  });
});

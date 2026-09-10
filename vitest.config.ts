import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@hotel/shared': new URL('./packages/shared/src/index.ts', import.meta.url).pathname,
      react: new URL('./apps/web/node_modules/react', import.meta.url).pathname,
      'react-dom': new URL('./apps/web/node_modules/react-dom', import.meta.url).pathname
    }
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts', 'apps/web/src/**/*.test.tsx'],
    restoreMocks: true,
    clearMocks: true,
    sequence: {
      concurrent: false
    }
  }
});

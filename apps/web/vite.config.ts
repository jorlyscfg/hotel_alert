import path from 'node:path';
import { defineConfig } from 'vite';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const repositoryRoot = path.resolve(__dirname, '../..');

export function resolveViteServerHost(env: Record<string, string>): string {
  return env['HOST'] ?? '0.0.0.0';
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repositoryRoot, '');
  const serverOrigin = env['VITE_SERVER_ORIGIN'] ?? `http://127.0.0.1:${env['PORT'] ?? '3001'}`;

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@hotel/shared': path.resolve(repositoryRoot, 'packages/shared/src/index.ts')
      }
    },
    server: {
      host: resolveViteServerHost(env),
      port: 4173,
      proxy: {
        '/api': serverOrigin,
        '/socket.io': {
          target: serverOrigin,
          ws: true
        }
      }
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true
    }
  };
});

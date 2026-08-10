import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    env: {
      APP_PASSWORD: 'test-password-123',
      ASTRA_DB_APPLICATION_TOKEN: 'test-token',
      ASTRA_DB_API_ENDPOINT: 'https://test.endpoint',
      RESEND_FROM_EMAIL: 'test@example.com',
      GEOAPIFY_API_KEY: 'test-geoapify',
    },
    setupFiles: ['./vitest.setup.ts'],
    server: {
      deps: {
        inline: ['server-only'],
      },
    },
  },
});

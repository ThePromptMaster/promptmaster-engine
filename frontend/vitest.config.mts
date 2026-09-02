import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vite resolves the `@/*` alias from tsconfig.json natively, so tests import
  // the same specifiers the app does without the vite-tsconfig-paths plugin.
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    restoreMocks: true,
  },
});

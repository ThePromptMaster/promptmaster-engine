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
    // The default 5s is not a timeout, it is a load test. userEvent types a
    // character at a time behind fake-timer-free waits, so the outline and
    // renderer suites sit near the limit and cross it whenever something else
    // is using the machine — a build, or CI running suites in parallel. A
    // flaky red is worse than a slow green: it trains people to re-run rather
    // than read the failure.
    testTimeout: 20_000,
  },
});

import { defineConfig, devices } from '@playwright/test';

import { API_PORT, API_URL, BASE_URL, FRONTEND_PORT, supabaseEnv } from './e2e/env';

/**
 * Browser E2E against the real stack with a scripted model. See e2e/README.md.
 *
 * Every test records video and screenshots: they are the evidence attached to
 * pull requests, not just a debugging aid.
 */
const sb = supabaseEnv();
const workerSecret = 'e2e-worker-secret';
const uvicorn = process.env.E2E_UVICORN ?? '../backend/.venv/bin/uvicorn';

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    video: 'on',
    screenshot: 'on',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: 'e2e/.auth/state.json' },
      dependencies: ['setup'],
    },
  ],
  webServer: [
    {
      command: `${uvicorn} main:app --port ${API_PORT}`,
      cwd: '../backend',
      url: `${API_URL}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        PM_LLM_MODE: 'mock',
        ALLOWED_ORIGINS: BASE_URL,
        SUPABASE_URL: sb.API_URL,
        SUPABASE_JWT_SECRET: sb.JWT_SECRET,
        AUTH_ENFORCED: 'true',
        WORKER_SHARED_SECRET: workerSecret,
        RATE_LIMIT_ENABLED: 'false',
        OPENROUTER_API_KEY: '',
      },
    },
    {
      command: `npm run build && npm run start -- --port ${FRONTEND_PORT}`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      env: {
        NEXT_DIST_DIR: '.next-e2e',
        NEXT_PUBLIC_SUPABASE_URL: sb.API_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.ANON_KEY,
        NEXT_PUBLIC_API_URL: API_URL,
        SUPABASE_SERVICE_ROLE_KEY: sb.SERVICE_ROLE_KEY,
        WORKER_SHARED_SECRET: workerSecret,
        CRON_SECRET: 'e2e-cron-secret',
        // B3: scripted code execution; refused when VERCEL_ENV=production.
        SANDBOX_MODE: 'mock',
      },
    },
  ],
});

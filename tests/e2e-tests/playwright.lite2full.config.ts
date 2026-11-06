/**
 * Standalone config for the Lite->Full conversion render gate.
 *
 * Kept out of playwright.config.ts because this suite runs on demand against a
 * specific converted page (CONVERT_PAGE_ID), never as part of the CI matrix.
 * Reuses the base `use` block so it picks up the same auth state.
 *
 *   cd tests/e2e-tests
 *   APP=zenuml-full@stg CONVERT_PAGE_ID=1867779 CONVERT_LABEL=after \
 *     npx playwright test -c playwright.lite2full.config.ts
 */

import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';
import { AUTH_STATE_PATH } from './config/auth-state.js';

export default defineConfig({
  testDir: './tests',
  timeout: 300000,
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    storageState: AUTH_STATE_PATH,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 60000,
    navigationTimeout: 60000,
    serviceWorkers: 'allow',
    launchOptions: { args: ['--disable-blink-features=AutomationControlled'] },
  },
  projects: [
    {
      name: 'auth',
      testMatch: 'setup/auth.setup.ts',
      use: { ...devices['Desktop Chrome'], storageState: { cookies: [], origins: [] } },
      timeout: 120000,
    },
    {
      name: 'lite2full',
      testMatch: 'conversion/lite2full-render.spec.ts',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['auth'],
    },
  ],
});

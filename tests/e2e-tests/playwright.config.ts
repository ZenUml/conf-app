import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';
import { AUTH_STATE_PATH } from './config/auth-state.js';

export default defineConfig({
  testDir: './tests',
  timeout: 120000,
  testIgnore: ['**/node_modules/**', '../../**', '**/ai-repair/**'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    storageState: AUTH_STATE_PATH,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 60000,
    navigationTimeout: 60000,
    serviceWorkers: 'allow',
    launchOptions: {
      args: ['--disable-blink-features=AutomationControlled'],
    },
  },

  projects: [
    {
      name: 'auth',
      testMatch: 'setup/auth.setup.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: { cookies: [], origins: [] },
      },
      timeout: 120000,
    },
    {
      name: 'pages',
      testMatch: 'render/pages.setup.ts',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['auth'],
      timeout: 180000,
    },
    {
      name: 'render',
      testMatch: 'render/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['pages'],
      fullyParallel: false,
    },
    {
      name: 'insert',
      testMatch: 'insert/**/*.spec.ts',
      // upgrade-prompt suite is gated on the unreleased space-licensing Forge
      // build and skips at runtime in CI. Excluding at collection time so
      // `--shard` doesn't allocate idle slots to skipped tests.
      testIgnore: process.env.CI ? ['insert/upgrade-prompt.spec.ts'] : [],
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['auth'],
      timeout: 300000,
    },
    {
      name: 'syntax-validation',
      testMatch: 'syntax-validation/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['auth'],
      timeout: 300000,
    },
    {
      // Fullscreen bridge modal coverage — ports the manual test plan in
      // docs/fullscreen-test-plan.html (66 cases) into Playwright. Same
      // auth flow as `insert`, separate project so a partial run can target
      // just these specs (e.g. for branch deploy verification).
      name: 'fullscreen',
      testMatch: 'fullscreen/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['auth'],
      timeout: 300000,
    },
    {
      name: 'ai-repair',
      testMatch: 'ai-repair/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['auth'],
      timeout: 300000,
    },
    {
      // Standalone visual snapshots against local Vite dev server (pnpm start:local).
      // No Confluence/Forge auth required.
      name: 'preview',
      testMatch: ['viewer-preview*.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: { cookies: [], origins: [] },
      },
      timeout: 60000,
    },
  ],
});

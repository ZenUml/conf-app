import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';
import { AUTH_STATE_PATH } from './config/auth-state.js';

export default defineConfig({
  testDir: './tests',
  timeout: 120000,
  testIgnore: ['**/node_modules/**', '../../**'],
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
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['auth'],
      timeout: 300000,
    },
  ],
});

import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';
import { AUTH_STATE_PATH } from '../config/auth-state.js';
export default defineConfig({
  testDir: '..', outputDir: '../test-results/version-check', timeout: 120000, retries: 0, workers: 1,
  reporter: [['list'], ['json', { outputFile: '../test-results/version-check/results.json' }]],
  use: { ...devices['Desktop Chrome'], storageState: AUTH_STATE_PATH, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'auth', testMatch: 'tests/setup/auth.setup.ts', use: { storageState: { cookies: [], origins: [] } } },
    { name: 'version', testMatch: 'version-check/verify.spec.ts', dependencies: ['auth'] },
  ],
});

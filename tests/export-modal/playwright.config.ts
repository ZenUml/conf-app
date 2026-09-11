import { defineConfig, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');
const localBaseURL = process.env.LOCAL_DEV_URL || execFileSync(
  'pnpm',
  ['--silent', 'dev:url'],
  { cwd: repoRoot, encoding: 'utf8' },
).trim();

export default defineConfig({
  testDir: '.',
  timeout: 30000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }]],

  use: {
    baseURL: localBaseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'pnpm start:local',
    url: localBaseURL,
    reuseExistingServer: true,
    timeout: 30000,
  },
});

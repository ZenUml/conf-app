import { defineConfig, devices } from '@playwright/test';

// Runs against Storybook, not the app: each spec opens one story in
// iframe.html and asserts what a real browser renders (focus-visible,
// transitions, text wrapping), which jsdom cannot observe.
const PORT = Number(process.env.UI_DETAILS_STORYBOOK_PORT || 6016);

export default defineConfig({
  testDir: '.',
  timeout: 30000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `PRODUCT_TYPE=lite pnpm exec storybook dev -p ${PORT} --ci --no-open`,
    url: `http://localhost:${PORT}/iframe.html`,
    reuseExistingServer: true,
    timeout: 120000,
  },
});

require('dotenv').config();
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './tests',
  timeout: 120000, // 2 minutes for OTP entry
  testMatch: '**/e2e.*.spec.{js,ts}',
  testIgnore: ['**/node_modules/**', '../../**'],
  /* Run tests in files in parallel */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Use saved authentication state */
    storageState: path.join(__dirname, 'auth-state.json'),

    /* Collect trace. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Screenshots on failure */
    screenshot: 'only-on-failure',

    /* Video on failure */
    video: 'retain-on-failure',

    /* Timeout settings */
    actionTimeout: 60000,
    navigationTimeout: 60000,

    /* Enable service workers for better caching */
    serviceWorkers: 'allow',

    /* Launch options for better caching */
    launchOptions: {
      args: ['--disable-blink-features=AutomationControlled'],
    },
  },

  /* Configure projects for major browsers */
  projects: [
    // Setup project - authenticates once before all tests
    {
      name: 'setup',
      testMatch: /.*auth\.setup\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        // Setup should NOT use storageState - it creates it
        storageState: { cookies: [], origins: [] },
      },
      timeout: 120000, // 2 minutes for OTP entry
    },

    // Pages setup - creates test pages for diagram tests
    {
      name: 'pages-setup',
      testMatch: /.*pages\.setup\.ts$/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      timeout: 180000, // Allow time for creating 5 pages
    },

    // Diagram tests - sequential execution to avoid Confluence overload
    {
      name: 'chromium',
      testMatch: '**/e2e.*-diagram.spec.{js,ts}',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['pages-setup'],
      fullyParallel: false, // Sequential to prevent overwhelming Confluence
    },
  ],
});
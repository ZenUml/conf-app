import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './isolation-verification',
  reporter: 'list',
  use: { ...devices['Desktop Chrome'] },
});

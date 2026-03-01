import { test as setup } from '@playwright/test';
import { ConfluenceLogin } from '../../utils/login.js';
import { testConfig } from '../../config/test-config.js';
import path from 'path';
import fs from 'fs';

/**
 * Authentication setup for all E2E tests
 * This runs as a dependency project before the main test suite
 */
setup('authenticate', async ({ page }) => {
  console.log('🚀 Starting authentication setup...');

  // Validate configuration
  testConfig.validate();

  // Check if auth state already exists
  const authStatePath = path.join(__dirname, '..', '..', 'auth-state.json');
  if (fs.existsSync(authStatePath)) {
    console.log('✅ Auth state file already exists, skipping authentication setup');
    console.log(`📁 Using existing auth state from: ${authStatePath}`);
    return;
  }

  try {
    console.log('🔐 Performing one-time login...');

    // Navigate to Confluence
    const targetUrl = `${testConfig.baseUrl}/overview`;
    console.log(`🔗 Navigating to ${targetUrl}`);
    await page.goto(targetUrl);

    // Handle "Log in" button if present
    const loginButton = page.locator('a:has-text("Log in")');
    if (await loginButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('📝 Clicking "Log in" button...');
      await loginButton.click();
    }

    // Login once with OTP
    const confluenceLogin = new ConfluenceLogin(page);
    await confluenceLogin.login(testConfig.credentials.username, testConfig.credentials.password);

    console.log('✅ Login successful, saving authentication state...');

    // Save authentication state
    console.log(`💾 Saving auth state to: ${authStatePath}`);
    await page.context().storageState({ path: authStatePath });

    console.log('✅ Authentication setup complete!');
  } catch (error) {
    console.error('❌ Authentication setup failed:', error);
    throw error;
  }
});

import { test as setup } from '@playwright/test';
import { ConfluenceLogin } from '../../utils/login.js';
import { testConfig } from '../../config/test-config.js';
import { AUTH_STATE_PATH } from '../../config/auth-state.js';
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
  if (fs.existsSync(AUTH_STATE_PATH)) {
    console.log('✅ Auth state file already exists, skipping authentication setup');
    console.log(`📁 Using existing auth state from: ${AUTH_STATE_PATH}`);
    return;
  }

  try {
    console.log('🔐 Performing one-time login...');

    // Navigate to Confluence
    const targetUrl = `${testConfig.baseUrl}/overview`;
    console.log(`🔗 Navigating to ${targetUrl}`);
    await page.goto(targetUrl);

    // Handle "Log in" button if present (typical staging flow — anonymous
    // users get a text link).
    const loginButton = page.locator('a:has-text("Log in")');
    const hasLoginLink = await loginButton.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasLoginLink) {
      await loginButton.click();
    } else {
      // Prod (and some site variants) render an anonymous Confluence shell
      // where the login affordance is an icon without visible "Log in" text,
      // so the locator above misses it. Navigate directly to Atlassian ID
      // login — it always renders a predictable form with input[name=username]
      // and redirects back to targetUrl after auth.
      const loginUrl = `https://id.atlassian.com/login?continue=${encodeURIComponent(targetUrl)}`;
      console.log(`🔀 No "Log in" text link found — falling back to ${loginUrl}`);
      await page.goto(loginUrl);
    }

    // Login once with OTP
    const confluenceLogin = new ConfluenceLogin(page);
    await confluenceLogin.login(testConfig.credentials.username, testConfig.credentials.password);

    console.log('✅ Login successful, saving authentication state...');
    await page.context().storageState({ path: AUTH_STATE_PATH });

    console.log('✅ Authentication setup complete!');
  } catch (error) {
    console.error('❌ Authentication setup failed:', error);
    throw error;
  }
});

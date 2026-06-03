import { test as setup } from '@playwright/test';
import type { Browser } from '@playwright/test';
import { ConfluenceLogin } from '../../utils/login.js';
import { testConfig } from '../../config/test-config.js';
import { AUTH_STATE_PATH } from '../../config/auth-state.js';
import fs from 'fs';

/**
 * Is the saved storageState still a live session?
 *
 * Cross-run caching (CI restores auth-state-<domain>.json from a daily
 * actions/cache) means the file can be up to a day old. The Atlassian session
 * lasts ~30 days so it's almost always still valid, but a revoked/expired
 * session must self-heal into a fresh login rather than fail every test. Open the
 * cached state in a throwaway context and confirm we are not bounced to the
 * Atlassian ID login.
 */
async function isCachedSessionLive(browser: Browser): Promise<boolean> {
  const ctx = await browser.newContext({ storageState: AUTH_STATE_PATH });
  try {
    const page = await ctx.newPage();
    await page.goto(`${testConfig.baseUrl}/overview`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    return !/id\.atlassian\.com|\/login/.test(page.url());
  } catch {
    return false;
  } finally {
    await ctx.close();
  }
}

/**
 * Authentication setup for all E2E tests
 * This runs as a dependency project before the main test suite
 */
setup('authenticate', async ({ page, browser }) => {
  console.log('🚀 Starting authentication setup...');

  // Validate configuration
  testConfig.validate();

  // Reuse an existing/cached auth state — but only if its session is still live.
  if (fs.existsSync(AUTH_STATE_PATH)) {
    console.log(`📁 Found existing auth state at ${AUTH_STATE_PATH} — validating session...`);
    if (await isCachedSessionLive(browser)) {
      console.log('✅ Cached session is live — skipping authentication setup');
      return;
    }
    console.log('⚠️ Cached session is stale — deleting and re-authenticating');
    fs.rmSync(AUTH_STATE_PATH, { force: true });
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

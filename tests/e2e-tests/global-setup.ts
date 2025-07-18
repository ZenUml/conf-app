import { chromium, FullConfig } from '@playwright/test';
import { ConfluenceLogin } from './utils/ConfluenceLogin.js';
import { testConfig } from './config/test-config.js';

async function globalSetup(config: FullConfig) {
  console.log('🚀 Starting global setup...');

  // Validate configuration
  testConfig.validate();

  const browser = await chromium.launch();
  const context = await browser.newContext({ bypassCSP: true });
  const page = await context.newPage();

  try {
    console.log('🔐 Performing one-time login...');

    // Navigate to Confluence
    const targetUrl = `${testConfig.baseUrl}/overview`;
    console.log(`🔗 Navigating to ${targetUrl}`);
    await page.goto(targetUrl);

    // Wait for either login form or "Log in" button
    await Promise.race([
      // Case 1: Already on login page (auto-redirect)
      page.waitForSelector('input[name="username"]', { timeout: 5000 }).then(() => {
        console.log('🔄 Auto-redirected to login page');
      }),
      // Case 2: Need to click "Log in" button
      page.getByRole('button', { name: 'Log in' }).waitFor({ timeout: 5000 }).then(async () => {
        console.log('🔘 Clicking "Log in" button...');
        await page.getByRole('button', { name: 'Log in' }).click();
        await page.waitForSelector('input[name="username"]', { timeout: 10000 });
      })
    ]).catch(() => {
      console.log('⚠️ Neither login form nor button found, proceeding anyway...');
    });

    // Login once with OTP
    const confluenceLogin = new ConfluenceLogin(page);
    await confluenceLogin.login(testConfig.credentials.username, testConfig.credentials.password);

    console.log('✅ Login successful, saving authentication state...');

    // Save authentication state
    await context.storageState({ path: 'auth-state.json' });

    console.log('✅ Global setup complete!');
  } catch (error) {
    console.error('❌ Global setup failed:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

export default globalSetup;
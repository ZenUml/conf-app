import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import { ConfluenceLogin } from '../utils/ConfluenceLogin.js';
import { testConfig } from '../config/test-config.js';

// Validate configuration
testConfig.validate();

test.describe('Log in', () => {
  let page: Page;
  let context: BrowserContext;
  let confluenceLogin: ConfluenceLogin;

  test.beforeEach(async ({ browser }: { browser: Browser }) => {
    context = await browser.newContext({ bypassCSP: true });
    page = await context.newPage();
    confluenceLogin = new ConfluenceLogin(page);
  });

  test.afterEach(async () => {
    await context.close();
  });

  test('should login and go to space overview page', async () => {
    const targetUrl = `${testConfig.baseUrl}/overview`;

    await page.goto(targetUrl);
    await confluenceLogin.login(testConfig.credentials.username, testConfig.credentials.password);
  });
});
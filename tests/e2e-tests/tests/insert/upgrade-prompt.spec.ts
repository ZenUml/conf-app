/**
 * Upgrade Prompt E2E Tests — ZenUML Lite Staging (lite-stg.atlassian.net / SD space)
 *
 * Tests 2.1 and 2.3 from the test-space-license skill that were previously skipped
 * because the space had < 85 macros and CUSTOMER_SUCCESS_SERVICE flag was off.
 *
 * Strategy:
 * - Create a fresh test page with a ZenUML sequence macro
 * - Inject localStorage mocks via addInitScript into the Forge iframe context
 *   (mockCSSEnabled=true, mockMacroCount=90 to trigger the threshold without real data)
 * - For Tests 2.2 and 2.3: use the real space-status API by activating/deactivating
 *   a license on conf-stg-lite.zenuml.com and letting the Forge app call it naturally
 *
 * Run with: APP=zenuml-lite@stg npx playwright test tests/upgrade-prompt.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';
import { PageCreator } from '../../utils/page-creator.js';
import { testConfig } from '../../config/test-config.js';
import { AUTH_STATE_PATH } from '../../config/auth-state.js';

const CLOUD_ID = 'c78e721e-957f-402c-9b70-1df2227c2739'; // lite-stg.atlassian.net
const SPACE_KEY = 'SD';
const ADMIN_SECRET = 'd05317f67bbc172e6d8a43c01689d1c4';
const STG_API = 'https://conf-stg-lite.zenuml.com';
const FORGE_IFRAME = '[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]';

let testPageUrl: string;

async function apiCall(method: string, path: string, body?: object): Promise<Record<string, unknown>> {
  const res = await fetch(`${STG_API}${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${ADMIN_SECRET}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json() as Promise<Record<string, unknown>>;
}

async function deactivateLicense() {
  return apiCall('DELETE', `/api/space-license?cloudId=${CLOUD_ID}&spaceKey=${SPACE_KEY}`);
}

async function activateLicense() {
  return apiCall('POST', '/api/space-license', {
    cloudId: CLOUD_ID, spaceKey: SPACE_KEY,
    expiresAt: '2027-12-31T23:59:59Z', activatedBy: 'upgrade-prompt-e2e',
  });
}

async function waitForForgeIframe(page: Page) {
  const frame = page.frameLocator(FORGE_IFRAME).first();
  await expect(frame.locator('body')).toBeVisible({ timeout: 60000 });
  return frame;
}

test.describe('Upgrade Prompt (Lite Staging)', () => {
  test.beforeAll(async ({ browser }) => {
    // Create a fresh page with a sequence macro for these tests
    const ctx = await browser.newContext({ storageState: AUTH_STATE_PATH });
    const page = await ctx.newPage();
    try {
      await page.goto(testConfig.baseUrl);
      const creator = new PageCreator(page);
      const pageId = await creator.createTestPage({ sequence: true });
      testPageUrl = testConfig.pageUrl(pageId);
      console.log('Created test page:', testPageUrl);
    } finally {
      await ctx.close();
    }

    // Ensure no active license before tests
    await deactivateLicense().catch(() => {});
  });

  test.afterAll(async () => {
    await deactivateLicense().catch(() => {});
  });

  test('2.1: upgrade prompt visible when unlicensed', async ({ context, page }) => {
    // Mock: CSS feature enabled + 90 macros (above WARNING_THRESHOLD=85) + unpaid
    await context.addInitScript(() => {
      localStorage.setItem('mockCSSEnabled', 'true');
      localStorage.setItem('mockMacroCount', '90');
      localStorage.setItem('mockSpacePaid', 'false');
    });

    await page.goto(testPageUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#title-text')).toBeVisible({ timeout: 30000 });

    const frame = await waitForForgeIframe(page);
    await expect(frame.getByText('Pick the upgrade that fits your team')).toBeVisible({ timeout: 30000 });

    console.log('✅ Test 2.1 PASS: Upgrade prompt visible when unlicensed');
  });

  test('2.2: restrictions lifted after license activation', async ({ context, page }) => {
    // CSS + macros mocked; let the real space-status API determine paid status
    await context.addInitScript(() => {
      localStorage.setItem('mockCSSEnabled', 'true');
      localStorage.setItem('mockMacroCount', '90');
    });

    const activation = await activateLicense();
    console.log('License activated:', JSON.stringify(activation));
    expect(activation['status']).toBe('active');

    await page.goto(testPageUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#title-text')).toBeVisible({ timeout: 30000 });

    const frame = await waitForForgeIframe(page);
    await expect(
      frame.getByText('Pick the upgrade that fits your team')
    ).not.toBeVisible({ timeout: 30000 });

    console.log('✅ Test 2.2 PASS: Upgrade prompt hidden when space is licensed');
  });

  test('2.3: restrictions return after license deactivation', async ({ context, page }) => {
    await context.addInitScript(() => {
      localStorage.setItem('mockCSSEnabled', 'true');
      localStorage.setItem('mockMacroCount', '90');
    });

    const deactivation = await deactivateLicense();
    console.log('License deactivated:', JSON.stringify(deactivation));
    expect(deactivation['status']).toBe('inactive');

    await page.goto(testPageUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#title-text')).toBeVisible({ timeout: 30000 });

    const frame = await waitForForgeIframe(page);
    await expect(frame.getByText('Pick the upgrade that fits your team')).toBeVisible({ timeout: 30000 });

    console.log('✅ Test 2.3 PASS: Upgrade prompt reappears after license deactivation');
  });
});

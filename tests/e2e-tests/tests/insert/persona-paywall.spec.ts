/**
 * Persona-Aware Paywall E2E Smoke — lite-stg.atlassian.net (SD space)
 *
 * Records a video walking through the three variants of the new persona-aware paywall:
 *   1. Bystander → "Editing paused" notice with notify-admin CTA
 *   2. ComparisonView → both options when tenant size is unknown
 *   3. HeavyCreatorPrompt → focused paid-upgrade modal with dynamic ordering
 *
 * Strategy:
 * - Stub /api/space-status with controlled persona fields per variant.
 * - Inject localStorage mocks via addInitScript:
 *     mockCSSEnabled=true, mockPersonaAwarePaywall=true, mockMacroCount=120, mockSpacePaid=false
 * - Click Edit on the rendered ZenUML macro to fire the paywall gate.
 *
 * Run with:
 *   APP=zenuml-lite@stg npx playwright test tests/insert/persona-paywall.spec.ts --headed
 */

import { test, expect, type Page, type Route } from '@playwright/test';
import { PageCreator } from '../../utils/page-creator.js';
import { testConfig } from '../../config/test-config.js';
import { AUTH_STATE_PATH } from '../../config/auth-state.js';

const FORGE_IFRAME = '[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]';

let testPageUrl: string;

async function waitForForgeIframe(page: Page) {
  const frame = page.frameLocator(FORGE_IFRAME).first();
  await expect(frame.locator('body')).toBeVisible({ timeout: 60_000 });
  return frame;
}

function stubSpaceStatus(page: Page, payload: Record<string, unknown>) {
  return page.route('**/api/space-status*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify(payload),
    });
  });
}

// Force video recording for these specific tests (project default is 'retain-on-failure').
test.use({ video: 'on' });

test.describe('Persona-Aware Paywall (Lite Staging)', () => {
  test.skip(!!process.env.CI, 'Manual smoke recording — not for CI');

  test.beforeAll(async ({ browser }) => {
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
  });

  test('Variant A: BystanderNotice — low authorship, notify-admin CTA', async ({ context, page }) => {
    await stubSpaceStatus(page, {
      isPaid: false,
      personalAuthored: 0,
      tenantSizeEstimate: 'small_likely',
      confluenceAdmin: false,
    });

    await context.addInitScript(() => {
      localStorage.setItem('mockCSSEnabled', 'true');
      localStorage.setItem('mockPersonaAwarePaywall', 'true');
      localStorage.setItem('mockMacroCount', '120');
      localStorage.setItem('mockSpacePaid', 'false');
    });

    await page.goto(testPageUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#title-text')).toBeVisible({ timeout: 30_000 });

    const frame = await waitForForgeIframe(page);

    // Wait for service to load (Upgrade button only appears when actionRequired)
    await expect(frame.getByRole('button', { name: /upgrade/i }).first()).toBeVisible({ timeout: 30_000 });

    // Trigger the paywall by clicking Edit on the macro
    await frame.getByRole('button', { name: /edit/i }).first().click();

    // BystanderNotice teleports to the iframe's body (Vue runs in the Forge iframe)
    await expect(frame.getByText('Editing paused on this space')).toBeVisible({ timeout: 30_000 });
    await expect(frame.getByText('Notify the space admin')).toBeVisible();
    await expect(frame.getByText('I am the owner', { exact: false }).or(frame.getByText('see upgrade options'))).toBeVisible();

    console.log('✅ Variant A (BystanderNotice) renders correctly');
  });

  test('Variant B: ComparisonView — tenant size unknown', async ({ context, page }) => {
    await context.addInitScript(() => {
      localStorage.setItem('mockCSSEnabled', 'true');
      localStorage.setItem('mockPersonaAwarePaywall', 'true');
      localStorage.setItem('mockMacroCount', '120');
      localStorage.setItem('mockSpacePaid', 'false');
      localStorage.setItem('mockPersonalAuthored', '20');
      localStorage.setItem('mockTenantSizeEstimate', 'unknown');
      localStorage.setItem('mockConfluenceAdmin', 'true');
    });

    await page.goto(testPageUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#title-text')).toBeVisible({ timeout: 30_000 });

    const frame = await waitForForgeIframe(page);
    await expect(frame.getByRole('button', { name: /upgrade/i }).first()).toBeVisible({ timeout: 30_000 });
    await frame.getByRole('button', { name: /edit/i }).first().click();

    // ComparisonView shows both Marketplace + Bundle cards
    await expect(frame.getByText(/marketplace/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(frame.getByText(/enterprise bundle/i).first()).toBeVisible();

    console.log('✅ Variant B (ComparisonView) renders correctly');
  });

  test('Variant C: HeavyCreatorPrompt — admin + medium_or_larger → Bundle primary', async ({ context, page }) => {
    await context.addInitScript(() => {
      localStorage.setItem('mockCSSEnabled', 'true');
      localStorage.setItem('mockPersonaAwarePaywall', 'true');
      localStorage.setItem('mockMacroCount', '120');
      localStorage.setItem('mockSpacePaid', 'false');
      localStorage.setItem('mockPersonalAuthored', '20');
      localStorage.setItem('mockTenantSizeEstimate', 'medium_or_larger');
      localStorage.setItem('mockConfluenceAdmin', 'true');
    });

    await page.goto(testPageUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#title-text')).toBeVisible({ timeout: 30_000 });

    const frame = await waitForForgeIframe(page);
    await expect(frame.getByRole('button', { name: /upgrade/i }).first()).toBeVisible({ timeout: 30_000 });
    await frame.getByRole('button', { name: /edit/i }).first().click();

    // HeavyCreator copy
    await expect(frame.getByText('This space has reached the Lite limit')).toBeVisible({ timeout: 30_000 });
    // Bundle should be primary (contains $299)
    await expect(frame.getByText(/\$299/)).toBeVisible();

    console.log('✅ Variant C (HeavyCreatorPrompt — Bundle primary) renders correctly');
  });
});

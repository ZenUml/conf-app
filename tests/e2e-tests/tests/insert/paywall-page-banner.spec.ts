/**
 * Paywall page-banner spec — verifies the warning banner and its CTAs on the
 * single `zenuml-page-banner` Forge pageBanner host.
 *
 * The banner shows for Lite spaces over the hard macro limit when the space has
 * CUSTOMER_SUCCESS_SERVICE enabled and recent macro activity. We force that
 * state with `mockMacroCount=101` and a recent activity marker, which the
 * page-banner reads on a later load (see helpers/pageBanner).
 *
 * Forge-only; run against a tunnel (dev) or a deployed staging build:
 *   pnpm forge:tunnel                       # repo root
 *   IS_FORGE=true npx playwright test --project=insert tests/insert/paywall-page-banner.spec.ts
 */
import { test, expect } from '@playwright/test';
import { testConfig, TIMEOUTS } from '../../config/test-config.js';
import { AUTH_STATE_PATH } from '../../config/auth-state.js';
import { createPageAndSetup, publishAndVerifyMacros } from './insert-helpers.js';
import { expectVisibleOrFailOnLogin } from '../../helpers/authGuard.js';
import {
  pageBannerFrame,
  showWarningBanner,
  clearAllBannerState,
  readAppMarker,
  expectBannerAbsent,
  expectCsatAbsent,
  armCsatPending,
  ageLastImpression,
} from '../../helpers/pageBanner.js';

// The Forge macro iframe. Its presence guarantees an app-origin
// (cdn.prod.atlassian-dev.net) frame exists to inject the localStorage mocks into.
const MACRO_IFRAME =
  '[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

// Serial: the published macro page is built ONCE (beforeAll) and reused by every
// test. Each test still gets a fresh browser context (Playwright default), so the
// app-origin localStorage is clean per test — markers never leak across tests
// even though they share the same Confluence page.
test.describe.serial('Paywall page banner', () => {
  test.skip(!testConfig.isForge, 'pageBanner is Forge-only');
  // Lite-only: the macro writes the warning targeting marker only on Lite
  // (persistTargetingMarker() in useCustomerSuccessService.ts returns early when
  // !isLite()). On Full/Diagramly the banner can never appear, so showWarningBanner
  // would time out. All three variants' E2E run suite=insert, so without this gate
  // the spec fails the Full/Diagramly main-branch E2E.
  test.skip(!testConfig.isLite, 'paywall warning banner is Lite-only');
  test.skip(!testConfig.macros.includes('sequence'), 'sequence macro required');

  // Published page (one sequence macro) shared across all tests.
  let pageId: string;

  test.beforeAll(async ({ browser }) => {
    // Create the fixture page ONCE via the proven insert path (the same one the
    // smoke specs use). The previous version called insertAndPublishMacro per
    // test, whose fillEditorTitle() does titleInput.click() — intercepted by the
    // editor's modal backdrop — so every beforeEach failed and, under CI's serial
    // + retries:2, blew the 15-min E2E shard. interactWithDiagramMacro fills the
    // title without clicking (and dismisses the paywall modal), and we do it once.
    const variantLabel = testConfig.isLite ? ' Lite' : '';
    const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
    const setupPage = await context.newPage();
    try {
      const editorPage = await createPageAndSetup(setupPage, variantLabel);
      await editorPage.dismissLearnTheBasicsPanel();
      const macroName = editorPage.getMacroName('Diagram (Mermaid, PlantUML & ZenUML)');
      await editorPage.clickInsertElements();
      await editorPage.searchAndSelectMacro('diagram', macroName);
      await editorPage.interactWithDiagramMacro(`Paywall Banner${variantLabel}`);
      pageId = await publishAndVerifyMacros(setupPage, editorPage, 1, 'paywall-banner-setup');
    } finally {
      await context.close();
    }
    expect(pageId, 'beforeAll must publish a macro page').toBeTruthy();
  });

  test.beforeEach(async ({ page }) => {
    // Reuse the shared macro page; wait for the macro iframe so an app-origin
    // frame exists for mock injection, then clear any banner state written by
    // this initial load before the scenario is set up.
    await page.goto(testConfig.pageUrl(pageId));
    await expectVisibleOrFailOnLogin(page, page.locator(MACRO_IFRAME).first(), TIMEOUTS.FRAME_LOAD);
    await clearAllBannerState(page);
  });

  // CI keeps a slim 3-test regression set so the spec doesn't dominate one E2E
  // shard. The full granular matrix — per-CTA isolation, negative eligibility
  // gates, and Mixpanel assertions — lives in the `pvt-paywall-banner` skill as
  // a production-verification recipe.

  test('hard limit: banner renders with the count and the primary CTA opens Plan and usage', async ({ page }) => {
    await showWarningBanner(page);
    const frame = await pageBannerFrame(page);
    await expect(frame.getByTestId('paywall-warning-banner')).toContainText('101 of 100');
    await expect(frame.getByTestId('paywall-banner-plan-usage')).toBeVisible();

    // navigateToAppPage() uses router.navigate(), which reloads the top-level
    // Confluence page in place (no new tab) — unlike the retired
    // Request-extension/Copy-admin-message CTAs, which opened a popup/clipboard.
    await frame.getByTestId('paywall-banner-plan-usage').click();
    await page.waitForURL(/zenuml-plan-usage/, { timeout: 15_000 });
  });

  test('dismiss snoozes — banner gone after reload despite the warning marker', async ({ page }) => {
    await showWarningBanner(page);
    await (await pageBannerFrame(page)).getByTestId('paywall-banner-dismiss').click();

    // Dismissal marker is stamped (starts the 7-day snooze).
    const dismissal = await readAppMarker(page, 'paywallBanner:');
    expect(dismissal, 'dismissal marker should record dismissedAt').toContain('dismissedAt');

    // Reload: the macro still writes a warning marker, but the snooze suppresses it.
    await page.reload();
    await page.waitForTimeout(6_000);
    await expectBannerAbsent(page);
  });

  test('impression taper, then single host: paywall outranks CSAT (no stacking)', async ({ page }) => {
    await showWarningBanner(page);
    await armCsatPending(page);

    // Taper (2026-09-07): a 2nd impression inside 24h of the 1st is suppressed,
    // and with the paywall standing down the armed CSAT survey takes the slot.
    await page.reload();
    await page.waitForTimeout(6_000);
    await expectBannerAbsent(page);

    // Age the 1st impression past the 24h gap: paywall is eligible again, and the
    // single host must render ONLY the paywall banner — the #202 consolidation.
    await ageLastImpression(page, 25);
    await page.reload();
    await page.waitForTimeout(6_000);
    await expect((await pageBannerFrame(page)).getByTestId('paywall-warning-banner')).toBeVisible({
      timeout: 20_000,
    });
    await expectCsatAbsent(page);
  });
});

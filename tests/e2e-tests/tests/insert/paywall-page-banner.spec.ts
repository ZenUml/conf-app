/**
 * Paywall page-banner spec — verifies the warning banner and its CTAs on the
 * single `zenuml-page-banner` Forge pageBanner host.
 *
 * The banner shows for Lite spaces in the 85–99 macro warning band. We force
 * that band with `mockMacroCount=90` so the macro writes a `warning` targeting
 * marker, which the page-banner reads on a later load (see helpers/pageBanner).
 *
 * Forge-only; run against a tunnel (dev) or a deployed staging build:
 *   pnpm forge:tunnel                       # repo root
 *   IS_FORGE=true npx playwright test --project=insert tests/insert/paywall-page-banner.spec.ts
 */
import { test, expect } from '@playwright/test';
import { testConfig, TIMEOUTS } from '../../config/test-config.js';
import { AUTH_STATE_PATH } from '../../config/auth-state.js';
import { createPageAndSetup, publishAndVerifyMacros } from './insert-helpers.js';
import {
  pageBannerFrame,
  showWarningBanner,
  setAppMocks,
  clearAllBannerState,
  clearPaywallMarkers,
  readAppMarker,
  expectBannerAbsent,
  expectCsatAbsent,
  armCsatPending,
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
    await expect(page.locator(MACRO_IFRAME).first()).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    await clearAllBannerState(page);
  });

  test('renders in the warning band with the count and both CTAs', async ({ page }) => {
    await showWarningBanner(page);
    const frame = pageBannerFrame(page);
    await expect(frame.getByTestId('paywall-warning-banner')).toContainText('90 of 100');
    await expect(frame.getByTestId('paywall-banner-request-extension')).toBeVisible();
    await expect(frame.getByTestId('paywall-banner-copy-admin')).toBeVisible();
  });

  test('Copy admin message CTA flips the button to the Copied state', async ({ page }) => {
    await showWarningBanner(page);
    const frame = pageBannerFrame(page);
    await frame.getByTestId('paywall-banner-copy-admin').click();
    // The button swaps its testid to paywall-banner-copied ("✓ Copied").
    await expect(frame.getByTestId('paywall-banner-copied')).toBeVisible({ timeout: 5_000 });
  });

  test('Request extension CTA opens the Service Desk in a new tab', async ({ page, context }) => {
    await showWarningBanner(page);
    const frame = pageBannerFrame(page);
    // openUrl() → router.open() opens the external Service Desk URL in a new tab.
    const popupPromise = context.waitForEvent('page', { timeout: 15_000 });
    await frame.getByTestId('paywall-banner-request-extension').click();
    const popup = await popupPromise;
    await expect.poll(() => popup.url()).toMatch(/servicedesk|customer\/portal/i);
  });

  test('Dismiss snoozes — banner gone after reload despite the warning marker', async ({ page }) => {
    await showWarningBanner(page);
    await pageBannerFrame(page).getByTestId('paywall-banner-dismiss').click();

    // Dismissal marker is stamped (starts the 7-day snooze).
    const dismissal = await readAppMarker(page, 'paywallBanner:');
    expect(dismissal, 'dismissal marker should record dismissedAt').toContain('dismissedAt');

    // Reload: the macro still writes a warning marker, but the snooze suppresses it.
    await page.reload();
    await page.waitForTimeout(6_000);
    await expectBannerAbsent(page);
  });

  test('no banner at 105 macros — the hard modal owns the critical band', async ({ page }) => {
    await setAppMocks(page, { mockMacroCount: '105', mockSpacePaid: 'false', mockCSSEnabled: 'true' });
    await clearPaywallMarkers(page);
    await page.reload();
    await page.waitForTimeout(6_000); // macro writes a `critical` marker
    await page.reload();
    await page.waitForTimeout(6_000);
    await expectBannerAbsent(page);
  });

  test('single host — paywall outranks CSAT (no stacking)', async ({ page }) => {
    // Warning band makes paywall eligible; arm a fresh CSAT trigger too. The
    // single host must render ONLY the paywall banner — CSAT defers with no
    // cross-iframe coordination.
    await showWarningBanner(page);
    await armCsatPending(page);
    await page.reload();
    await page.waitForTimeout(6_000);
    await expect(pageBannerFrame(page).getByTestId('paywall-warning-banner')).toBeVisible({
      timeout: 20_000,
    });
    await expectCsatAbsent(page);
  });
});

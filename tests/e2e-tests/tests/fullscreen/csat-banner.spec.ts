/**
 * CSAT pageBanner spec — verifies the post-save satisfaction survey flow.
 *
 * Design: after macro_save_succeeded, the editor sets localStorage.csatPending.
 * When the Confluence page reloads, the confluence:pageBanner module checks the
 * flag and either shows the CSAT rating UI or calls view.close() immediately.
 *
 * This is a TDD spec — it captures expected behaviour before implementation.
 * It will fail until the pageBanner module and CSAT Custom UI are deployed.
 *
 * Run against Forge tunnel (dev env):
 *   # terminal 1 — repo root:
 *   pnpm forge:tunnel
 *
 *   # terminal 2 — tests/e2e-tests/:
 *   APP=zenuml-lite@dev npx playwright test --project=fullscreen tests/csat/csat-banner.spec.ts
 *
 * Prerequisites:
 *   - Forge tunnel active (FORGE_ENV=development, ATLASSIAN_SITE=lite-dev.atlassian.net)
 *   - confluence:pageBanner module deployed to the dev environment
 *   - Authenticated session (run auth project first)
 */

import { test, expect, Page } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { insertAndPublishMacro, openEditModal } from '../../helpers/MacroFlowHelper.js';
import { clickEditorPublish, expectModalClosed } from '../../helpers/FullscreenModalHelper.js';

// ---------------------------------------------------------------------------
// Banner helpers
// ---------------------------------------------------------------------------

/**
 * The pageBanner module renders as an iframe in the Confluence page DOM.
 * Atlassian wraps Forge banner modules in a container with a data attribute
 * identifying the module key. The exact attribute needs to be verified via a
 * spot-check after the first deploy — update BANNER_IFRAME_SELECTOR if it
 * differs from the expected pattern.
 *
 * Candidate selectors to try (in order of specificity):
 *   iframe[data-module-key*="csat"]
 *   iframe[data-forge-module*="banner"]
 *   [id*="page-banner"] iframe
 *   .forge-page-banner iframe
 *
 * Run `page.locator('iframe').all()` in a debugger session after deploying
 * the module to find the correct selector.
 */
// The CSAT survey now renders inside the single shared host module
// (`zenuml-page-banner`), which picks paywall-warning > CSAT. CSAT tests create
// a fresh low-macro page so paywall is never eligible → the host shows CSAT.
// The host iframe lives under div[data-testid="forge-page-banner-wrapper"]
// (confirmed via the feat/page-banner-host spot-check; there is no data-module-key).
const BANNER_IFRAME_SELECTOR = '[data-testid="forge-page-banner-wrapper"] iframe, [data-testid*="page-banner"] iframe';

/** Drill into the CSAT banner's Custom UI iframe. */
function csatBannerFrame(page: Page) {
  return page.frameLocator(BANNER_IFRAME_SELECTOR);
}

/**
 * Clear CSAT state so the banner is eligible to show.
 *
 * csatPending (src/utils/csat.ts) and csat_state (src/hooks/useCSATState.ts,
 * via getLocalStorageKey -> `<key>-<clientDomain>`) both live in the Forge
 * Custom UI iframe's localStorage (cdn.prod.atlassian-dev.net origin), NOT
 * Confluence's — a same-origin top-page localStorage clear never reaches
 * them. useCSATState().markSuppressed() writes a 7-day suppression
 * (`csat_state-<domain>`) on Send; that write PERSISTS ACROSS TEST RUNS
 * (and across whole sessions weeks apart) because it lives on the real
 * cdn.prod.atlassian-dev.net origin, not anything Playwright resets between
 * runs. A prior run's suppression silently makes the banner never show on
 * the next run within that 7-day window — this is why "Dismiss without
 * score" (which needs the banner visible) and "Send…suppresses" (whose own
 * assertion reads this same key) failed together: a leftover
 * `csat_state-<domain>` entry from an earlier run/session suppressed both.
 *
 * The confluence:pageBanner module (zenuml-page-banner) mounts on every
 * page load regardless of csatPending — it just calls view.close() when
 * nothing is pending — so its iframe (same Forge origin as csatPending/
 * csat_state) is reliably present shortly after navigating to any page.
 * Clear the real, tenant-scoped state directly on that iframe's origin, the
 * same way the app itself reads/writes it, rather than only the (different-
 * origin, ineffective) top-page localStorage.
 */
async function clearCsatState(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.removeItem('csatPending');
    const keys = Object.keys(localStorage).filter(k => k.includes('csat_state'));
    keys.forEach(k => localStorage.removeItem(k));
  });

  const bannerFrame = await page
    .waitForEvent('frameattached', {
      predicate: f => f.url().includes('cdn.prod.atlassian-dev.net'),
      timeout: 10_000,
    })
    .catch(() => page.frames().find(f => f.url().includes('cdn.prod.atlassian-dev.net')));
  if (!bannerFrame) return;
  await bannerFrame
    .evaluate(() => {
      const keys = Object.keys(localStorage).filter(
        k => k.includes('csat_state') || k.includes('csatPending'),
      );
      keys.forEach(k => localStorage.removeItem(k));
    })
    .catch(() => {
      // Best-effort: a cross-origin frame mid-navigation can throw on evaluate.
      // The banner iframe re-checked per test below still catches a leftover
      // suppression via its own visible/absent assertions.
    });
}

/**
 * Insert and publish a macro. Persistence.ts sets csatPending on every save
 * (create and edit), so the pageBanner will show after the page reload that
 * follows macro publish.
 */
async function prepareCsatBannerFlow(page: Page): Promise<void> {
  await insertAndPublishMacro(page, 'sequence');
}

/** Assert the CSAT banner is absent (closed via view.close()). */
async function expectBannerAbsent(page: Page): Promise<void> {
  // When view.close() is called the iframe is either hidden or removed.
  const iframe = page.locator(BANNER_IFRAME_SELECTOR);
  await expect(iframe).toBeHidden({ timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('CSAT pageBanner', () => {
  test.skip(!testConfig.isForge, 'pageBanner is Forge-only');
  test.skip(!testConfig.macros.includes('sequence'), 'sequence macro required');

  test.beforeEach(async ({ page }) => {
    // Start each test with a clean CSAT state so suppression doesn't interfere.
    // We navigate to the base space first to have a page context for localStorage.
    await page.goto(testConfig.baseUrl);
    await clearCsatState(page);
  });

  // -------------------------------------------------------------------------
  // Core: banner appears after creation
  // -------------------------------------------------------------------------

  test('banner appears after macro creation', async ({ page }) => {
    await prepareCsatBannerFlow(page);

    const frame = csatBannerFrame(page);
    await expect(frame.getByText(/how.s zenuml working/i)).toBeVisible({ timeout: 20_000 });
    await expect(frame.locator('.pb-face-btn')).toHaveCount(5, { timeout: 10_000 });
    await page.waitForTimeout(3_000); // hold on banner so video captures it
  });

  // -------------------------------------------------------------------------
  // Core: banner appears after edit
  // -------------------------------------------------------------------------

  test('banner appears after macro edit', async ({ page }) => {
    if (!testConfig.existingPageId) {
      test.skip(true, 'PAGE_ID not set — set PAGE_ID env var pointing to a page with a sequence macro');
      return;
    }
    await page.goto(testConfig.pageUrl(testConfig.existingPageId));
    await openEditModal(page, 'sequence');
    await clickEditorPublish(page);
    await expectModalClosed(page, 'edit');

    const frame = csatBannerFrame(page);
    await expect(frame.getByText(/how.s zenuml working/i)).toBeVisible({ timeout: 20_000 });
    await expect(frame.locator('.pb-face-btn')).toHaveCount(5, { timeout: 10_000 });
  });

  // -------------------------------------------------------------------------
  // Step 2: click score → text area expands
  // -------------------------------------------------------------------------

  test('clicking a score expands inline text area', async ({ page }) => {
    await prepareCsatBannerFlow(page);

    const frame = csatBannerFrame(page);
    await expect(frame.locator('button').nth(0)).toBeVisible({ timeout: 20_000 });

    // Click the 4th emoji (😊, score=4).
    await frame.locator('button').nth(3).click();

    // Step 2 UI: inline comment input + Send button appear.
    await expect(frame.getByPlaceholder(/optional/i)).toBeVisible({ timeout: 5_000 });
    await expect(frame.getByRole('button', { name: /send/i })).toBeVisible();

    // Face buttons remain visible (score can be changed); count stays at 5.
    await expect(frame.locator('.pb-face-btn')).toHaveCount(5);
  });

  // -------------------------------------------------------------------------
  // Submit: Send closes banner and sets suppression state
  // -------------------------------------------------------------------------

  test('Send closes banner and suppresses for 3 months', async ({ page }) => {
    await prepareCsatBannerFlow(page);

    const frame = csatBannerFrame(page);
    await expect(frame.locator('button').nth(0)).toBeVisible({ timeout: 20_000 });

    // Click score 5 (😍).
    await frame.locator('button').nth(4).click();

    // Type optional feedback text.
    const input = frame.getByPlaceholder(/optional/i);
    await expect(input).toBeVisible({ timeout: 5_000 });
    await input.fill('Great product!');

    // Submit.
    await frame.getByRole('button', { name: /send/i }).click();

    // Banner closes (view.close() called after submit).
    await expectBannerAbsent(page);

    // Suppression state is written to the Forge iframe's localStorage (different
    // origin from Confluence, shared by every Custom UI iframe on the page —
    // Web Storage partitions by origin only, not by path). Read it from ANY
    // still-attached Forge iframe rather than specifically the banner's: by
    // this point expectBannerAbsent() has already closed (and possibly
    // detached) the banner iframe itself, so filtering the frame list on
    // `.includes('csat')` can miss it and silently fall back to
    // page.frames()[0] — the top Confluence frame, which never has the key
    // and always reads suppressed=false regardless of what actually
    // happened. The sequence macro's own iframe (still rendered on the page)
    // is the same origin and is guaranteed to still be attached.
    const forgeFrame = page.frames().find(f => f.url().includes('cdn.prod.atlassian-dev.net'));
    if (!forgeFrame) throw new Error('No Forge Custom UI iframe found to read csat_state from');
    const suppressed = await forgeFrame.evaluate(() => {
      const key = Object.keys(localStorage).find(k => k.startsWith('csat_state-'));
      if (!key) return false;
      const state = JSON.parse(localStorage.getItem(key) ?? '{}');
      const users = state.users ?? {};
      const entries = Object.values(users) as Array<{ expires: string }>;
      if (!entries.length) return false;
      const expires = new Date(entries[0].expires);
      const threeMonthsFromNow = new Date();
      threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);
      return expires > new Date() && expires < new Date(threeMonthsFromNow.getTime() + 86_400_000);
    });
    expect(suppressed, 'CSAT suppression state should be set for ~3 months').toBe(true);
  });

  // -------------------------------------------------------------------------
  // Dismiss: closes banner without selecting a score
  // -------------------------------------------------------------------------

  test('Dismiss without score closes banner', async ({ page }) => {
    await prepareCsatBannerFlow(page);

    const frame = csatBannerFrame(page);
    await expect(frame.locator('.pb-face-btn').nth(0)).toBeVisible({ timeout: 20_000 });

    // Dismiss without selecting any score — shows "We'll check back" confirmation.
    await frame.getByRole('button', { name: /dismiss/i }).click();

    await expect(frame.getByText(/check back/i)).toBeVisible({ timeout: 5_000 });
    await expectBannerAbsent(page);
  });

  // -------------------------------------------------------------------------
  // Dismiss: × closes banner and suppresses
  // -------------------------------------------------------------------------

  test('× dismiss closes banner and suppresses', async ({ page }) => {
    await prepareCsatBannerFlow(page);

    const frame = csatBannerFrame(page);
    await expect(frame.locator('button').nth(0)).toBeVisible({ timeout: 20_000 });

    // × button — no score given, just dismiss.
    await frame.getByRole('button', { name: /dismiss|close|×/i }).click();

    await expectBannerAbsent(page);
  });

  // -------------------------------------------------------------------------
  // No-show: banner absent without a prior save
  // -------------------------------------------------------------------------

  test('banner does not appear on a fresh page load with no pending save', async ({ page }) => {
    // Navigate directly to an existing page — no macro save has happened.
    if (!testConfig.existingPageId) {
      test.skip(true, 'PAGE_ID not set — skipping no-show guard (set PAGE_ID env var)');
      return;
    }
    await page.goto(testConfig.pageUrl(testConfig.existingPageId));
    // Give the banner time to mount and call view.close().
    await page.waitForTimeout(3_000);
    await expectBannerAbsent(page);
  });

  // -------------------------------------------------------------------------
  // No-show: banner absent when suppressed
  // -------------------------------------------------------------------------

  test('banner does not appear when CSAT is suppressed (already shown)', async ({ page }) => {
    await prepareCsatBannerFlow(page);

    const frame = csatBannerFrame(page);
    await expect(frame.locator('button').nth(0)).toBeVisible({ timeout: 20_000 });

    // Dismiss to trigger suppression.
    await frame.getByRole('button', { name: /dismiss|close|×/i }).click();
    await expectBannerAbsent(page);

    // Simulate another save by setting csatPending in the Forge iframe's
    // localStorage (same origin as the banner — different from Confluence's).
    const bannerFrame = page.frames().find(f => f.url().includes('cdn.prod.atlassian-dev.net'));
    await bannerFrame?.evaluate(() => {
      localStorage.setItem('csatPending', String(Date.now()));
    });

    // Reload — suppression state should prevent banner from showing.
    await page.reload();
    await page.waitForTimeout(3_000);
    await expectBannerAbsent(page);
  });
});

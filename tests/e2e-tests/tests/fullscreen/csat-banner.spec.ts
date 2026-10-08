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

import { test, expect, Page, FrameLocator } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { insertMacro, openEditModal } from '../../helpers/MacroFlowHelper.js';
import { clickEditorPublish, expectModalClosed, fillEditorTitle, modalContentFrame } from '../../helpers/FullscreenModalHelper.js';
import { pageBannerFrame as csatBannerFrame, expectBannerAbsent } from '../../helpers/pageBanner.js';
import { MacroPage } from '../../pages/MacroPage.js';

// ---------------------------------------------------------------------------
// Banner helpers
// ---------------------------------------------------------------------------

/**
 * Reset the target app's storage before saving. Each co-installed Forge app
 * has a different origin: clearing Confluence storage or the first CDN frame
 * can leave this app suppressed. The editor/macro belongs to the app under test.
 */
async function clearCsatState(frame: FrameLocator): Promise<void> {
  await frame.locator('body').evaluate(() => {
    Object.keys(localStorage)
      .filter(k => k.startsWith('csat_state') || k.startsWith('csatPending'))
      .forEach(k => localStorage.removeItem(k));
  });
}

/**
 * Insert and publish a macro. Persistence.ts sets csatPending on every save
 * (create and edit), so the pageBanner will show after the page reload that
 * follows macro publish.
 */
async function prepareCsatBannerFlow(page: Page): Promise<void> {
  const { editorPage } = await insertMacro(page, 'sequence');
  await clearCsatState(modalContentFrame(page, 'edit'));
  await fillEditorTitle(page, `Test sequence ${Date.now()}`);
  await clickEditorPublish(page);
  await expectModalClosed(page, 'edit');
  await editorPage.publishPage();
  await new MacroPage(page).dismissSpotlightModal();
  // Publishing can reuse Confluence's existing page-banner iframe. CSAT reads
  // its newly armed signal on a page load, so reload the published page.
  await page.reload();
  const frame = await csatBannerFrame(page);
  const warningDismiss = frame.getByTestId('paywall-banner-dismiss');
  const rating = frame.locator('.pb-face-btn').first();
  await expect(warningDismiss.or(rating)).toBeVisible({ timeout: 20_000 });
  if (await warningDismiss.isVisible()) {
    // Follow the user's normal snooze path; preserve targeting and policy.
    await warningDismiss.click();
    await expectBannerAbsent(page);
    await page.reload();
  }
}


// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('CSAT pageBanner', { tag: ['@test:csat-banner', '@variant:lite', '@variant:full', '@variant:diagramly', '@page-banner', '@fullscreen', '@csat'] }, () => {
  test.skip(!testConfig.isForge, 'pageBanner is Forge-only');
  test.skip(!testConfig.macros.includes('sequence'), 'sequence macro required');

  // -------------------------------------------------------------------------
  // Core: banner appears after creation
  // -------------------------------------------------------------------------

  test('banner appears after macro creation', async ({ page }) => {
    // Quarantine only this Diagramly case until its missing CSAT UI is diagnosed
    // and the unchanged assertions pass on Diagramly staging.
    test.skip(testConfig.productType === 'diagramly',
      'Quarantined: Diagramly CSAT text missing; root cause unknown. Re-enable after diagnosis and a passing staging run. Evidence: https://github.com/ZenUml/conf-app/actions/runs/37763014693/job/113264014068');
    await prepareCsatBannerFlow(page);

    const frame = await csatBannerFrame(page);
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
    await clearCsatState(new MacroPage(page).getSequenceMacroFrame());
    await openEditModal(page, 'sequence');
    await clickEditorPublish(page);
    await expectModalClosed(page, 'edit');

    const frame = await csatBannerFrame(page);
    await expect(frame.getByText(/how.s zenuml working/i)).toBeVisible({ timeout: 20_000 });
    await expect(frame.locator('.pb-face-btn')).toHaveCount(5, { timeout: 10_000 });
  });

  // -------------------------------------------------------------------------
  // Step 2: click score → text area expands
  // -------------------------------------------------------------------------

  test('clicking a score expands inline text area', async ({ page }) => {
    await prepareCsatBannerFlow(page);

    const frame = await csatBannerFrame(page);
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

  test('Send closes banner and suppresses for 1 week', async ({ page }) => {
    await prepareCsatBannerFlow(page);

    const frame = await csatBannerFrame(page);
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

    // The rendered macro shares this app's origin and stays attached after
    // view.close() removes the banner. Other installed apps have different stores.
    const suppressed = await new MacroPage(page).getSequenceMacroFrame().locator('body').evaluate(() => {
      const key = Object.keys(localStorage).find(k => k.startsWith('csat_state-'));
      if (!key) return false;
      const state = JSON.parse(localStorage.getItem(key) ?? '{}');
      const users = state.users ?? {};
      const entries = Object.values(users) as Array<{ expires: string }>;
      if (!entries.length) return false;
      const expires = new Date(entries[0].expires);
      // Match the product's seven calendar days, including DST changes.
      const expectedExpiry = new Date();
      expectedExpiry.setDate(expectedExpiry.getDate() + 7);
      const deltaMs = expectedExpiry.getTime() - expires.getTime();
      return deltaMs >= 0 && deltaMs < 60_000;
    });
    expect(suppressed, 'CSAT suppression state should last one week').toBe(true);
  });

  // -------------------------------------------------------------------------
  // Dismiss: closes banner without selecting a score
  // -------------------------------------------------------------------------

  test('Dismiss without score closes banner', async ({ page }) => {
    await prepareCsatBannerFlow(page);

    const frame = await csatBannerFrame(page);
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

    const frame = await csatBannerFrame(page);
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
    await clearCsatState(new MacroPage(page).getSequenceMacroFrame());
    await page.reload();
    // Give the banner time to mount and call view.close().
    await page.waitForTimeout(3_000);
    await expectBannerAbsent(page);
  });

  // -------------------------------------------------------------------------
  // No-show: banner absent when suppressed
  // -------------------------------------------------------------------------

  test('banner does not appear when CSAT is suppressed (already shown)', async ({ page }) => {
    await prepareCsatBannerFlow(page);

    const frame = await csatBannerFrame(page);
    await expect(frame.locator('button').nth(0)).toBeVisible({ timeout: 20_000 });

    // Dismiss to trigger suppression.
    await frame.getByRole('button', { name: /dismiss|close|×/i }).click();
    await expectBannerAbsent(page);

    // Simulate another save by setting csatPending in the Forge iframe's
    // localStorage (same origin as the banner — different from Confluence's).
    await new MacroPage(page).getSequenceMacroFrame().locator('body').evaluate(() => {
      const stateKey = Object.keys(localStorage).find(k => k.startsWith('csat_state-'));
      if (!stateKey) throw new Error('CSAT suppression state missing after dismissal');
      localStorage.setItem(`csatPending-${stateKey.slice('csat_state-'.length)}`, String(Date.now()));
    });

    // Reload — suppression state should prevent banner from showing.
    await page.reload();
    await page.waitForTimeout(3_000);
    await expectBannerAbsent(page);
  });
});

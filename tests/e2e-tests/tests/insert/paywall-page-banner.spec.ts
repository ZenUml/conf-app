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
import { testConfig } from '../../config/test-config.js';
import { insertAndPublishMacro } from '../../helpers/MacroFlowHelper.js';
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

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.describe('Paywall page banner', () => {
  test.skip(!testConfig.isForge, 'pageBanner is Forge-only');
  test.skip(!testConfig.macros.includes('sequence'), 'sequence macro required');

  test.beforeEach(async ({ page }) => {
    // Fresh macro page so the macro iframe writes the per-space targeting marker,
    // then a clean banner state so prior runs don't leak.
    await insertAndPublishMacro(page, 'sequence');
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

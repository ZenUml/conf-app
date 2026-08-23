// Byline activation nudge E2E (spec v5).
//
// GATED on BYLINE_ACTIVATION_LIVE=1: the "View as diagram" chip only exists on a
// site whose DEPLOYED manifest carries the zenuml-byline-newuser module (its
// displayConditions are registered at install), AND only on a page carrying the
// zenuml-prepared-diagram content property. Without a deploy of this branch the
// chip never renders and every assertion is noise — so this does not run in the
// default suite.
//
//   APP=zenuml-lite@dev BYLINE_ACTIVATION_LIVE=1 npx playwright test byline-activation
//
// The dialog opens in a Forge fullscreen modal iframe; preview assertions
// require frameLocator traversal into that OOPIF (Playwright only).

import { test, expect } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import {
  seedPreparedProperty,
  removePreparedProperty,
  bylineChip,
} from '../../helpers/bylineActivation.js';

const LIVE = process.env.BYLINE_ACTIVATION_LIVE === '1';
// A published page to attach the property to. Provide one that already exists
// (test pages are never deleted); the property is added/removed around the test.
const PAGE_ID = process.env.BYLINE_PAGE_ID || '';

test.describe('byline activation nudge', () => {
  test.skip(!LIVE, 'needs this branch deployed + BYLINE_ACTIVATION_LIVE=1');
  test.skip(!PAGE_ID, 'set BYLINE_PAGE_ID to a published page on the target site');

  test.afterEach(async ({ request }) => {
    await removePreparedProperty(request, testConfig.baseUrl, PAGE_ID).catch(() => {});
  });

  test('prepared: chip appears only when the property is set, and opens the dialog', async ({ page, request }) => {
    const url = `${testConfig.baseUrl}/wiki/pages/viewpage.action?pageId=${PAGE_ID}`;

    // 1. Without the property, the chip must NOT be present (gate holds).
    await removePreparedProperty(request, testConfig.baseUrl, PAGE_ID);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await expect(bylineChip(page)).toHaveCount(0);

    // 2. Seed 'prepared' → chip appears on reload.
    await seedPreparedProperty(request, testConfig.baseUrl, PAGE_ID);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(bylineChip(page).first()).toBeVisible({ timeout: 20_000 });

    // 3. Click → the Forge fullscreen dialog opens (loading theatre → preview).
    await bylineChip(page).first().click();
    const dialog = page.frameLocator('iframe[src*="preview"], [data-testid="hosted-resources-iframe"]').first();
    await expect(
      dialog.getByText(/reading this page|drawing it as a diagram|this page, as a diagram/i).first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});

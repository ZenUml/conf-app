// Embed autoConvert deeplink paste E2E (#360 + ticketed-preview contract).
//
// GATED on EMBED_AUTOCONVERT_LIVE=1: the autoConvert matcher is registered at
// app-install time from manifest.yml, so this spec only means something on a
// site whose installed app version carries the matcher (lite-dev with the
// #360 branch deployed; any site after #360 releases). Without the gate the
// paste legitimately stays a link and every assertion would be noise.
//
//   APP=zenuml-lite@dev EMBED_AUTOCONVERT_LIVE=1 npx playwright test embed-deeplink-paste
//
// The paste is a synthetic ClipboardEvent (headless-safe — see
// helpers/embedDeeplink.ts). Positive-control principle (query-forensics
// check 7): the negative case (wrong-host URL stays a link) is only trusted
// because the positive case (deeplink converts) runs in the same session with
// the same paste mechanics.

import { test } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { createPageAndSetup } from './insert-helpers.js';
import {
  buildDeeplink,
  pasteText,
  expectAutoconverted,
  expectPlainLink,
} from '../../helpers/embedDeeplink.js';

const LIVE = process.env.EMBED_AUTOCONVERT_LIVE === '1';
// lite-dev (internal dev site) fixtures; override per site.
const CLOUD_ID = process.env.DEEPLINK_CLOUD_ID || 'bc8bb5b3-09d2-4932-b68c-9b56fab8e34a';
const CONTENT_ID = process.env.DEEPLINK_CONTENT_ID || '425987';

test.describe('embed deeplink autoConvert on paste', () => {
  test.skip(!LIVE, 'needs a site with the #360 matcher installed — set EMBED_AUTOCONVERT_LIVE=1');

  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: testConfig.baseUrl,
    });
  });

  test('bare deeplink converts into an embed macro', async ({ page }) => {
    await createPageAndSetup(page, 'DeeplinkBare');
    await pasteText(page, buildDeeplink(CLOUD_ID, CONTENT_ID));
    await expectAutoconverted(page);
    // Draft left unpublished on purpose — test pages are never deleted, and an
    // unpublished draft keeps the space clean.
  });

  test('TICKETED deeplink (?t=) still converts — the #360 × ticketed-preview contract', async ({
    page,
  }) => {
    // The ticket only changes off-Confluence behavior (preview page / Slack
    // unfurl). Inside Confluence the matcher and DEEPLINK_RE tolerate the
    // query — if this ever stops converting, minted links would paste as dead
    // text and the whole flywheel breaks. This is THE regression to catch.
    await createPageAndSetup(page, 'DeeplinkTicketed');
    await pasteText(page, buildDeeplink(CLOUD_ID, CONTENT_ID, 'e2eFakeTicket1234567'));
    await expectAutoconverted(page);
  });

  test('non-matching host stays a plain link (negative, controlled by the positive above)', async ({
    page,
  }) => {
    await createPageAndSetup(page, 'DeeplinkNegative');
    const url = `https://example.com/d/${CLOUD_ID}/${CONTENT_ID}`;
    await pasteText(page, url);
    await expectPlainLink(page, url);
  });
});

/**
 * The Lite byline's "Add a diagram" is no longer blocked by the paywall.
 *
 * Retired 2026-09: `shouldBlockActions` in `useCustomerSuccessService` is
 * hardcoded `false` (the paywall no longer blocks editing at any macro
 * count — see useCustomerSuccessService.ts). The byline's create still
 * routes through `tryPageEditorPaywall`'s create branch like any other
 * insert-menu create, but that branch now never fires, so picking a type in
 * the byline on an over-limit space must land on a usable editor, not a
 * gate.
 *
 * This spec previously asserted the opposite (over-limit → paywall modal,
 * under-limit → editor) to guard against the create branch silently
 * un-gating. It now guards the inverse regression: a future change that
 * reintroduces a block on this branch without also updating the byline.
 *
 * Over-limit state is forced with the documented localStorage mocks rather
 * than a real saturated space, so the test does not depend on a fixture
 * space staying over 100 macros. The mocks live in the Forge iframe's
 * origin (cdn.prod.atlassian-dev.net), NOT the top-level Confluence page —
 * writing them to the page does nothing, which is the classic false
 * negative here.
 */
import { test, expect } from '@playwright/test';
import { testConfig, TIMEOUTS } from '../../config/test-config.js';
import { AUTH_STATE_PATH } from '../../config/auth-state.js';
import { createPageAndSetup, publishAndVerifyMacros } from './insert-helpers.js';
import { expectVisibleOrFailOnLogin } from '../../helpers/authGuard.js';
import { setAppMocks } from '../../helpers/pageBanner.js';
import { openBylineModal } from '../../helpers/byline.js';

const MACRO_IFRAME =
  '[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]';

// shouldBlockActions is hardcoded false (paywall block retired), so this
// count no longer matters for gating — kept only to prove the byline still
// opens a usable editor even for a space that WOULD have been saturated
// under the old block.
const OVER_LIMIT_MOCKS = {
  mockMacroCount: '105',
  mockCSSEnabled: 'true',
  mockSpacePaid: 'false',
};

test.describe.serial(`Byline create is not paywalled - ${testConfig.productType}`, () => {
  // The byline entry ships on Lite only (manifest strip in staging-deploy.yml),
  // and the paywall is Lite-only, so both gates are the same gate here.
  test.skip(!testConfig.isForge, 'byline is Forge-only');
  test.skip(!testConfig.isLite, 'the Diagrams byline entry ships on Lite only');
  test.skip(
    testConfig.fullCoinstalled,
    'Full co-installed: the Lite Diagrams byline is hidden by design (zenuml-full-active), so it cannot be opened here',
  );
  test.skip(!testConfig.macros.includes('sequence'), 'sequence macro required');

  let pageId: string;

  test.beforeAll(async ({ browser }) => {
    // A published macro guarantees an app-origin frame exists to seed the mocks
    // into. Built once and reused — page creation dominates this suite's cost.
    const variantLabel = testConfig.isLite ? ' Lite' : '';
    const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
    const setupPage = await context.newPage();
    try {
      const editorPage = await createPageAndSetup(setupPage, variantLabel);
      await editorPage.dismissLearnTheBasicsPanel();
      const macroName = editorPage.getMacroName('Diagram (Mermaid, PlantUML & ZenUML)');
      await editorPage.clickInsertElements();
      await editorPage.searchAndSelectMacro('diagram', macroName);
      await editorPage.interactWithDiagramMacro(`Byline Paywall${variantLabel}`);
      pageId = await publishAndVerifyMacros(setupPage, editorPage, 1, 'byline-paywall-setup');
    } finally {
      await context.close();
    }
    expect(pageId, 'beforeAll must publish a macro page').toBeTruthy();
  });

  test('picking a type on an over-limit space still lands on a usable editor', async ({
    page,
  }) => {
    test.slow();

    await page.goto(testConfig.pageUrl(pageId));
    await expectVisibleOrFailOnLogin(page, page.locator(MACRO_IFRAME).first(), TIMEOUTS.FRAME_LOAD);

    // Seed, then reload: the gate reads the count once at editor mount, so the
    // mocks have to be in place before the byline opens anything.
    await setAppMocks(page, OVER_LIMIT_MOCKS);
    await page.reload();
    await expectVisibleOrFailOnLogin(page, page.locator(MACRO_IFRAME).first(), TIMEOUTS.FRAME_LOAD);

    const bylineFrame = await openBylineModal(page);
    await expect(
      bylineFrame.locator('[data-testid="byline-diagrams"]'),
      'byline modal did not render',
    ).toBeVisible({ timeout: 15000 });

    // Any type tile: all of them route through tryPageEditorPaywall's create
    // branch. Sequence is the one every variant ships.
    const framesBefore = page.frames().length;
    await bylineFrame.locator('[data-testid="byline-type-sequence"]').first().click();

    // Wait for the editor modal to actually open before asserting the ABSENCE of
    // the gate — otherwise "no paywall yet" passes as "no paywall". A new frame
    // is the signal, deliberately not a test id inside the editor: this assertion
    // must not rest on a selector that could silently stop matching.
    await expect
      .poll(() => page.frames().length, {
        timeout: 30000,
        message: 'byline click opened no editor modal, so the paywall-retired assertion would be vacuous',
      })
      .toBeGreaterThan(framesBefore);

    // Give a gate that WOULD fire time to render, then assert none did.
    await page.waitForTimeout(5000);
    for (const f of page.frames()) {
      const gated = await f
        .locator('[data-testid="continue-editing-btn"], [data-testid="continue-attempts-exhausted"]')
        .count()
        .catch(() => 0);
      expect(gated, 'paywall gate fired on an over-limit space despite the block being retired').toBe(0);
    }
  });
});

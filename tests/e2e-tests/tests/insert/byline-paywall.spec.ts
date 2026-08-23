/**
 * The Lite byline's "Add a diagram" must be restricted by the paywall.
 *
 * It already is, structurally: the byline opens the ordinary editor via
 * `openModal({ macroMode: 'editor' })` with no customContentId, so
 * tryPageEditorPaywall takes its create branch and blocks on the same predicate
 * as an insert-menu create. But that is EMERGENT — it falls out of forgeIndex
 * skipping the byline branch for opened modals — and nothing outside a unit test
 * states it. moduleKey-based routing on this branch has already regressed twice,
 * and either regression would have silently un-gated the byline while leaving
 * every other paywall test green.
 *
 * So this asserts the product behaviour end to end: on an over-limit Lite space,
 * picking a type in the byline lands on the paywall modal, not a usable editor.
 *
 * Over-limit state is forced with the documented localStorage mocks rather than
 * a real saturated space, so the test does not depend on a fixture space staying
 * over 100 macros. The mocks live in the Forge iframe's origin
 * (cdn.prod.atlassian-dev.net), NOT the top-level Confluence page — writing them
 * to the page does nothing, which is the classic false negative here.
 */
import { test, expect } from '@playwright/test';
import { testConfig, TIMEOUTS } from '../../config/test-config.js';
import { AUTH_STATE_PATH } from '../../config/auth-state.js';
import { createPageAndSetup, publishAndVerifyMacros } from './insert-helpers.js';
import { expectVisibleOrFailOnLogin } from '../../helpers/authGuard.js';
import { setAppMocks } from '../../helpers/pageBanner.js';
import { openBylineModal, frameWithTestId, expectPaywallModal } from '../../helpers/byline.js';

const MACRO_IFRAME =
  '[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]';

// shouldBlockActions = macrosCreated >= 100 && cssEnabled && isLite, unless the
// space is paid. mockSpacePaid short-circuits the real /api/space-status read,
// so a genuinely licensed staging space can't silently invert this test.
const OVER_LIMIT_MOCKS = {
  mockMacroCount: '105',
  mockCSSEnabled: 'true',
  mockSpacePaid: 'false',
};

test.describe.serial(`Byline create is paywalled - ${testConfig.productType}`, () => {
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

  test('picking a type on an over-limit space lands on the paywall, not the editor', async ({
    page,
  }) => {
    // Two page loads and a modal chain on top of the shared fixture.
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
    await bylineFrame.locator('[data-testid="byline-type-sequence"]').first().click();

    // The editor opens as its own Forge modal frame. It must come up gated.
    const editorFrame = await frameWithTestId(page, 'continue-editing-btn', 30000).catch(
      async () => frameWithTestId(page, 'continue-attempts-exhausted', 5000),
    );
    await expectPaywallModal(editorFrame);
  });

  test('the same click is NOT paywalled when the space is under the limit', async ({ page }) => {
    // The negative leg. Without it, a gate that fired unconditionally — or a
    // byline that failed to open an editor at all — would pass the test above.
    test.slow();

    await page.goto(testConfig.pageUrl(pageId));
    await expectVisibleOrFailOnLogin(page, page.locator(MACRO_IFRAME).first(), TIMEOUTS.FRAME_LOAD);

    await setAppMocks(page, { ...OVER_LIMIT_MOCKS, mockMacroCount: '3' });
    await page.reload();
    await expectVisibleOrFailOnLogin(page, page.locator(MACRO_IFRAME).first(), TIMEOUTS.FRAME_LOAD);

    const bylineFrame = await openBylineModal(page);
    const framesBefore = page.frames().length;
    await bylineFrame.locator('[data-testid="byline-type-sequence"]').first().click();

    // Wait for the editor modal to actually open before asserting the ABSENCE of
    // the gate — otherwise "no paywall yet" passes as "no paywall". A new frame
    // is the signal, deliberately not a test id inside the editor: this assertion
    // must not rest on a selector that could silently stop matching.
    await expect
      .poll(() => page.frames().length, {
        timeout: 30000,
        message: 'byline click opened no editor modal, so the negative leg would be vacuous',
      })
      .toBeGreaterThan(framesBefore);

    // Give a gate that WOULD fire time to render, then assert none did.
    await page.waitForTimeout(5000);
    for (const f of page.frames()) {
      const gated = await f
        .locator('[data-testid="continue-editing-btn"]')
        .count()
        .catch(() => 0);
      expect(gated, 'paywall fired on an under-limit space').toBe(0);
    }
  });
});

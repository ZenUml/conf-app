/**
 * The byline's create path, end to end, and how it adapts to where it was
 * opened from.
 *
 * The create flow is only half-verifiable in unit tests: they can prove which
 * link the component *builds*, but not that picking a tile opens a real editor,
 * that saving it creates a custom content, or that the id diffed out of the page
 * afterwards is the one that was just saved. Those are the steps that silently
 * broke twice on this branch — a pasted macro rendering empty, and a first save
 * orphaning its content — and both were invisible to a matcher-level assertion.
 *
 * The editor-vs-view split is here for a different reason: `hostInEditor` reads
 * `extension.location`, which no unit test can supply truthfully because nothing
 * in this repo knows what Confluence puts there. The component tests pin the
 * branching given a location; only this pins that the location is real.
 */
import { test, expect } from '@playwright/test';
import { testConfig, TIMEOUTS } from '../../config/test-config.js';
import { AUTH_STATE_PATH } from '../../config/auth-state.js';
import { createPageAndSetup, publishAndVerifyMacros } from './insert-helpers.js';
import { expectVisibleOrFailOnLogin } from '../../helpers/authGuard.js';
import { setAppMocks } from '../../helpers/pageBanner.js';
import { openBylineModal, createDiagramFromByline } from '../../helpers/byline.js';

const MACRO_IFRAME =
  '[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]';

// Pin the space UNDER the limit. Staging spaces drift over 100 macros as other
// suites create them, and a paywall firing mid-create would fail this spec for a
// reason it is not about. mockSpacePaid is pinned false too, so a licensed space
// cannot mask a gate that should not be firing anyway.
const UNDER_LIMIT_MOCKS = {
  mockMacroCount: '3',
  mockCSSEnabled: 'true',
  mockSpacePaid: 'false',
};

/** 4-segment typed deeplink: /d/<type>/<cloudId>/<contentId>. The 3-segment form
 *  pastes as a read-only embed, so the segment count is the assertion. */
const TYPED_SEQUENCE_LINK = /^https:\/\/[^/]+\/d\/sequence\/[^/]+\/\d+$/;

test.describe.serial(`Byline create path - ${testConfig.productType}`, () => {
  test.skip(!testConfig.isForge, 'byline is Forge-only');
  test.skip(!testConfig.isLite, 'the Diagrams byline entry ships on Lite only');
  test.skip(!testConfig.macros.includes('sequence'), 'sequence macro required');

  let pageId: string;

  test.beforeAll(async ({ browser }) => {
    // One published macro: gives the byline something to list, and guarantees an
    // app-origin frame exists to seed the mocks into.
    const variantLabel = testConfig.isLite ? ' Lite' : '';
    const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
    const setupPage = await context.newPage();
    try {
      const editorPage = await createPageAndSetup(setupPage, variantLabel);
      await editorPage.dismissLearnTheBasicsPanel();
      const macroName = editorPage.getMacroName('Diagram (Mermaid, PlantUML & ZenUML)');
      await editorPage.clickInsertElements();
      await editorPage.searchAndSelectMacro('diagram', macroName);
      await editorPage.interactWithDiagramMacro(`Byline Create${variantLabel}`);
      pageId = await publishAndVerifyMacros(setupPage, editorPage, 1, 'byline-create-setup');
    } finally {
      await context.close();
    }
    expect(pageId, 'beforeAll must publish a macro page').toBeTruthy();
  });

  test('lists the page\'s diagrams, then hands back an editable typed deeplink', async ({ page }) => {
    // Page load, byline modal, editor modal, save, and a re-read of the page.
    test.slow();

    await page.goto(testConfig.pageUrl(pageId));
    await expectVisibleOrFailOnLogin(page, page.locator(MACRO_IFRAME).first(), TIMEOUTS.FRAME_LOAD);
    await setAppMocks(page, UNDER_LIMIT_MOCKS);
    await page.reload();
    await expectVisibleOrFailOnLogin(page, page.locator(MACRO_IFRAME).first(), TIMEOUTS.FRAME_LOAD);

    const byline = await openBylineModal(page);
    await expect(byline.locator('[data-testid="byline-diagrams"]')).toBeVisible({ timeout: 15000 });

    // Asserted here rather than in its own test: the create flow has to open the
    // byline anyway, and `--shard` splits contiguously by FILE, so a third test
    // in this file lands on the same shard as the dense paywall spec rather than
    // being spread. The empty state is the failure mode that matters — a listing
    // error resolves rather than rejecting, so "no diagrams" is exactly what a
    // 403 looked like on a page that demonstrably has one.
    await expect(
      byline.locator('[data-testid="byline-item"]'),
      'the byline listed no diagrams on a page that has one',
    ).toHaveCount(1, { timeout: 15000 });
    await expect(byline.locator('[data-testid="byline-empty"]')).toHaveCount(0);
    await expect(byline.locator('[data-testid="byline-failed"]')).toHaveCount(0);

    await createDiagramFromByline(page, byline, 'sequence', 'Byline created (view)');

    await expect(
      byline.locator('[data-testid="byline-created"]'),
      'saving in the byline editor produced no paste link',
    ).toBeVisible({ timeout: 60000 });

    // The link must be the 4-segment typed form. The 3-segment fallback this
    // replaced produced `https://<cloudId>/d/<id>/undefined` — always truthy, so
    // it looked like success and pasted as a read-only embed.
    const link = (await byline.locator('[data-testid="byline-created-link"]').innerText()).trim();
    expect(link, `unexpected paste link: ${link}`).toMatch(TYPED_SEQUENCE_LINK);
    expect(link).not.toContain('undefined');

    // View mode keeps the handoff: the user is not in the editor yet.
    await expect(byline.locator('[data-testid="byline-open-editor"]')).toBeVisible();
    await expect(byline.locator('[data-testid="byline-created-sub-editing"]')).toHaveCount(0);

    // The automatic copy is best-effort — it is not user-gesture-initiated, so
    // the Forge iframe may refuse it. Report which happened rather than pinning
    // an assertion this repo cannot control, and pin the button instead.
    // `.created__title` is the element that varies on the copy outcome — the
    // subtitle no longer mentions the clipboard at all, so reading it would log
    // the same string either way and prove nothing.
    const autoCopied = await byline
      .locator('.created__title')
      .first()
      .innerText()
      .catch(() => '');
    console.log(`  ℹ auto-copy headline: ${autoCopied.replace(/\s+/g, ' ').trim()}`);

    // A gesture-initiated copy must work, and must acknowledge itself — this is
    // the affordance for a clipboard overwritten between saving and pasting.
    await byline.locator('[data-testid="byline-copy-link"]').click();
    await expect(byline.locator('[data-testid="byline-copy-link"]')).toContainText('Copied', {
      timeout: 10000,
    });
  });

  test('creating from INSIDE the editor drops the redundant "Open editor" prompt', async ({
    page,
  }) => {
    test.slow();

    // Seed the mocks on the published page, then move to the editor: they live
    // in the Forge iframe's origin, which survives the navigation.
    await page.goto(testConfig.pageUrl(pageId));
    await expectVisibleOrFailOnLogin(page, page.locator(MACRO_IFRAME).first(), TIMEOUTS.FRAME_LOAD);
    await setAppMocks(page, UNDER_LIMIT_MOCKS);

    // testConfig.baseUrl is already https://<domain>/wiki/spaces/<KEY>.
    await page.goto(`${testConfig.baseUrl}/pages/edit-v2/${pageId}`);
    // Reaching the byline at all in the editor is itself part of what this pins:
    // the whole hostInEditor branch is dead code if Confluence does not render a
    // contentBylineItem there.
    const byline = await openBylineModal(page);
    await expect(byline.locator('[data-testid="byline-diagrams"]')).toBeVisible({ timeout: 15000 });

    await createDiagramFromByline(page, byline, 'sequence', 'Byline created (editor)');
    await expect(byline.locator('[data-testid="byline-created"]')).toBeVisible({ timeout: 60000 });

    // The point of the branch: "Open editor" would navigate to where the user
    // already is, reloading the editor they were typing in.
    await expect(
      byline.locator('[data-testid="byline-open-editor"]'),
      'offered to open the editor to a user already in it',
    ).toHaveCount(0);
    await expect(byline.locator('[data-testid="byline-created-done"]')).toHaveText('Done');
    await expect(byline.locator('[data-testid="byline-created-sub-editing"]')).toContainText(
      'Paste the link where you want it',
    );

    // Done must never land on the diagram index — that is a panel over the page
    // the user has to click into to paste, and the thing they pressed Done to
    // leave. Either the popup closes (frame detaches) or the terminal state
    // shows; both are acceptable, the index is not.
    await byline.locator('[data-testid="byline-created-done"]').click();
    await page.waitForTimeout(3000);

    if (byline.isDetached()) {
      console.log('  ✓ view.close() dismissed the byline popup');
      return;
    }
    console.log('  ℹ view.close() did not dismiss the popup — asserting the terminal state');
    await expect(byline.locator('[data-testid="byline-finished"]')).toBeVisible({ timeout: 10000 });
    await expect(
      byline.locator('[data-testid="byline-list"], [data-testid="byline-empty"]'),
      'Done fell back to the diagram index',
    ).toHaveCount(0);
  });
});

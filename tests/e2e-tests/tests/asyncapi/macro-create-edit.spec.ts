import { test, expect } from '@playwright/test';
import { testConfig, TIMEOUTS } from '../../config/test-config.js';
import { ConfluenceEditorPage } from '../../pages/EditorPage.js';
import { MacroPage } from '../../pages/MacroPage.js';

/**
 * MACRO create + edit coverage (the page-macro flows — distinct from the
 * dashboard flows in create-edit.spec.ts):
 *
 *   - Create: in the page editor, insert the `zenuml-asyncapi-macro`
 *     ("AsyncAPI Spec") from the element browser. Inserting opens the Forge
 *     fullscreen config editor (isInserting=true) on DEFAULT_ASYNCAPI_SPEC;
 *     Publish saves the doc AND view.submit()s the customContentId back into
 *     the macro config. Publishing the page then renders the macro through
 *     GenericViewer + @asyncapi/react-component — asserting the default
 *     spec's `info.title` ("Example AsyncAPI") inside the iframe proves the
 *     whole chain (config writeback → custom-content fetch → render).
 *
 *   - Edit: on the published page, the GenericViewer chrome's Edit button
 *     opens the spec editor modal (EventBus 'edit' → openModal macroMode
 *     'editor' with the macro's customContentId). Publish pins the save to
 *     that id (in-place update) and the editor only closes the modal after
 *     saveToPlatform resolves — so the modal dismissing proves the save
 *     round-tripped. The viewer iframe then reloads (onClose) and must still
 *     render the spec.
 *
 * Why not reuse insert-helpers/createMacroTest: the asyncapi profile has no
 * parentPageId (navigateToParentPage throws) and `macros: []` (createMacroTest
 * auto-skips), and the element-browser results contain BOTH "AsyncAPI Spec"
 * and "Embed AsyncAPI Spec" — substring filtering in the shared
 * searchAndSelectMacro could pick the embed macro, so the selection step here
 * adds a hasNotText('Embed') filter. Everything else (editor page object,
 * MacroPage edit/assert helpers, fullscreen-modal testids) is reused.
 *
 * Pages persist after the run (same convention as the render suite).
 * Skips for non-asyncapi profiles.
 */

const skip = testConfig.productType !== 'asyncapi';

// Forge fullscreen modal — same testid for the insert-time config editor and
// the view-mode edit modal (see MacroPage.getEditorDialogFrame).
const MODAL = '[data-testid="custom-ui-fullscreen-modal-dialog"]';
const MODAL_IFRAME = `${MODAL} [data-testid="hosted-resources-iframe"]`;

// The default spec the editor opens with on insert (forge-asyncapi-editor's
// DEFAULT_ASYNCAPI_SPEC) carries info.title "Example AsyncAPI" — it becomes
// the custom-content title and the rendered react-component heading.
const DEFAULT_SPEC_TITLE = 'Example AsyncAPI';

// Shared across the serial pair: the page published by the create test.
let publishedPageUrl: string | undefined;

async function discoverSpaceKey(request: import('@playwright/test').APIRequestContext): Promise<string> {
  try {
    const resp = await request.get(`https://${testConfig.domain}/wiki/api/v2/spaces?limit=1`);
    if (resp.ok()) {
      const first = (await resp.json())?.results?.[0]?.key;
      if (typeof first === 'string' && first.length > 0) return first;
    }
  } catch {
    // fall through to the profile default
  }
  return testConfig.spaceKey;
}

/** Wait for the editor modal's Publish, settle the nested Studio, click, expect close. */
async function publishEditorAndExpectClose(page: import('@playwright/test').Page) {
  await expect(page.locator(MODAL)).toBeVisible({ timeout: 60_000 });
  const editor = page.frameLocator(MODAL_IFRAME);
  const publish = editor.getByRole('button', { name: 'Publish' });
  await expect(publish).toBeVisible({ timeout: 90_000 });
  // Let the nested Studio iframe finish loading so its document reaches
  // localStorage before saveSpec() reads it (saveSpec also flushes via
  // Ctrl+S + a 750ms backstop; settling avoids racing the very first paint).
  await page.waitForTimeout(3_000);
  await publish.click();
  await expect(page.locator(MODAL)).toBeHidden({ timeout: 60_000 });
}

test.describe('AsyncAPI macro create + edit', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(skip, `Profile ${testConfig.domain} is not the asyncapi variant`);

  test('create: insert AsyncAPI Spec macro, publish page, macro renders', async ({ page, request }) => {
    test.slow(); // page create + studio load + two publishes exceed the project's 120s default

    const spaceKey = await discoverSpaceKey(request);
    const editorPage = new ConfluenceEditorPage(page);

    await test.step('Create a new page in the discovered space', async () => {
      // The asyncapi profile has no parentPageId, so skip
      // navigateToParentPage/createChildPage and open the v2 create route
      // for the space directly (same URL EditorPage uses as its fallback).
      await page.goto(`https://${testConfig.domain}/wiki/create-content/page?spaceKey=${spaceKey}`);
      await expect(page.locator('[data-test-id="editor-title"]')).toBeVisible({ timeout: 60_000 });
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      await editorPage.typePageTitle(`AsyncAPI Macro Smoke ${ts}`);
    });

    await test.step('Insert the AsyncAPI Spec macro', async () => {
      await editorPage.dismissLearnTheBasicsPanel();
      await editorPage.clickInsertElements();

      // Own selection step: the browser lists BOTH "AsyncAPI Spec" and
      // "Embed AsyncAPI Spec"; substring matching alone could pick the embed
      // macro, so exclude it explicitly.
      const dialog = page.locator('[role="dialog"]:visible');
      const combobox = dialog.getByRole('combobox').first();
      await combobox.click();
      await combobox.fill('asyncapi');
      const option = dialog
        .locator('[role="option"], [role="gridcell"] button')
        .filter({ hasText: 'AsyncAPI Spec' })
        .filter({ hasNotText: 'Embed' });
      await expect(option.first()).toBeVisible({ timeout: 10_000 });
      await option.first().click();
      const insertButton = dialog.getByRole('button', { name: 'Insert' });
      if (await insertButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await insertButton.click();
      }
    });

    await test.step('Publish the spec in the insert-time config editor', async () => {
      // Inserting opens the fullscreen config editor (isInserting=true) on the
      // default spec. Publish persists the doc and view.submit()s the new
      // customContentId into the macro config.
      await publishEditorAndExpectClose(page);
    });

    await test.step('Publish the page and verify the macro renders the spec', async () => {
      await editorPage.publishPage();
      const macroPage = new MacroPage(page);
      await macroPage.dismissSpotlightModal();

      const frame = page.frameLocator('[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]');
      // info.title from the default spec — present in both the GenericViewer
      // title bar and the rendered react component. Catches the broken-viewer
      // case (load-failed panel) that an iframe-count check would miss.
      await macroPage.assertMacroContent(frame, DEFAULT_SPEC_TITLE);
      publishedPageUrl = page.url();
      console.log(`  ✓ macro page published: ${publishedPageUrl}`);
    });
  });

  test('edit: viewer Edit button opens the spec editor, Publish updates in place', async ({ page }) => {
    test.slow();
    test.skip(!publishedPageUrl, 'create test did not publish a page');

    await page.goto(publishedPageUrl!);
    const macroPage = new MacroPage(page);
    await macroPage.dismissSpotlightModal();

    const frame = page.frameLocator('[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]');
    await macroPage.assertMacroContent(frame, DEFAULT_SPEC_TITLE);

    // GenericViewer chrome → Edit → EventBus 'edit' → fullscreen editor modal
    // with the macro's customContentId (in-place update path, no fork).
    await macroPage.editMacro(frame);
    await publishEditorAndExpectClose(page);

    // onClose reloads the macro iframe; the spec must still render.
    await macroPage.assertMacroContent(frame, DEFAULT_SPEC_TITLE);
  });
});

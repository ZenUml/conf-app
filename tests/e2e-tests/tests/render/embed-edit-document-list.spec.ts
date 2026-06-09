import { expect } from '@playwright/test';
import { createMacroTest } from '../../fixtures/macro-test.js';
import { TIMEOUTS } from '../../config/test-config.js';

/**
 * Regression guard for the AsyncAPI PR's one substantive *shared* change that
 * executes in the Lite runtime: `ApWrapper2.searchCustomContentForge` now
 * type-scopes the Forge v2 custom-content search (appends `type=<variant
 * types>` params) instead of returning ALL custom content unfiltered.
 *
 * That method backs the Embed macro's document picker
 * (forge-embed-editor → ForgeEmbedEditor → DocumentList). If the variant's
 * custom-content type strings were wrong, the picker would come up EMPTY —
 * a silent Lite regression that no AsyncAPI test would catch.
 *
 * This drives the real Lite flow: open the embed editor from the published
 * page and assert (a) the picker chrome renders (ForgeEmbedEditor mounted —
 * the forgeIndex route dispatch still reaches the embed editor) and (b) the
 * list is populated (searchCustomContentForge returned this variant's
 * diagrams under the type filter).
 *
 * `createMacroTest('embed')` auto-skips when 'embed' isn't in the profile's
 * renderMacros — so this only runs for variants that ship the embed macro.
 */
const test = createMacroTest('embed');
test.describe.configure({ mode: 'serial' });

test.describe('Embed editor — document list (search type-scoping)', () => {
  test('opening the embed editor lists existing diagrams', async ({ macroPage }) => {
    const embedFrame = macroPage.getEmbedMacroFrame();
    // Sanity: the embed page loaded and the referenced diagram rendered.
    await macroPage.assertMacroContent(embedFrame, 'Order Service (Demonstration only)');

    // GenericViewer Edit → EventBus 'edit' → forge-embed-editor (fullscreen
    // modal) → ForgeEmbedEditor → DocumentList.
    await macroPage.editMacro(embedFrame);

    const editorFrame = macroPage.getEditorDialogFrame();

    // (a) Picker chrome renders → ForgeEmbedEditor mounted.
    await expect(editorFrame.getByText('Recent diagrams and API specs'))
      .toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });

    // (b) List populated → searchCustomContentForge returned results under the
    // variant's type filter. Each entry renders "Page: <title>". An empty list
    // here is the exact symptom a broken type filter would produce.
    await expect(editorFrame.getByText('Page:', { exact: false }).first())
      .toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
  });
});

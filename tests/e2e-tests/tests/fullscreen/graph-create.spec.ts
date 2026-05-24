// graph-create:0..6 — Create flow for the Graph (DrawIO) macro inside the
// fullscreen Forge bridge modal.
//
// CAVEAT: DrawIO mounts an inner iframe inside the Forge editor iframe.
// The Publish button lives in that inner iframe, NOT the outer one. Use
// `clickEditorPublish(page, { nested: 'drawio' })` for graph publish, or
// drill in manually via `outerFrame.locator('iframe').contentFrame()`.
// The dirty signal for DrawIO is also iframe-scoped (autosave message
// dispatched on the OUTER editor frame's window — see CloseGuardHelper).

import { test, expect } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import {
  expectFullscreenLayout,
  expectPublishButtonState,
  fillEditorTitle,
  clickEditorPublish,
  expectModalClosed,
  modalContentFrame,
} from '../../helpers/FullscreenModalHelper.js';
import { insertMacro } from '../../helpers/MacroFlowHelper.js';
import {
  bridgeModalFrame,
  dispatchSyntheticBeforeunload,
  dirtyEditor,
} from '../../helpers/CloseGuardHelper.js';

test.describe('Graph (DrawIO) — Create flow', () => {
  test.skip(!testConfig.isForge && !testConfig.isLite, 'Forge-only chrome');
  test.skip(!testConfig.macros.includes('graph'), 'graph not in profile');

  // graph-create:0 — Slash menu finds the macro.
  test('graph-create:0 — macro is findable in the element browser', async ({ page }) => {
    const { macroName } = await insertMacro(page, 'graph');
    expect(macroName).toMatch(/Graph \(DrawIO\)/);
  });

  // graph-create:1 — Modal opens at fullscreen viewport.
  test('graph-create:1 — modal opens at fullscreen viewport', async ({ page }) => {
    await insertMacro(page, 'graph');
    await expectFullscreenLayout(page, 'edit');
  });

  // graph-create:2 — DrawIO canvas + shape library load.
  test('graph-create:2 — DrawIO canvas and shape library mount', async ({ page }) => {
    await insertMacro(page, 'graph');
    const outerFrame = modalContentFrame(page, 'edit');
    const drawioFrame = outerFrame.locator('iframe').contentFrame();
    // Sidebar (shape library) and canvas grid are stable DrawIO selectors.
    await expect(drawioFrame.locator('.geSidebarContainer').first()).toBeVisible({ timeout: 30_000 });
    await expect(drawioFrame.locator('.geDiagramContainer, .geGridStyle').first()).toBeVisible({ timeout: 30_000 });
  });

  // graph-create:3 — Title field gates Publish.
  test('graph-create:3 — empty title disables Publish', async ({ page }) => {
    await insertMacro(page, 'graph');
    await expectPublishButtonState(page, 'disabled');
  });

  // graph-create:4 — Publish persists graph on page.
  test('graph-create:4 — Publish closes modal and inserts the macro', async ({ page }) => {
    await insertMacro(page, 'graph');
    await fillEditorTitle(page, `graph-${Date.now()}`);
    await expectPublishButtonState(page, 'enabled');
    await clickEditorPublish(page, { nested: 'drawio' });
    await expectModalClosed(page, 'edit');
    const inserted = page.locator('[data-testid="ForgeExtensionContainer"]').first();
    await expect(inserted).toBeVisible({ timeout: 30_000 });
  });

  // graph-create:5 — Close clean.
  test('graph-create:5 — clean editor: synthetic beforeunload is false', async ({ page }) => {
    await insertMacro(page, 'graph');
    const result = await dispatchSyntheticBeforeunload(bridgeModalFrame(page));
    expect(result).toBe(false);
  });

  // graph-create:6 — Close dirty.
  test('graph-create:6 — dirty editor (autosave message): synthetic beforeunload is true', async ({ page }) => {
    await insertMacro(page, 'graph');
    await dirtyEditor(page, 'graph');
    const result = await dispatchSyntheticBeforeunload(bridgeModalFrame(page));
    expect(result).toBe(true);
  });
});

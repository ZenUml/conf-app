// Cross-cutting modal chrome cases (cross:0..6) from
// docs/fullscreen-test-rerun-data.json. Verifies the Forge bridge fullscreen
// modal contract that must hold for ANY editor that mounts inside it. We
// open the Sequence editor as the canonical surface — the chrome assertions
// here are macro-agnostic, but you need a real editor mounted to observe them.

import { test, expect } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import {
  expectModalVisible,
  expectFullscreenLayout,
  expectSingleHeaderClose,
  expectHeaderTitle,
  expectNoConfluenceChrome,
  clickHeaderClose,
  expectModalClosed,
  pressEscape,
  modalContentFrame,
  modalDialog,
} from '../../helpers/FullscreenModalHelper.js';
import { insertMacro } from '../../helpers/MacroFlowHelper.js';
import {
  bridgeModalFrame,
  dispatchSyntheticBeforeunload,
  dirtyEditor,
} from '../../helpers/CloseGuardHelper.js';

test.describe('Forge bridge fullscreen modal — cross-cutting chrome', () => {
  test.skip(!testConfig.isForge && !testConfig.isLite, 'Forge-only; Connect uses different chrome');
  test.skip(!testConfig.macros.includes('sequence'), 'sequence macro required to mount the modal');

  // cross:0 — Bridge modal renders at 100vw × 100vh.
  test('cross:0 — modal occupies full viewport, iframe sits below header', async ({ page }) => {
    await insertMacro(page, 'sequence');
    const layout = await expectFullscreenLayout(page, 'edit');
    // Recorded baseline: 1920×835 viewport, 70px header. We assert the
    // proportional invariant (modal == viewport, iframe.y == headerPx).
    expect(Math.round(layout.iframeRect.height)).toBe(layout.viewport.height - 70);
  });

  // cross:1 — Atlassian header is the only close affordance.
  test('cross:1 — single header X close button, none inside iframe', async ({ page }) => {
    await insertMacro(page, 'sequence');
    await expectSingleHeaderClose(page, 'edit');

    // Verify there's no in-iframe Close button. The editor uses Publish/Cancel
    // — neither matches /^Close$/i in the editor frame.
    const frame = modalContentFrame(page, 'edit');
    const innerCloseBtns = frame.getByRole('button', { name: /^Close$/i });
    await expect(innerCloseBtns).toHaveCount(0);
  });

  // cross:2 — Header shows app icon + macro title.
  test('cross:2 — header shows the macro module title', async ({ page }) => {
    await insertMacro(page, 'sequence');
    // The exact module title from manifest.yml. Lite variant adds " Lite".
    const titlePart = testConfig.isLite
      ? /Diagram \(Mermaid, PlantUML & ZenUML\) Lite/
      : /Diagram \(Mermaid, PlantUML & ZenUML\)/;
    await expectHeaderTitle(page, titlePart, 'edit');
  });

  // cross:3 — No Confluence chrome around modal.
  test('cross:3 — modal has aria-modal=true (no chrome reachable)', async ({ page }) => {
    await insertMacro(page, 'sequence');
    await expectNoConfluenceChrome(page, 'edit');
  });

  // cross:4 — Close (header X) — clean state.
  test('cross:4 — clean state: header X dismisses without prompt', async ({ page }) => {
    await insertMacro(page, 'sequence');
    // Synthetic dispatch should be false (clean) before we click close.
    const result = await dispatchSyntheticBeforeunload(bridgeModalFrame(page));
    expect(result, 'synthetic beforeunload on clean editor').toBe(false);
    await clickHeaderClose(page, 'edit');
    await expectModalClosed(page, 'edit');
  });

  // cross:5 — Close (header X) — dirty state.
  test('cross:5 — dirty state: synthetic beforeunload is preventDefault=true', async ({ page }) => {
    await insertMacro(page, 'sequence');
    await dirtyEditor(page, 'sequence');
    const result = await dispatchSyntheticBeforeunload(bridgeModalFrame(page));
    expect(result, 'synthetic beforeunload on dirty editor').toBe(true);
  });

  // cross:6 — Esc key behavior.
  test('cross:6 — Esc on dirty sequence editor does NOT close modal', async ({ page }) => {
    await insertMacro(page, 'sequence');
    await dirtyEditor(page, 'sequence');
    await pressEscape(page);
    await page.waitForTimeout(500);
    // Manual run notes: "Sequence editor (CodeMirror) does not pass Esc to
    // Atlassian bridge handler. Intended behavior — modal only closeable via X."
    await expect(modalDialog(page, 'edit')).toBeVisible();
  });
});

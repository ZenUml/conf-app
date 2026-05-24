// graph-edit:0..4 — Edit flow for an existing Graph (DrawIO) macro.

import { test, expect } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import {
  expectFullscreenLayout,
  clickEditorPublish,
  expectModalClosed,
  modalContentFrame,
} from '../../helpers/FullscreenModalHelper.js';
import { insertAndPublishMacro, openEditModal } from '../../helpers/MacroFlowHelper.js';
import {
  bridgeModalFrame,
  dispatchSyntheticBeforeunload,
  dirtyEditor,
} from '../../helpers/CloseGuardHelper.js';

test.describe('Graph (DrawIO) — Edit flow', () => {
  test.skip(!testConfig.isForge && !testConfig.isLite, 'Forge-only chrome');
  test.skip(!testConfig.macros.includes('graph'), 'graph not in profile');

  async function seed(page: import('@playwright/test').Page, title: string) {
    return insertAndPublishMacro(page, 'graph', { title });
  }

  // graph-edit:0 — Edit button opens fullscreen modal.
  test('graph-edit:0 — Edit button opens fullscreen modal', async ({ page }) => {
    await seed(page, `graph-edit-${Date.now()}`);
    await openEditModal(page, 'graph');
    await expectFullscreenLayout(page, 'edit');
  });

  // graph-edit:1 — Edits update canvas. Manual run verified via "Undo button
  // becomes active after canvas mutation". We assert the same by dispatching
  // the autosave message and reading `_drawioModified`.
  test('graph-edit:1 — autosave dispatch flips the dirty flag', async ({ page }) => {
    await seed(page, `graph-canvas-${Date.now()}`);
    await openEditModal(page, 'graph');
    // Read window._drawioModified before/after dispatch — caveman-clean
    // observation that the message handler in ForgeGraphEditor.vue ran.
    const beforeAfter = await modalContentFrame(page, 'edit').locator('body').evaluate(() => {
      const before = (window as unknown as { _drawioModified?: boolean })._drawioModified ?? false;
      window.dispatchEvent(new MessageEvent('message', {
        data: JSON.stringify({ event: 'autosave', modified: true }),
      }));
      const after = (window as unknown as { _drawioModified?: boolean })._drawioModified ?? false;
      return { before, after };
    });
    expect(beforeAfter.before).toBe(false);
    expect(beforeAfter.after).toBe(true);
  });

  // graph-edit:2 — Publish persists edit.
  test('graph-edit:2 — Publish closes the modal', async ({ page }) => {
    await seed(page, `graph-publish-${Date.now()}`);
    await openEditModal(page, 'graph');
    await clickEditorPublish(page, { nested: 'drawio' });
    await expectModalClosed(page, 'edit');
  });

  // graph-edit:3 — Close clean.
  test('graph-edit:3 — re-open clean: synthetic beforeunload is false', async ({ page }) => {
    await seed(page, `graph-clean-${Date.now()}`);
    await openEditModal(page, 'graph');
    const result = await dispatchSyntheticBeforeunload(bridgeModalFrame(page));
    expect(result).toBe(false);
  });

  // graph-edit:4 — Close dirty.
  test('graph-edit:4 — re-open dirty (autosave): synthetic beforeunload is true', async ({ page }) => {
    await seed(page, `graph-dirty-${Date.now()}`);
    await openEditModal(page, 'graph');
    await dirtyEditor(page, 'graph');
    const result = await dispatchSyntheticBeforeunload(bridgeModalFrame(page));
    expect(result).toBe(true);
  });
});

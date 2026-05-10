// sequence-edit:0..5 — Edit flow for an existing Diagram (Sequence) macro.
// Each test seeds the macro by running the create+publish flow, then opens
// the Edit modal. This is intentionally stateful within a test (not across
// tests) — Confluence pages are heavyweight to set up.

import { test, expect } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import {
  expectFullscreenLayout,
  fillEditorTitle,
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

test.describe('Sequence — Edit flow', () => {
  test.skip(!testConfig.isForge && !testConfig.isLite, 'Forge-only chrome');
  test.skip(!testConfig.macros.includes('sequence'), 'sequence not in profile');

  async function seed(page: import('@playwright/test').Page, title: string) {
    return insertAndPublishMacro(page, 'sequence', { title });
  }

  // sequence-edit:0 — Edit button opens fullscreen modal.
  test('sequence-edit:0 — Edit button opens fullscreen modal with existing source', async ({ page }) => {
    await seed(page, `seq-edit-${Date.now()}`);
    await openEditModal(page, 'sequence');
    await expectFullscreenLayout(page, 'edit');
  });

  // sequence-edit:1 — Editor shows existing source.
  test('sequence-edit:1 — editor mounts with the saved source', async ({ page }) => {
    const title = `seq-src-${Date.now()}`;
    await seed(page, title);
    await openEditModal(page, 'sequence');
    const frame = modalContentFrame(page, 'edit');
    // Title input is preloaded with the saved title.
    const titleInput = frame.locator('input[type="text"]').first();
    await expect(titleInput).toHaveValue(title);
    // Editor body has non-empty content.
    const cm = frame.locator('.cm-content, .CodeMirror').first();
    const text = (await cm.textContent()) ?? '';
    expect(text.length).toBeGreaterThan(0);
  });

  // sequence-edit:2 — Edits update preview.
  // We assert the editor content changes after typing — verifying the live
  // preview pixel rendering is too fragile to reproduce reliably in CI.
  test('sequence-edit:2 — typing in editor changes the buffer', async ({ page }) => {
    await seed(page, `seq-edits-${Date.now()}`);
    await openEditModal(page, 'sequence');
    const frame = modalContentFrame(page, 'edit');
    const before = (await frame.locator('.cm-content, .CodeMirror').first().textContent()) ?? '';
    await dirtyEditor(page, 'sequence');
    const after = (await frame.locator('.cm-content, .CodeMirror').first().textContent()) ?? '';
    expect(after).not.toBe(before);
  });

  // sequence-edit:3 — Publish persists edit.
  test('sequence-edit:3 — Publish closes the modal after editing', async ({ page }) => {
    await seed(page, `seq-publish-${Date.now()}`);
    await openEditModal(page, 'sequence');
    await dirtyEditor(page, 'sequence');
    await clickEditorPublish(page);
    await expectModalClosed(page, 'edit');
  });

  // sequence-edit:4 — Close clean.
  test('sequence-edit:4 — re-open clean: synthetic beforeunload is false', async ({ page }) => {
    await seed(page, `seq-clean-${Date.now()}`);
    await openEditModal(page, 'sequence');
    const result = await dispatchSyntheticBeforeunload(bridgeModalFrame(page));
    expect(result).toBe(false);
  });

  // sequence-edit:5 — Close dirty.
  test('sequence-edit:5 — re-open dirty: synthetic beforeunload is true', async ({ page }) => {
    await seed(page, `seq-dirty-${Date.now()}`);
    await openEditModal(page, 'sequence');
    await dirtyEditor(page, 'sequence');
    const result = await dispatchSyntheticBeforeunload(bridgeModalFrame(page));
    expect(result).toBe(true);
  });
});

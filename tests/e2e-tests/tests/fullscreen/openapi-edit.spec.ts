// openapi-edit:0..4 — Edit flow for an existing OpenAPI / Swagger macro.

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
  readPersistedDraft,
} from '../../helpers/CloseGuardHelper.js';

test.describe('OpenAPI / Swagger — Edit flow', () => {
  test.skip(!testConfig.isForge && !testConfig.isLite, 'Forge-only chrome');
  test.skip(!testConfig.macros.includes('openapi'), 'openapi not in profile');

  async function seed(page: import('@playwright/test').Page, title: string) {
    return insertAndPublishMacro(page, 'openapi', { title });
  }

  // openapi-edit:0 — Edit button opens fullscreen modal.
  test('openapi-edit:0 — Edit button opens fullscreen modal with saved spec', async ({ page }) => {
    await seed(page, `openapi-edit-${Date.now()}`);
    await openEditModal(page, 'openapi');
    await expectFullscreenLayout(page, 'edit');
  });

  // openapi-edit:1 — Edits update preview.
  test('openapi-edit:1 — typing in YAML changes the buffer', async ({ page }) => {
    await seed(page, `openapi-edits-${Date.now()}`);
    await openEditModal(page, 'openapi');
    // Use window.specContent as the observable signal — the openapi
    // close guard reads it directly.
    const before = await modalContentFrame(page, 'edit').locator('body').evaluate(() =>
      ((window as unknown as { specContent?: string }).specContent) ?? '',
    );
    await dirtyEditor(page, 'openapi');
    await page.waitForTimeout(500);
    const after = await modalContentFrame(page, 'edit').locator('body').evaluate(() =>
      ((window as unknown as { specContent?: string }).specContent) ?? '',
    );
    expect(after).not.toBe(before);
  });

  // openapi-edit:2 — Publish persists edit.
  test('openapi-edit:2 — Publish closes the modal', async ({ page }) => {
    await seed(page, `openapi-publish-${Date.now()}`);
    await openEditModal(page, 'openapi');
    await dirtyEditor(page, 'openapi');
    await clickEditorPublish(page);
    await expectModalClosed(page, 'edit');
  });

  // openapi-edit:3 — Close clean.
  // In EDIT mode, the saved spec IS the baseline — no race. This is the
  // firm clean-state assertion (manual run :3 confirmed pass).
  test('openapi-edit:3 — re-open clean: synthetic beforeunload is false', async ({ page }) => {
    await seed(page, `openapi-clean-${Date.now()}`);
    await openEditModal(page, 'openapi');
    const result = await dispatchSyntheticBeforeunload(bridgeModalFrame(page));
    expect(result).toBe(false);
  });

  // openapi-edit:4 — Close dirty. Asserts the draft rather than beforeunload,
  // for the reason spelled out in src/utils/closeGuard.ts (the listener was
  // deliberately removed; the localStorage draft replaced it).
  test('openapi-edit:4 — a dirty re-opened editor persists a recoverable draft', async ({ page }) => {
    await seed(page, `openapi-dirty-${Date.now()}`);
    await openEditModal(page, 'openapi');
    await dirtyEditor(page, 'openapi');
    // makeDebouncedDraftSaver runs 500ms after the last change.
    await page.waitForTimeout(1500);
    const draft = await readPersistedDraft(bridgeModalFrame(page));
    expect(draft, 'an unsaved OpenAPI edit should leave a recoverable draft').not.toBeNull();
    expect(draft!.code).toContain('Dirty Edit');
  });
});

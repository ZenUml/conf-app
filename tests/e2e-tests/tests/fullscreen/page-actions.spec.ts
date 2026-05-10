// page-actions:0..3 — Confluence page-level actions: publish, close-clean,
// close-dirty, and the "Close button is the only one" assertion.
//
// CAVEAT (from manual run): "page-actions:3" verifies that there is exactly
// ONE close-button on a page with our macros — the Confluence editor's own
// `data-testid="close-button"`. The fullscreen modal X is per-macro chrome
// that only renders while a modal is open, so it doesn't count here.

import { test, expect } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { insertAndPublishMacro } from '../../helpers/MacroFlowHelper.js';
import { dispatchSyntheticBeforeunloadOnPage } from '../../helpers/CloseGuardHelper.js';

test.describe('Page-level actions', () => {
  test.skip(!testConfig.isForge && !testConfig.isLite, 'Forge-only chrome');
  test.skip(!testConfig.macros.includes('sequence'), 'need at least one macro to seed the page');

  // page-actions:0 — Publish a page containing one of our macros.
  // insertAndPublishMacro already does this — we assert the URL transitioned
  // and the macro renders.
  test('page-actions:0 — page transitions from edit-v2 to view URL after publish', async ({ page }) => {
    await insertAndPublishMacro(page, 'sequence', { title: `pa0-${Date.now()}` });
    expect(page.url()).toMatch(/\/wiki\/spaces\/.*\/pages\/\d+\//);
    expect(page.url()).not.toMatch(/edit-v2/);
    // The Forge container is mounted on the published view.
    await expect(page.locator('[data-testid="ForgeExtensionContainer"]').first()).toBeVisible({ timeout: 30_000 });
  });

  // page-actions:1 — Publish dialog opens with location + access fields.
  // We assert during the publish-page flow inside EditorPage.publishPage that
  // the "Publish page" dialog heading appears. Here we just rerun and check
  // the standard dialog regions during publish.
  test('page-actions:1 — Publish dialog has location + access fields', async ({ page }) => {
    // Pre-publish: open editor on a fresh child page, intercept after click.
    const variantLabel = testConfig.isLite ? ' Lite' : '';
    const { createPageAndSetup } = await import('../insert/insert-helpers.js');
    const editorPage = await createPageAndSetup(page, variantLabel);
    await editorPage.dismissLearnTheBasicsPanel();

    // Click Publish... and assert the dialog content (without clicking Publish yet).
    const publishButton = page.locator('button:has-text("Publish...")').first();
    await publishButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Publish page' })).toBeVisible({ timeout: 10_000 });
    // Location field is labeled with breadcrumb-style content (e.g. "/ Overview /").
    // We accept either "Location" label or the parent-page breadcrumb element.
    const locationField = dialog.getByText(/Location|Parent page|Overview/i).first();
    const accessField = dialog.getByText(/Access|Open|Anyone in this space/i).first();
    await expect(locationField).toBeVisible({ timeout: 5_000 });
    await expect(accessField).toBeVisible({ timeout: 5_000 });
  });

  // page-actions:2 — Close page — clean. Synthetic beforeunload on the
  // top-level page (not the Forge iframe) returns false when nothing has
  // changed since the last publish.
  test('page-actions:2 — clean published page: synthetic beforeunload on top page is false', async ({ page }) => {
    await insertAndPublishMacro(page, 'sequence', { title: `pa2-${Date.now()}` });
    // After publish, we're on the view URL — Confluence's own beforeunload
    // listener is not installed in view mode, so dispatch returns false.
    const result = await dispatchSyntheticBeforeunloadOnPage(page);
    expect(result).toBe(false);
  });

  // page-actions:3 — Close button in page editor is the only one.
  // After insertAndPublishMacro the page is in VIEW mode; we navigate back
  // to edit mode to count Close buttons in the edit chrome.
  test('page-actions:3 — only one Close button in the editor (no extra macro chrome Close)', async ({ page }) => {
    const { editorPage } = await insertAndPublishMacro(page, 'sequence', { title: `pa3-${Date.now()}` });
    void editorPage;

    // Click Edit to reopen the page in edit mode.
    const editPageBtn = page.getByRole('button', { name: 'Edit' }).first();
    await editPageBtn.click();
    await page.waitForURL(/edit-v2/, { timeout: 30_000 });

    // Count buttons matching the Confluence editor's close-button testid.
    const closeButtons = page.locator('[data-testid="close-button"]');
    await expect(closeButtons).toHaveCount(1, { timeout: 30_000 });
  });
});

// Regression for ZenUml/conf-app#169.
//
// Bug: editing a macro whose customContentId binding lives only in the page
// DRAFT (the published body has no macro referencing it) makes
// saveCustomContentV2's `count === 1` update-guard fail — AtlasPage.countMacros
// reads the *published* atlas_doc_format, which returns 0 — so every save forks
// a new custom content. The forked id ≠ the loaded id, so the writeback fires
// view.submit() in the in-viewer Edit modal (a non-submittable Forge Modal),
// which throws "this resource's view is not submittable", and the dialog stays
// open with no feedback.
//
// Fix 1a: when the cc loaded cleanly and lives on this page, treat count===0 the
// same as count===1 → update in place. Then idChanged stays false, no writeback
// is attempted, and the modal closes cleanly.
//
// This test reproduces the precise precondition: a *previously-published* page
// with the macro added in a fresh draft and NOT republished. (A brand-new,
// never-published page does NOT reproduce it — the v2 API returns the draft,
// which contains the macro, so count===1.)
//
// RED on buggy code: the modal stays open + "view.submit/close failed" logs.
// GREEN after 1a: the modal closes cleanly, no submit failure.

import { test, expect, Page } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { MacroPage } from '../../pages/MacroPage.js';
import { createPageAndSetup } from '../insert/insert-helpers.js';
import {
  modalContentFrame,
  fillEditorTitle,
  clickEditorPublish,
  expectModalVisible,
  expectModalClosed,
} from '../../helpers/FullscreenModalHelper.js';

const SEQUENCE_MACRO_BASE = 'Diagram (Mermaid, PlantUML & ZenUML)';

// Lite editor-mount paywall overlay intercepts clicks; clear it before touching
// the editor. No-op on spaces under the macro limit.
async function dismissPaywall(page: Page, waitMs = 4000): Promise<void> {
  const btn = modalContentFrame(page, 'edit').locator('[data-testid="continue-editing-btn"]');
  const shown = await btn.first().waitFor({ state: 'visible', timeout: waitMs }).then(() => true).catch(() => false);
  if (shown) {
    await btn.first().click();
    await btn.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
}

test.describe('REGRESSION #169 — draft-only binding updates in place (no fork)', () => {
  test.skip(!testConfig.isLite, 'Lite-only: the in-viewer Edit modal is the non-submittable surface');
  test.skip(!testConfig.macros.includes('sequence'), 'diagram (sequence) macro required');

  test('edit-via-modal of a draft-only-bound macro closes cleanly and does not fork', async ({ page }) => {
    const submitFailures: string[] = [];
    page.on('console', (m) => {
      if (/view\.submit\/close failed after save|not submittable/i.test(m.text())) submitFailures.push(m.text());
    });

    // 1) Publish an EMPTY page → published version exists with no macro binding.
    const editorPage = await createPageAndSetup(page, ' Lite');
    await editorPage.dismissLearnTheBasicsPanel();
    await editorPage.publishPage();
    const pageId = page.url().match(/\/pages\/(\d+)\//)?.[1];
    expect(pageId, 'published page id from URL').toBeTruthy();

    // 2) Re-open the editor (fresh draft on the published page) and insert the macro.
    //    Publishing the macro config writes customContentId into the DRAFT only.
    await page.goto(`https://${testConfig.domain}/wiki/spaces/${testConfig.spaceKey}/pages/edit-v2/${pageId}`);
    await expect(page.locator('[data-test-id="editor-title"]')).toBeVisible({ timeout: 30_000 });
    await editorPage.dismissLearnTheBasicsPanel();
    await editorPage.clickInsertElements();
    await editorPage.searchAndSelectMacro('diagram', editorPage.getMacroName(SEQUENCE_MACRO_BASE));
    await expectModalVisible(page, 'edit');
    await page.waitForTimeout(1500);
    await dismissPaywall(page);
    await fillEditorTitle(page, `Repro169 ${Date.now()}`);
    await clickEditorPublish(page);
    await expectModalClosed(page, 'edit');
    // NOTE: page deliberately NOT republished → published body has no macro→cc.

    // 3) Edit the macro via its in-viewer Edit button (opens the Forge Modal).
    const macroPage = new MacroPage(page);
    const macroFrame = macroPage.getSequenceMacroFrame();
    await expect(macroFrame.locator('body')).toBeVisible({ timeout: 30_000 });
    await macroPage.editMacro(macroFrame);
    await expectModalVisible(page, 'edit');
    await page.waitForTimeout(1500);
    await dismissPaywall(page);

    // Dirty the diagram and Publish — the save that forks on buggy code.
    const cm = modalContentFrame(page, 'edit').locator('.cm-content, .CodeMirror').first();
    await cm.click();
    await page.keyboard.press('End');
    await page.keyboard.type('\n  A169-->B169');
    await clickEditorPublish(page);

    // Fixed (1a): count===0 → update in place → idChanged=false → view.close() → modal closes.
    // Buggy:     fork → idChanged → view.submit in non-submittable modal → throws → modal stays open.
    await expectModalClosed(page, 'edit', 20_000);
    expect(submitFailures, `unexpected writeback failure: ${submitFailures[0] ?? ''}`).toHaveLength(0);
  });
});

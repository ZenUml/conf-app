// Regression for ZenUml/conf-app#170 — the in-viewer Edit modal must never throw
// "this resource's view is not submittable" when a save legitimately mints a new
// customContentId (idChanged) in that non-submittable surface.
//
// #169/1a removed the *spurious* fork (count===0). This covers the two
// *legitimate* fork shapes that still produce idChanged in the modal:
//   1. cross-page copy   — the macro's cc lives on another page → samePage===false → fork
//   2. same-page duplicate — two macros share one cc (count>1) → fork
//
// Both preconditions are built via the v2 API (see helpers/macroDuplication.ts —
// the editor's clipboard duplication can't be driven from Playwright). Then the
// macro is edited in its in-viewer Edit Modal and saved.
//
// RED (pre-#2 build): save forks → idChanged → view.submit() in the modal →
//   throws "not submittable" → dialog stuck open + console error.
// GREEN (#2): the writeback is gated behind repairWillPersist (false in the
//   modal) → view.close() → dialog closes cleanly, no submit failure.

import { test, expect, Page, FrameLocator } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { MacroPage } from '../../pages/MacroPage.js';
import { createPageAndSetup } from '../insert/insert-helpers.js';
import { duplicateMacroSamePage, copyMacroToNewPage } from '../../helpers/macroDuplication.js';
import {
  modalContentFrame,
  fillEditorTitle,
  clickEditorPublish,
  expectModalVisible,
  expectModalClosed,
} from '../../helpers/FullscreenModalHelper.js';

const SEQUENCE_MACRO_BASE = 'Diagram (Mermaid, PlantUML & ZenUML)';
const FORGE_IFRAME = '[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]';

async function dismissPaywall(page: Page, waitMs = 4000): Promise<void> {
  const btn = modalContentFrame(page, 'edit').locator('[data-testid="continue-editing-btn"]');
  const shown = await btn.first().waitFor({ state: 'visible', timeout: waitMs }).then(() => true).catch(() => false);
  if (shown) {
    await btn.first().click();
    await btn.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
}

// Insert a sequence macro into a fresh page and publish the page. Returns pageId.
async function insertAndPublishMacroPage(page: Page): Promise<string> {
  const editorPage = await createPageAndSetup(page, ' Lite');
  await editorPage.dismissLearnTheBasicsPanel();
  await editorPage.clickInsertElements();
  await editorPage.searchAndSelectMacro('diagram', editorPage.getMacroName(SEQUENCE_MACRO_BASE));
  await expectModalVisible(page, 'edit');
  await page.waitForTimeout(1500);
  await dismissPaywall(page);
  await fillEditorTitle(page, `Gate170 ${Date.now()}`);
  await clickEditorPublish(page);
  await expectModalClosed(page, 'edit');
  await editorPage.publishPage();
  const pageId = page.url().match(/\/pages\/(\d+)\//)?.[1];
  expect(pageId, 'published page id').toBeTruthy();
  return pageId!;
}

// Open the macro's in-viewer Edit modal, dirty the code, publish, and assert the
// modal closes cleanly with no view.submit failure (the #2-fixed behavior).
async function editInViewerExpectCleanClose(page: Page, macroFrame: FrameLocator, submitFailures: string[]): Promise<void> {
  await expect(macroFrame.locator('body')).toBeVisible({ timeout: 30_000 });
  const macroPage = new MacroPage(page);
  await macroPage.editMacro(macroFrame);
  await expectModalVisible(page, 'edit');
  await page.waitForTimeout(1500);
  await dismissPaywall(page);
  const cm = modalContentFrame(page, 'edit').locator('.cm-content, .CodeMirror').first();
  await cm.click();
  await page.keyboard.press('End');
  await page.keyboard.type('\n  A170-->B170');
  await clickEditorPublish(page);
  // GREEN (#2): fork → idChanged → gated (not submittable) → view.close() → modal closes.
  // RED  (pre-#2): view.submit() throws → modal stays open + "not submittable".
  await expectModalClosed(page, 'edit', 20_000);
  expect(submitFailures, `unexpected writeback failure: ${submitFailures[0] ?? ''}`).toHaveLength(0);
}

test.describe('REGRESSION #170 — non-submittable in-viewer surfaces never throw "not submittable" on save', () => {
  test.skip(!testConfig.isLite, 'Lite-only: the in-viewer Edit modal is the non-submittable surface');
  test.skip(!testConfig.macros.includes('sequence'), 'diagram (sequence) macro required');

  test('mechanism 2 — same-page duplicate (count>1) fork closes cleanly', async ({ page }) => {
    const submitFailures: string[] = [];
    page.on('console', (m) => {
      if (/view\.submit\/close failed after save|not submittable/i.test(m.text())) submitFailures.push(m.text());
    });

    const pageId = await insertAndPublishMacroPage(page);
    await duplicateMacroSamePage(page, testConfig.domain, pageId);

    // Reload the published view; both macros now share one cc.
    await page.goto(`https://${testConfig.domain}/wiki/spaces/${testConfig.spaceKey}/pages/${pageId}`);
    await expect(page.locator(FORGE_IFRAME)).toHaveCount(2, { timeout: 30_000 });

    const firstMacro = page.locator(FORGE_IFRAME).first().contentFrame();
    await editInViewerExpectCleanClose(page, firstMacro, submitFailures);
  });

  // Mechanism 1 (cross-page copy) cannot reach the #170 fork-in-modal path: a
  // cc whose container is another page is detected at load and its in-viewer Edit
  // button is DISABLED with a "lives on another page" tooltip — so the modal
  // never opens and view.submit is never attempted. This asserts that existing
  // UI guard (the front-line defence; #2's writeback gate is the floor behind it
  // for any cross-page cc that load-time detection misses, e.g. a container-less cc).
  test('mechanism 1 — cross-page copy disables in-viewer Edit (guard front-line)', async ({ page }) => {
    const sourcePageId = await insertAndPublishMacroPage(page);
    const copyPageId = await copyMacroToNewPage(page, testConfig.domain, testConfig.parentPageId, sourcePageId);

    // View the COPY page — its macro's cc lives on the source page (samePage===false).
    await page.goto(`https://${testConfig.domain}/wiki/spaces/${testConfig.spaceKey}/pages/${copyPageId}`);
    const firstMacro = page.locator(FORGE_IFRAME).first().contentFrame();
    const editBtn = firstMacro.getByRole('button', { name: 'Edit' });
    await expect(editBtn).toBeVisible({ timeout: 30_000 });
    await expect(editBtn, 'cross-page copy must not be editable in-viewer').toBeDisabled();
    await expect(editBtn).toHaveAttribute('title', /lives on another page/i);
  });
});

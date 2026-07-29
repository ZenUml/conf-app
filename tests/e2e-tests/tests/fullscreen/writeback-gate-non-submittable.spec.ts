// Regression for ZenUml/conf-app#170 + the view-fork silent orphan: both copy
// shapes must be stopped at the Edit button, BEFORE the in-viewer modal opens —
// a fork minted inside that non-submittable surface can never be written back
// into the macro config, so #170's clean view.close() would strand the user's
// edit in a CC nothing references (runtime-proven 2026-07-29 on lite-dev:
// POST 201 fork, both macros still on the old id, edit invisible after reload).
//
// The two copy shapes and their front-line guards:
//   1. cross-page copy    — detected at LOAD time (zero-network pageId compare)
//      → in-viewer Edit rendered disabled with a "lives on another page" tooltip.
//   2. same-page duplicate — invisible at load (viewer runs 'cross-page-only',
//      PR #370) → detected at CLICK time (model/editDupGate.ts: one on-demand
//      ADF scan) → modal refused, button flips disabled, toast steers to the
//      page editor.
//
// Both preconditions are built via the v2 API (see helpers/macroDuplication.ts —
// the editor's clipboard duplication can't be driven from Playwright).
//
// Behind these front-line guards, two floors remain for anything they miss:
// the editor-side publishBlock (Publish disabled for a copy-flagged doc in a
// non-submittable surface) and #170's writeback gate (never throw
// "not submittable"), both locked by unit tests (editDupGate.spec.ts /
// writebackGate.spec.ts).

import { test, expect, Page } from '@playwright/test';
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

test.describe('REGRESSION #170 / view-fork gate — copy shapes are stopped before the in-viewer modal', () => {
  test.skip(!testConfig.isLite, 'Lite-only: the in-viewer Edit modal is the non-submittable surface');
  test.skip(!testConfig.macros.includes('sequence'), 'diagram (sequence) macro required');

  test('mechanism 2 — same-page duplicate (count>1): Edit is gated BEFORE the modal opens', async ({ page }) => {
    const pageId = await insertAndPublishMacroPage(page);
    await duplicateMacroSamePage(page, testConfig.domain, pageId);

    // Reload the published view; both macros now share one cc.
    await page.goto(`https://${testConfig.domain}/wiki/spaces/${testConfig.spaceKey}/pages/${pageId}`);
    await expect(page.locator(FORGE_IFRAME)).toHaveCount(2, { timeout: 30_000 });

    // From here on, any custom-content write means the gate failed and a fork
    // was minted (the silent-orphan bug this spec locks out). Attached only
    // now — the setup above legitimately POSTs when creating the macro's cc.
    const ccWrites: string[] = [];
    page.on('response', (resp) => {
      const req = resp.request();
      if (/\/api\/v2\/custom-content/.test(resp.url()) && ['POST', 'PUT'].includes(req.method())) {
        ccWrites.push(`${req.method()} ${resp.status()} ${resp.url()}`);
      }
    });

    const firstMacro = page.locator(FORGE_IFRAME).first().contentFrame();
    await expect(firstMacro.locator('body')).toBeVisible({ timeout: 30_000 });
    await new MacroPage(page).editMacro(firstMacro);

    // The click-time gate scans the page ADF, finds the shared id, and flips
    // the viewer into the same disabled-Edit state a cross-page copy gets —
    // this disable happening at all proves the gate fired.
    const editBtn = firstMacro.getByRole('button', { name: 'Edit' });
    await expect(editBtn, 'gate must disable Edit after the click').toBeDisabled({ timeout: 15_000 });
    await expect(editBtn).toHaveAttribute('title', /several copies/i);

    // The modal must never have opened, and nothing may have been written.
    await expectModalClosed(page, 'edit', 2_000);
    expect(ccWrites, `unexpected custom-content write(s): ${ccWrites[0] ?? ''}`).toHaveLength(0);
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

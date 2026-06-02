// SAME-PAGE failure→success demonstration for ZenUml/conf-app#170 (mechanism 2,
// the reachable fork path: a same-page duplicate, count>1). Throwaway two-phase
// verification — NOT a CI regression test (that's writeback-gate-non-submittable.spec.ts).
// Hands the pageId across two deploys via REPRO_PAGE_ID, exactly like #169's
// draft-only-binding-samepage spec.
//
//   PHASE A — pre-#2 build: REPRO_PAGE_ID unset → create a page with a macro,
//     clone the node (count>1) via the v2 API, edit it in-viewer + publish.
//     EXPECT FAILURE: the count>1 fork mints a new id → view.submit() in the
//     non-submittable Modal → throws → dialog stuck open. Prints SAMEPAGE_PAGE_ID.
//
//   PHASE B — #2 build: REPRO_PAGE_ID=<id> → REOPEN that same page (still count>1),
//     edit in-viewer + publish. EXPECT SUCCESS: the writeback is gated behind
//     repairWillPersist (false in the modal) → view.close() → dialog closes cleanly.
//
// Run:
//   # pre-#2 build on dev:
//   APP=zenuml-lite@dev npx playwright test --project=fullscreen writeback-gate-samepage
//   # grab SAMEPAGE_PAGE_ID, deploy #2, then:
//   REPRO_PAGE_ID=<id> APP=zenuml-lite@dev npx playwright test --project=fullscreen writeback-gate-samepage

import { test, expect, Page, FrameLocator } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { MacroPage } from '../../pages/MacroPage.js';
import { createPageAndSetup } from '../insert/insert-helpers.js';
import { duplicateMacroSamePage } from '../../helpers/macroDuplication.js';
import {
  modalContentFrame,
  fillEditorTitle,
  clickEditorPublish,
  expectModalVisible,
  expectModalClosed,
} from '../../helpers/FullscreenModalHelper.js';

const SEQUENCE_MACRO_BASE = 'Diagram (Mermaid, PlantUML & ZenUML)';
const FORGE_IFRAME = '[data-testid="ForgeExtensionContainer"] [data-testid="hosted-resources-iframe"]';
const REPRO_PAGE_ID = process.env.REPRO_PAGE_ID?.trim();

async function dismissPaywall(page: Page, waitMs = 4000): Promise<void> {
  const btn = modalContentFrame(page, 'edit').locator('[data-testid="continue-editing-btn"]');
  const shown = await btn.first().waitFor({ state: 'visible', timeout: waitMs }).then(() => true).catch(() => false);
  if (shown) {
    await btn.first().click();
    await btn.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
}

// Open the first macro's in-viewer Edit modal and dirty + publish it.
async function editAndPublishFirstMacro(page: Page, macroFrame: FrameLocator): Promise<void> {
  await expect(macroFrame.locator('body')).toBeVisible({ timeout: 30_000 });
  await new MacroPage(page).editMacro(macroFrame);
  await expectModalVisible(page, 'edit');
  await page.waitForTimeout(1500);
  await dismissPaywall(page);
  const cm = modalContentFrame(page, 'edit').locator('.cm-content, .CodeMirror').first();
  await cm.click();
  await page.keyboard.press('End');
  await page.keyboard.type('\n  A170-->B170');
  await clickEditorPublish(page);
}

test.describe('SAME-PAGE #170 — one count>1 page: stuck on pre-#2 → clean on #2', () => {
  test.skip(!testConfig.isLite, 'Lite-only: the in-viewer Edit modal is the non-submittable surface');
  test.skip(!testConfig.macros.includes('sequence'), 'diagram (sequence) macro required');

  test('PHASE A (pre-#2): count>1 fork → edit modal stuck open', async ({ page }) => {
    test.skip(!!REPRO_PAGE_ID, 'phase B requested (REPRO_PAGE_ID set)');

    const submitFailures: string[] = [];
    page.on('console', (m) => {
      if (/view\.submit\/close failed after save|not submittable/i.test(m.text())) submitFailures.push(m.text());
    });

    const editorPage = await createPageAndSetup(page, ' Lite');
    await editorPage.dismissLearnTheBasicsPanel();
    await editorPage.clickInsertElements();
    await editorPage.searchAndSelectMacro('diagram', editorPage.getMacroName(SEQUENCE_MACRO_BASE));
    await expectModalVisible(page, 'edit');
    await page.waitForTimeout(1500);
    await dismissPaywall(page);
    await fillEditorTitle(page, `SamePage170 ${Date.now()}`);
    await clickEditorPublish(page);
    await expectModalClosed(page, 'edit');
    await editorPage.publishPage();

    const pageId = page.url().match(/\/pages\/(\d+)\//)?.[1]!;
    await duplicateMacroSamePage(page, testConfig.domain, pageId);
    await page.goto(`https://${testConfig.domain}/wiki/spaces/${testConfig.spaceKey}/pages/${pageId}`);
    await expect(page.locator(FORGE_IFRAME)).toHaveCount(2, { timeout: 30_000 });

    await editAndPublishFirstMacro(page, page.locator(FORGE_IFRAME).first().contentFrame());

    // RED: count>1 fork → view.submit in modal → throws → modal stays open.
    await expect
      .poll(() => submitFailures.length, { timeout: 20_000, message: 'expected a not-submittable failure on the pre-#2 deploy' })
      .toBeGreaterThan(0);
    await expectModalVisible(page, 'edit', 3_000);

    await page.screenshot({ path: `samepage170-A-stuck-${pageId}-${Date.now()}.png`, fullPage: true });
    console.log(`\nSAMEPAGE_PAGE_ID=${pageId}\n`);
  });

  test('PHASE B (#2): reopen the same count>1 page → edit closes cleanly', async ({ page }) => {
    test.skip(!REPRO_PAGE_ID, 'phase A requested (set REPRO_PAGE_ID to run phase B)');

    const submitFailures: string[] = [];
    page.on('console', (m) => {
      if (/view\.submit\/close failed after save|not submittable/i.test(m.text())) submitFailures.push(m.text());
    });

    await page.goto(`https://${testConfig.domain}/wiki/spaces/${testConfig.spaceKey}/pages/${REPRO_PAGE_ID}`);
    // PRECONDITION GUARD: the page must still carry the count>1 duplicate from phase A.
    await expect(
      page.locator(FORGE_IFRAME),
      'page must still have 2 macros (phase A precondition)',
    ).toHaveCount(2, { timeout: 30_000 });

    await editAndPublishFirstMacro(page, page.locator(FORGE_IFRAME).first().contentFrame());

    // GREEN: count>1 fork → gated (not submittable) → view.close() → modal closes.
    await expectModalClosed(page, 'edit', 20_000);
    expect(submitFailures, `unexpected writeback failure: ${submitFailures[0] ?? ''}`).toHaveLength(0);

    await page.screenshot({ path: `samepage170-B-clean-${REPRO_PAGE_ID}-${Date.now()}.png`, fullPage: true });
    console.log(`\nSAMEPAGE_OK page=${REPRO_PAGE_ID}\n`);
  });
});

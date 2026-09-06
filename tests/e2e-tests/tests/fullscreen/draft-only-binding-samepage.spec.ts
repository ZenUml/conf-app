// SAME-PAGE failure→success demonstration for ZenUml/conf-app#169.
//
// This is a THROWAWAY verification spec, not a CI regression test (the pristine
// regression lives in draft-only-binding-fork.spec.ts, fresh-page per run). Its
// only job: prove that ONE specific page goes from broken (buggy deploy) to
// working (fixed deploy) — the "same page" evidence the fresh-page spec can't give.
//
// It runs in two phases across two deploys, handing the pageId over via env:
//
//   PHASE A — buggy deploy (ApWrapper2 guard = `count === 1`):
//     REPRO_PAGE_ID unset → create a previously-published page, add the macro in
//     a fresh draft (binding lives in the DRAFT only, published body is empty →
//     countMacros===0), edit+publish the macro. EXPECT FAILURE: the save forks,
//     idChanged fires view.submit() in the non-submittable Forge Modal → throws
//     "not submittable", modal stays open. Prints `SAMEPAGE_PAGE_ID=<id>`.
//
//   PHASE B — fixed deploy (guard = `count <= 1`):
//     REPRO_PAGE_ID=<id from phase A> → REOPEN that same page's draft, assert the
//     macro is still there (precondition guard — if phase A didn't persist the
//     draft-only binding, the demo is meaningless), edit+publish again. EXPECT
//     SUCCESS: count<=1 → update in place → idChanged stays false → modal closes,
//     zero submit failures.
//
// Run:
//   # after deploying BUGGY build to dev:
//   APP=zenuml-lite@dev npx playwright test --project=fullscreen draft-only-binding-samepage
//   # grab SAMEPAGE_PAGE_ID from output, deploy FIXED build, then:
//   REPRO_PAGE_ID=<id> APP=zenuml-lite@dev npx playwright test --project=fullscreen draft-only-binding-samepage

import { test, expect, Page } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { MacroPage } from '../../pages/MacroPage.js';
import {
  modalContentFrame,
  clickEditorPublish,
  expectModalVisible,
  expectModalClosed,
} from '../../helpers/FullscreenModalHelper.js';

const REPRO_PAGE_ID = process.env.REPRO_PAGE_ID?.trim();

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

// Dirty the diagram code, then Publish — the save that forks on buggy code.
async function dirtyAndPublish(page: Page): Promise<void> {
  const cm = modalContentFrame(page, 'edit').locator('.cm-content, .CodeMirror').first();
  await cm.click();
  await page.keyboard.press('End');
  await page.keyboard.type('\n  A169-->B169');
  await clickEditorPublish(page);
}

test.describe('SAME-PAGE #169 — one page: broken on buggy deploy → fixed on fixed deploy', () => {
  test.skip(!testConfig.isLite, 'Lite-only: the in-viewer Edit modal is the non-submittable surface');
  test.skip(!testConfig.macros.includes('sequence'), 'diagram (sequence) macro required');

  // PHASE A deleted 2026-09-03 (fix/e2e-stale-specs, issue #609): asserted a
  // "view.submit/not-submittable failure" that only reproduces against the
  // pre-fix (buggy) ApWrapper2 guard (`count === 1`) described in the file
  // header above. Fixed code (`count <= 1`, shipped long ago) cannot fail
  // this assertion — it isn't a stale selector, the thing it tests for no
  // longer exists to happen. PHASE B below is unaffected: it takes its page
  // id from the REPRO_PAGE_ID env var, set by hand from a real PHASE A run
  // against an actually-buggy deploy (not from any state this file produces
  // at run time), so it's still meaningful as a standalone throwaway
  // verification script for a future regression of #169.

  // PHASE B — run on the FIXED deploy against the SAME page from phase A.
  test('PHASE B (fixed): reopen that same page, edit succeeds (modal closes, no fork)', async ({ page }) => {
    test.skip(!REPRO_PAGE_ID, 'phase A requested (set REPRO_PAGE_ID to run phase B)');

    const submitFailures: string[] = [];
    page.on('console', (m) => {
      if (/view\.submit\/close failed after save|not submittable/i.test(m.text())) submitFailures.push(m.text());
    });

    // Reopen the SAME page's draft (the draft-only binding from phase A lives here).
    await page.goto(`https://${testConfig.domain}/wiki/spaces/${testConfig.spaceKey}/pages/edit-v2/${REPRO_PAGE_ID}`);
    await expect(page.locator('[data-test-id="editor-title"]')).toBeVisible({ timeout: 30_000 });

    const editorPage = await import('../../pages/EditorPage.js').then(
      (m) => new m.ConfluenceEditorPage(page),
    );
    await editorPage.dismissLearnTheBasicsPanel();

    // PRECONDITION GUARD (advisor #2): the macro must still be in the reopened
    // draft. If it isn't, phase A failed to persist the draft-only binding and
    // any "success" below would be testing nothing.
    const macroPage = new MacroPage(page);
    const macroFrame = macroPage.getSequenceMacroFrame();
    await expect(
      macroFrame.locator('body'),
      'macro must still render in the reopened draft (phase A precondition)',
    ).toBeVisible({ timeout: 30_000 });

    await macroPage.editMacro(macroFrame);
    await expectModalVisible(page, 'edit');
    await page.waitForTimeout(1500);
    await dismissPaywall(page);

    await dirtyAndPublish(page);

    // GREEN proof: count<=1 → update in place → idChanged=false → view.close()
    // → modal closes cleanly. Same page that was stuck in phase A.
    await expectModalClosed(page, 'edit', 20_000);
    expect(submitFailures, `unexpected writeback failure: ${submitFailures[0] ?? ''}`).toHaveLength(0);

    await page.screenshot({ path: `samepage169-B-clean-${REPRO_PAGE_ID}-${Date.now()}.png`, fullPage: true });
    console.log(`\nSAMEPAGE_OK page=${REPRO_PAGE_ID}\n`);
  });
});

// Regression for ZenUml/conf-app#170 + the view-fork silent orphan: both copy
// shapes must be stopped at the Edit button, BEFORE the in-viewer modal opens —
// a fork minted inside that non-submittable surface can never be written back
// into the macro config, so #170's clean view.close() would strand the user's
// edit in a CC nothing references (runtime-proven 2026-07-29 on lite-dev:
// POST 201 fork, both macros still on the old id, edit invisible after reload).
//
// The two copy shapes and their front-line guards — now identical for EVERY
// macro type (sequence family, graph, openapi, asyncapi), since all viewers
// load with the zero-network 'cross-page-only' copy check:
//   1. cross-page copy    — detected at LOAD time (zero-network pageId compare)
//      → in-viewer Edit rendered disabled with a "lives on another page" tooltip.
//   2. same-page duplicate — invisible at load by construction → detected at
//      CLICK time (utils/guardEditClick.ts: one memoized on-demand ADF scan)
//      → modal refused, button flips disabled, toast steers to the page editor.
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
import { dismissStarterGalleryIfPresent } from '../../helpers/starterGallery.js';

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
  await dismissStarterGalleryIfPresent(page, modalContentFrame(page, 'edit'));
  await fillEditorTitle(page, `Gate170 ${Date.now()}`);
  await clickEditorPublish(page);
  await expectModalClosed(page, 'edit');
  await editorPage.publishPage();
  const pageId = page.url().match(/\/pages\/(\d+)\//)?.[1];
  expect(pageId, 'published page id').toBeTruthy();
  return pageId!;
}

// Insert a graph / openapi macro into a fresh page and publish it. Returns pageId.
async function insertAndPublishNonSequenceMacro(page: Page, kind: 'graph' | 'openapi'): Promise<string> {
  const editorPage = await createPageAndSetup(page, ' Lite');
  await editorPage.dismissLearnTheBasicsPanel();
  await editorPage.clickInsertElements();
  if (kind === 'openapi') {
    await editorPage.searchAndSelectMacro('openapi', editorPage.getMacroName('OpenAPI / Swagger'));
    await editorPage.interactWithOpenApiMacro(`Gate170 openapi ${Date.now()}`);
  } else {
    await editorPage.searchAndSelectMacro('graph', editorPage.getMacroName('Graph (DrawIO)'));
    await editorPage.interactWithGraphMacro(`Gate170 graph ${Date.now()}`);
  }
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

  // Every viewer type now loads with the zero-network 'cross-page-only' copy
  // check — the full page-ADF scan it replaces cost ~15% of a graph render's
  // p50 and ~22% of an openapi render's (measured, 7d external). The gate that
  // replaced it runs on the Edit click, and it must hold for these types too:
  // each registers its OWN EventBus 'edit' listener that opens a modal
  // independently of forgeIndex's, so both consult the (memoized) guard.
  //
  // Same assertions as mechanism 2 — the protection must be indistinguishable
  // across types; that is the whole point of moving them onto one mechanism.
  for (const kind of ['openapi', 'graph'] as const) {
    test(`mechanism 3 — ${kind} same-page duplicate: Edit is gated BEFORE the modal opens`, async ({ page }) => {
      test.skip(!testConfig.macros.includes(kind), `${kind} macro not in this profile`);

      const pageId = await insertAndPublishNonSequenceMacro(page, kind);
      await duplicateMacroSamePage(page, testConfig.domain, pageId);
      await page.goto(`https://${testConfig.domain}/wiki/spaces/${testConfig.spaceKey}/pages/${pageId}`);
      await expect(page.locator(FORGE_IFRAME)).toHaveCount(2, { timeout: 30_000 });

      // Attach after load: from here a custom-content write means a fork was
      // minted, i.e. the gate failed.
      const ccWrites: string[] = [];
      page.on('response', (resp) => {
        const req = resp.request();
        if (/\/api\/v2\/custom-content/.test(resp.url()) && ['POST', 'PUT'].includes(req.method())) {
          ccWrites.push(`${req.method()} ${resp.status()} ${resp.url()}`);
        }
      });

      const firstMacro = page.locator(FORGE_IFRAME).first().contentFrame();
      const editBtn = firstMacro.getByRole('button', { name: 'Edit' });
      await expect(editBtn).toBeVisible({ timeout: 30_000 });
      // Enabled at load now (no load-time full scan) — the gate is the click.
      await expect(editBtn, 'load-time scan is gone, so Edit starts enabled').toBeEnabled();
      await editBtn.click();

      await expect(editBtn, `${kind} click gate must disable Edit`).toBeDisabled({ timeout: 20_000 });
      await expect(editBtn).toHaveAttribute('title', /several copies/i);
      await expectModalClosed(page, 'edit', 3_000);
      expect(ccWrites, `unexpected custom-content write(s): ${ccWrites[0] ?? ''}`).toHaveLength(0);
    });

    // False-positive guard: a NORMAL macro of the same type must still open its
    // editor on the first click. Without this, "the gate works" could just mean
    // "the gate blocks everything".
    test(`mechanism 3b — ${kind} unique macro still opens the editor on Edit`, async ({ page }) => {
      test.skip(!testConfig.macros.includes(kind), `${kind} macro not in this profile`);

      const pageId = await insertAndPublishNonSequenceMacro(page, kind);
      await page.goto(`https://${testConfig.domain}/wiki/spaces/${testConfig.spaceKey}/pages/${pageId}`);
      const firstMacro = page.locator(FORGE_IFRAME).first().contentFrame();
      const editBtn = firstMacro.getByRole('button', { name: 'Edit' });
      await expect(editBtn).toBeVisible({ timeout: 30_000 });
      await editBtn.click();
      await expectModalVisible(page, 'edit', 30_000);
    });

    // The other half of what 'cross-page-only' must still deliver for these
    // types: cross-page copies stay disabled at LOAD (that check is the part
    // that survived — it is zero-network). Guards the switch from detectCopy
    // to detectCrossPageCopy in their viewer loads.
    test(`mechanism 3c — ${kind} cross-page copy stays disabled at LOAD`, async ({ page }) => {
      test.skip(!testConfig.macros.includes(kind), `${kind} macro not in this profile`);

      const sourcePageId = await insertAndPublishNonSequenceMacro(page, kind);
      const copyPageId = await copyMacroToNewPage(page, testConfig.domain, testConfig.parentPageId, sourcePageId);

      await page.goto(`https://${testConfig.domain}/wiki/spaces/${testConfig.spaceKey}/pages/${copyPageId}`);
      const firstMacro = page.locator(FORGE_IFRAME).first().contentFrame();
      const editBtn = firstMacro.getByRole('button', { name: 'Edit' });
      await expect(editBtn).toBeVisible({ timeout: 30_000 });
      await expect(editBtn, `${kind} cross-page copy must not be editable in-viewer`).toBeDisabled();
      await expect(editBtn).toHaveAttribute('title', /lives on another page/i);
    });
  }

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

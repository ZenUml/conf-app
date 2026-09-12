// Feedback reporting — the in-product "Send feedback" edge trigger + dialog.
//
// Ports a manual spot check (verified by hand on lite-dev, branch HEAD
// 460efc70) into a checked-in spec. Six behaviours, across four surfaces:
//
//   1. Viewer: a fixed edge trigger (data-testid="feedback-edge" ->
//      "feedback-trigger", aria-label "Send feedback", visible text
//      "Feedback" once revealed) renders on a published macro.
//   2. Viewer: clicking the trigger opens a SEPARATE Forge modal (a new
//      Custom UI iframe, context.extension.modal.macroMode === 'feedback'),
//      never an inline `.feedback-overlay` in the macro's own frame.
//   3. Editor and fullscreen: the same trigger opens an INLINE
//      `.feedback-overlay` in the CURRENT frame, and the dialog's
//      auto-attached-fields panel reports Surface = editor / fullscreen.
//   4. PNG export: while `.export-modal-backdrop` is open, the page-level
//      host (`#zenuml-feedback-host`) hides its trigger (FeedbackHost.vue
//      suppresses during export by default); the export modal mounts its
//      OWN FeedbackHost instance (suppressDuringExport=false) whose dialog
//      reports Surface = png_export. Driven from the FULLSCREEN viewer
//      (already open for assertion 3b), not the in-page one, DELIBERATELY:
//      the first version of this spec drove it via ViewerActionsHelper's
//      `openExport` (the in-page viewer), and its "Export PNG" click was
//      intercepted by the in-page viewer's zoom-percentage label ("100%")
//      at this point in this spec's flow — reproduced live on lite-stg
//      (2026-09-10) and separately by hand via agent-browser. `openExport`
//      itself is not broken — its own spec, tests/fullscreen/viewer-
//      actions.spec.ts, drives it successfully on a freshly-published page
//      with no prior fullscreen open/close — it is something about this
//      spec's specific sequencing that hits the intercept; root cause not
//      fully isolated. Moving the check to the already-open fullscreen
//      viewer did NOT make the click land cleanly either (a *different*
//      interceptor — `.viewer-footer-row` / an `atlaskit-portal` element —
//      never cleared across a 60s retry loop there, also reproduced live);
//      the Export PNG click uses `force: true` below for that reason, the
//      same escape hatch paywallGate.ts uses for an analogous backdrop-
//      intercept, verified (not just fired-and-forgotten) by the very next
//      assertion. The export-suppression behaviour under test is identical
//      on both surfaces (same FeedbackHost.vue logic, gated on
//      `.export-modal-backdrop` presence, not on which viewer hosts it), so
//      the surface choice here is about dodging the intercept, not about
//      the assertion needing the fullscreen surface specifically.
//   5. "Capture current view" produces a screenshot preview. On the viewer
//      surface this round-trips over a BroadcastChannel between the macro
//      iframe and the separate feedback-modal iframe (see feedbackBridge.ts)
//      — requestFeedbackCapture() itself has a 5s product timeout, so a
//      generous UI-settle wait (TIMEOUTS.FRAME_LOAD) does not mask a real
//      product regression, it just avoids a flaky bare wait.
//   6. Submitting with a description returns a reference matching
//      /^FBR-[A-Z0-9]{12}$/ (functions/api/feedback-report.ts) and flips the
//      dialog to its success state.
//
// Structure: TWO tests, not six-plus, to keep live-Confluence page creation
// (insertMacro/insertAndPublishMacro) to two calls total instead of one per
// assertion — each create+publish round trip costs real wall-clock against a
// live site.
//
//   - Test 1 walks assertions 1-5 on a single created+published page: editor
//     surface is checked DURING insertMacro (before the page is even
//     published), then the same page is published and reused for fullscreen,
//     viewer, and export-modal checks.
//   - Test 2 covers assertion 6 alone. Submitting writes a real row to
//     staging D1 (functions/api/feedback-report.ts) and, since it also
//     attaches a screenshot, an object to R2 — on every run, with no
//     cleanup. That is squarely inside the existing convention for this
//     suite (insertAndPublishMacro's test pages are themselves never
//     deleted — see insert-helpers.ts), so it is NOT gated behind
//     process.env.CI like the unrelated spot-check-metrics-fix.spec.ts is.
//
// The whole file is skipped on production (`testConfig.isProd`), not just
// the backend-write test. `insert` is also the suite the production release
// smoke (smoke-test.yml) and release.yml run against zenuml.atlassian.net —
// a real backend write there would violate "never use production databases
// for testing" (see the workspace CLAUDE.md Safety Rules), but even the
// read-only surfaces test creates a real page on production and makes a
// brand-new UI spec a release gate. Neither is part of this suite's job: a
// post-deploy smoke should not be the first place a new spec runs, and the
// value of asserting a feedback trigger's placement immediately after a
// prod deploy is low next to that risk. `testConfig.isProd` is false for
// every staging profile (id ends `@stg`, not `@prod`), so this does not
// skip on staging. The description text in test 2 carries an identifiable
// marker for anyone auditing staging D1 rows later.

import { test, expect } from '@playwright/test';
import { testConfig, TIMEOUTS } from '../../config/test-config.js';
import { MacroPage } from '../../pages/MacroPage.js';
import { insertMacro, insertAndPublishMacro } from '../../helpers/MacroFlowHelper.js';
import {
  fillEditorTitle,
  clickEditorPublish,
  expectModalClosed,
  modalContentFrame,
  clickHeaderClose,
} from '../../helpers/FullscreenModalHelper.js';
import { openFullscreenViewer, viewerFrame } from '../../helpers/ViewerActionsHelper.js';
import { frameWithTestId } from '../../helpers/byline.js';

test.describe('Feedback reporting', { tag: ['@modal', '@editor', '@viewer', '@fullscreen', '@feedback'] }, () => {
  test.skip(!testConfig.isForge, 'Feedback reporting is Forge-only');
  test.skip(!testConfig.macros.includes('sequence'), 'sequence macro required');
  // File-wide, not just the backend-write test — see the file header for why.
  test.skip(testConfig.isProd, 'insert is shared with the production release smoke; a new spec should not debut there, and the backend-write test would hit real prod D1/R2.');

  test('editor, fullscreen, viewer and PNG export surfaces', async ({ page }) => {
    // -------------------------------------------------------------------
    // Assertion 3a — editor surface: inline overlay, Surface = editor.
    // Checked BEFORE publishing — insertMacro() leaves the bridge modal
    // open with the macro not yet on the page.
    // -------------------------------------------------------------------
    const { editorPage } = await insertMacro(page, 'sequence');
    const editorFrame = modalContentFrame(page, 'edit');
    await expect(editorFrame.locator('body')).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });

    const editorEdge = editorFrame.locator('[data-testid="feedback-edge"]');
    await expect(editorEdge).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    await editorEdge.locator('[data-testid="feedback-trigger"]').click();

    const editorOverlay = editorFrame.locator('.feedback-overlay');
    await expect(editorOverlay).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    await editorOverlay.locator('.context-disclosure').click();
    await expect(editorOverlay.locator('dt:has-text("Surface") + dd')).toHaveText('editor');

    await editorOverlay.getByRole('button', { name: 'Cancel' }).click();
    await expect(editorOverlay).toBeHidden();

    // Publish the macro, then the page, the same way insertAndPublishMacro
    // does — reusing this page (rather than creating a second one) for the
    // rest of the surfaces below.
    const title = `Feedback report ${Date.now()}`;
    await fillEditorTitle(page, title);
    await clickEditorPublish(page);
    await expectModalClosed(page, 'edit');
    await editorPage.publishPage();
    const macroPage = new MacroPage(page);
    await macroPage.dismissSpotlightModal();

    // -------------------------------------------------------------------
    // Assertion 3b — fullscreen surface: inline overlay, Surface = fullscreen.
    // -------------------------------------------------------------------
    await openFullscreenViewer(page, 'sequence');
    const fullscreenFrame = modalContentFrame(page, 'fullscreen-viewer');
    await expect(fullscreenFrame.locator('body')).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });

    const fullscreenEdge = fullscreenFrame.locator('[data-testid="feedback-edge"]');
    await expect(fullscreenEdge).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    await fullscreenEdge.locator('[data-testid="feedback-trigger"]').click();

    const fullscreenOverlay = fullscreenFrame.locator('.feedback-overlay');
    await expect(fullscreenOverlay).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    await fullscreenOverlay.locator('.context-disclosure').click();
    await expect(fullscreenOverlay.locator('dt:has-text("Surface") + dd')).toHaveText('fullscreen');

    await fullscreenOverlay.getByRole('button', { name: 'Cancel' }).click();
    await expect(fullscreenOverlay).toBeHidden();

    // -------------------------------------------------------------------
    // Assertion 4 — PNG export dialog: page-level trigger hides, export
    // modal's own trigger reports Surface = png_export. Driven from the
    // FULLSCREEN viewer (still open from 3b above), not the in-page one —
    // see the file header for why.
    // -------------------------------------------------------------------
    // `force: true` for the same reason paywallGate.ts uses it: the button
    // is the real, intended target, but something else in the viewer chrome
    // sits on top of its click point. Observed live on lite-stg (2026-09-10)
    // TWICE with two different interceptors — the in-page viewer's zoom-%
    // label the first time this spec drove Export from there, then (after
    // moving the check here, to the fullscreen viewer) `.viewer-footer-row`
    // / an `atlaskit-portal` element, neither of which ever cleared across a
    // 60s action-timeout retry loop. Not a bare `force` without a check,
    // though: the very next assertion (`exportBackdrop` visible) verifies
    // the click actually reached the button and opened the modal, the same
    // detach-confirmation discipline paywallGate.ts's own `force` click uses
    // — if `force` ever lands on the wrong (intercepting) element instead,
    // this fails loudly here rather than silently proceeding.
    const exportBtn = fullscreenFrame.getByRole('button', { name: 'Export PNG' });
    await expect(exportBtn).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    await exportBtn.click({ force: true });

    const exportBackdrop = fullscreenFrame.locator('.export-modal-backdrop');
    await expect(exportBackdrop).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });

    await expect(fullscreenFrame.locator('#zenuml-feedback-host [data-testid="feedback-edge"]')).toHaveCount(0);

    const exportEdge = exportBackdrop.locator('[data-testid="feedback-edge"]');
    await expect(exportEdge).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    await exportEdge.locator('[data-testid="feedback-trigger"]').click();

    const exportOverlay = exportBackdrop.locator('.feedback-overlay');
    await expect(exportOverlay).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    await exportOverlay.locator('.context-disclosure').click();
    await expect(exportOverlay.locator('dt:has-text("Surface") + dd')).toHaveText('png_export');

    await exportOverlay.getByRole('button', { name: 'Cancel' }).click();
    await expect(exportOverlay).toBeHidden();
    // main replaced ExportSidebar with ExportWorkspace, and with it the
    // `.sidebar-close` handle this used to click. The close control is now the
    // workspace header's button, addressed by its accessible name.
    await exportBackdrop.getByRole('button', { name: 'Close export' }).click();
    await expect(exportBackdrop).toBeHidden();

    await clickHeaderClose(page, 'fullscreen-viewer');
    await expectModalClosed(page, 'fullscreen-viewer');

    // -------------------------------------------------------------------
    // Assertions 1 & 2 — viewer surface: fixed edge trigger, and clicking it
    // opens a SEPARATE Forge modal (new iframe), never an inline overlay in
    // the macro's own frame.
    // -------------------------------------------------------------------
    const macroFrame = viewerFrame(page, 'sequence');
    await expect(macroFrame.locator('body')).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });

    const pageHostEdge = macroFrame.locator('#zenuml-feedback-host [data-testid="feedback-edge"]');
    await expect(pageHostEdge).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    const pageHostTrigger = pageHostEdge.locator('[data-testid="feedback-trigger"]');
    await expect(pageHostTrigger).toHaveAttribute('aria-label', 'Send feedback');

    // Label text is only revealed on hover/focus (edge collapses to an icon
    // otherwise) — assert the collapsed -> revealed transition, not just
    // that the (always-present-in-the-DOM) text node exists.
    await expect(pageHostEdge).not.toHaveClass(/revealed/);
    await pageHostTrigger.hover();
    await expect(pageHostEdge).toHaveClass(/revealed/);
    await expect(pageHostTrigger.getByText('Feedback', { exact: true })).toBeVisible();

    await pageHostTrigger.click();

    const viewerModalFrame = await frameWithTestId(page, 'send-feedback');
    await expect(
      viewerModalFrame.locator('[role="dialog"][aria-labelledby="feedback-title"]'),
    ).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    // Assert the negative AFTER the new modal frame resolved — asserting it
    // immediately after the click would pass trivially before anything has
    // happened.
    await expect(macroFrame.locator('.feedback-overlay')).toHaveCount(0);

    // -------------------------------------------------------------------
    // Assertion 5 — "Capture current view" produces a screenshot preview.
    // -------------------------------------------------------------------
    const captureBtn = viewerModalFrame.locator('[data-testid="capture-current-view"]');
    await expect(captureBtn).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    await captureBtn.click();
    await expect(viewerModalFrame.getByText('Current view captured')).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    await expect(viewerModalFrame.getByText('Replace', { exact: true })).toBeVisible();
    await expect(viewerModalFrame.getByText('Retake', { exact: true })).toBeVisible();
    await expect(viewerModalFrame.locator('[data-testid="remove-screenshot"]')).toBeVisible();

    await viewerModalFrame.getByRole('button', { name: 'Close feedback' }).click();
  });

  // -------------------------------------------------------------------
  // Assertion 6 — submitting saves a report and returns an FBR- reference.
  // Real backend write (D1 + R2) on every run; the file-wide isProd skip
  // above covers this (and every other test in the file) on production —
  // see the file header for why.
  // -------------------------------------------------------------------
  test('submitting with a description saves a report and returns a reference', async ({ page }) => {
    await insertAndPublishMacro(page, 'sequence');
    const macroFrame = viewerFrame(page, 'sequence');
    await expect(macroFrame.locator('body')).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });

    const trigger = macroFrame.locator('#zenuml-feedback-host [data-testid="feedback-trigger"]');
    await expect(trigger).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    await trigger.click();

    const modalFrame = await frameWithTestId(page, 'send-feedback');
    const description = modalFrame.locator('#feedback-description');
    await expect(description).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    await description.fill(`[e2e feedback-report.spec.ts] automated E2E submission — ${new Date().toISOString()}`);

    await modalFrame.locator('[data-testid="send-feedback"]').click();

    const reference = modalFrame.locator('.success-state strong');
    await expect(reference).toBeVisible({ timeout: TIMEOUTS.FRAME_LOAD });
    await expect(reference).toHaveText(/^FBR-[A-Z0-9]{12}$/);
  });
});

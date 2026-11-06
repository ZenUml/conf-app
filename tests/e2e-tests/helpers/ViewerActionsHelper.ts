// Helpers for viewer toolbar actions: Fullscreen, Export, Copy Code, Versions.
// All four exist on every macro type (sequence/graph/openapi) but their
// internals differ — Export opens an in-iframe Vue ExportModal for Sequence
// and a DrawIO export sidebar for Graph; Versions is a console-log dump for
// all three (the Forge versions UI is currently emit-only, no modal).
//
// Controls live inside the macro iframe (see src/components/Viewer/GenericViewer.vue):
//   - header buttons "Fullscreen" and "Edit"
//   - header "More" (⋯) menu items "Copy diagram link", "Copy page link",
//     "Export PNG", "Versions", "Download debug info" — the staged header
//     (2026-10) removed the bottom pill that used to hold them
//
// CAVEATS:
//  - Clipboard reads require navigator.clipboard.readText() from the TOP page
//    context. Read it on `page.evaluate`, NOT on the iframe — the iframe
//    won't have clipboard permission.
//  - Versions in the current build only logs to console — there's no DOM
//    target to assert on. We listen to console messages and pattern-match.
//  - "More" must be matched exactly: getByRole name matching is a substring
//    match, and the Copy for AI chevron is labelled "Copy for AI — more options".

import { Page, FrameLocator, expect, ConsoleMessage } from '@playwright/test';
import { MacroPage } from '../pages/MacroPage.js';
import { modalDialog, modalContentFrame, expectModalVisible } from './FullscreenModalHelper.js';

export type ViewerKind = 'sequence' | 'graph' | 'openapi';

export function viewerFrame(page: Page, kind: ViewerKind): FrameLocator {
  const macroPage = new MacroPage(page);
  switch (kind) {
    case 'sequence': return macroPage.getSequenceMacroFrame();
    case 'graph':    return macroPage.getGraphMacroFrame();
    case 'openapi':  return macroPage.getOpenApiMacroFrame();
  }
}

/**
 * Click the toolbar Fullscreen button and assert the fullscreen viewer
 * modal opens. Returns the modal locator.
 */
export async function openFullscreenViewer(page: Page, kind: ViewerKind): Promise<void> {
  const frame = viewerFrame(page, kind);
  await expect(frame.locator('body')).toBeVisible({ timeout: 30_000 });
  const btn = frame.getByRole('button', { name: 'Fullscreen' });
  await expect(btn).toBeVisible();
  await btn.click();
  await expectModalVisible(page, 'fullscreen-viewer');
}

/**
 * Open the inline header's More (⋯) menu and pick an item. The header actions
 * are hover-revealed; Playwright's click moves the pointer onto the trigger,
 * which reveals them.
 */
export async function clickMoreMenuItem(frame: FrameLocator, name: string): Promise<void> {
  const more = frame.getByRole('button', { name: 'More', exact: true });
  await expect(more).toBeVisible({ timeout: 30_000 });
  await more.click();
  const item = frame.getByRole('menuitem', { name, exact: true });
  await expect(item).toBeVisible();
  await item.click();
}

/**
 * Pick "Export PNG" from the header More menu and assert the shared
 * ExportModal (src/components/ExportModal/ExportModal.vue) opens. As of the
 * V8 viewer redesign (2026-05-04) ALL three macro types share this one
 * export UI — Graph no longer opens a separate DrawIO export sidebar.
 */
export async function openExport(page: Page, kind: ViewerKind): Promise<{ kind: 'export-modal' | 'unknown' }> {
  const frame = viewerFrame(page, kind);
  await expect(frame.locator('body')).toBeVisible({ timeout: 30_000 });
  await clickMoreMenuItem(frame, 'Export PNG');

  // The dialog no longer opens inside the inline macro iframe. That iframe is
  // ~560px wide and a few hundred px tall (564x256 on the production page this
  // was reported from), which leaves the annotation controls unusable, so the
  // button opens the Fullscreen modal and the dialog opens there on arrival.
  await expectModalVisible(page, 'fullscreen-viewer');
  const modalFrame = modalContentFrame(page, 'fullscreen-viewer');

  const exportModal = modalFrame.locator('[data-testid="export-modal"], .export-modal').first();
  // isVisible is an immediate snapshot; its timeout option does not wait for
  // the fullscreen viewer's asynchronous export-entry initialization.
  await expect(exportModal).toBeVisible({ timeout: 20_000 });
  return { kind: 'export-modal' };
}

/**
 * Retrieve the diagram source and put it on the clipboard, then read the
 * clipboard from the top-level page. Returns the clipboard text.
 *
 * The old single "Copy Code" button (viewerFrame -> Copy Code -> clipboard)
 * was removed by the V8 viewer redesign (2026-05-04). The current path for
 * text-DSL macros (sequence/mermaid/plantuml — see GenericViewer.vue's
 * `showViewSource` gate) is: click "Source" (data-testid="view-source-btn")
 * to open the ViewSourcePanel side sheet, then its own Copy button
 * (data-testid="view-source-copy") writes the source to the clipboard.
 *
 * Graph and OpenAPI have NO source-retrieval affordance in the current
 * viewer toolbar at all — `showViewSource` is gated to text-DSL diagram
 * types only, and neither ForgeGraphViewer.vue nor OpenApiViewer.vue add
 * one of their own. Callers for those kinds will find no "Source" button
 * and this correctly times out — that reflects a real, deliberate product
 * gap (not a stale selector), not a bug in this helper.
 *
 * The clipboard read happens on the OUTER `page` because the iframe doesn't
 * have clipboard-read permission — even if we wrote to the clipboard from
 * the iframe, only the outer document can read it back.
 */
export async function clickCopyCodeAndRead(page: Page, kind: ViewerKind): Promise<string> {
  const frame = viewerFrame(page, kind);
  // Grant clipboard-read so navigator.clipboard.readText() works.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

  if (kind === 'sequence') {
    // data-testid, not getByRole(name: 'Source') — the diagram canvas can
    // contain a participant/node whose accessible name is something like
    // "Icon-Resource/Compute/…", and Playwright's default name match is a
    // case-insensitive SUBSTRING match, so "Source" matches "Re[source]"
    // too (strict-mode violation, 2 elements). See view-source-btn in
    // GenericViewer.vue.
    const sourceBtn = frame.getByTestId('view-source-btn');
    await expect(sourceBtn).toBeVisible({ timeout: 30_000 });
    await sourceBtn.click();
    const copyBtn = frame.getByTestId('view-source-copy');
    await expect(copyBtn).toBeVisible({ timeout: 10_000 });
    await copyBtn.click();
    // Small settle window — Vue mutation observers fire async.
    await page.waitForTimeout(300);
    return page.evaluate(async () => {
      try {
        return await navigator.clipboard.readText();
      } catch (e) {
        return `__clipboard_error__:${(e as Error).message}`;
      }
    });
  }

  // graph / openapi — no source-retrieval affordance exists; see doc comment.
  const btn = frame.getByRole('button', { name: 'Copy Code' });
  await expect(btn).toBeVisible({ timeout: 30_000 });
  await btn.click();
  await page.waitForTimeout(300);
  return page.evaluate(async () => {
    try {
      return await navigator.clipboard.readText();
    } catch (e) {
      return `__clipboard_error__:${(e as Error).message}`;
    }
  });
}

/**
 * Click Versions, capture relevant console output. Returns the captured
 * console lines that match the versions log pattern.
 *
 * The current Forge versions UX is intentionally minimal — the click
 * triggers `getAndPrintContentVersions()` which logs version metadata to
 * `console.log`. Until a real versions UI ships, this is the canonical
 * verification path (matches the manual run notes in
 * docs/fullscreen-test-rerun-data.json).
 */
export async function clickVersionsAndCaptureLogs(
  page: Page,
  kind: ViewerKind,
  timeoutMs = 5_000,
): Promise<string[]> {
  const frame = viewerFrame(page, kind);
  const captured: string[] = [];
  const listener = (msg: ConsoleMessage) => {
    const text = msg.text();
    if (/Getting versions|Found \d+ versions?|Version \d+/i.test(text)) {
      captured.push(text);
    }
  };
  page.on('console', listener);
  try {
    await clickMoreMenuItem(frame, 'Versions');
    // Wait for the version-fetch + log roundtrip.
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (captured.some(l => /Found \d+ versions?/i.test(l))) break;
      await page.waitForTimeout(250);
    }
  } finally {
    page.off('console', listener);
  }
  return captured;
}

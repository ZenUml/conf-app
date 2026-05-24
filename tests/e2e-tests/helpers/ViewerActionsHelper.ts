// Helpers for viewer toolbar actions: Fullscreen, Export, Copy Code, Versions.
// All four exist on every macro type (sequence/graph/openapi) but their
// internals differ — Export opens an in-iframe Vue ExportModal for Sequence
// and a DrawIO export sidebar for Graph; Versions is a console-log dump for
// all three (the Forge versions UI is currently emit-only, no modal).
//
// Toolbar buttons live inside the macro iframe and use these aria-labels
// (see src/components/Viewer/GenericViewer.vue):
//   - "Fullscreen"
//   - "Edit"
//   - "Export" (the button itself is a download icon; aria-label is "Download PNG")
//   - "Copy Code"
//   - "Versions"
//
// CAVEATS:
//  - Clipboard reads require navigator.clipboard.readText() from the TOP page
//    context. Read it on `page.evaluate`, NOT on the iframe — the iframe
//    won't have clipboard permission.
//  - Versions in the current build only logs to console — there's no DOM
//    target to assert on. We listen to console messages and pattern-match.
//  - The Export aria-label on the actual button is "Download PNG" (the button
//    that opens the export modal), not "Export". Use a regex to be tolerant.

import { Page, FrameLocator, expect, ConsoleMessage } from '@playwright/test';
import { MacroPage } from '../pages/MacroPage.js';
import { modalDialog, expectModalVisible } from './FullscreenModalHelper.js';

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
 * Click the toolbar Export button. For sequence/openapi this opens the in-
 * iframe ExportModal (Vue); for graph it opens the DrawIO sidebar.
 * Returns true if a recognizable export UI surfaced.
 */
export async function openExport(page: Page, kind: ViewerKind): Promise<{ kind: 'export-modal' | 'drawio-sidebar' | 'unknown' }> {
  const frame = viewerFrame(page, kind);
  await expect(frame.locator('body')).toBeVisible({ timeout: 30_000 });
  // Button uses aria-label="Download PNG" in GenericViewer.vue.
  const exportBtn = frame.getByRole('button', { name: /download png|export/i }).first();
  await expect(exportBtn).toBeVisible();
  await exportBtn.click();

  if (kind === 'sequence' || kind === 'openapi') {
    // Vue ExportModal — has a "Download" or "PNG" button visible.
    const exportModal = frame.locator('[data-testid="export-modal"], .export-modal, [class*="export"]').first();
    if (await exportModal.isVisible({ timeout: 5_000 }).catch(() => false)) {
      return { kind: 'export-modal' };
    }
    // Fallback: heading text "Export Settings".
    const exportHeading = frame.getByText(/export settings/i).first();
    if (await exportHeading.isVisible({ timeout: 2_000 }).catch(() => false)) {
      return { kind: 'export-modal' };
    }
    return { kind: 'unknown' };
  }

  // Graph (DrawIO) — sidebar appears.
  const drawioFrame = frame.locator('iframe').contentFrame();
  const sidebar = drawioFrame.locator('.sidebar-container, [class*="sidebar-container"]').first();
  if (await sidebar.isVisible({ timeout: 5_000 }).catch(() => false)) {
    return { kind: 'drawio-sidebar' };
  }
  return { kind: 'unknown' };
}

/**
 * Click Copy Code, then read clipboard from the top-level page. Returns the
 * clipboard text. Caller asserts the content matches the expected diagram.
 *
 * The clipboard read happens on the OUTER `page` because the iframe doesn't
 * have clipboard-read permission — even if we wrote to the clipboard from
 * the iframe, only the outer document can read it back.
 */
export async function clickCopyCodeAndRead(page: Page, kind: ViewerKind): Promise<string> {
  const frame = viewerFrame(page, kind);
  const btn = frame.getByRole('button', { name: 'Copy Code' });
  await expect(btn).toBeVisible({ timeout: 30_000 });
  // Grant clipboard-read so navigator.clipboard.readText() works.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await btn.click();
  // Small settle window — Vue mutation observers fire async.
  await page.waitForTimeout(300);
  const text = await page.evaluate(async () => {
    try {
      return await navigator.clipboard.readText();
    } catch (e) {
      return `__clipboard_error__:${(e as Error).message}`;
    }
  });
  return text;
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
    const btn = frame.getByRole('button', { name: 'Versions' });
    await expect(btn).toBeVisible({ timeout: 30_000 });
    await btn.click();
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

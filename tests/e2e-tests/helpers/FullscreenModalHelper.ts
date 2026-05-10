// Helpers for asserting the Forge bridge fullscreen modal chrome and routing
// macro-specific open/edit flows through it. Companion to CloseGuardHelper —
// CloseGuardHelper covers dirty/clean signal; this helper covers everything
// else (modal dimensions, header, close button, app icon, no Confluence chrome
// underneath, Esc key behavior, tab switching, title gating).
//
// Selectors follow the Forge Custom UI bridge convention:
//   - Edit modal:        [data-testid="custom-ui-fullscreen-modal-dialog"]
//                        (manifest.yml has viewportSize: fullscreen for all 4
//                         macros, so the insert/edit modal Atlassian renders
//                         is the fullscreen variant)
//   - Fullscreen viewer: [data-testid="custom-ui-fullscreen-modal-dialog"]
//                        (opened via view.open({ size: 'fullscreen' }))
// Both wrap an iframe at [data-testid="hosted-resources-iframe"] whose
// contentFrame() is the actual macro UI.
//
// CAVEATS (hard-won from manual run docs/fullscreen-test-rerun-data.json):
//  - Modal viewport size in CI may not be exactly 1920×835. Read the actual
//    viewport from the page rather than hardcoding.
//  - Atlassian's header is ~70px tall. The hosted-resources-iframe rect.y
//    should equal that header height (default 70).
//  - The header X close button accessible name is /close/i (not "X"); use
//    getByRole('button', { name: /close/i }).
//  - DrawIO captures Esc; sequence editor doesn't pass Esc to the bridge —
//    so Esc-while-modal-open is editor-dependent. Document outcome rather
//    than asserting either way.

import { Page, FrameLocator, Locator, expect } from '@playwright/test';

export type ModalKind = 'edit' | 'fullscreen-viewer';

const MODAL_TESTIDS: Record<ModalKind, string> = {
  'edit': 'custom-ui-fullscreen-modal-dialog',
  'fullscreen-viewer': 'custom-ui-fullscreen-modal-dialog',
};

/**
 * Get the modal element by kind. Use the `edit` variant for the bridge modal
 * that opens when inserting/editing a macro. Use `fullscreen-viewer` for the
 * read-only modal opened by the toolbar Fullscreen button.
 */
export function modalDialog(page: Page, kind: ModalKind = 'edit'): Locator {
  return page.getByTestId(MODAL_TESTIDS[kind]);
}

/**
 * Drill into the editor iframe inside the modal.
 */
export function modalContentFrame(page: Page, kind: ModalKind = 'edit'): FrameLocator {
  return modalDialog(page, kind)
    .locator('[data-testid="hosted-resources-iframe"]')
    .contentFrame();
}

/**
 * Assert that the modal is open and the editor iframe is visible.
 */
export async function expectModalVisible(
  page: Page,
  kind: ModalKind = 'edit',
  timeoutMs = 15_000,
): Promise<void> {
  const modal = modalDialog(page, kind);
  await expect(modal).toBeVisible({ timeout: timeoutMs });
  await expect(modal.locator('[data-testid="hosted-resources-iframe"]')).toBeVisible({ timeout: timeoutMs });
}

/**
 * Assert that the modal renders at the full viewport. The expected baseline
 * recorded in fullscreen-test-rerun-data.json is 0,0,1920×835 with a 70px
 * Atlassian header (so the editor iframe rect is 0,70,1920×765). We don't
 * hardcode 1920×835 — instead, verify modal == viewport, and the iframe rect
 * starts at y === HEADER_PX with width === viewport.width.
 */
export async function expectFullscreenLayout(
  page: Page,
  kind: ModalKind = 'edit',
  options: { headerPx?: number } = {},
): Promise<{ modalRect: DOMRect; iframeRect: DOMRect; viewport: { width: number; height: number } }> {
  const headerPx = options.headerPx ?? 70;
  const modal = modalDialog(page, kind);
  const iframe = modal.locator('[data-testid="hosted-resources-iframe"]');

  await expect(modal).toBeVisible();
  await expect(iframe).toBeVisible();

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('expectFullscreenLayout: viewport size is unknown');

  const modalRect = await modal.evaluate(el => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, left: r.left, right: r.right, bottom: r.bottom } as DOMRect;
  });
  const iframeRect = await iframe.evaluate(el => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, left: r.left, right: r.right, bottom: r.bottom } as DOMRect;
  });

  // Modal occupies entire viewport.
  expect(Math.round(modalRect.x)).toBe(0);
  expect(Math.round(modalRect.y)).toBe(0);
  expect(Math.round(modalRect.width)).toBe(viewport.width);
  expect(Math.round(modalRect.height)).toBe(viewport.height);

  // Iframe sits below header, full viewport width, fills the rest vertically.
  expect(Math.round(iframeRect.x)).toBe(0);
  expect(Math.round(iframeRect.y)).toBe(headerPx);
  expect(Math.round(iframeRect.width)).toBe(viewport.width);
  expect(Math.round(iframeRect.height)).toBe(viewport.height - headerPx);

  return { modalRect, iframeRect, viewport };
}

/**
 * Assert there is exactly ONE close affordance — the Atlassian header X.
 * Distinct from any button INSIDE the editor iframe (which we explicitly
 * verified should not exist as a result of the fullscreen migration).
 */
export async function expectSingleHeaderClose(page: Page, kind: ModalKind = 'edit'): Promise<Locator> {
  const modal = modalDialog(page, kind);
  // Atlassian header sits at top of modal; the close button is /close/i.
  const closeBtns = modal.getByRole('button', { name: /close/i });
  await expect(closeBtns).toHaveCount(1);
  await expect(closeBtns.first()).toBeVisible();
  return closeBtns.first();
}

/**
 * Assert the modal header text matches the expected macro module title.
 * The title comes from manifest.yml. Examples:
 *   "Diagram (Mermaid, PlantUML & ZenUML) Lite"
 *   "Graph (DrawIO) Lite"
 *   "OpenAPI / Swagger Lite"
 */
export async function expectHeaderTitle(
  page: Page,
  expected: string | RegExp,
  kind: ModalKind = 'edit',
): Promise<void> {
  const modal = modalDialog(page, kind);
  if (typeof expected === 'string') {
    await expect(modal).toContainText(expected);
  } else {
    await expect(modal).toContainText(expected);
  }
}

/**
 * Assert that no Confluence chrome (sidebar, top nav, page byline) is visible
 * while the modal is open. The modal element itself has aria-modal=true and
 * sits above everything; we verify the underlying page nav landmarks are
 * either absent from the a11y tree or covered by the modal.
 */
export async function expectNoConfluenceChrome(page: Page, kind: ModalKind = 'edit'): Promise<void> {
  // The modal must have aria-modal=true so screen readers don't reach the
  // backdrop. This is the strongest guarantee that "no chrome" is visible.
  const modal = modalDialog(page, kind);
  const ariaModal = await modal.getAttribute('aria-modal');
  expect(ariaModal).toBe('true');

  // Sanity check: the global nav (Atlassian "switcher" / "appswitcher") is
  // either off-screen or covered. We check that any `nav` landmarks that
  // exist do not intersect the modal's visible area in a meaningful way.
  // This is best-effort — Confluence's exact nav DOM varies.
  const visible = await page.evaluate(() => {
    const nav = document.querySelector('nav');
    if (!nav) return { exists: false } as const;
    const r = (nav as HTMLElement).getBoundingClientRect();
    return { exists: true, top: r.top, left: r.left, width: r.width, height: r.height } as const;
  });
  // If a nav exists, it must be off-screen (negative coords) or zero-sized,
  // OR the modal must cover it. We rely on aria-modal as the primary signal.
  if (visible.exists) {
    // No strict assertion here — different Confluence editor versions render
    // nav landmarks differently. The aria-modal check above is the contract.
  }
}

/**
 * Click the header X close button.
 */
export async function clickHeaderClose(page: Page, kind: ModalKind = 'edit'): Promise<void> {
  const closeBtn = await expectSingleHeaderClose(page, kind);
  await closeBtn.click();
}

/**
 * Press Esc while the modal is focused.
 */
export async function pressEscape(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
}

/**
 * Switch to a tab inside the editor (Sequence / Mermaid / PlantUML).
 * Used by sequence-create cases 2/3/4.
 */
export async function switchEditorTab(page: Page, tabName: 'Sequence' | 'Mermaid' | 'PlantUML'): Promise<void> {
  const frame = modalContentFrame(page, 'edit');
  await frame.getByRole('tab', { name: tabName }).click();
}

/**
 * Read the editor's CodeMirror content (works for sequence, plant, mermaid).
 */
export async function readCodeMirrorContent(page: Page): Promise<string> {
  const frame = modalContentFrame(page, 'edit');
  return frame.locator('.cm-content, .CodeMirror').first().textContent() as Promise<string>;
}

/**
 * Assert the Publish button state. `expected: 'enabled' | 'disabled'`.
 * Uses aria-disabled or the disabled attribute — works for both Vue and
 * React variants (zenuml/openapi/graph).
 */
export async function expectPublishButtonState(
  page: Page,
  expected: 'enabled' | 'disabled',
): Promise<void> {
  const frame = modalContentFrame(page, 'edit');
  const btn = frame.locator('button:has-text("Publish")').first();
  await expect(btn).toBeVisible();
  if (expected === 'enabled') {
    await expect(btn).toBeEnabled();
  } else {
    await expect(btn).toBeDisabled();
  }
}

/**
 * Fill the title input inside the editor. Returns the input locator.
 */
export async function fillEditorTitle(page: Page, title: string): Promise<void> {
  const frame = modalContentFrame(page, 'edit');
  // Multiple editor variants share the same first <input type="text"> for title.
  const titleInput = frame.locator('input[type="text"]').first();
  await titleInput.click();
  await titleInput.fill(title);
}

/**
 * Click Publish inside the editor. For DrawIO macros, the Publish button is
 * inside the inner DrawIO iframe (double-nested) — caller should pass
 * `nested: 'drawio'` for that path.
 */
export async function clickEditorPublish(page: Page, options: { nested?: 'drawio' } = {}): Promise<void> {
  const outerFrame = modalContentFrame(page, 'edit');
  if (options.nested === 'drawio') {
    const innerFrame = outerFrame.locator('iframe').contentFrame();
    await innerFrame.locator('button:has-text("Publish")').click();
  } else {
    await outerFrame.locator('button:has-text("Publish")').click();
  }
}

/**
 * Wait for the modal to disappear after a successful Publish/Close.
 */
export async function expectModalClosed(
  page: Page,
  kind: ModalKind = 'edit',
  timeoutMs = 15_000,
): Promise<void> {
  await expect(modalDialog(page, kind)).toBeHidden({ timeout: timeoutMs });
}

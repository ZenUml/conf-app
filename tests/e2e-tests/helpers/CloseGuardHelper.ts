// Reusable primitives for testing the unsaved-edit close guard
// (`src/utils/closeGuard.ts`) end-to-end through the Forge bridge fullscreen
// modal. The guard registers a `beforeunload` listener on the editor iframe's
// window that calls preventDefault when isDirty() is true; the bridge X click
// triggers iframe unload which fires beforeunload which the browser converts
// into a "Leave site?" confirm dialog.
//
// Two ways to verify the guard from a Playwright test:
//
//   1. SYNTHETIC dispatch (deterministic): manually dispatch a beforeunload
//      Event inside the editor frame and read defaultPrevented. No real modal
//      navigation, no dialog handler, no flake. This is the primary signal.
//
//   2. REAL header X click + page.on('dialog'): integration proof. Register
//      the dialog handler BEFORE clicking X; assert dialog.type() ===
//      'beforeunload'. Note that Playwright's default behavior auto-dismisses
//      beforeunload dialogs in some headless modes, so dialog.type() may not
//      always surface — treat as a complement to synthetic, not a replacement.
//
// SCREENSHOT CONVENTION: when these helpers are used as part of a manually-
// driven test execution (e.g. via Playwright MCP) that records evidence in
// `docs/fullscreen-test-plan.html`, every test case should produce at least
// one screenshot saved under `docs/screenshots/<case-key>.png`. The test
// plan webpage renders inline thumbnails when the notes contain markdown
// `![](docs/screenshots/foo.png)` — that's the integration point.
// `.playwright-mcp/` is NOT served by Vite, so screenshots saved there
// won't render in the test plan.

import { Page, FrameLocator, expect } from '@playwright/test';

export type EditorKind = 'sequence' | 'graph' | 'openapi' | 'embed';

/**
 * Locate the Forge bridge modal's editor iframe content frame. Matches the
 * `data-testid="custom-ui-fullscreen-modal-dialog"` selector that Forge uses for Custom
 * UI bridge modals — same convention as `EditorPage.interactWithForgeDiagramMacro`.
 */
export function bridgeModalFrame(page: Page): FrameLocator {
  return page
    .getByTestId('custom-ui-fullscreen-modal-dialog')
    .locator('[data-testid="hosted-resources-iframe"]')
    .contentFrame();
}

/**
 * Wait for the bridge modal to be open and its editor iframe to have loaded.
 * Use after triggering insert or edit. Throws if the modal doesn't appear.
 */
export async function waitForBridgeModal(page: Page, timeoutMs = 15_000): Promise<void> {
  const modal = page.getByTestId('custom-ui-fullscreen-modal-dialog');
  await expect(modal).toBeVisible({ timeout: timeoutMs });
  await expect(modal.locator('[data-testid="hosted-resources-iframe"]')).toBeVisible({ timeout: timeoutMs });
}

/**
 * Dispatch a synthetic `beforeunload` event in the given frame and return
 * whether the listener called preventDefault. The deterministic primitive.
 *
 * Caveats:
 *  - In-iframe instrumentation (defineProperty getters/setters on window
 *    state, monkey-patches on Event.prototype) leaks across dispatches and
 *    can produce false-positive `defaultPrevented=true`. Re-open the modal
 *    between independent tests rather than dispatching repeatedly in the
 *    same frame.
 *  - Do NOT pre-seed `event.returnValue` — WebIDL boolean conversion turns
 *    `undefined` into `false` which sets the canceled flag before dispatch.
 */
export async function dispatchSyntheticBeforeunload(frame: FrameLocator): Promise<boolean> {
  return frame.locator('body').evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
}

/**
 * Same primitive but operating on the top-level Confluence page, not a
 * Forge iframe. Useful for `page-actions:3` (close-page-while-dirty) where
 * Confluence's own editor registers a beforeunload listener.
 */
export async function dispatchSyntheticBeforeunloadOnPage(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
}

/**
 * Convenience: assert clean state, then dirty the editor, then assert dirty.
 * The single-call shape future tests should use.
 */
export async function expectGuardContract(
  page: Page,
  kind: EditorKind,
  options: { dirtyAction?: () => Promise<void> } = {},
): Promise<void> {
  const frame = bridgeModalFrame(page);

  // Clean baseline — editor mounted but no edits yet.
  const cleanResult = await dispatchSyntheticBeforeunload(frame);
  expect(cleanResult, `clean dispatch for ${kind}`).toBe(false);

  // Editor-specific dirty action (or caller-provided override).
  if (options.dirtyAction) {
    await options.dirtyAction();
  } else {
    await dirtyEditor(page, kind);
  }

  const dirtyResult = await dispatchSyntheticBeforeunload(frame);
  expect(dirtyResult, `dirty dispatch for ${kind}`).toBe(true);
}

/**
 * Per-editor "make it dirty" action. Each editor exposes a different
 * mechanism for state mutation, but the abstraction is the same: change
 * something the close guard's isDirty() callback observes.
 */
export async function dirtyEditor(page: Page, kind: EditorKind): Promise<void> {
  const frame = bridgeModalFrame(page);
  switch (kind) {
    case 'sequence':
      await dirtySequenceEditor(frame);
      return;
    case 'openapi':
      await dirtyOpenApiEditor(frame);
      return;
    case 'graph':
      await dirtyGraphEditor(frame);
      return;
    case 'embed':
      await dirtyEmbedPicker(frame);
      return;
  }
}

/**
 * Sequence/Mermaid/PlantUML editor: type into the CodeMirror surface.
 * The Vue `Header.vue` component watches `currentCode` against `originalCode`.
 */
async function dirtySequenceEditor(frame: FrameLocator): Promise<void> {
  const cm = frame.locator('.cm-content, .CodeMirror textarea').first();
  await cm.click();
  await cm.press('End');
  await cm.pressSequentially(' // dirty', { delay: 30 });
}

/**
 * OpenAPI/Swagger editor: type into the YAML editor textarea.
 * `react/Header.tsx` captures the baseline lazily via `window.specListeners`
 * (the first non-empty spec value); typing fires the listener and updates
 * `window.specContent`.
 */
async function dirtyOpenApiEditor(frame: FrameLocator): Promise<void> {
  const yamlEditor = frame.locator('.swagger-editor textarea, [data-editor="ace"], .ace_editor textarea').first();
  await yamlEditor.click();
  await yamlEditor.press('End');
  await yamlEditor.pressSequentially(' # dirty', { delay: 30 });
}

/**
 * DrawIO editor: send a postMessage to the embedded DrawIO iframe simulating
 * an autosave with `modified: true`. `ForgeGraphEditor.vue`'s message handler
 * sets `_drawioModified = true`, which the close guard's isDirty() reads.
 */
async function dirtyGraphEditor(frame: FrameLocator): Promise<void> {
  await frame.locator('body').evaluate(() => {
    const drawioFrame = document.querySelector('iframe') as HTMLIFrameElement | null;
    if (!drawioFrame?.contentWindow) {
      throw new Error('DrawIO inner iframe not found');
    }
    // The Vue message handler listens on the OUTER window, so we
    // dispatch the message there directly (no need to round-trip through
    // postMessage if we're in the same realm — which we are because the
    // handler is `addEventListener('message', ...)` on the editor's
    // window).
    window.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ event: 'autosave', modified: true }),
    }));
  });
}

/**
 * Embed picker (DocumentList.vue): click a different document so picked.id
 * changes. Falls back to JS-level mutation if no second document is visible.
 */
async function dirtyEmbedPicker(frame: FrameLocator): Promise<void> {
  const items = frame.locator('a[class*="block px-6 py-3"]:has(span.font-semibold)');
  const count = await items.count();
  if (count >= 2) {
    // Click the second item if first is the initial selection.
    await items.nth(1).click();
    return;
  }
  if (count === 1) {
    await items.first().click();
    return;
  }
  throw new Error('Embed picker has no documents to switch to — cannot dirty');
}

/**
 * Click the Atlassian header X. Use with `page.on('dialog', ...)` registered
 * BEFORE the click. Returns whether a dialog event fired.
 *
 * Some headless Playwright configurations auto-dismiss beforeunload without
 * surfacing a dialog event; treat a no-dialog result as inconclusive rather
 * than a guard failure unless you can independently confirm via synthetic
 * dispatch that the guard is registered.
 */
/**
 * Save a screenshot to `docs/screenshots/<name>.png` (the path the test plan
 * webpage serves) and return the markdown image string ready to embed in a
 * test-plan note. The convention enforces that every test execution records
 * visual evidence.
 *
 *   const md = await attachScreenshot(page, 'rerun-cross-6');
 *   notes += '\n\n' + md;
 *
 * Pass `element` for a node-scoped shot, or omit for a viewport shot.
 */
export async function attachScreenshot(
  page: Page,
  name: string,
  options: { fullPage?: boolean; element?: import('@playwright/test').Locator } = {},
): Promise<string> {
  const path = `docs/screenshots/${name}.png`;
  if (options.element) {
    await options.element.screenshot({ path });
  } else {
    await page.screenshot({ path, fullPage: options.fullPage ?? false });
  }
  return `![](${path})`;
}

export async function clickHeaderXAndCaptureDialog(
  page: Page,
  options: { timeoutMs?: number; accept?: boolean } = {},
): Promise<{ fired: boolean; type?: string }> {
  const dialogPromise = page.waitForEvent('dialog', { timeout: options.timeoutMs ?? 5_000 })
    .catch(() => null);

  const closeBtn = page.getByTestId('custom-ui-fullscreen-modal-dialog').getByRole('button', { name: /close/i }).first();
  await closeBtn.click();

  const dialog = await dialogPromise;
  if (!dialog) return { fired: false };

  if (options.accept) {
    await dialog.accept();
  } else {
    await dialog.dismiss();
  }
  return { fired: true, type: dialog.type() };
}

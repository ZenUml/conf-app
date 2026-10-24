import { Locator, Page } from '@playwright/test';

/**
 * Put the caret in the Confluence editor body without depending on a pointer
 * click landing on it.
 *
 * From 2026-10-24 a brand-new page on zenuml.atlassian.net renders a Rovo
 * "Describe or select what you want to create" panel inside the empty body:
 * template buttons ("Decision doc", "Out of office plan", "Team progress
 * report", "Templates") plus a prompt box. The panel sits inside the
 * `[data-editor-content-component]` subtree on top of the ProseMirror
 * textbox, so the textbox resolves as visible and stable but every pointer
 * click on its centre is intercepted by a template button — the release smoke
 * for v2026.10.241314-diagramly timed out at `editorEl.click()` in all six
 * @smoke insert/edit tests.
 *
 * A trial click tells us whether the pointer would reach the textbox. If it
 * would (sites without the panel), click as before. If not, focus the
 * contenteditable directly: ProseMirror takes keyboard input and keeps a
 * selection for the toolbar "+" insert without any pointer event, and the
 * panel itself is never touched, so no template gets applied.
 *
 * Returns true when the body was covered and had to be focused via the DOM.
 */
export async function focusEditorBody(page: Page, editorEl: Locator): Promise<boolean> {
  if (await isPointerReachable(editorEl)) {
    await editorEl.click();
    return false;
  }
  console.log('  [debug] editor body covered (Rovo template panel?) — focusing it via the DOM');
  await editorEl.focus();
  await page.waitForTimeout(200);
  return true;
}

export async function isPointerReachable(editorEl: Locator): Promise<boolean> {
  return editorEl
    .click({ trial: true, timeout: 2000 })
    .then(() => true)
    .catch(() => false);
}

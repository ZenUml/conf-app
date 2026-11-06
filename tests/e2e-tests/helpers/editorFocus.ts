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
 * contenteditable directly and check that focus actually landed there: on
 * prod it sometimes stays in the page title, and a Ctrl+A/Delete meant for
 * the body then wipes the title instead. When it did not land, click the
 * title (never covered) and press End + Enter, which moves the caret into
 * the body. The panel itself is never clicked, so no template gets applied,
 * and it does not block typing or paste once the body has focus.
 */
export async function focusEditorBody(page: Page, editorEl: Locator): Promise<void> {
  const reachable = await editorEl
    .click({ trial: true, timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  if (reachable) {
    await editorEl.click();
    return;
  }

  await editorEl.focus();
  await page.waitForTimeout(200);
  if (await hasFocusWithin(editorEl)) {
    console.log('  [debug] editor body covered (Rovo template panel?) — focused it via the DOM');
    return;
  }

  await page.locator('[data-test-id="editor-title"]').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const focused = await hasFocusWithin(editorEl);
  console.log(`  [debug] editor body covered (Rovo template panel?) — entered it from the title: ${focused ? 'focused' : 'STILL NOT FOCUSED'}`);
}

function hasFocusWithin(editorEl: Locator): Promise<boolean> {
  return editorEl.evaluate((el) => el.contains(document.activeElement)).catch(() => false);
}

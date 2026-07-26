import { Page, expect } from '@playwright/test';

/**
 * Helpers for the embed autoConvert deeplink (#360) and its ticketed-preview
 * extension. Pure functions over Page — no test-runner state, reusable across
 * specs and spot checks.
 *
 * Paste mechanics (paid for during #360 verification, 2026-07-26):
 * - Clicking the editor's aria-label wrapper leaves ProseMirror caret-less;
 *   focus the ProseMirror node and collapse a Range before any paste.
 * - Headless Meta+V is a NO-OP (the shortcut reads the OS clipboard, which
 *   the async clipboard API does not populate in headless Chromium). The
 *   reliable headless path is dispatching a ClipboardEvent carrying the URL
 *   on BOTH text/plain and text/uri-list — autoConvert matches on the link.
 * - A converted paste becomes an ADF extension node; a plain paste stays an
 *   <a>. Poll for the node — conversion is editor-side async (~2-8s).
 */

export const DEEPLINK_HOST = 'https://confluence.zenuml.com';

export function buildDeeplink(cloudId: string, contentId: string, ticket?: string): string {
  return `${DEEPLINK_HOST}/d/${cloudId}/${contentId}${ticket ? `?t=${ticket}` : ''}`;
}

/** Focus ProseMirror with a collapsed caret — precondition for any paste. */
export async function focusEditorCaret(page: Page): Promise<void> {
  const editor = page.locator('[aria-label*="Page editing area"]');
  await editor.waitFor({ state: 'visible' });
  await editor.click();
  await page.evaluate(() => {
    const pm = document.querySelector<HTMLElement>('.ProseMirror');
    if (!pm) return;
    pm.focus();
    const range = document.createRange();
    range.selectNodeContents(pm);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  });
}

/**
 * Paste `text` into the focused editor. Headless-safe: dispatches a synthetic
 * ClipboardEvent (text/plain + text/uri-list). autoConvert runs on the
 * editor's paste plugin, which this event reaches; only isTrusted-dependent
 * paths would need a headed Meta+V (see paste-deeplink notes).
 */
export async function pasteText(page: Page, text: string): Promise<void> {
  await focusEditorCaret(page);
  await page.evaluate((t) => {
    const root = document.querySelector('[aria-label*="Page editing area"]');
    if (!root) throw new Error('editor root not found');
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    dt.setData('text/uri-list', t);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    (root.querySelector('p') || root).dispatchEvent(ev);
  }, text);
}

/** Assert the last paste autoconverted into a Forge extension node. */
export async function expectAutoconverted(page: Page, timeoutMs = 15_000): Promise<void> {
  const ext = page.locator(
    '[aria-label*="Page editing area"] ' +
      '[data-node-type="extension"], ' +
      '[aria-label*="Page editing area"] [data-node-type="inlineExtension"], ' +
      '[aria-label*="Page editing area"] [data-node-type="bodiedExtension"]',
  );
  await expect(ext.first()).toBeVisible({ timeout: timeoutMs });
}

/** Assert the pasted URL stayed a plain link (negative case). */
export async function expectPlainLink(page: Page, url: string, settleMs = 8_000): Promise<void> {
  await page.waitForTimeout(settleMs); // conversion window must fully elapse
  const state = await page.evaluate((u) => {
    const root = document.querySelector('[aria-label*="Page editing area"]');
    return {
      hasExtension: !!root?.querySelector(
        '[data-node-type="extension"], [data-node-type="inlineExtension"], [data-node-type="bodiedExtension"]',
      ),
      hasAnchor: [...(root?.querySelectorAll('a') ?? [])].some((a) =>
        (a as HTMLAnchorElement).href.startsWith(u),
      ),
      text: (root as HTMLElement | null)?.innerText?.slice(0, 200) ?? '',
    };
  }, url);
  expect(state.hasExtension, 'must NOT convert').toBe(false);
  expect(state.hasAnchor || state.text.includes(url), 'URL should remain as link/text').toBe(true);
}

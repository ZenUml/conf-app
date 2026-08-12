import { Page } from '@playwright/test';

// Embed-deeplink autoConvert automation. A real paste event is required:
// typing only linkifies the URL and never runs Forge macro autoConvert.
// Scope every operation to Confluence's page body. The editor now also renders
// a Rovo prompt backed by ProseMirror; a generic `.ProseMirror` selector can
// paste the deeplink there while leaving the actual page body empty.
const EDITOR_BODY = '[role="textbox"][aria-label*="Main content area"], [role="textbox"][aria-label*="Page editing area"]';

function editorBody(page: Page) {
  return page.locator(EDITOR_BODY).first();
}

/** The canonical embed deeplink for a diagram (matches the active variant). */
export function embedDeeplinkUrl(host: string, cloudId: string, contentId: string): string {
  return `https://${host}/d/${cloudId}/${contentId}`;
}

export async function pasteDeeplink(page: Page, url: string): Promise<void> {
  await editorBody(page).click();
  await page.waitForTimeout(200);
  await page.evaluate(({ selector, url: u }) => {
    const pm = document.querySelector(selector) as HTMLElement | null;
    if (!pm) throw new Error('pasteDeeplink: Confluence page editor not found');
    pm.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', u);
    pm.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, { selector: EDITOR_BODY, url });
}

export interface EditorConversion {
  extensionKeys: string[];
  cardCount: number;
  anchorHrefs: string[];
}

export async function readConversion(page: Page, timeoutMs = 8000): Promise<EditorConversion> {
  const deadline = Date.now() + timeoutMs;
  let out: EditorConversion = { extensionKeys: [], cardCount: 0, anchorHrefs: [] };
  while (true) {
    out = await page.evaluate((selector) => {
      const pm = document.querySelector(selector);
      if (!pm) throw new Error('readConversion: Confluence page editor not found');
      const q = (s: string) => Array.from(pm.querySelectorAll(s));
      return {
        extensionKeys: q('[extensionkey]').map(
          (e) => e.getAttribute('extensionkey') || '',
        ),
        cardCount: q(
          '[data-node-type="inlineCard"], [data-node-type="blockCard"]',
        ).length,
        anchorHrefs: q('a[href]').map((a) => a.getAttribute('href') || ''),
      };
    }, EDITOR_BODY);
    if (out.extensionKeys.length || out.cardCount || out.anchorHrefs.length) break;
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(400);
  }
  return out;
}

export function isEmbedMacro(conv: EditorConversion): boolean {
  return conv.extensionKeys.some((k) => k.includes('zenuml-embed-macro'));
}

async function clearEditor(page: Page): Promise<void> {
  await editorBody(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(150);
}

// Forge matchers load asynchronously on a cold editor. Clear and re-paste
// until the matcher is ready so the test observes autoConvert, not startup
// timing.
export async function pasteDeeplinkUntilConverted(
  page: Page,
  url: string,
  opts: { attempts?: number; settleMs?: number } = {},
): Promise<EditorConversion> {
  const attempts = opts.attempts ?? 12;
  const settleMs = opts.settleMs ?? 1500;
  let conv: EditorConversion = { extensionKeys: [], cardCount: 0, anchorHrefs: [] };
  for (let i = 0; i < attempts; i++) {
    await clearEditor(page);
    await pasteDeeplink(page, url);
    conv = await readConversion(page, settleMs);
    if (isEmbedMacro(conv)) return conv;
    await page.waitForTimeout(1000);
  }
  return conv;
}

import { Page } from '@playwright/test';

// Embed-deeplink autoConvert automation. A real paste event is required:
// typing only linkifies the URL and never runs Forge macro autoConvert.
const PM = '.ProseMirror';

/** The canonical embed deeplink for a diagram (matches the active variant). */
export function embedDeeplinkUrl(host: string, cloudId: string, contentId: string): string {
  return `https://${host}/d/${cloudId}/${contentId}`;
}

export async function pasteDeeplink(page: Page, url: string): Promise<void> {
  await page.locator(PM).first().click();
  await page.waitForTimeout(200);
  await page.evaluate((u) => {
    const pm = document.querySelector('.ProseMirror') as HTMLElement | null;
    if (!pm) throw new Error('pasteDeeplink: .ProseMirror editor not found');
    pm.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', u);
    pm.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, url);
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
    out = await page.evaluate(() => {
      const q = (s: string) => Array.from(document.querySelectorAll(s));
      return {
        extensionKeys: q('.ProseMirror [extensionkey]').map(
          (e) => e.getAttribute('extensionkey') || '',
        ),
        cardCount: q(
          '.ProseMirror [data-node-type="inlineCard"], .ProseMirror [data-node-type="blockCard"]',
        ).length,
        anchorHrefs: q('.ProseMirror a[href]').map((a) => a.getAttribute('href') || ''),
      };
    });
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
  await page.locator(PM).first().click();
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

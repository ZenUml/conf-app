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

/**
 * Did the paste convert into the given macro?
 *
 * Substring, not equality: Lite suffixes every macro key with `-lite`
 * (`zenuml-graph-macro` -> `zenuml-graph-macro-lite`), so a caller can pass the
 * unsuffixed key and have it match on every variant.
 */
export function isMacro(conv: EditorConversion, macroKey: string): boolean {
  return conv.extensionKeys.some((k) => k.includes(macroKey));
}

/**
 * The typed paste-to-place link — `/d/<type>/<cloudId>/<contentId>`, four path
 * segments to the embed form's three.
 *
 * Host is deliberately NOT `testConfig.deeplinkHost`. The embed matcher moved to
 * the per-variant serving hosts (conf-lite / conf-full) in the #382 migration,
 * but the typed matchers in manifest.yml are still written against
 * confluence.zenuml.com, and `buildDiagramDeeplink` mints to match them. Point
 * this at the variant host and nothing converts.
 */
export function typedDeeplinkUrl(type: string, cloudId: string, contentId: string): string {
  return `https://confluence.zenuml.com/d/${type}/${cloudId}/${contentId}`;
}

/** The create-a-new-diagram-of-this-type link. Carries no site or content. */
export function newDiagramUrl(type: string): string {
  return `https://confluence.zenuml.com/new/${type}`;
}

/**
 * Generalized form of pasteDeeplinkUntilConverted: retries until `done` holds,
 * so a cold editor's not-yet-loaded Forge matchers read as startup timing rather
 * than a conversion failure. Returns the last observed state either way, so a
 * caller can assert on what actually appeared.
 */
export async function pasteUntil(
  page: Page,
  url: string,
  done: (conv: EditorConversion) => boolean,
  opts: { attempts?: number; settleMs?: number } = {},
): Promise<EditorConversion> {
  const attempts = opts.attempts ?? 12;
  const settleMs = opts.settleMs ?? 1500;
  let conv: EditorConversion = { extensionKeys: [], cardCount: 0, anchorHrefs: [] };
  for (let i = 0; i < attempts; i++) {
    await clearEditor(page);
    await pasteDeeplink(page, url);
    conv = await readConversion(page, settleMs);
    if (done(conv)) return conv;
    await page.waitForTimeout(1000);
  }
  return conv;
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
  return pasteUntil(page, url, isEmbedMacro, opts);
}

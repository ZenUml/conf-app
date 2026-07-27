import { Page } from '@playwright/test';

// Embed-deeplink autoConvert automation.
//
// PR #360 registers a Forge autoConvert matcher (manifest.yml, embed macro:
// `autoConvert.matchers: [ pattern: https://confluence.zenuml.com/d/*/* ]`).
// When a user PASTES a matching URL into the Confluence editor, the editor
// converts it into the embed macro. When the same URL lands in Slack / email /
// a browser bar, the standalone confluence-deeplink Worker serves an
// instruction/preview page instead.
//
// The ONLY reliable way to trigger the paste-side autoConvert from automation
// is to dispatch a real `paste` ClipboardEvent carrying the URL as `text/plain`
// on the ProseMirror node. This is NOT interchangeable with typing:
//
//   - keyboard.type(url) / fill(url)  → the editor LINKIFIES the text into a
//     plain <a> (or a smart-link) — the macro-autoConvert path never runs,
//     because that path only fires inside ProseMirror's `paste` handler.
//   - a synthetic ClipboardEvent with a populated DataTransfer IS read by
//     ProseMirror's paste handler (Chrome honours `clipboardData` passed to the
//     ClipboardEvent constructor), which runs handleMacroAutoConvert → matches
//     the manifest matcher → inserts the embed extension node.
//
// (`navigator.clipboard.writeText` + a real Ctrl/Meta+V works too and is more
// human-faithful, but it needs `context.grantPermissions(['clipboard-*'])`,
// which is unavailable when Playwright drives a real Chrome over CDP. The
// synthetic-paste method needs no clipboard and no permissions, so it is the
// portable choice for both standalone and CDP-attached runs.)
//
// Verified 2026-07-27 on lite-stg — see tests/insert/embed-deeplink-autoconvert.spec.ts.

const PM = '.ProseMirror';

/** The canonical embed deeplink for a diagram (matches the manifest matcher). */
export function embedDeeplinkUrl(cloudId: string, contentId: string): string {
  return `https://confluence.zenuml.com/d/${cloudId}/${contentId}`;
}

/**
 * Paste `url` into the Confluence editor the way a human paste does — a real
 * `paste` ClipboardEvent carrying the URL as text/plain — so the Forge
 * autoConvert matcher fires. Do NOT replace this with keyboard.type(): typing
 * only linkifies and the macro conversion never runs (see the file header and
 * the negative-control test).
 */
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
  /** extensionKey of every inserted Forge/Connect extension node. */
  extensionKeys: string[];
  /** count of smart-link cards (inlineCard / blockCard). */
  cardCount: number;
  /** hrefs of plain hyperlinks (the linkify fallback). */
  anchorHrefs: string[];
}

/**
 * Poll the editor document until the pasted URL resolves into SOMETHING
 * (extension node, smart-link card, or plain anchor) — autoConvert and
 * smart-card resolution are async. Returns whichever landed, so the caller can
 * assert it was the embed extension and not a link.
 */
export async function readConversion(page: Page, timeoutMs = 8000): Promise<EditorConversion> {
  const deadline = Date.now() + timeoutMs;
  let out: EditorConversion = { extensionKeys: [], cardCount: 0, anchorHrefs: [] };
  // eslint-disable-next-line no-constant-condition
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

/** True when the editor holds the ZenUML embed macro extension node. */
export function isEmbedMacro(conv: EditorConversion): boolean {
  return conv.extensionKeys.some((k) => k.includes('zenuml-embed-macro'));
}

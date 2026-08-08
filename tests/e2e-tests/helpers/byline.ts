import { Frame, Page, expect } from '@playwright/test';

/**
 * Driving the Lite byline (`zenuml-byline-diagrams`).
 *
 * Confluence renders a contentBylineItem under the page title and boots its
 * iframe only on click, so everything here starts from the page's own chrome —
 * the one part of this flow whose DOM belongs to Confluence rather than to us.
 * The modal's own contents are ours (`data-testid="byline-*"`), so once the
 * iframe is open the selectors are exact.
 */

/**
 * Manifest title of the Lite byline entry, as a PREFIX.
 *
 * Not an exact match: staging appends an environment suffix, so the button reads
 * "Diagrams (Staging)" on lite-stg and "Diagrams" in production (confirmed from
 * the CI DOM dump on 2026-08-05). Matching exactly works in prod and silently
 * never matches on staging — where this test actually runs.
 */
const BYLINE_TITLE = /^Diagrams\b/;

/**
 * Confluence's test id for a Forge contentBylineItem button. Distinct from its
 * own byline controls (e.g. `byline-listen`), so this plus the title prefix
 * identifies our entry even when another app ships a byline item too.
 */
const BYLINE_BUTTON = '[data-testid="byline-forge-app-button"]';

/** Forge app iframes are served from this origin (or localhost under tunnel). */
function isAppFrame(f: Frame): boolean {
  return f.url().includes('cdn.prod.atlassian-dev.net') || f.url().includes('localhost:8000');
}

/**
 * The Forge frame containing `data-testid=<testId>`, polled until it appears.
 *
 * Frame-by-content rather than `frameLocator()` chaining: a Forge modal is a
 * sibling top-level iframe, not a descendant of the macro's, and `page.frames()`
 * returns the tree flattened.
 */
export async function frameWithTestId(
  page: Page,
  testId: string,
  timeoutMs = 30000,
): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;
  let lastSeen: string[] = [];
  while (Date.now() < deadline) {
    const appFrames = page.frames().filter(isAppFrame);
    lastSeen = appFrames.map(f => f.url());
    for (const f of appFrames) {
      const hit = await f
        .locator(`[data-testid="${testId}"]`)
        .count()
        .catch(() => 0);
      if (hit > 0) return f;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(
    `No Forge frame exposed [data-testid="${testId}"] within ${timeoutMs}ms. ` +
      `App frames seen: ${JSON.stringify(lastSeen)}`,
  );
}

/**
 * Click the byline item and return the frame hosting the byline modal.
 *
 * This targets Confluence's own byline chrome rather than our markup. The
 * primary locator below was read off a CI DOM dump; the fallbacks and the
 * diagnostic throw are kept because that chrome can change under us without any
 * change on our side, and a bare "element not found" would send the next person
 * hunting instead of handing them the answer.
 */
export async function openBylineModal(page: Page): Promise<Frame> {
  const candidates = [
    page.locator(BYLINE_BUTTON).filter({ hasText: BYLINE_TITLE }),
    page.locator(BYLINE_BUTTON),
    page.getByRole('button', { name: BYLINE_TITLE }),
    page.getByRole('link', { name: BYLINE_TITLE }),
  ];

  for (const c of candidates) {
    const n = await c.count().catch(() => 0);
    if (n === 0) continue;
    await c.first().click({ timeout: 10000 }).catch(() => undefined);
    const frame = await frameWithTestId(page, 'byline-diagrams', 15000).catch(() => undefined);
    if (frame) return frame;
  }

  // Nothing worked — dump what IS in the byline region so the next run is a fix,
  // not another guess.
  const dump = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll('button, a, [role="button"]').forEach(el => {
      const t = (el.textContent || '').trim();
      if (!t || t.length > 40) return;
      const testid = el.getAttribute('data-testid') || '';
      const cls = (el.getAttribute('class') || '').slice(0, 60);
      if (/diagram/i.test(t) || /byline/i.test(testid) || /byline/i.test(cls)) {
        out.push(`<${el.tagName.toLowerCase()} data-testid="${testid}" class="${cls}">${t}`);
      }
    });
    return out.slice(0, 40);
  });
  throw new Error(
    `Could not open the byline modal by any candidate locator for ${BYLINE_TITLE}.\n` +
      `Byline-ish candidates on the page:\n${dump.join('\n') || '(none found)'}`,
  );
}

/**
 * The Forge frame matching `selector`, excluding frames already known.
 *
 * The byline's editor opens as a SECOND top-level Forge modal while the byline
 * frame is still mounted, and both are `custom-ui-fullscreen-modal-dialog`s
 * hosting a `hosted-resources-iframe` — so the page-object's
 * `getByTestId('custom-ui-fullscreen-modal-dialog')` matches two things here and
 * cannot be reused. Excluding the frames that existed before the click is what
 * makes "the editor" unambiguous.
 */
async function newFrameWithSelector(
  page: Page,
  selector: string,
  known: Set<string>,
  timeoutMs = 30000,
): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;
  let lastSeen: string[] = [];
  while (Date.now() < deadline) {
    const candidates = page.frames().filter(f => isAppFrame(f) && !known.has(f.url()));
    lastSeen = candidates.map(f => f.url());
    for (const f of candidates) {
      const hit = await f.locator(selector).count().catch(() => 0);
      if (hit > 0) return f;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(
    `No NEW Forge frame matched ${selector} within ${timeoutMs}ms. ` +
      `New app frames seen: ${JSON.stringify(lastSeen)}`,
  );
}

/**
 * Pick a type in the byline and save the diagram its editor opens.
 *
 * This is the byline's whole create path: the tile opens the ordinary diagram
 * editor as its own Forge modal, and only once that editor saves does a custom
 * content exist for the modal to hand back a link to. Returns after the editor
 * has published, so the caller can assert on the post-create panel.
 */
export async function createDiagramFromByline(
  page: Page,
  bylineFrame: Frame,
  typeKey: string,
  title: string,
): Promise<void> {
  const known = new Set(page.frames().map(f => f.url()));
  await bylineFrame.locator(`[data-testid="byline-type-${typeKey}"]`).first().click();

  const editor = await newFrameWithSelector(page, 'button:has-text("Publish")', known);
  // Same shape as EditorPage.interactWithForgeDiagramMacro: the title input is
  // the first text field, and Publish only enables once it has a value.
  await editor.locator('input[type="text"]').first().fill(title);
  await page.waitForTimeout(500);
  await editor.locator('button:has-text("Publish")').click();
}

/**
 * Assert the Lite paywall modal is up inside `frame`.
 *
 * `continue-editing-btn` is the load-bearing element: the Lite paywall is a
 * METERED soft gate, so its presence (label "Continue editing without upgrading
 * (N)") is what proves the gate fired. At N=0 it is replaced by
 * `continue-attempts-exhausted`, so accept either — both mean blocked.
 */
export async function expectPaywallModal(frame: Frame): Promise<void> {
  const gate = frame.locator(
    '[data-testid="continue-editing-btn"], [data-testid="continue-attempts-exhausted"]',
  );
  await expect(
    gate.first(),
    'expected the Lite paywall modal over the byline-opened editor',
  ).toBeVisible({ timeout: 30000 });
}

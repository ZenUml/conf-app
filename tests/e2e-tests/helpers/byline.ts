import { Frame, Page } from '@playwright/test';
import { dismissStarterGalleryIfPresent } from './starterGallery.js';

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
 * Not an exact match, for two reasons. Staging appends an environment suffix,
 * so the button read "Diagrams (Staging)" on lite-stg against plain "Diagrams"
 * in production (confirmed from the CI DOM dump on 2026-08-05); matching
 * exactly works in prod and silently never matches on staging — where this test
 * actually runs. And the manifest title now carries ${LITE_TITLE_SUFFIX}, so
 * Lite reads "Diagrams Lite" and the staging button "Diagrams Lite (Staging)".
 *
 * Kept as a bare `Diagrams` prefix rather than tightened to `Diagrams Lite`, so
 * the helper still finds the entry in a variant that sets the suffix empty.
 * Hazard for later: once Full ships its own byline titled "Diagrams", this
 * pattern matches BOTH entries on a site with both apps installed, and the
 * locator's `.first()` would pick arbitrarily. That is not reachable today —
 * e2e runs on lite-stg, which has only Lite — but tighten this to require the
 * suffix before pointing these tests at a site carrying both.
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
 *
 * POLLED, not probed once. The byline row is mounted by Confluence's SPA well
 * after `page.goto` resolves, and a single pass over the candidates asks
 * whether the button exists at one arbitrary instant. The 2026-08-15 run
 * (31853347570, shard 1/4) failed all three attempts in the editor with a dump
 * listing only Confluence's own `byline-listen` — which is itself evidence the
 * probe can land mid-mount, since that native item had appeared by the time the
 * dump ran a moment later. Callers that happen to await something slow first
 * (the view test waits for a macro iframe) were getting the settle time by
 * accident; this makes it deliberate and equal for every caller.
 */
export async function openBylineModal(page: Page, timeoutMs = 30000): Promise<Frame> {
  const candidates = [
    page.locator(BYLINE_BUTTON).filter({ hasText: BYLINE_TITLE }),
    page.locator(BYLINE_BUTTON),
    page.getByRole('button', { name: BYLINE_TITLE }),
    page.getByRole('link', { name: BYLINE_TITLE }),
  ];

  const deadline = Date.now() + timeoutMs;
  do {
    for (const c of candidates) {
      const n = await c.count().catch(() => 0);
      if (n === 0) continue;
      await c.first().click({ timeout: 10000 }).catch(() => undefined);
      const frame = await frameWithTestId(page, 'byline-diagrams', 15000).catch(() => undefined);
      if (frame) return frame;
    }
    await page.waitForTimeout(1000);
  } while (Date.now() < deadline);

  // Nothing worked — dump what IS in the byline region so the next run is a fix,
  // not another guess. The URL and the editor-title probe are in the message
  // because the interesting failure is mode-specific: "our item is missing" and
  // "we are not on the page we think we are" produce the same empty dump.
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
  const inEditor = await page
    .locator('[data-test-id="editor-title"]')
    .count()
    .catch(() => 0);
  throw new Error(
    `Could not open the byline modal by any candidate locator for ${BYLINE_TITLE} ` +
      `within ${timeoutMs}ms.\n` +
      `URL: ${page.url()}\n` +
      `Confluence editor title present: ${inEditor > 0}\n` +
      `Byline-ish candidates on the page:\n${dump.join('\n') || '(none found)'}`,
  );
}

/**
 * The Forge frame matching `selector`, excluding the byline frame itself.
 *
 * The byline's editor opens as a SECOND top-level Forge modal while the byline
 * frame is still mounted, and both are `custom-ui-fullscreen-modal-dialog`s
 * hosting a `hosted-resources-iframe` — so the page-object's
 * `getByTestId('custom-ui-fullscreen-modal-dialog')` matches two things here and
 * cannot be reused.
 *
 * Excluding by frame IDENTITY, not by URL. The first version of this diffed the
 * set of frame URLs across the click, and that can never work: both modals are
 * `resource: main` of the same app, so Forge serves them from the SAME CDN URL
 * and passes the context over the bridge rather than in the query string. The
 * editor frame was therefore filtered out as "already known" and every run
 * failed with `New app frames seen: []` while the editor was in fact open —
 * confirmed on the 2026-08-14 run, where `paywall_gate_evaluated`
 * (action_type `byline_create`, surface `byline`) fired ~1s after each
 * `byline_create_clicked`, which only happens once the editor modal has mounted.
 *
 * A new iframe element is a new Playwright `Frame` object even at an identical
 * URL, so identity is the discriminator that actually holds. The selector then
 * does the rest: the byline panel has no Publish button, and the host page's
 * Publish is not in an app frame.
 */
async function appFrameWithSelector(
  page: Page,
  selector: string,
  exclude: Frame,
  timeoutMs = 30000,
): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;
  let lastSeen: string[] = [];
  while (Date.now() < deadline) {
    const candidates = page.frames().filter(f => isAppFrame(f) && f !== exclude);
    lastSeen = candidates.map(f => f.url());
    for (const f of candidates) {
      const hit = await f.locator(selector).count().catch(() => 0);
      if (hit > 0) return f;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(
    `No Forge frame other than the byline matched ${selector} within ${timeoutMs}ms. ` +
      `Candidate app frames seen: ${JSON.stringify(lastSeen)}`,
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
  await bylineFrame.locator(`[data-testid="byline-type-${typeKey}"]`).first().click();

  const editor = await appFrameWithSelector(page, 'button:has-text("Publish")', bylineFrame);
  await dismissStarterGalleryIfPresent(page, editor);
  // Same shape as EditorPage.interactWithForgeDiagramMacro: the title input is
  // the first text field, and Publish only enables once it has a value.
  await editor.locator('input[type="text"]').first().fill(title);
  await page.waitForTimeout(500);
  await editor.locator('button:has-text("Publish")').click();
}

/**
 * The byline's AsyncAPI create path.
 *
 * Split from createDiagramFromByline rather than branching inside it, because
 * the editor the tile opens is a different program: AsyncAPI Studio in a NESTED
 * iframe, not the diagram editor. Two concrete differences the shared helper
 * cannot absorb —
 *
 *  - No title field. Studio derives the custom-content title from the spec's
 *    own `info.title` (buildAsyncApiSaveDiagram parses it), so
 *    `input[type="text"].first()` matches nothing here and Publish is enabled
 *    from the start.
 *  - Publish needs the nested Studio to have painted. saveSpec() reads the
 *    document out of localStorage, which the Studio iframe only writes once it
 *    has booted; clicking too early saves the template rather than what is on
 *    screen. tests/asyncapi/macro-create-edit.spec.ts settles the same way, for
 *    the same reason.
 *
 * Returns after Publish is clicked, so the caller can assert on the post-create
 * panel exactly as it does for the other types.
 */
export async function createAsyncApiDiagramFromByline(
  page: Page,
  bylineFrame: Frame,
): Promise<void> {
  await bylineFrame.locator('[data-testid="byline-type-asyncapi"]').first().click();

  const editor = await appFrameWithSelector(page, 'button:has-text("Publish")', bylineFrame);
  await dismissStarterGalleryIfPresent(page, editor);
  await page.waitForTimeout(3000);
  await editor.locator('button:has-text("Publish")').click();
}

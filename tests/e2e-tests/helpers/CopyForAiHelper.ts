// Helpers for the "Copy for AI" viewer toolbar button
// (src/components/Viewer/GenericViewer.vue, data-testid="copy-for-ai-btn",
// analytics event copy_for_ai_clicked in catalog.ts). One-click clipboard
// payload — the diagram DSL in a fenced code block plus best-effort
// Confluence page context (buildCopyForAiPrompt.ts) — sized for pasting into
// an external AI chat. Companion to ViewerActionsHelper (Fullscreen, Export,
// Copy Code, Versions) — Copy for AI is gated the same way View Source is:
// text-DSL macro types only (Sequence / Mermaid / PlantUML).
//
// CAVEATS:
//  - Mermaid isn't its own macro kind in the Confluence slash menu — it's a
//    TAB inside the "Diagram (Mermaid, PlantUML & ZenUML)" macro (macro kind
//    'sequence' in MacroFlowHelper's MacroKind). insertAndPublishMermaidMacro
//    below mirrors MacroFlowHelper.insertAndPublishMacro('sequence', ...) but
//    switches to the Mermaid tab first (same tab-switch primitive
//    sequence-create:3 in fullscreen/sequence-create.spec.ts already
//    exercises). The resulting macro renders through the SAME iframe/frame
//    selector as a ZenUML "sequence" macro (see MacroPage.getSequenceMacroFrame
//    doc comment: Forge extension containers carry no macro-type identifier),
//    so ViewerActionsHelper.viewerFrame(page, 'sequence') still finds it.
//  - Clipboard reads happen on the OUTER `page`, NOT `frame.evaluate()` on the
//    iframe. This deliberately follows the already-proven pattern in
//    ViewerActionsHelper.clickCopyCodeAndRead rather than reading inside the
//    iframe's own execution context: Forge Custom UI apps render inside a
//    sandboxed cross-origin OOPIF, which has no clipboard-read permission of
//    its own — even though the WRITE happens from inside that iframe, only
//    the top-level document can read the OS clipboard back. Caller must grant
//    permissions first via page.context().grantPermissions([...]).
//  - Root cause of issue #420 ("outer readText() always comes back empty"),
//    established by direct instrumentation on lite-stg, not by assumption —
//    see primeClipboardPermissions()'s doc comment for the full mechanism
//    and how each alternative (longer wait, explicit iframe focus) was
//    ruled out. Short version: the write itself (GenericViewer.vue's
//    copyToClipboard() / writeClipboardKeepingActivation()) executes inside
//    the OOPIF's OWN document, whose origin is a per-install CDN host
//    (observed: https://<uuid>.cdn.prod.atlassian-dev.net — NOT
//    lite-stg.atlassian.net). context.grantPermissions([...]) with no
//    `origin` option only registers the permission for the page's origin at
//    call time — it does not propagate to the cross-origin child frame.
//    Granting permissions for the OOPIF's resolved origin is necessary but
//    not sufficient by itself: Chromium only recognizes that grant inside a
//    given renderer/frame instance after one write attempt has already run
//    there, so a single click right after granting still comes back empty;
//    a second click succeeds. primeClipboardPermissions() below performs
//    the origin grant plus that one required warm-up click; call it once,
//    then use clickCopyForAiAndRead() for the click you actually assert on.
//    This keeps the assertion on the real end-to-end payload (write happens
//    for real, OS clipboard holds it, outer readText() proves it) rather
//    than substituting a weaker signal like the tracking event alone.
//  - The copy_for_ai_clicked Mixpanel event ships via mixpanel-browser's
//    default transport: batch_requests=true, batch_flush_interval_ms=5000
//    (node_modules/mixpanel-browser/src/mixpanel-core.js), POSTed to
//    https://api-js.mixpanel.com/track/ as `data=<json-or-base64>` containing
//    an ARRAY of whatever events were queued in that flush window — a
//    same-URL match alone would false-positive on an unrelated event (e.g.
//    macro_viewed fires on page load). waitForCopyForAiTrackingRequest
//    decodes the body and matches on event name, and may take several
//    seconds because of the batch window.

import { Page, expect } from '@playwright/test';
import { MacroPage } from '../pages/MacroPage.js';
import { ConfluenceEditorPage } from '../pages/EditorPage.js';
import { insertMacro } from './MacroFlowHelper.js';
import {
  fillEditorTitle,
  clickEditorPublish,
  expectModalClosed,
  switchEditorTab,
  modalContentFrame,
} from './FullscreenModalHelper.js';
import { viewerFrame } from './ViewerActionsHelper.js';
import { dismissPaywallGate } from './paywallGate.js';

/**
 * Insert the Diagram macro, switch to the Mermaid tab, publish the macro,
 * then publish the page. Returns once the viewer toolbar is mounted on the
 * published page — same contract as MacroFlowHelper.insertAndPublishMacro.
 */
export async function insertAndPublishMermaidMacro(
  page: Page,
  options: { title?: string } = {},
): Promise<{ editorPage: ConfluenceEditorPage; macroPage: MacroPage; pageId: string }> {
  const { editorPage } = await insertMacro(page, 'sequence');
  // The shared E2E test space (lite-stg, space key SD) is long-lived and has
  // crossed the Lite 100-macro soft-paywall threshold, so PaywallGate.vue's
  // UpgradePrompt can mount over the editor iframe as soon as it opens,
  // intercepting the tab-switch/publish clicks below. Dismiss it defensively
  // here (no-op under the limit — dismissPaywallGate waits briefly for the
  // gate and returns false if it never appears) so this helper doesn't
  // depend on the test space's current macro count. Scoped to this new
  // helper only, per the shared-helper policy — insertMacro/insertAndPublishMacro
  // in MacroFlowHelper.ts stay untouched; only the viewer-edit paths
  // (MacroPage.ts, EditorPage.ts) already dismiss this gate on their own.
  await dismissPaywallGate(page, modalContentFrame(page, 'edit'));
  await switchEditorTab(page, 'Mermaid');
  // switchEditorTab only clicks — it does not confirm the switch landed. If
  // the click is swallowed (React re-mount mid-click), everything below still
  // succeeds and the macro publishes as ZenUML, so the caller's mermaid
  // assertions fail far from the cause. Assert the tab is selected here, the
  // same check sequence-create:3 makes.
  await expect(
    modalContentFrame(page, 'edit').getByRole('tab', { name: 'Mermaid' }),
  ).toHaveAttribute('aria-selected', 'true');
  const title = options.title ?? `Test mermaid ${Date.now()}`;
  await fillEditorTitle(page, title);
  await clickEditorPublish(page);
  await expectModalClosed(page, 'edit');

  // Publish the page so the viewer toolbar mounts (same as
  // MacroFlowHelper.insertAndPublishMacro).
  await editorPage.publishPage();
  const macroPage = new MacroPage(page);
  await macroPage.dismissSpotlightModal();

  const pageId = page.url().match(/\/pages\/(\d+)\//)?.[1] ?? '';
  return { editorPage, macroPage, pageId };
}

/**
 * Insert + publish a Graph (DrawIO) macro, dismissing the soft paywall gate
 * first if present. copy-for-ai:1 (the "absent on Graph" negative test)
 * needs its own macro-create flow — Graph isn't gated the same way as
 * Mermaid isn't relevant here, but the SAME over-limit test space blocks
 * *any* macro-editor open, so this test hits the identical gate as
 * insertAndPublishMermaidMacro above.
 *
 * This deliberately does NOT call MacroFlowHelper.insertAndPublishMacro —
 * that shared helper is used by every other spec under tests/fullscreen/
 * and is left untouched (shared-helper policy); it has no seam to inject a
 * dismiss between its internal insertMacro() and fillEditorTitle() calls.
 * So this reimplements the same handful of steps for the 'graph' kind,
 * inserting the dismiss in between. Keep in sync with
 * MacroFlowHelper.insertAndPublishMacro's 'graph' branch if that changes.
 */
export async function insertAndPublishGraphMacroForCopyForAiTest(
  page: Page,
  options: { title?: string } = {},
): Promise<{ editorPage: ConfluenceEditorPage; macroPage: MacroPage; pageId: string }> {
  const { editorPage } = await insertMacro(page, 'graph');
  // Same staging-space rationale as insertAndPublishMermaidMacro above —
  // no-op when the space is under the limit.
  await dismissPaywallGate(page, modalContentFrame(page, 'edit'));
  const title = options.title ?? `Test graph ${Date.now()}`;
  await fillEditorTitle(page, title);
  // DrawIO Publish lives in the inner nested iframe (matches
  // MacroFlowHelper.insertAndPublishMacro's 'graph' branch).
  await clickEditorPublish(page, { nested: 'drawio' });
  await expectModalClosed(page, 'edit');

  await editorPage.publishPage();
  const macroPage = new MacroPage(page);
  await macroPage.dismissSpotlightModal();

  const pageId = page.url().match(/\/pages\/(\d+)\//)?.[1] ?? '';
  return { editorPage, macroPage, pageId };
}

/**
 * Grant clipboard permissions for BOTH the outer Confluence page's origin
 * AND the Forge Custom UI OOPIF's own origin, then perform one throwaway
 * "warm-up" click + read so a real, asserted click afterward reliably
 * reaches the OS clipboard. Call this ONCE, before the click you actually
 * want to measure.
 *
 * Why a warm-up click is required (issue #420), established empirically on
 * lite-stg, not by assumption:
 *  - The clipboard WRITE (GenericViewer.vue's copyToClipboard /
 *    writeClipboardKeepingActivation) executes inside the OOPIF's own
 *    document, whose origin is a per-install CDN host (observed on
 *    lite-stg: https://<uuid>.cdn.prod.atlassian-dev.net) — NOT the outer
 *    lite-stg.atlassian.net origin. context.grantPermissions([...]) called
 *    with no `origin` only registers the permission for the page's origin
 *    at call time; it does not propagate to a cross-origin child frame, so
 *    the in-iframe write was previously unpermitted for its own origin.
 *  - Explicitly granting permissions for the resolved OOPIF origin is
 *    necessary but NOT sufficient on its own: a single click performed
 *    immediately after that grant still fails (outer readText() still
 *    comes back empty), while a SECOND click succeeds every time, with no
 *    difference in wait time or focus state between the two attempts
 *    (confirmed by direct instrumentation — hasFocus() is true and the
 *    origin-scoped permission is already granted before both clicks; only
 *    a completed prior write attempt in that frame changes the outcome).
 *    This points to Chromium's permission state for the clipboard-write
 *    descriptor being established lazily on first use inside a given
 *    renderer/frame instance — a CDP-level grant issued before that first
 *    use doesn't retroactively apply until one write attempt has run in
 *    that frame. A throwaway warm-up click forces that one-time
 *    registration; every click after it observes the grant correctly.
 *  - This is a harness-only workaround for a Chromium/CDP automation
 *    quirk, not a product bug: production users load the macro once and
 *    click once, and Mixpanel confirms their writes succeed (see issue
 *    #420 "Ground truth" section) — there's no user-facing "click twice"
 *    requirement, only an automation-specific permission-registration gap.
 */
export async function primeClipboardPermissions(page: Page): Promise<void> {
  const frame = viewerFrame(page, 'sequence');
  const btn = frame.getByTestId('copy-for-ai-btn');
  await expect(btn).toBeVisible({ timeout: 30_000 });

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

  const iframeElement = await frame.owner().elementHandle();
  const oopif = await iframeElement?.contentFrame();
  if (!oopif) {
    throw new Error('primeClipboardPermissions: could not resolve the Copy for AI OOPIF content frame');
  }
  const oopifOrigin = await oopif.evaluate(() => location.origin);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: oopifOrigin });

  // Warm-up click — outcome intentionally discarded (see doc comment above).
  await btn.click();
  await page.waitForTimeout(300);

  // Wait out the ~2s Copied/Copy-failed -> idle revert (GenericViewer.vue's
  // setCopyForAiState) so the caller's own click starts from a clean
  // data-copy-state="idle" and its own assertions aren't looking at a stale
  // transition from this warm-up click.
  await expect(btn).toHaveAttribute('data-copy-state', 'idle', { timeout: 5_000 });
}

/**
 * Click "Copy for AI" and read the clipboard back from the OUTER page (see
 * file header caveat — NOT frame.evaluate on the iframe, that throws
 * "Document is not focused"). Caller MUST call primeClipboardPermissions()
 * once before this — see its doc comment for why a bare grantPermissions()
 * call is not enough (issue #420).
 */
export async function clickCopyForAiAndRead(page: Page): Promise<string> {
  const frame = viewerFrame(page, 'sequence');
  const btn = frame.getByTestId('copy-for-ai-btn');
  await expect(btn).toBeVisible({ timeout: 30_000 });

  await btn.click();
  // Small settle window — the page-context fetch + clipboard write are async
  // (same pattern as ViewerActionsHelper.clickCopyCodeAndRead). No toast to
  // wait on here: Copy for AI's feedback is the inline Copying…/Copied state
  // machine on the button itself (GenericViewer.vue's data-copy-state),
  // asserted separately by the caller — this helper only owns the clipboard
  // read.
  await page.waitForTimeout(300);
  return page.evaluate(async () => {
    try {
      return await navigator.clipboard.readText();
    } catch (e) {
      return `__clipboard_error__:${(e as Error).message}`;
    }
  });
}

type DecodedMixpanelEvent = { event: string; properties: Record<string, unknown> };

/**
 * Decode a mixpanel-browser track POST body: `data=<json-or-base64>`, where
 * the decoded payload is either a single event object or an array of queued
 * events (batch_requests mode — see file header). Returns [] on anything
 * that doesn't parse, so callers can treat a decode failure as "not a match"
 * rather than throwing mid-predicate.
 */
function decodeMixpanelTrackBody(postData: string | null): DecodedMixpanelEvent[] {
  if (!postData) return [];
  const match = postData.match(/(?:^|&)data=([^&]*)/);
  if (!match) return [];
  const raw = decodeURIComponent(match[1]);
  let jsonText = raw;
  try {
    JSON.parse(raw);
  } catch {
    try {
      jsonText = Buffer.from(raw, 'base64').toString('utf-8');
    } catch {
      return [];
    }
  }
  try {
    const parsed = JSON.parse(jsonText);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

/**
 * Wait for the copy_for_ai_clicked Mixpanel track request and return its
 * event properties. Call this BEFORE triggering the click (e.g. via
 * `Promise.all([waitForCopyForAiTrackingRequest(page), clickCopyForAiAndRead(page)])`)
 * so the listener is registered ahead of the request firing.
 */
export async function waitForCopyForAiTrackingRequest(
  page: Page,
  timeoutMs = 20_000,
): Promise<Record<string, unknown>> {
  const request = await page.waitForRequest((req) => {
    if (req.method() !== 'POST' || !/mixpanel\.com\/track/i.test(req.url())) return false;
    return decodeMixpanelTrackBody(req.postData()).some(e => e.event === 'copy_for_ai_clicked');
  }, { timeout: timeoutMs });
  const hit = decodeMixpanelTrackBody(request.postData()).find(e => e.event === 'copy_for_ai_clicked');
  if (!hit) throw new Error('copy_for_ai_clicked tracking request matched the predicate but was not found on re-decode');
  return hit.properties;
}

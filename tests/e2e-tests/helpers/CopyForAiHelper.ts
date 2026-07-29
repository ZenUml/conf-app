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
 * Click "Copy for AI" and read the clipboard back from the OUTER page (see
 * file header caveat — NOT frame.evaluate on the iframe). Caller must grant
 * clipboard-read/clipboard-write permissions first.
 */
export async function clickCopyForAiAndRead(page: Page): Promise<string> {
  const frame = viewerFrame(page, 'sequence');
  const btn = frame.getByTestId('copy-for-ai-btn');
  await expect(btn).toBeVisible({ timeout: 30_000 });
  await btn.click();
  // Small settle window — clipboard write + toast are async (same pattern as
  // ViewerActionsHelper.clickCopyCodeAndRead).
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

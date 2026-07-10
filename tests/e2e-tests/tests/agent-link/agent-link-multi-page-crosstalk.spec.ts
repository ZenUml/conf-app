/**
 * Live Agent Link — multi-page cross-talk isolation (ZenUML Lite staging,
 * lite-stg.atlassian.net).
 *
 * Answers the user's "多人多页面串台" question end-to-end, live: with two
 * INDEPENDENT people editing two DIFFERENT pages via Agent Link at the same
 * time, does either session ever see/apply the other's edit? Two separate
 * browser contexts (same login, but isolated tabs/storage — the shape that
 * matters here is "two live macro instances, two tokens", not "two Atlassian
 * accounts") each Connect on their own page, mint their own token, and edit
 * concurrently. Each macro's rendered DOM must show ONLY its own marker.
 *
 * This is the live end-to-end complement to the unit-level regression tests
 * that lock in the SAME invariant at each layer (see those files for the
 * full picture, including what's proven-safe vs. still-open):
 *   - functions/agent-link/mcp.spec.ts "cross-session isolation" — two
 *     concurrent tokens routed to independently-mocked DOs never swap
 *     payloads; update_diagram's schema has no client-controllable target
 *     override.
 *   - src/composables/agentLink/bridgeOps.spec.ts — write is scope-gated to
 *     the bound contentId; read is deliberately NOT (documented asymmetry).
 *   - functions/agent-link/session.spec.ts — the per-contentId mint lock key
 *     omits cloudId (a KNOWN, unresolved false-lockout gap — NOT exercised by
 *     THIS test, since our two fixture pages use different contentIds).
 *
 * Uses TWO existing stable fixture pages (create-not-delete policy — see
 * CLAUDE.md), each already carrying a real ZenUML macro:
 *   - Page A: pageId=128811025, contentId=128483345 ("E2E test page", SD
 *     space — same fixture as agent-link-e2e.spec.ts).
 *   - Page B: pageId=146636830, contentId=147292161 ("Spotcheck-3 cross-space
 *     discovery fixture", a different/personal space — see
 *     spot-check-3-discovery.spec.ts's header for provenance; confirmed live
 *     via GET /wiki/api/v2/pages/146636830 to carry a real
 *     zenuml-sequence-macro-lite extension node bound to that contentId).
 *
 * Two-context-per-test pattern matches spot-check-2-lifecycle.spec.ts's
 * exclusivity test (test 6): `browser.newContext({ storageState:
 * AUTH_STATE_PATH })` per "user", not the default single `page` fixture.
 *
 * Gated on the unreleased agent-link build: skips (not fails) when
 * `/agent-link/mcp` isn't routed on conf-stg-lite — same skip pattern as
 * agent-link-e2e.spec.ts. Both edits are restored in `finally`, so the run is
 * non-destructive.
 *
 * Run: cd tests/e2e-tests && npx playwright test --project=agent-link agent-link-multi-page-crosstalk
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import {
  AGENT_LINK_STG_BASE,
  agentLinkMcp,
  clickConnectToAgent,
  enableAgentLinkOverrides,
  isAgentLinkEndpointLive,
  openMacroPage,
  readPanelClass,
  readSessionToken,
  waitForRenderedMarker,
} from '../../helpers/agentLink.js';
import { AUTH_STATE_PATH } from '../../config/auth-state.js';

const CLOUD_ID = 'c78e721e-957f-402c-9b70-1df2227c2739'; // lite-stg.atlassian.net

const PAGE_A_ID = '128811025';
const CONTENT_A_ID = '128483345';
const PAGE_A_URL = `https://lite-stg.atlassian.net/wiki/pages/viewpage.action?pageId=${PAGE_A_ID}`;

const PAGE_B_ID = '146636830';
const CONTENT_B_ID = '147292161';
const PAGE_B_URL = `https://lite-stg.atlassian.net/wiki/pages/viewpage.action?pageId=${PAGE_B_ID}`;

/**
 * Reattach as the macro peer with `token` (accepted while the session is
 * 'suspended' — see AgentLinkSession.ts's peer-connect guard) and send
 * `{kind:'disconnect'}`, the same envelope the real UI's Disconnect button
 * sends, so the per-contentId mint-exclusivity claim releases immediately
 * instead of sitting on the full 10-min token TTL. Same mechanism as
 * spot-check-2*.spec.ts's forceReleaseLock — MUST be called AFTER the
 * owning browser context is closed: while it's still open the relay
 * considers the session ACTIVE and rejects a second macro-peer connect
 * outright (verified empirically, both here and in those specs).
 */
async function forceReleaseLock(token: string, pageId: string, contentId: string): Promise<void> {
  const wsUrl =
    `wss://conf-stg-lite.zenuml.com/agent-link/channel?token=${encodeURIComponent(token)}` +
    `&peer=macro&cloudId=${encodeURIComponent(CLOUD_ID)}&pageId=${encodeURIComponent(pageId)}` +
    `&contentId=${encodeURIComponent(contentId)}`;
  try {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ws open timeout')), 10000);
      ws.addEventListener('open', () => {
        clearTimeout(t);
        resolve();
      });
      ws.addEventListener('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
    });
    ws.send(JSON.stringify({ kind: 'disconnect' }));
    await new Promise((r) => setTimeout(r, 1200));
    ws.close();
  } catch {
    // Best-effort cleanup only — a failure here just means the claim
    // self-clears at its own TTL instead of releasing early.
  }
}

/**
 * A `tools/call` JSON-RPC result is `{content: [{type:'text', text: <JSON
 * string>}], structuredContent?: <the actual tool payload>}` (mcp.ts) — the
 * diagram/page fields are NOT top-level on `.result` itself. Prefer
 * structuredContent; fall back to parsing content[0].text (covers a
 * hypothetical result shape where structuredContent were ever omitted).
 */
function mcpPayload(res: { result: any }): any {
  if (res.result?.structuredContent) return res.result.structuredContent;
  const text = res.result?.content?.[0]?.text;
  if (typeof text === 'string') {
    try {
      return JSON.parse(text);
    } catch {
      /* fall through */
    }
  }
  return {};
}

/**
 * Build an APPEND-only edit: the marker line is added after the diagram's
 * existing content, never replacing it — a monotonic length increase that
 * can never trip the update_diagram guardrail's catastrophic-data-loss check
 * (see spot-check-2.spec.ts's "APPEND (monotonic length increase) — never
 * trips the data-loss guard" comment). Deliberately NOT a full-replace via
 * the shared helper's `markerDsl()`: this fixture's CURRENT bound diagram
 * turned out to be a large, unrelated "paywall warning banner" demo diagram
 * (left by a prior, unrelated spot-check run on this shared page — found
 * empirically when a full-replace with a tiny one-liner got silently
 * guardrail-rejected). Appending is robust regardless of how large the
 * fixture's current content happens to be.
 */
function appendMarkerEdit(originalDsl: string, diagramType: string, marker: string): string {
  const trimmed = originalDsl.trimEnd();
  const t = diagramType.toLowerCase();
  if (t === 'mermaid') return `${trimmed}\n  AgentX-->Server[${marker}]`;
  if (t === 'plantuml') {
    // @enduml must stay the last line — insert just before it if present.
    const idx = trimmed.lastIndexOf('@enduml');
    if (idx === -1) return `${trimmed}\nAgent -> Server: ${marker}`;
    return `${trimmed.slice(0, idx)}Agent -> Server: ${marker}\n${trimmed.slice(idx)}`;
  }
  return `${trimmed}\nAgentX->Server: ${marker}()`; // sequence (ZenUML) default
}

/**
 * Snapshot every Forge frame's rendered diagram text (same DOM query
 * waitForRenderedMarker polls) at a single point in time. Used for the
 * NEGATIVE assertion ("the other session's marker never showed up here") —
 * polling until true would never resolve for a marker that (correctly) never
 * arrives, so this is a one-shot read taken right after the POSITIVE
 * assertion (own marker rendered) on the same page: if the relay ever
 * cross-wired the two sessions, the swapped marker would already be visible
 * by that same point in time too.
 */
async function renderedText(page: Page): Promise<string> {
  const frames = page.frames().filter((f) => /atlassian-dev\.net/.test(f.url()));
  const texts = await Promise.all(
    frames.map((f) =>
      f
        .evaluate(() => {
          const d = document.querySelector('.zenuml, .diagram, svg, .viewer-frame');
          return d ? (d.textContent ?? '') : document.body ? document.body.innerText : '';
        })
        .catch(() => ''),
    ),
  );
  return texts.join('\n');
}

test.describe('Live Agent Link — multi-page cross-talk isolation', () => {
  test('two concurrent sessions on two different pages never leak edits across each other', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    test.setTimeout(150_000);

    test.skip(
      !(await isAgentLinkEndpointLive()),
      `agent-link not routed on ${AGENT_LINK_STG_BASE} (unreleased build or shared-alias clobber)`,
    );

    const contextA = await browser.newContext({ storageState: AUTH_STATE_PATH });
    const contextB = await browser.newContext({ storageState: AUTH_STATE_PATH });
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    let tokenA: string | null = null;
    let tokenB: string | null = null;
    let originalDslA = '';
    let originalDslB = '';

    try {
      // ---- Connect + pair each page FULLY, one at a time ----
      // Deliberately sequential, not "click both then wait once": two
      // Fullscreen dialogs (each a heavy Vue bundle + WS handshake) loading
      // at the same instant in one browser process starve each other of
      // CPU/network, and starving the WS-open step past its window leaves a
      // token that minted (HTTP 200, localStorage record present) but never
      // actually paired — found empirically (page B connected fine; page A's
      // read_page then 401'd "invalid", meaning its DO never saw a
      // bootstrapped session). Session ISOLATION doesn't require simultaneous
      // SETUP — it requires two sessions to be simultaneously LIVE when
      // something happens on either, which the concurrent update_diagram
      // calls below (with BOTH sessions already fully paired) exercise
      // directly. Matches the proven per-page timing in agent-link-e2e.spec.ts.
      // `onToken` reports the token back to the OUTER tokenA/tokenB variables
      // as soon as it's minted — i.e. BEFORE any of the later
      // read_page/read_diagram assertions in this function can throw — so the
      // `finally` block below can still force-release this page's per-
      // contentId mint-exclusivity claim even if pairing/reading fails
      // partway through (found necessary empirically: an assertion thrown
      // from inside this function otherwise left the caller's `tokenA`/
      // `tokenB` at their initial `null`, silently orphaning a live claim for
      // up to the full 10-minute token TTL).
      async function connectAndPair(
        page: Page,
        url: string,
        label: string,
        onToken: (token: string) => void,
      ): Promise<{ token: string; dsl: string; diagramType: string }> {
        await enableAgentLinkOverrides(page);
        await openMacroPage(page, url);
        expect(await clickConnectToAgent(page), `${label} renders "Connect to Agent"`).toBe(true);
        await page.waitForTimeout(9000);

        const token = await readSessionToken(page);
        expect(token, `${label} mints a session token`).toBeTruthy();
        onToken(token!);

        const rp = await agentLinkMcp(token!, 'read_page');
        expect(rp.status, `${label} read_page HTTP`).toBe(200);

        await expect
          .poll(() => readPanelClass(page), { timeout: 15000, message: `${label} border flips to connected` })
          .toContain('connected');

        const rd = await agentLinkMcp(token!, 'read_diagram');
        expect(rd.status, `${label} read_diagram HTTP`).toBe(200);
        const rdPayload = mcpPayload(rd);
        const dsl = String(rdPayload.dsl ?? rdPayload.code ?? '');
        expect(dsl, `${label} read_diagram returns current DSL`).not.toHaveLength(0);
        const diagramType = String(rdPayload.diagramType ?? 'sequence');

        return { token: token!, dsl, diagramType };
      }

      const a = await connectAndPair(pageA, PAGE_A_URL, 'page A', (t) => {
        tokenA = t;
      });
      originalDslA = a.dsl;

      const b = await connectAndPair(pageB, PAGE_B_URL, 'page B', (t) => {
        tokenB = t;
      });
      originalDslB = b.dsl;

      expect(tokenA, 'the two pages mint DIFFERENT tokens').not.toBe(tokenB);
      const diagramTypeA = a.diagramType;
      const diagramTypeB = b.diagramType;

      // ---- both sessions are now simultaneously LIVE — re-confirm both
      // panels still show connected right before the concurrent edits below,
      // proving this is genuinely "two people, two pages, at once", not two
      // sequential single-session runs ----
      await expect
        .poll(() => readPanelClass(pageA), { timeout: 10000, message: 'page A still connected after B paired' })
        .toContain('connected');
      await expect
        .poll(() => readPanelClass(pageB), { timeout: 10000, message: 'page B still connected' })
        .toContain('connected');

      // ---- concurrent edits: distinct markers, one per session, fired together ----
      const suffix = String(Date.now()).slice(-5);
      const markerA = `AGENTX${suffix}A`;
      const markerB = `AGENTX${suffix}B`;

      const [upA, upB] = await Promise.all([
        agentLinkMcp(tokenA!, 'update_diagram', {
          dsl: appendMarkerEdit(originalDslA, diagramTypeA, markerA),
          summary: 'crosstalk-check A',
        }),
        agentLinkMcp(tokenB!, 'update_diagram', {
          dsl: appendMarkerEdit(originalDslB, diagramTypeB, markerB),
          summary: 'crosstalk-check B',
        }),
      ]);
      expect(upA.status, 'page A update_diagram HTTP').toBe(200);
      expect(upB.status, 'page B update_diagram HTTP').toBe(200);
      // Check for a JSON-RPC error envelope explicitly, not just `.ok !==
      // false`: a guardrail rejection (or any ToolError) still returns HTTP
      // 200 with `json.error` set and NO `.result` — mcpPayload() then
      // resolves to `{}`, so `.ok` reads as `undefined`, which silently
      // passes a `.not.toBe(false)` check. Found empirically: an earlier
      // version of this test used a full-replace edit that got
      // guardrail-rejected as catastrophic data loss, and this weaker check
      // let it through, masking the real failure as a much more confusing
      // "marker never rendered" error further down.
      expect(upA.error, 'page A update_diagram has no JSON-RPC error').toBeFalsy();
      expect(upB.error, 'page B update_diagram has no JSON-RPC error').toBeFalsy();
      expect(mcpPayload(upA).ok, 'page A update_diagram ok').not.toBe(false);
      expect(mcpPayload(upB).ok, 'page B update_diagram ok').not.toBe(false);

      // ---- own marker renders live on own page ----
      expect(await waitForRenderedMarker(pageA, markerA), 'page A renders ITS OWN marker').toBe(true);
      expect(await waitForRenderedMarker(pageB, markerB), 'page B renders ITS OWN marker').toBe(true);

      // ---- the OTHER session's marker never shows up (negative check) ----
      const textOnA = await renderedText(pageA);
      const textOnB = await renderedText(pageB);
      expect(textOnA, "page A's DOM never shows page B's marker (no cross-talk)").not.toContain(markerB);
      expect(textOnB, "page B's DOM never shows page A's marker (no cross-talk)").not.toContain(markerA);
    } finally {
      // Non-destructive: restore both diagrams, matching agent-link-e2e.spec.ts's convention.
      if (tokenA && originalDslA) {
        await agentLinkMcp(tokenA, 'update_diagram', { dsl: originalDslA, summary: 'crosstalk-check restore A' }).catch(
          () => {},
        );
      }
      if (tokenB && originalDslB) {
        await agentLinkMcp(tokenB, 'update_diagram', { dsl: originalDslB, summary: 'crosstalk-check restore B' }).catch(
          () => {},
        );
      }
      // Close both browser contexts BEFORE force-releasing (see
      // forceReleaseLock's doc comment for why), then release each page's
      // per-contentId mint-exclusivity claim so a re-run — or another spec
      // sharing these fixtures — isn't 409'd for up to 10 minutes by a
      // claim this run is done with.
      await contextA.close().catch(() => {});
      await contextB.close().catch(() => {});
      if (tokenA) await forceReleaseLock(tokenA, PAGE_A_ID, CONTENT_A_ID);
      if (tokenB) await forceReleaseLock(tokenB, PAGE_B_ID, CONTENT_B_ID);
    }
  });
});

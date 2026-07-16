import { Page } from '@playwright/test';

/**
 * Helpers for the Live Agent Link end-to-end test. Two actors share one
 * process: Playwright drives the MACRO (and must keep the tab open so the
 * relay WebSocket stays connected — the relay's Durable Object holds the
 * session ONLY while the macro's WS is live), while plain `fetch` calls act as
 * the local AGENT against the hosted MCP endpoint.
 *
 * Pure functions taking a `Page` — no test-runner deps — so they compose from
 * any spec. See tests/agent-link/agent-link-e2e.spec.ts.
 *
 * Non-obvious caveats baked in here so the next person doesn't re-discover them:
 *  - The relay session is WS-lifetime-bound, so every agent MCP call must
 *    happen WHILE the Playwright tab is open (do not close the browser first).
 *  - The Forge Custom UI iframe is a sandboxed cross-origin OOPIF; content
 *    lives in a child frame whose URL matches *.atlassian-dev.net.
 *  - `read_page`/the first agent op is what fires `agent_connected` and flips
 *    the macro panel `waiting -> connected` (the green border). There is no
 *    dedicated pairing envelope.
 */

// lite-stg backend (REMOTE_BASE_URL_MAP STAGING_LITE in src/model/globals/forgeGlobal.ts).
export const AGENT_LINK_STG_BASE = 'https://conf-stg-lite.zenuml.com';
export const agentLinkMcpUrl = (base = AGENT_LINK_STG_BASE) => `${base}/agent-link/mcp`;

export interface McpResult {
  status: number;
  // JSON-RPC result payload (`.result`) when the call succeeded, else null.
  result: any;
  error: any;
}

/** Call one hosted-MCP tool as the agent, presenting the session token. */
export async function agentLinkMcp(
  token: string,
  name: string,
  args: Record<string, unknown> = {},
  base = AGENT_LINK_STG_BASE,
): Promise<McpResult> {
  const res = await fetch(agentLinkMcpUrl(base), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON (e.g. a 405 static-handler fallback) */
  }
  return { status: res.status, result: body?.result ?? null, error: body?.error ?? null };
}

/**
 * Whether the agent-link functions are actually routed on this deployment.
 * The `conf-stg-lite` alias is SHARED and gets clobbered by macro-only
 * deploys (see reference: shared-lite-stg-alias-clobber) — when that happens
 * `/agent-link/mcp` POST falls through to the static SPA handler and returns
 * 405. A live endpoint returns a JSON-RPC error (401/invalid token) instead.
 * The spec skips (not fails) when this is false, since the feature ships on an
 * unreleased build.
 */
export async function isAgentLinkEndpointLive(base = AGENT_LINK_STG_BASE): Promise<boolean> {
  try {
    const res = await fetch(agentLinkMcpUrl(base), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer probe' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    return res.status !== 405 && res.status !== 404;
  } catch {
    return false;
  }
}

const forgeFrames = (page: Page) => page.frames().filter((f) => /atlassian-dev\.net/.test(f.url()));

/** Opt the macro into Agent Link + skip the Lite paywall via localStorage. */
export async function enableAgentLinkOverrides(page: Page): Promise<void> {
  // addInitScript runs in every frame (incl. the Forge OOPIF) before its
  // scripts, so the flags are set on the correct origin without a reload.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('mockAgentLinkEnabled', 'true');
      localStorage.setItem('mockSpacePaid', 'true');
      Object.keys(localStorage)
        .filter((k) => k.startsWith('agentLinkSession:'))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* origin without storage access — ignore */
    }
  });
}

/** Navigate to a page with a ZenUML macro and wait for its Forge frame. */
export async function openMacroPage(page: Page, pageUrl: string, timeout = 60000): Promise<void> {
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout });
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline && forgeFrames(page).length === 0) {
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(6000); // let the macro mount + resolve the flag
}

/** Click the inline macro's "Connect to Agent" (mints a session, opens Fullscreen). */
export async function clickConnectToAgent(page: Page): Promise<boolean> {
  for (const f of forgeFrames(page)) {
    const text = await f.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
    if (/connect to agent/i.test(text)) {
      await f
        .getByText(/connect to agent/i)
        .first()
        .click({ timeout: 9000 })
        .catch(() => {});
      return true;
    }
  }
  return false;
}

/** The minted session token from the macro's localStorage handoff record. */
export async function readSessionToken(page: Page): Promise<string | null> {
  for (const f of forgeFrames(page)) {
    const s = await f
      .evaluate(() => {
        const k = Object.keys(localStorage).find((k) => k.startsWith('agentLinkSession:'));
        return k ? JSON.parse(localStorage.getItem(k) as string) : null;
      })
      .catch(() => null);
    if (s?.token) return s.token as string;
  }
  return null;
}

/** The ConnectPanel state class suffix, e.g. 'agent-link-panel--waiting'. */
export async function readPanelClass(page: Page): Promise<string | null> {
  for (const f of forgeFrames(page)) {
    const c = await f
      .evaluate(() => {
        const p = document.querySelector('.agent-link-panel');
        return p ? p.className.replace('agent-link-panel ', '') : null;
      })
      .catch(() => null);
    if (c) return c;
  }
  return null;
}

/**
 * Poll the rendered diagram across Forge frames until `marker` appears (a live
 * re-render with no page reload) or the window elapses.
 */
export async function waitForRenderedMarker(page: Page, marker: string, timeoutMs = 14000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const f of forgeFrames(page)) {
      const text = await f
        .evaluate(() => {
          const d = document.querySelector('.zenuml, .diagram, svg, .viewer-frame');
          return d ? d.textContent : document.body ? document.body.innerText : '';
        })
        .catch(() => '');
      if (text && text.includes(marker)) return true;
    }
    await page.waitForTimeout(1500);
  }
  return false;
}

/**
 * Explicitly disconnect the live session via the Fullscreen rail's Disconnect
 * button (RailActions). Best-effort — returns whether a button was found.
 *
 * Why this matters for suite hygiene: an explicit disconnect makes the relay
 * DO release the per-contentId content lock immediately. Since PR1 the lock is
 * re-claimed at the 60-MIN cap once a macro connects, so a test that just
 * closes the tab (ws_drop -> suspended) leaves the lock held until the idle
 * alarm (~10 min) — and every later mint against the shared fixed test page
 * 409s with diagram_already_linked. Call this in each test's finally block.
 */
export async function disconnectAgentLink(page: Page): Promise<boolean> {
  for (const f of forgeFrames(page)) {
    const btn = f.locator('[data-testid="agent-link-disconnect-btn"]').first();
    if (await btn.count().catch(() => 0)) {
      await btn.click({ timeout: 5000 }).catch(() => {});
      // Give the {kind:'disconnect'} envelope time to reach the DO before the
      // tab (and with it the WS) is torn down.
      await page.waitForTimeout(1500);
      return true;
    }
  }
  return false;
}

/** Call `get_status` (non-bump-worthy passive monitor) and return `expiresInSec`. */
export async function getStatus(token: string, base = AGENT_LINK_STG_BASE): Promise<number> {
  const s = await agentLinkMcp(token, 'get_status', {}, base);
  return Number(s.result?.structuredContent?.expiresInSec ?? NaN);
}

/**
 * A `tools/call` JSON-RPC result is `{content: [{type:'text', text: <JSON
 * string>}], structuredContent?: <the actual tool payload>}` (mcp.ts) — the
 * diagram/page fields are NOT top-level on `.result` itself. Prefer
 * structuredContent; fall back to parsing content[0].text.
 */
export function mcpPayload(res: { result: any }): any {
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
 * existing content, never replacing it — a monotonic length increase that can
 * never trip the update_diagram guardrail's catastrophic-data-loss check
 * (DATA_LOSS_MIN_RATIO = 0.8 in functions/agent-link/updateDiagramGuard.ts).
 * NEVER test edits as a full-replace one-liner: the shared fixture pages
 * carry arbitrarily large diagrams (left by unrelated spot-check runs), and a
 * tiny replacement gets guardrail-rejected — the JSON-RPC reply is still HTTP
 * 200 with `json.error` set and NO `.result`, which a weak `.ok !==
 * false` assertion silently passes. Assert `expect(res.error).toBeFalsy()`
 * alongside using this helper.
 */
export function appendMarkerEdit(originalDsl: string, diagramType: string, marker: string): string {
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

/** Bound context needed to (re)connect a macro-peer WS for a token. */
export interface AgentLinkWsContext {
  cloudId: string;
  pageId: string;
  contentId: string;
}

/**
 * Reattach as the macro peer with `token` (accepted while the session is
 * 'suspended' — see AgentLinkSession.ts's peer-connect guard) and send
 * `{kind:'disconnect'}`, the same envelope the real UI's Disconnect button
 * sends, so the per-contentId mint-exclusivity claim releases immediately.
 * Since PR1 a connected session's claim is held at the 60-MIN cap, so
 * skipping this leaves the shared fixture page 409ing every later mint until
 * the ~10-min idle alarm fires. MUST be called AFTER the owning page/context
 * is closed: while it's open the relay considers the session ACTIVE and
 * rejects a second macro-peer connect outright (verified empirically).
 */
export async function forceReleaseLock(
  token: string,
  ctx: AgentLinkWsContext,
  base = AGENT_LINK_STG_BASE,
): Promise<void> {
  const wsUrl =
    `${base.replace(/^https:/, 'wss:')}/agent-link/channel?token=${encodeURIComponent(token)}` +
    `&peer=macro&cloudId=${encodeURIComponent(ctx.cloudId)}&pageId=${encodeURIComponent(ctx.pageId)}` +
    `&contentId=${encodeURIComponent(ctx.contentId)}`;
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

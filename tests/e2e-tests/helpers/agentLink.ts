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

/** Build a minimal one-line diagram carrying `marker`, per diagram type. */
export function markerDsl(diagramType: string, marker: string): string {
  if (diagramType === 'mermaid') return `graph TD;\n  A[Start]-->B[${marker}]`;
  if (diagramType === 'plantuml') return `@startuml\nAgent -> Server: ${marker}\n@enduml`;
  return `AgentE2E->Server: ${marker}`; // sequence (ZenUML) default
}

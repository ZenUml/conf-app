import { Page, expect } from '@playwright/test';
import { PageCreator } from '../utils/page-creator.js';
import { testConfig } from '../config/test-config.js';

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

// Match the active staging app's remote (Diagramly shares Lite's backend).
export const AGENT_LINK_STG_BASE = testConfig.productType === 'full'
  ? 'https://conf-stg-full.zenuml.com'
  : 'https://conf-stg-lite.zenuml.com';
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
  // MCP tools/call wraps the tool payload: result = { content:[{text:JSON}],
  // structuredContent: <payload> } (mcp.ts). Unwrap to the payload so callers
  // can read result.title / result.dsl / result.ok directly.
  const raw = body?.result ?? null;
  let payload: any = raw;
  if (raw && typeof raw === 'object') {
    if (raw.structuredContent) payload = raw.structuredContent;
    else if (Array.isArray(raw.content) && typeof raw.content[0]?.text === 'string') {
      try { payload = JSON.parse(raw.content[0].text); } catch { /* keep raw */ }
    }
  }
  return { status: res.status, result: payload, error: body?.error ?? null };
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

export const forgeFrames = (page: Page) => page.frames().filter((f) => /atlassian-dev\.net/.test(f.url()));

/** Opt the macro into Agent Link + skip the Lite paywall via localStorage. */
export async function enableAgentLinkOverrides(page: Page): Promise<void> {
  // addInitScript runs in every frame (incl. the Forge OOPIF) before its
  // scripts, so the flags are set on the correct origin without a reload.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('mockAgentLinkEnabled', 'true');
      localStorage.setItem('mockSpacePaid', 'true');
      // A newly opened fullscreen iframe must retain the inline macro's handoff.
      // Each normal test owns fresh content, so no previous session needs clearing.
    } catch {
      /* origin without storage access — ignore */
    }
  });
}

/** A private diagram per test prevents another user's session from blocking mint. */
export async function openIsolatedAgentLinkPage(page: Page): Promise<void> {
  if (testConfig.isProd) throw new Error('Agent Link isolated fixtures require a staging profile');
  await enableAgentLinkOverrides(page);
  await page.goto(testConfig.baseUrl, { waitUntil: 'domcontentloaded' });
  const pageId = await new PageCreator(page).createTestPage({ sequence: true });
  if (!pageId) throw new Error('Agent Link fixture creation returned no page ID');
  await openMacroPage(page, testConfig.pageUrl(pageId));
}

/** Mint precedes the macro's relay WebSocket bootstrap; wait for readiness. */
export async function waitForAgentLinkReady(token: string): Promise<void> {
  await expect.poll(async () => (await agentLinkMcp(token, 'get_status')).status, {
    timeout: 20000,
    message: 'relay accepts the minted session',
  }).toBe(200);
}

/** Disconnect only this test's own live UI session before closing its page. */
export async function disconnectAgentLink(page: Page): Promise<void> {
  for (const frame of forgeFrames(page)) {
    const button = frame.getByTestId('agent-link-disconnect-btn');
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      await expect.poll(() => readPanelClass(page)).toContain('closed');
      return;
    }
  }
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

/** Click the inline macro's "Connect MCP" (opens the inline dialog). */
export async function clickConnectToAgent(page: Page): Promise<boolean> {
  for (const f of forgeFrames(page)) {
    const button = f.getByTestId('connect-mcp-btn');
    if (await button.count().catch(() => 0)) {
      await button.click({ timeout: 9000 });
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
    if (s?.state === 'already_linked' || s?.state === 'failed') {
      throw new Error(`Agent Link session mint failed: state=${s.state}`);
    }
    if (typeof s?.token === 'string') {
      if (s.token.startsWith('pending-')) {
        throw new Error(`Agent Link session mint did not return a usable token: state=${s.state ?? 'unknown'}`);
      }
      return s.token;
    }
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

/** Build a minimal one-line diagram carrying `marker`, per diagram type. */
export function markerDsl(diagramType: string, marker: string): string {
  if (diagramType === 'mermaid') return `graph TD;\n  A[Start]-->B[${marker}]`;
  if (diagramType === 'plantuml') return `@startuml\nAgent -> Server: ${marker}\n@enduml`;
  return `AgentE2E->Server: ${marker}`; // sequence (ZenUML) default
}

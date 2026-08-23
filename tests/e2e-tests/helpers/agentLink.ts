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
 *  - `connect(code)` binds the fixed MCP transport session and pushes verified
 *    presence, which flips the macro panel `waiting -> connected`.
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

/** Start one standard Streamable HTTP MCP transport session. */
export async function initializeAgentLinkMcp(base = AGENT_LINK_STG_BASE): Promise<string> {
  const init = await fetch(agentLinkMcpUrl(base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'agent-link-e2e', version: '1' },
      },
    }),
  });
  if (!init.ok) throw new Error(`MCP initialize failed: HTTP ${init.status}`);
  const mcpSessionId = init.headers.get('mcp-session-id');
  if (!mcpSessionId) throw new Error('MCP initialize returned no Mcp-Session-Id');
  await fetch(agentLinkMcpUrl(base), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'mcp-session-id': mcpSessionId },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  return mcpSessionId;
}

/** Pair a newly initialized MCP transport session with one Macro code. */
export async function connectAgentLink(code: string, base = AGENT_LINK_STG_BASE): Promise<string> {
  const mcpSessionId = await initializeAgentLinkMcp(base);
  const result = await agentLinkMcp(mcpSessionId, 'connect', { code }, base);
  if (result.status !== 200 || result.error || result.result?.connected !== true) {
    throw new Error(`Agent Link connect failed: ${JSON.stringify(result)}`);
  }
  return mcpSessionId;
}

/** Call one hosted-MCP tool through an already-paired transport session. */
export async function agentLinkMcp(
  mcpSessionId: string,
  name: string,
  args: Record<string, unknown> = {},
  base = AGENT_LINK_STG_BASE,
): Promise<McpResult> {
  const res = await fetch(agentLinkMcpUrl(base), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'mcp-session-id': mcpSessionId },
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
 * `/agent-link/mcp` POST falls through to the static SPA handler. A live
 * endpoint completes an anonymous MCP initialize and issues Mcp-Session-Id.
 * The spec skips (not fails) when this is false, since the feature ships on an
 * unreleased build.
 */
export async function isAgentLinkEndpointLive(base = AGENT_LINK_STG_BASE): Promise<boolean> {
  try {
    const res = await fetch(agentLinkMcpUrl(base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'route-probe', version: '1' } },
      }),
    });
    return res.status === 200 && Boolean(res.headers.get('mcp-session-id'));
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

/** The presence progress element's innerText, e.g. '已连接'. Null when absent. */
export async function readProgressStage(page: Page): Promise<string | null> {
  for (const f of forgeFrames(page)) {
    const t = await f
      .evaluate(() => {
        const el = document.querySelector('[data-testid="agent-link-progress"]');
        return el ? (el as HTMLElement).innerText : null;
      })
      .catch(() => null);
    if (t) return t;
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

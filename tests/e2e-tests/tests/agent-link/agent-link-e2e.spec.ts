/**
 * Live Agent Link — end-to-end (ZenUML Lite staging, lite-stg.atlassian.net).
 *
 * Drives the WHOLE product loop with Playwright acting as the macro and plain
 * fetch acting as the local agent over the hosted MCP:
 *   Connect -> mint session -> waiting prompt -> agent read_page -> connected
 *   border -> agent read_diagram -> agent update_diagram -> live re-render ->
 *   restore original.
 *
 * Gated on the unreleased agent-link build: skips (not fails) when
 * `/agent-link/mcp` isn't routed on conf-stg-lite (shared-alias clobber or the
 * feature simply isn't deployed) — mirrors insert/upgrade-prompt.spec.ts.
 *
 * The relay session is WS-lifetime-bound, so every agent call happens while the
 * Playwright page is open. The edit is restored, so the run is non-destructive.
 *
 * Run: APP=zenuml-lite@stg npx playwright test --project=agent-link
 */
import { test, expect, type Page } from '@playwright/test';
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

// Stable lite-stg page carrying a single ZenUML sequence macro ("E2E test page").
const CLOUD_ID = 'c78e721e-957f-402c-9b70-1df2227c2739'; // lite-stg.atlassian.net
const TEST_PAGE_ID = '128811025';
const TEST_CONTENT_ID = '128483345';
const TEST_PAGE_URL = `https://lite-stg.atlassian.net/wiki/pages/viewpage.action?pageId=${TEST_PAGE_ID}`;

/**
 * A `tools/call` JSON-RPC result carries the tool payload in
 * `structuredContent`, with a text JSON fallback for clients that only expose
 * MCP text content.
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
  // agentLinkMcp already unwraps structuredContent/content into `.result`;
  // fall back to the payload itself for that (current) shape.
  return res.result ?? {};
}

/**
 * Build an append-only edit so the shared fixture's current diagram is never
 * replaced by a tiny marker DSL that trips update_diagram's data-loss guard.
 */
function appendMarkerEdit(originalDsl: string, diagramType: string, marker: string): string {
  const trimmed = originalDsl.trimEnd();
  const t = diagramType.toLowerCase();
  if (t === 'mermaid') return `${trimmed}\n  AgentX-->Server[${marker}]`;
  if (t === 'plantuml') {
    const idx = trimmed.lastIndexOf('@enduml');
    if (idx === -1) return `${trimmed}\nAgent -> Server: ${marker}`;
    return `${trimmed.slice(0, idx)}Agent -> Server: ${marker}\n${trimmed.slice(idx)}`;
  }
  return `${trimmed}\nAgentX->Server: ${marker}()`;
}

/**
 * Reattach as the macro peer after the page closes and send the same
 * disconnect envelope as the UI so the shared fixture's per-contentId claim
 * is released before the next serial test starts.
 */
async function forceReleaseLock(token: string): Promise<void> {
  const wsUrl =
    `wss://conf-stg-lite.zenuml.com/agent-link/channel?token=${encodeURIComponent(token)}` +
    `&peer=macro&cloudId=${encodeURIComponent(CLOUD_ID)}&pageId=${encodeURIComponent(TEST_PAGE_ID)}` +
    `&contentId=${encodeURIComponent(TEST_CONTENT_ID)}`;
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
    // Best-effort cleanup only; the claim self-clears if this reconnect fails.
  }
}

test.describe('Live Agent Link — end to end', () => {
  test('agent connects, reads the page + diagram, edits it live, and the macro shows connected', async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(
      !(await isAgentLinkEndpointLive()),
      `agent-link not routed on ${AGENT_LINK_STG_BASE} (unreleased build or shared-alias clobber)`,
    );

    // ---- macro side: Connect -> mint -> waiting ----
    await enableAgentLinkOverrides(page);
    await openMacroPage(page, TEST_PAGE_URL);

    let token: string | null = null;
    let originalDsl = '';
    try {
      expect(await clickConnectToAgent(page), 'macro renders a "Connect to Agent" affordance').toBe(true);
      await page.waitForTimeout(9000);

      token = await readSessionToken(page);
      expect(token, 'Connect mints a session token').toBeTruthy();
      expect(await readPanelClass(page), 'Fullscreen shows the waiting prompt').toBe('agent-link-panel--waiting');

      // ---- agent side: read_page (also fires agent_connected) ----
      const rp = await agentLinkMcp(token!, 'read_page');
      expect(rp.status, 'read_page HTTP').toBe(200);
      expect(String(mcpPayload(rp).title ?? ''), 'read_page returns a real page title').not.toHaveLength(0);

      // ---- macro reflects the pairing: waiting -> connected (green border) ----
      await expect
        .poll(() => readPanelClass(page), { timeout: 12000, message: 'macro border flips to connected' })
        .toContain('connected');

      // ---- agent reads current diagram, edits it, macro re-renders live ----
      const rd = await agentLinkMcp(token!, 'read_diagram');
      expect(rd.status, 'read_diagram HTTP').toBe(200);
      const rdPayload = mcpPayload(rd);
      originalDsl = String(rdPayload.dsl ?? rdPayload.code ?? '');
      expect(originalDsl, 'read_diagram returns the current DSL').not.toHaveLength(0);
      const diagramType = String(rdPayload.diagramType ?? 'sequence');

      const marker = `AGENTE2E${String(Date.now()).slice(-5)}`;
      const up = await agentLinkMcp(token!, 'update_diagram', {
        dsl: appendMarkerEdit(originalDsl, diagramType, marker),
        summary: 'agent-link e2e',
      });
      expect(up.status, 'update_diagram HTTP').toBe(200);
      expect(up.error, `update_diagram has no JSON-RPC error: ${JSON.stringify(up.error)}`).toBeFalsy();
      expect(mcpPayload(up).ok, 'update_diagram ok').not.toBe(false);

      expect(await waitForRenderedMarker(page, marker), 'macro re-renders the edit LIVE (no reload)').toBe(true);
    } finally {
      // Non-destructive: put the diagram back the way we found it.
      if (token && originalDsl) {
        await agentLinkMcp(token, 'update_diagram', { dsl: originalDsl, summary: 'agent-link e2e restore' }).catch(() => {});
      }
      await page.close().catch(() => {});
      if (token) await forceReleaseLock(token);
    }
  });

  test('TTL slides on agent activity (PR1 sliding window)', async ({ page }: { page: Page }) => {
    test.skip(
      !(await isAgentLinkEndpointLive()),
      `agent-link not routed on ${AGENT_LINK_STG_BASE} (unreleased build or shared-alias clobber)`,
    );

    let token: string | null = null;
    try {
      // ---- macro side: Connect -> mint -> waiting ----
      await enableAgentLinkOverrides(page);
      await openMacroPage(page, TEST_PAGE_URL);

      expect(await clickConnectToAgent(page), 'macro renders a "Connect to Agent" affordance').toBe(true);
      await page.waitForTimeout(9000);

      token = await readSessionToken(page);
      expect(token, 'Connect mints a session token').toBeTruthy();
      expect(await readPanelClass(page), 'Fullscreen shows the waiting prompt').toBe('agent-link-panel--waiting');

      const s1 = await agentLinkMcp(token!, 'get_status');
      expect(s1.status, 'get_status HTTP before activity').toBe(200);
      expect(s1.error, 'get_status before activity has no JSON-RPC error').toBeFalsy();
      const e1 = Number(mcpPayload(s1).expiresInSec);
      expect(e1, 'get_status before activity returns expiresInSec').toBeGreaterThan(0);

      await page.waitForTimeout(30_000);

      const rd = await agentLinkMcp(token!, 'read_diagram');
      expect(rd.status, 'read_diagram HTTP').toBe(200);
      expect(rd.error, 'read_diagram has no JSON-RPC error').toBeFalsy();

      const s2 = await agentLinkMcp(token!, 'get_status');
      expect(s2.status, 'get_status HTTP after activity').toBe(200);
      expect(s2.error, 'get_status after activity has no JSON-RPC error').toBeFalsy();
      const e2 = Number(mcpPayload(s2).expiresInSec);
      expect(e2, 'get_status after activity returns expiresInSec').toBeGreaterThan(0);

      // get_status itself is passive; the read_diagram above is the bump that
      // should slide the idle window back toward its full TTL.
      // If sliding is broken, e2 is roughly e1 - 30s - round-trip latency; if
      // sliding works, e2 is roughly e1 - round-trip latency. This leaves 15s of
      // staging latency slack while keeping the broken case comfortably below.
      expect(e2).toBeGreaterThan(e1 - 15);
    } finally {
      await page.close().catch(() => {});
      if (token) await forceReleaseLock(token);
    }
  });
});

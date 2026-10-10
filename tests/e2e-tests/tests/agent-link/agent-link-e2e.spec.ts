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
 * feature simply isn't deployed).
 *
 * The relay session is WS-lifetime-bound, so every agent call happens while the
 * Playwright page is open. The edit is restored, so the run is non-destructive.
 *
 * The first describe covers the headless Connect MCP dialog, which is what
 * the first release ships; the relay loop below is gated off until relay
 * sessions are offered again.
 *
 * Run: APP=zenuml-lite@stg npx playwright test --project=agent-link
 */
import { test, expect, type Frame, type Page } from '@playwright/test';
import {
  AGENT_LINK_STG_BASE,
  agentLinkMcp,
  agentLinkMcpUrl,
  clickConnectToAgent,
  forgeFrames,
  openIsolatedAgentLinkPage,
  disconnectAgentLink,
  waitForAgentLinkReady,
  isAgentLinkEndpointLive,
  readPanelClass,
  readSessionToken,
  waitForRenderedMarker,
} from '../../helpers/agentLink.js';

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
 * Build an append-only edit so the fixture's current diagram is never
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

async function dialogFrame(page: Page): Promise<Frame | null> {
  for (const f of forgeFrames(page)) {
    if (await f.getByTestId('connect-mcp-dialog').count().catch(() => 0)) return f;
  }
  return null;
}

// What ships in the first release: the headless MCP, no relay session. The
// OAuth sign-in needs a real MCP client and an interactive consent, so it is
// out of scope; this covers the macro side and the 401 discovery challenge
// that hands a client to it.
test.describe('Connect MCP — headless', { tag: ['@test:agent-link-e2e', '@variant:lite', '@viewer', '@ai'] }, () => {
  test('the dialog shows the setup command and a prompt for this diagram, and mints nothing', async ({ page }) => {
    test.skip(
      !(await isAgentLinkEndpointLive()),
      `agent-link not routed on ${AGENT_LINK_STG_BASE} (unreleased build or shared-alias clobber)`,
    );

    await openIsolatedAgentLinkPage(page);
    expect(await clickConnectToAgent(page), 'macro renders a "Connect MCP" button').toBe(true);

    let frame: Frame | null = null;
    await expect.poll(async () => (frame = await dialogFrame(page)) !== null, { timeout: 10000 }).toBe(true);
    const f = frame as unknown as Frame;
    await expect(f.getByTestId('connect-mcp-dialog')).toHaveAttribute('data-mcp-mode', 'headless');
    await expect(f.getByTestId('connect-mcp-setup-command')).toHaveText(
      `claude mcp add --transport http zenuml ${agentLinkMcpUrl()}`,
    );
    const prompt = (await f.getByTestId('connect-mcp-prompt').innerText()).trim();
    expect(prompt).toMatch(/^Use the zenuml MCP to review my ZenUML diagram/);
    expect(prompt).toMatch(/^cloudId: \S+$/m);
    expect(prompt).toMatch(/^pageId: \d+$/m);
    expect(prompt).toMatch(/^contentId: \d+$/m);
    expect(prompt).not.toContain('session:');

    // No relay session: nothing handed off, so no diagram lock either.
    const handoffKeys = await f.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('agentLinkSession:')));
    expect(handoffKeys).toEqual([]);
    await expect(f.getByTestId('agent-link-disconnect-btn')).toHaveCount(0);

    await f.getByTestId('connect-mcp-done').click();
    await expect(f.getByTestId('connect-mcp-dialog')).toHaveCount(0);
  });

  test('a token-less MCP call gets the OAuth discovery challenge', async () => {
    test.skip(
      !(await isAgentLinkEndpointLive()),
      `agent-link not routed on ${AGENT_LINK_STG_BASE} (unreleased build or shared-alias clobber)`,
    );
    const res = await fetch(agentLinkMcpUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate') ?? '').toContain(
      `resource_metadata="${AGENT_LINK_STG_BASE}/.well-known/oauth-protected-resource"`,
    );
  });
});

// lite only: the "Connect to Agent" affordance needs the Agent Link feature
// flag and the /agent-link/mcp route, which exist on lite-stg alone — on
// dia-stg and full-stg the macro never renders it (main runs 2026-10-08).
test.describe('Live Agent Link — end to end', { tag: ['@test:agent-link-e2e', '@variant:lite', '@viewer', '@fullscreen', '@ai'] }, () => {
  // The relay session UI is not offered in the headless-only first release
  // (RELAY_SESSIONS_ENABLED=false in src/composables/agentLink/connectInstructions.ts),
  // so there is no button to start a session. Flip that constant and run
  // with AGENT_LINK_RELAY=1 to bring these back; the "Connect MCP — headless"
  // describe in agent-link-e2e.spec.ts covers what ships.
  test.skip(process.env.AGENT_LINK_RELAY !== '1', 'relay sessions are not offered in the headless-only release');

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
    await openIsolatedAgentLinkPage(page);

    let token: string | null = null;
    let originalDsl = '';
    try {
      expect(await clickConnectToAgent(page), 'macro renders a "Connect to Agent" affordance').toBe(true);
      await expect.poll(async () => {
        token = await readSessionToken(page);
        return token;
      }, { timeout: 20000 }).toBeTruthy();
      expect(token, 'Connect mints a session token').toBeTruthy();
      await expect.poll(() => readPanelClass(page), { timeout: 20000 }).toBe('agent-link-panel--waiting');
      await waitForAgentLinkReady(token!);

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
      if (token) await disconnectAgentLink(page).catch(() => {});
      await page.close().catch(() => {});
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
      await openIsolatedAgentLinkPage(page);

      expect(await clickConnectToAgent(page), 'macro renders a "Connect to Agent" affordance').toBe(true);
      await expect.poll(async () => {
        token = await readSessionToken(page);
        return token;
      }, { timeout: 20000 }).toBeTruthy();
      expect(token, 'Connect mints a session token').toBeTruthy();
      await expect.poll(() => readPanelClass(page), { timeout: 20000 }).toBe('agent-link-panel--waiting');
      await waitForAgentLinkReady(token!);

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
      if (token) await disconnectAgentLink(page).catch(() => {});
      await page.close().catch(() => {});
    }
  });
});

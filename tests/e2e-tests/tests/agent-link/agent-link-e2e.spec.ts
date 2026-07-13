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
  markerDsl,
  openMacroPage,
  readPanelClass,
  readSessionToken,
  waitForRenderedMarker,
} from '../../helpers/agentLink.js';

// Stable lite-stg page carrying a single ZenUML sequence macro ("E2E test page").
const TEST_PAGE_URL = 'https://lite-stg.atlassian.net/wiki/pages/viewpage.action?pageId=128811025';

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
  return {};
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

    expect(await clickConnectToAgent(page), 'macro renders a "Connect to Agent" affordance').toBe(true);
    await page.waitForTimeout(9000);

    const token = await readSessionToken(page);
    expect(token, 'Connect mints a session token').toBeTruthy();
    expect(await readPanelClass(page), 'Fullscreen shows the waiting prompt').toBe('agent-link-panel--waiting');

    let originalDsl = '';
    try {
      // ---- agent side: read_page (also fires agent_connected) ----
      const rp = await agentLinkMcp(token!, 'read_page');
      expect(rp.status, 'read_page HTTP').toBe(200);
      expect(String(rp.result?.structuredContent?.title ?? ''), 'read_page returns a real page title').not.toHaveLength(0);

      // ---- macro reflects the pairing: waiting -> connected (green border) ----
      await expect
        .poll(() => readPanelClass(page), { timeout: 12000, message: 'macro border flips to connected' })
        .toContain('connected');

      // ---- agent reads current diagram, edits it, macro re-renders live ----
      const rd = await agentLinkMcp(token!, 'read_diagram');
      expect(rd.status, 'read_diagram HTTP').toBe(200);
      originalDsl = String(rd.result?.structuredContent?.dsl ?? rd.result?.structuredContent?.code ?? '');
      expect(originalDsl, 'read_diagram returns the current DSL').not.toHaveLength(0);
      const diagramType = String(rd.result?.structuredContent?.diagramType ?? 'sequence');

      const marker = `AGENTE2E${String(Date.now()).slice(-5)}`;
      const up = await agentLinkMcp(token!, 'update_diagram', { dsl: markerDsl(diagramType, marker), summary: 'agent-link e2e' });
      expect(up.status, 'update_diagram HTTP').toBe(200);
      expect(up.result?.structuredContent?.ok, 'update_diagram ok').not.toBe(false);

      expect(await waitForRenderedMarker(page, marker), 'macro re-renders the edit LIVE (no reload)').toBe(true);
    } finally {
      // Non-destructive: put the diagram back the way we found it.
      if (token && originalDsl) {
        await agentLinkMcp(token, 'update_diagram', { dsl: originalDsl, summary: 'agent-link e2e restore' }).catch(() => {});
      }
    }
  });

  test('TTL slides on agent activity (PR1 sliding window)', async ({ page }: { page: Page }) => {
    test.skip(
      !(await isAgentLinkEndpointLive()),
      `agent-link not routed on ${AGENT_LINK_STG_BASE} (unreleased build or shared-alias clobber)`,
    );

    // ---- macro side: Connect -> mint -> waiting ----
    await enableAgentLinkOverrides(page);
    await openMacroPage(page, TEST_PAGE_URL);

    expect(await clickConnectToAgent(page), 'macro renders a "Connect to Agent" affordance').toBe(true);
    await page.waitForTimeout(9000);

    const token = await readSessionToken(page);
    expect(token, 'Connect mints a session token').toBeTruthy();
    expect(await readPanelClass(page), 'Fullscreen shows the waiting prompt').toBe('agent-link-panel--waiting');

    const s1 = await agentLinkMcp(token!, 'get_status');
    expect(s1.status, 'get_status HTTP before activity').toBe(200);
    expect(s1.error, 'get_status before activity has no JSON-RPC error').toBeFalsy();
    const e1 = Number(mcpPayload(s1).expiresInSec);
    expect(e1, 'get_status before activity returns expiresInSec').toBeGreaterThan(0);

    await page.waitForTimeout(20_000);

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
    expect(e2).toBeGreaterThan(e1 - 10);
  });
});

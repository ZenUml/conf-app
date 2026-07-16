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
 * Suite hygiene (hard-won, do not regress):
 *  - Edits are APPEND-only (appendMarkerEdit) — a full-replace one-liner gets
 *    guardrail-rejected as catastrophic data loss (DATA_LOSS_MIN_RATIO = 0.8)
 *    because the shared fixture page carries a large diagram; the rejection is
 *    an HTTP-200 JSON-RPC error that a weak `.ok !== false` check passes
 *    silently. Assert `expect(up.error).toBeFalsy()` on every update.
 *  - Every test releases the per-contentId lock in `finally`: Disconnect
 *    button first, then forceReleaseLock over WS after closing the page.
 *    Since PR1 a connected session's lock is held at the 60-MIN cap, so a
 *    leaked lock 409s every later mint on this fixture page.
 *
 * Run: APP=zenuml-lite@stg npx playwright test --project=agent-link
 */
import { test, expect, type Page } from '@playwright/test';
import {
  AGENT_LINK_STG_BASE,
  agentLinkMcp,
  appendMarkerEdit,
  clickConnectToAgent,
  disconnectAgentLink,
  enableAgentLinkOverrides,
  forceReleaseLock,
  getStatus,
  isAgentLinkEndpointLive,
  mcpPayload,
  openMacroPage,
  readPanelClass,
  readSessionToken,
  waitForRenderedMarker,
} from '../../helpers/agentLink.js';

// Stable lite-stg page carrying a single ZenUML sequence macro ("E2E test page").
// Same fixture as agent-link-multi-page-crosstalk.spec.ts's page A.
const CLOUD_ID = 'c78e721e-957f-402c-9b70-1df2227c2739'; // lite-stg.atlassian.net
const PAGE_ID = '128811025';
const CONTENT_ID = '128483345';
const TEST_PAGE_URL = `https://lite-stg.atlassian.net/wiki/pages/viewpage.action?pageId=${PAGE_ID}`;

/** `finally`-block cleanup shared by both tests: UI Disconnect if reachable,
 * then close the page and force-release the lock over WS (see helper docs). */
async function releaseSession(page: Page, token: string | null): Promise<void> {
  await disconnectAgentLink(page).catch(() => {});
  await page.close().catch(() => {});
  if (token && !token.startsWith('pending-')) {
    await forceReleaseLock(token, { cloudId: CLOUD_ID, pageId: PAGE_ID, contentId: CONTENT_ID });
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
      // A guardrail rejection is HTTP 200 + json.error + NO result — assert
      // it explicitly so it can't masquerade as a render failure downstream.
      expect(up.error, 'update_diagram has no JSON-RPC error').toBeFalsy();
      expect(mcpPayload(up).ok, 'update_diagram ok').not.toBe(false);

      expect(await waitForRenderedMarker(page, marker), 'macro re-renders the edit LIVE (no reload)').toBe(true);
    } finally {
      // Non-destructive: put the diagram back the way we found it (the edit
      // was append-only, so the restore is a tiny shrink well above the
      // guardrail's data-loss ratio).
      if (token && originalDsl) {
        await agentLinkMcp(token, 'update_diagram', { dsl: originalDsl, summary: 'agent-link e2e restore' }).catch(() => {});
      }
      await releaseSession(page, token);
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

    try {
      // get_status is NOT bump-worthy, so this probe itself can't mask a broken slide.
      const e1 = await getStatus(token!);
      expect(e1, 'get_status returns a numeric expiresInSec').not.toBeNaN();

      await page.waitForTimeout(20_000); // burn 20s of the idle window

      const rd = await agentLinkMcp(token!, 'read_diagram'); // bump-worthy
      expect(rd.status, 'read_diagram HTTP').toBe(200);

      const e2 = await getStatus(token!);

      // Without sliding, e2 ≈ e1 - 20. With sliding, the read_diagram bump reset
      // the window: e2 ≈ 600 again. Allow generous network slop.
      expect(e2, 'idle window slid forward on agent activity').toBeGreaterThan(e1 - 10);
    } finally {
      await releaseSession(page, token);
    }
  });
});

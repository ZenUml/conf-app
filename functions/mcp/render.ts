// POST /mcp/render — the public, sign-in-free MCP endpoint that draws a
// diagram from source the agent sends. No Atlassian site is involved; see
// agent-link/renderMcp.ts for why this is its own endpoint and not a tool on
// /agent-link/mcp.
//
// `/mcp/render` must stay in public/_routes.json's include list, or Pages
// answers this path with the SPA's HTML instead of running this function.

import { CORS, JSON_HEADERS, handleRenderRequest, type RenderEnv } from '../agent-link/renderMcp';
import { json } from '../OkResponse';

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { headers: CORS });
}

// GET would open a server-initiated SSE stream and DELETE would end a session;
// this endpoint keeps neither, so both are declined the way mcp.ts declines them.
const METHOD_NOT_ALLOWED = () =>
  json({ error: 'method_not_allowed', message: 'This MCP endpoint accepts POST.' }, {
    status: 405,
    headers: { ...JSON_HEADERS, Allow: 'POST, OPTIONS' },
  });

export const onRequestGet: PagesFunction<RenderEnv> = async () => METHOD_NOT_ALLOWED();
export const onRequestDelete: PagesFunction<RenderEnv> = async () => METHOD_NOT_ALLOWED();

export const onRequestPost: PagesFunction<RenderEnv> = async ({ request, env, waitUntil }) =>
  handleRenderRequest(request, env, { waitUntil });

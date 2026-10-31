// POST /agent-link/render — the public, sign-in-free MCP endpoint that draws a
// diagram from source the agent sends. No Atlassian site is involved; see
// renderMcp.ts for why this is its own endpoint and not a tool on /mcp.
//
// `/agent-link/*` is already in public/_routes.json, so no route entry is needed.

import { CORS, JSON_HEADERS, handleRenderRequest, type RenderEnv } from './renderMcp';
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

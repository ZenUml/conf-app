// POST /mcp/view-event: the MCP Apps view reports what it drew. See
// agent-link/viewEvent.ts.
//
// `/mcp/view-event` must stay in public/_routes.json's include list, or Pages
// answers this path with the SPA's HTML instead of running this function.

import { CORS, type RenderEnv } from '../agent-link/renderMcp';
import { handleViewEvent } from '../agent-link/viewEvent';

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { headers: CORS });
}

export const onRequestPost: PagesFunction<RenderEnv> = async ({ request, env, waitUntil }) =>
  handleViewEvent(request, env, { waitUntil });

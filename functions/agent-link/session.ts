// POST /agent-link/session — mints a Live Agent Link session token.
// See docs/superpowers/specs/2026-07-08-live-agent-link-design.md §4.3 (connect
// handshake) and §5.2 (relay components).
//
// The macro calls this first, before opening its live channel to the relay.
// Response shape matches §4.3 step 2: token + the channel URL the macro
// should connect to next.

import { SessionRegistry } from './sessionRegistry';
import { TOKEN_TTL_MS } from './sessionToken';
import type { BoundContext } from './sessionToken';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const JSON_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

// Module-level registry — TODO(agent-link): replace with the AgentLinkSession
// Durable Object (functions/agent-link/AgentLinkSession.ts) once the live
// WS/DO runtime is wired up. A Worker-global Map does not survive across
// isolates or persist between requests in production; it is enough for local
// dev and for unit-testing the pure request/response contract of this
// endpoint, which is what this task builds.
const registry = new SessionRegistry();

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { headers: CORS_HEADERS });
}

export const onRequestPost: PagesFunction = async ({ request }) => {
  let body: Partial<BoundContext>;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  const { cloudId, pageId, contentId } = body ?? {};
  if (!cloudId || !pageId || !contentId) {
    return jsonError(400, 'Missing required fields: cloudId, pageId, contentId');
  }

  const record = registry.create({ cloudId, pageId, contentId });

  return new Response(
    JSON.stringify({
      token: record.token,
      channelUrl: `/agent-link/channel?token=${record.token}`,
      expiresInSec: TOKEN_TTL_MS / 1000,
    }),
    { status: 200, headers: JSON_HEADERS },
  );
};

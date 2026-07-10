// POST /agent-link/session — mints a Live Agent Link session token.
// See docs/superpowers/specs/2026-07-08-live-agent-link-design.md §4.3 (connect
// handshake) and §5.2 (relay components).
//
// The macro calls this first, before opening its live channel to the relay.
// Response shape matches §4.3 step 2: token + the channel URL the macro
// should connect to next.

import { sessionRegistry as registry } from './registrySingleton';
import { TOKEN_TTL_MS } from './sessionToken';
import type { BoundContext } from './sessionToken';

interface Env {
  // Same cross-Worker binding channel.ts/mcp.ts/AgentLinkSession.ts use —
  // see AgentLinkSession.ts's file header. Used here ONLY to check/claim the
  // per-contentId mint-exclusivity lock (design §7 decision #2: "one
  // ACTIVE/SUSPENDED session per contentId") against a SEPARATE DO instance
  // of that same class, addressed by `content:<cloudId>:<contentId>` rather
  // than a token. Optional/absent in local dev (no companion Worker bound — same
  // posture as channel.ts/mcp.ts) — the exclusivity check simply degrades to
  // a no-op (every mint succeeds), matching the pre-existing in-memory
  // `registry`-only behavior of this endpoint.
  AGENT_LINK?: DurableObjectNamespace;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const JSON_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

// Shared with mcp.ts via registrySingleton.ts — TODO(agent-link): replace
// with the AgentLinkSession Durable Object (AgentLinkSession.ts) once the
// live WS/DO runtime is wired up. A Worker-global singleton does not survive
// across isolates or persist between requests in production; it is enough
// for local dev and for unit-testing the pure request/response contract of
// this endpoint (and mcp.ts's session lookup), which is what this task
// builds.

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { headers: CORS_HEADERS });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
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

  // Per-contentId mint-exclusivity (design §7 decision #2): claim this
  // diagram's lock (a SEPARATE DO instance of AgentLinkSession, addressed by
  // `content:<cloudId>:<contentId>`) BEFORE handing the token back. A
  // still-live claim held by a different session rejects the mint outright —
  // no silent second link to the same diagram. Absent AGENT_LINK (local
  // dev/tests): degrades to a no-op, same posture as channel.ts/mcp.ts.
  if (env?.AGENT_LINK) {
    const lockId = env.AGENT_LINK.idFromName(`content:${cloudId}:${contentId}`);
    const lockStub = env.AGENT_LINK.get(lockId);
    const claimRes = await lockStub.fetch('https://agent-link-do/content-claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: record.token, expiresAt: Date.now() + TOKEN_TTL_MS }),
    });
    if (claimRes.status === 409) {
      return jsonError(409, 'diagram_already_linked');
    }
  }

  return new Response(
    JSON.stringify({
      token: record.token,
      channelUrl: `/agent-link/channel?token=${record.token}`,
      expiresInSec: TOKEN_TTL_MS / 1000,
    }),
    { status: 200, headers: JSON_HEADERS },
  );
};

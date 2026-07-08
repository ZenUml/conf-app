// GET /agent-link/channel — proxies the macro's and the agent's WebSocket
// upgrade requests through to the AgentLinkSession Durable Object instance
// for their shared `?token=`.
// See docs/superpowers/specs/2026-07-08-live-agent-link-design.md §4.3
// (connect handshake), §5.2 (relay components).
//
// The request is forwarded verbatim (including `?peer=macro|agent` and,
// on the very first connect for a token, `?cloudId=&pageId=&contentId=` —
// the macro side already holds those three values locally from the
// `POST /agent-link/session` call that minted the token, so it re-attaches
// them here rather than this endpoint depending on a registry that may not
// be visible from the DO's isolate). AgentLinkSession.fetch does all real
// validation; this file's only job is the env.AGENT_LINK lookup + forward.
//
// env.AGENT_LINK is wired in wrangler-stg.toml / wrangler-prod.toml via a
// cross-Worker `[[durable_objects.bindings]]` with `script_name` pointing at
// the standalone `conf-agent-link-{stg,prod}` Worker (workers/agent-link/)
// that actually defines AgentLinkSession — Pages Functions cannot host a
// Durable Object class internally (see the longer note in
// AgentLinkSession.ts's file header). wrangler-dev.toml intentionally has no
// such binding yet (no companion Worker is deployed for local dev), so the
// `!env.AGENT_LINK` branch below is a defensive check for that case, not a
// TODO.

interface Env {
  AGENT_LINK?: DurableObjectNamespace;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { headers: CORS_HEADERS });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) {
    return new Response(JSON.stringify({ error: 'Missing token' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  if (!env.AGENT_LINK) {
    // Defensive: only expected on wrangler-dev.toml (no companion Worker
    // deployed for local dev) or if a future config change drops the
    // binding. wrangler-stg.toml / wrangler-prod.toml always have it.
    return new Response(
      JSON.stringify({
        error:
          'AgentLinkSession channel not available: no AGENT_LINK Durable Object binding in this environment',
      }),
      { status: 501, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }

  const id = env.AGENT_LINK.idFromName(token);
  const stub = env.AGENT_LINK.get(id);
  return stub.fetch(request);
};

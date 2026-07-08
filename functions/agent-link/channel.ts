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
// TODO(agent-link): env.AGENT_LINK is not wired in wrangler-dev.toml /
// wrangler-stg.toml / wrangler-prod.toml yet. Confirmed via wrangler's own
// Pages config validator that a Durable Object binding on a Pages project
// MUST specify `script_name` pointing at a separately deployed Worker —
// Pages Functions cannot host a Durable Object class internally (see the
// longer note in AgentLinkSession.ts's file header). Until that companion
// Worker exists and is bound here, this handler returns 501 rather than
// pretending to relay.

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
    return new Response(
      JSON.stringify({
        error:
          'AgentLinkSession channel not wired: the AGENT_LINK Durable Object binding is pending a companion Worker deploy (see TODO(agent-link) in channel.ts / AgentLinkSession.ts)',
      }),
      { status: 501, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }

  const id = env.AGENT_LINK.idFromName(token);
  const stub = env.AGENT_LINK.get(id);
  return stub.fetch(request);
};

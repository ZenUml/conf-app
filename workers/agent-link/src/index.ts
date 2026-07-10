// Entry point for the `conf-agent-link` companion Worker.
//
// This Worker exists solely to host the AgentLinkSession Durable Object —
// Cloudflare Pages cannot host a DO class internally (wrangler's Pages
// config validator requires a DO binding to name the Worker where the class
// is actually defined via `script_name`). The Pages project's
// `functions/agent-link/channel.ts` proxies to this Worker's AGENT_LINK
// binding cross-Worker; this file re-exports the DO class so it's bundled
// and deployed here, plus a minimal `fetch` handler so the Worker is also
// directly reachable (e.g. for a companion-Worker-only smoke check).
//
// See docs/superpowers/specs/2026-07-08-live-agent-link-design.md §5.2 and
// functions/agent-link/AgentLinkSession.ts's file header for the full story.

export { AgentLinkSession } from '../../../functions/agent-link/AgentLinkSession';

interface Env {
  AGENT_LINK: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/channel') {
      return new Response('Not found', { status: 404 });
    }

    const token = url.searchParams.get('token');
    if (!token) {
      return new Response('Missing token', { status: 400 });
    }

    const id = env.AGENT_LINK.idFromName(token);
    const stub = env.AGENT_LINK.get(id);
    return stub.fetch(request);
  },
};

import { describe, it, expect } from 'vitest';
import { onRequestPost } from './session';

function makeRequest(body: unknown): Request {
  return new Request('https://example.com/agent-link/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { cloudId: 'cloud-1', pageId: 'page-1', contentId: 'content-1' };

describe('POST /agent-link/session', () => {
  it('returns token, channelUrl and expiresInSec for a valid body', async () => {
    const req = makeRequest(VALID_BODY);
    const res = await onRequestPost({ request: req } as any);

    expect(res.status).toBe(200);
    const body = await res.json() as { token: string; channelUrl: string; expiresInSec: number };

    expect(body.token).toMatch(/^CL-/);
    expect(body.channelUrl).toBe(`/agent-link/channel?token=${body.token}`);
    expect(body.expiresInSec).toBe(600);
  });

  it.each(['cloudId', 'pageId', 'contentId'])('returns 400 when %s is missing', async (field) => {
    const body = { ...VALID_BODY, [field]: undefined };
    const req = makeRequest(body);
    const res = await onRequestPost({ request: req } as any);

    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid JSON body', async () => {
    const req = new Request('https://example.com/agent-link/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    const res = await onRequestPost({ request: req } as any);

    expect(res.status).toBe(400);
  });
});

// --- per-contentId mint exclusivity (Track G, design §7 decision #2) -------
//
// Mocks the content-lock DO stub's `.fetch` directly (same approach as
// mcp.spec.ts's "env.AGENT_LINK present" block) rather than exercising
// AgentLinkSession's real /content-claim route — that route's own logic
// (claim/reject/TTL-staleness) is covered by AgentLinkSession.spec.ts. This
// block only proves session.ts's OWN contract: it claims before minting, and
// a 409 from the lock surfaces as `{error:'diagram_already_linked'}`.

function makeAgentLinkEnv(claimStatus: number) {
  const claimCalls: unknown[] = [];
  const stub = {
    fetch: async (url: string, init?: RequestInit) => {
      if (url.endsWith('/content-claim')) {
        claimCalls.push(init?.body ? JSON.parse(init.body as string) : undefined);
        return new Response(JSON.stringify(claimStatus === 200 ? { ok: true } : { error: 'diagram_already_linked' }), {
          status: claimStatus,
        });
      }
      return new Response(null, { status: 404 });
    },
  };
  return {
    env: { AGENT_LINK: { idFromName: (name: string) => ({ name }), get: () => stub } },
    claimCalls,
  };
}

describe('POST /agent-link/session with an AGENT_LINK Durable Object binding', () => {
  it('claims the per-contentId lock before minting and returns the token when the claim succeeds', async () => {
    const { env, claimCalls } = makeAgentLinkEnv(200);

    const req = makeRequest(VALID_BODY);
    const res = await onRequestPost({ request: req, env } as any);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    expect(body.token).toMatch(/^CL-/);
    expect(claimCalls).toHaveLength(1);
    expect((claimCalls[0] as { token: string }).token).toBe(body.token);
  });

  it('returns 409 {error: diagram_already_linked} when the contentId is already claimed', async () => {
    const { env } = makeAgentLinkEnv(409);

    const req = makeRequest(VALID_BODY);
    const res = await onRequestPost({ request: req, env } as any);

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('diagram_already_linked');
  });

  it('mints normally (no exclusivity check) when AGENT_LINK is absent (local dev)', async () => {
    const req = makeRequest(VALID_BODY);
    const res = await onRequestPost({ request: req, env: {} } as any);

    expect(res.status).toBe(200);
  });
});

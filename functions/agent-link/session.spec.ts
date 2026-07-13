import { describe, it, expect } from 'vitest';
import { onRequestPost } from './session';
import { IDLE_TTL_MS, MAX_SESSION_MS } from './sessionToken';

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

  it('claims the content lock for the ABSOLUTE cap, not the idle window (spec §4.3)', async () => {
    // Under sliding TTL a session can outlive a 10-min lock — a lock claimed at
    // the 60-min cap covers the whole possible lifetime with no refresh path.
    const { env, claimCalls } = makeAgentLinkEnv(200);

    const before = Date.now();
    const res = await onRequestPost({ request: makeRequest(VALID_BODY), env } as any);

    expect(res.status).toBe(200);
    expect((claimCalls[0] as { expiresAt: number }).expiresAt).toBeGreaterThanOrEqual(
      before + MAX_SESSION_MS,
    );
    expect((await res.json()).expiresInSec).toBe(IDLE_TTL_MS / 1000);
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

  // --- FIXED: the lock key now includes cloudId ----------------------------
  //
  // session.ts used to call
  // `env.AGENT_LINK.idFromName(\`content:${contentId}\`)` — no cloudId
  // anywhere in that string. Every OTHER cross-tenant key in this codebase
  // (e.g. the D1 queries the conf-app skill uses) always disambiguates on
  // cloudId; two DIFFERENT Confluence Cloud tenants whose custom-content
  // happened to share a numeric contentId would collide on the SAME DO
  // instance, and tenant B's mint would be incorrectly rejected with
  // `diagram_already_linked` for a completely unrelated diagram on an
  // unrelated site (a false-lockout risk — actual session read/write stayed
  // isolated by token regardless; see mcp.spec.ts's "cross-session isolation"
  // block and bridgeOps.spec.ts's scope-violation test).
  //
  // Fixed by keying the lock as `content:${cloudId}:${contentId}` (both call
  // sites — session.ts and AgentLinkSession.ts's releaseContentLock()). These
  // are now regression tests for that fix.
  //
  // The stub below is keyed by the `name` string idFromName is actually
  // called with (not by an assumed key), mirroring real Durable Object
  // addressing: identical names route to the identical stateful instance, so
  // these tests prove the (non-)collision from the actual addressing, not by
  // construction.
  function stubbedAgentLinkEnv() {
    const idFromNameCalls: string[] = [];
    const locksByName = new Map<string, { token: string; expiresAt: number }>();

    function stubForName(name: string) {
      return {
        fetch: async (url: string, init?: RequestInit) => {
          if (!url.endsWith('/content-claim')) return new Response(null, { status: 404 });
          const body = init?.body ? JSON.parse(init.body as string) : {};
          const existing = locksByName.get(name);
          if (existing && existing.token !== body.token && existing.expiresAt > Date.now()) {
            return new Response(JSON.stringify({ error: 'diagram_already_linked' }), { status: 409 });
          }
          locksByName.set(name, { token: body.token, expiresAt: body.expiresAt });
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      };
    }

    const env = {
      AGENT_LINK: {
        idFromName: (name: string) => {
          idFromNameCalls.push(name);
          return { name };
        },
        get: (id: { name: string }) => stubForName(id.name),
      },
    };

    return { env, idFromNameCalls };
  }

  it('lock key includes cloudId — two different tenants minting for a colliding contentId both succeed (no false lockout)', async () => {
    const { env, idFromNameCalls } = stubbedAgentLinkEnv();

    // Two DIFFERENT tenants, minting for the SAME contentId.
    const resA = await onRequestPost({
      request: makeRequest({ cloudId: 'tenant-a', pageId: 'page-a', contentId: 'shared-content-id' }),
      env,
    } as any);

    const resB = await onRequestPost({
      request: makeRequest({ cloudId: 'tenant-b', pageId: 'page-b', contentId: 'shared-content-id' }),
      env,
    } as any);

    // The two mints now hash to DIFFERENT lock keys, one per tenant.
    expect(idFromNameCalls).toEqual([
      'content:tenant-a:shared-content-id',
      'content:tenant-b:shared-content-id',
    ]);

    // So neither tenant's mint is spuriously rejected.
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
  });

  it('same tenant + same contentId still collides — the second mint is rejected (intended exclusivity)', async () => {
    const { env, idFromNameCalls } = stubbedAgentLinkEnv();

    const resA = await onRequestPost({
      request: makeRequest({ cloudId: 'tenant-a', pageId: 'page-a', contentId: 'shared-content-id' }),
      env,
    } as any);
    expect(resA.status).toBe(200);

    const resB = await onRequestPost({
      request: makeRequest({ cloudId: 'tenant-a', pageId: 'page-b', contentId: 'shared-content-id' }),
      env,
    } as any);

    // Same cloudId + same contentId -> the identical lock key both times.
    expect(idFromNameCalls).toEqual([
      'content:tenant-a:shared-content-id',
      'content:tenant-a:shared-content-id',
    ]);

    expect(resB.status).toBe(409);
    expect((await resB.json()).error).toBe('diagram_already_linked');
  });
});

// Probe: runs the real list_diagrams (functions/agent-link/oauth/headlessTools.ts)
// against lite-stg (our staging site) over REST basic auth. Placed temporarily at
// functions/agent-link/oauth/zz-embed-probe.spec.ts and run with
//   PROBE_OUT=<file> npx vitest run functions/agent-link/oauth/zz-embed-probe.spec.ts
// once at the baseline and once at the candidate. Needs FORGE_EMAIL/FORGE_API_TOKEN.
import { it } from 'vitest';
import { writeFileSync } from 'fs';
import { callHeadlessTool, type HeadlessContext } from './headlessTools';
import { saveGrant, type GrantStore } from './tokenStore';

const CLOUD = 'c78e721e-957f-402c-9b70-1df2227c2739';
const SITE = 'https://lite-stg.atlassian.net';
const AUTH = 'Basic ' + Buffer.from(`${process.env.FORGE_EMAIL}:${process.env.FORGE_API_TOKEN}`).toString('base64');

it('probe', async () => {
  const kv = new Map<string, string>();
  const store: GrantStore = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } };
  await saveGrant(store, 'grant-key', 'probe', { accessToken: 'x', refreshToken: 'y', accessTokenExpiresAtMs: Date.now() + 3_600_000, scope: '' });
  const fetchImpl = async (url: string, init?: RequestInit) => {
    if (url.includes('accessible-resources')) {
      return new Response(JSON.stringify([{ id: CLOUD, name: 'lite-stg', url: SITE, scopes: [] }]), { status: 200 });
    }
    const real = url.replace(`https://api.atlassian.com/ex/confluence/${CLOUD}`, SITE);
    return fetch(real, { ...init, headers: { ...(init?.headers as Record<string, string>), Authorization: AUTH } });
  };
  const ctx: HeadlessContext = { store, secret: 'grant-key', app: { clientId: 'c', clientSecret: 's', redirectUri: 'https://x/cb' }, fetchImpl: fetchImpl as never, userId: 'probe' };
  const out: Record<string, unknown> = {};
  for (const pageId of ['277872821', '181436418', '92766232']) {
    const r = (await callHeadlessTool('list_diagrams', { cloudId: CLOUD, pageId }, ctx)) as any;
    out[pageId] = { diagrams: r.diagrams, note: r.note };
  }
  writeFileSync(process.env.PROBE_OUT!, JSON.stringify(out, null, 2));
}, 120_000);

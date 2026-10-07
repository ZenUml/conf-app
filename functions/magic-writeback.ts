import { OkResponse, response } from './OkResponse';
import type { ForgeRequestData } from './utils/authenticate';

const MAX_ARTIFACT_BYTES = 1024 * 1024;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const TYPES: Record<string, string[]> = {
  '8ad26115-211f-4216-971b-0540f606303d': ['ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence'],
  'd9e4002b-120b-426b-834b-402a4a5adce7': ['ac:com.zenuml.confluence-addon:zenuml-content-sequence'],
  '01ede8b1-4e88-451a-b9ef-89eeef93afaf': ['ac:gptdock-confluence:gpt-custom-content-key'],
};
type Artifact = { sourceHash: string; svg: string; rulesVersion: 'magic-v1'; outcome: 'validated'; generatedAt?: string };
type Delivery = { id: string; sourceHash: string };
type Claimed = Delivery & { artifact: string };

function artifactValid(value: any, hash: string): value is Artifact {
  return value && value.outcome === 'validated' && value.rulesVersion === 'magic-v1'
    && /^[a-f0-9]{64}$/.test(value.sourceHash) && value.sourceHash === hash
    && typeof value.svg === 'string' && value.svg.trimStart().startsWith('<svg')
    && new TextEncoder().encode(value.svg).byteLength <= MAX_ARTIFACT_BYTES
    && (value.generatedAt === undefined || (typeof value.generatedAt === 'string' && value.generatedAt.length <= 40));
}
async function sourceHash(source: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
async function jsonLimited(res: Response): Promise<any> {
  const text = await res.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw Error('oversize');
  return JSON.parse(text);
}
async function confluence(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
}

/** FIT-bound, reviewed enrichment only. Confluence stays the system of record. */
export async function onRequest({ request, data, env }: {
  request: Request; data: ForgeRequestData; env: { DB: D1Database };
}): Promise<Response> {
  if (request.method !== 'POST') return response(405, 'Method not allowed');
  const c = data.forgeContext;
  const user = request.headers.get('x-forge-oauth-user');
  const app = request.headers.get('x-forge-oauth-system');
  if (!c?.cloudId || !c.forgeAppId || !c.environmentId || !c.installationId
    || !c.accountId || !c.apiBaseUrl || !user || !app || !TYPES[c.forgeAppId]) return response(401, 'Missing authenticated context');
  // All identities used below are verified FIT claims. Client hints are ignored.
  const scope = [c.cloudId, c.forgeAppId, c.environmentId, c.installationId];
  const moduleKey = c.forgeAppId === '01ede8b1-4e88-451a-b9ef-89eeef93afaf' ? 'gpt-custom-content-key' : 'zenuml-content-sequence';
  const allowedTypes = [...TYPES[c.forgeAppId], `forge:${c.forgeAppId}:${c.environmentId}:${moduleKey}`];
  const result = (outcome: string, artifact?: Artifact) => OkResponse({ outcome, ...(artifact ? { artifact } : {}) });
  let claim: Claimed | null = null;
  const fence = crypto.randomUUID();
  try {
    const text = await request.text();
    if (text.length > 256) return response(400, 'Invalid request');
    const { contentId } = JSON.parse(text);
    if (typeof contentId !== 'string' || !/^\d{1,30}$/.test(contentId)) return response(400, 'Invalid content id');
    // An idle queue makes no Confluence requests. Expired payloads are never delivered.
    await env.DB.prepare('DELETE FROM MagicWriteback WHERE expiresAt <= ?1').bind(Date.now()).run();
    const pending = await env.DB.prepare(
      'SELECT id, sourceHash FROM MagicWriteback WHERE cloudId=?1 AND appId=?2 AND environmentId=?3 AND installationId=?4 AND contentId=?5 AND expiresAt>?6 ORDER BY createdAt DESC, id DESC LIMIT 1',
    ).bind(...scope, contentId, Date.now()).first<Delivery>();
    if (!pending) return result('miss');
    const url = `${c.apiBaseUrl}/api/v2/custom-content/${contentId}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      // Read as the viewer on EVERY retry: recheck permission and fresh version/body.
      const read = await confluence(`${url}?body-format=raw`, user);
      if (!read.ok) return result('unavailable');
      const doc = await jsonLimited(read);
      if (String(doc.id) !== contentId || doc.status !== 'current' || !allowedTypes.includes(doc.type)
        || !Number.isSafeInteger(doc.version?.number) || doc.version.number < 1
        || typeof doc.body?.raw?.value !== 'string') return result('invalid_target');
      const body = JSON.parse(doc.body.raw.value);
      if (body?.diagramType !== 'mermaid' || typeof body.mermaidCode !== 'string') return result('invalid_target');
      const hash = await sourceHash(body.mermaidCode);
      if (hash !== pending.sourceHash) return result('source_changed');
      // Never overwrite a newer valid same-source artifact, including a writer race.
      // The browser independently sanitizes before displaying the stored SVG.
      if (artifactValid(body.magic, hash)) return result('existing', body.magic);
      // Automatic repair is limited to missing or demonstrably source-stale
      // artifacts. A malformed matching/unknown hash requires manual repair.
      if (body.magic != null && (typeof body.magic?.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.magic.sourceHash)
        || body.magic.sourceHash === hash)) return result('invalid_target');
      if (!claim) {
        claim = await env.DB.prepare(
          'UPDATE MagicWriteback SET claimToken=?1, claimUntil=?2 WHERE id=?3 AND cloudId=?4 AND appId=?5 AND environmentId=?6 AND installationId=?7 AND contentId=?8 AND expiresAt>?9 AND (claimUntil IS NULL OR claimUntil<=?9) RETURNING id, sourceHash, artifact',
        ).bind(fence, Date.now() + 60000, pending.id, ...scope, contentId, Date.now()).first<Claimed>();
        if (!claim) return result('miss');
      }
      const artifact = JSON.parse(claim.artifact);
      if (!artifactValid(artifact, hash)) return result('unavailable');
      // Ensure the lease still belongs to this attempt before a write. A competing
      // claim uses a different fence and can never be deleted by this completion.
      const owned = await env.DB.prepare(
        'SELECT id FROM MagicWriteback WHERE id=?1 AND claimToken=?2 AND claimUntil>?3 AND expiresAt>?3',
      ).bind(claim.id, fence, Date.now()).first();
      if (!owned) return result('unavailable');
      const merged = { ...body, magic: artifact };
      // Preserve the current container (the API permits exactly one container).
      const container = ['pageId', 'blogPostId', 'customContentId', 'spaceId'].find(k => doc[k] != null);
      if (!container || typeof doc.title !== 'string') return result('invalid_target');
      const put = await confluence(url, app, {
        method: 'PUT', body: JSON.stringify({ id: contentId, type: doc.type, title: doc.title, status: 'current',
          [container]: doc[container], body: { value: JSON.stringify(merged), representation: 'raw' },
          version: { number: doc.version.number + 1, message: 'Prepared Magic view', minorEdit: true } }),
      });
      if (put.status === 409) continue;
      if (!put.ok) return result('unavailable');
      const saved = await jsonLimited(put);
      if (saved.errors || String(saved.id) !== contentId || saved.version?.number !== doc.version.number + 1) return result('unavailable');
      // A raw body in the PUT response proves which artifact was persisted. If
      // Confluence omits it, confirm with a fresh user read before acknowledgement.
      let confirmed = saved;
      if (typeof saved.body?.raw?.value !== 'string') {
        const confirmation = await confluence(`${url}?body-format=raw`, user);
        if (!confirmation.ok) return result('unavailable');
        confirmed = await jsonLimited(confirmation);
      }
      const confirmedBody = JSON.parse(confirmed.body?.raw?.value ?? 'null');
      if (String(confirmed.id) !== contentId || !allowedTypes.includes(confirmed.type) || confirmed.status !== 'current'
        || !confirmedBody || confirmedBody.mermaidCode !== body.mermaidCode
        || !artifactValid(confirmedBody.magic, hash) || confirmedBody.magic.svg !== artifact.svg
        || confirmedBody.magic.generatedAt !== artifact.generatedAt) return result('unavailable');
      // Successful Confluence PUT is the only delivery acknowledgement. Failure
      // to purge is harmless: a later attempt sees the existing stored artifact.
      try {
        await env.DB.prepare('DELETE FROM MagicWriteback WHERE id=?1 AND claimToken=?2 AND cloudId=?3 AND appId=?4 AND environmentId=?5 AND installationId=?6')
          .bind(claim.id, fence, ...scope).run();
      } catch { /* Expiry/purge handles an unacknowledged successful delivery. */ }
      return result('written', artifact);
    }
    return result('conflict');
  } catch {
    // Never log tenant bodies, SVGs, source hashes, credentials, or API envelopes.
    return result('unavailable');
  } finally {
    if (claim) {
      try {
        await env.DB.prepare('UPDATE MagicWriteback SET claimToken=NULL, claimUntil=NULL WHERE id=?1 AND claimToken=?2')
          .bind(claim.id, fence).run();
      } catch { /* The bounded lease recovers automatically on the next request. */ }
    }
  }
}

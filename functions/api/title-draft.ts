import { OkResponse, response } from '../OkResponse';
import type { ForgeRequestData } from '../utils/authenticate';
import { requireForgeUserToken } from '../utils/forgeUserToken';

const MAX_BODY_BYTES = 2048;

type Row = { title_hash: string; status: 'pending' | 'ready' | 'no_diagram'; mermaid: string | null; kind: string | null; confidence: number | null };

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Draft lookup for a page title. A miss (or a changed title) queues the title for
 * the offline batch job. Never log the title or the diagram: both are customer data.
 */
export async function onRequest({ request, data, env }: {
  request: Request; data: ForgeRequestData; env: { DB: D1Database };
}): Promise<Response> {
  if (request.method !== 'POST') return response(405, 'Method not allowed');
  const c = data.forgeContext;
  if (!c?.cloudId || !c.forgeAppId) return response(401, 'Missing authenticated context');
  // Guest and anonymous viewers carry a valid FIT but no user token: 403, never 401.
  const user = requireForgeUserToken(request);
  if (!c.accountId || user instanceof Response) return response(403, 'no_user_credential');

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return response(400, 'Invalid request');
  let body: any;
  try { body = JSON.parse(text); } catch { return response(400, 'Invalid request'); }
  const { pageId, title, spaceName } = body ?? {};
  if (typeof pageId !== 'string' || !/^\d{1,30}$/.test(pageId)) return response(400, 'Invalid page id');
  if (typeof title !== 'string' || title.trim().length < 1 || title.length > 255) return response(400, 'Invalid title');
  if (spaceName != null && (typeof spaceName !== 'string' || spaceName.length > 255)) return response(400, 'Invalid space name');

  try {
    const hash = await sha256Hex(title);
    const row = await env.DB.prepare(
      'SELECT title_hash, status, mermaid, kind, confidence FROM title_draft WHERE cloud_id=?1 AND forge_app_id=?2 AND page_id=?3',
    ).bind(c.cloudId, c.forgeAppId, pageId).first<Row>();
    if (!row || row.title_hash !== hash) {
      // The WHERE clause makes a concurrent insert of the same title a no-op.
      await env.DB.prepare(
        `INSERT INTO title_draft (cloud_id, forge_app_id, page_id, title, title_hash, space_name, status, requested_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7)
         ON CONFLICT (cloud_id, forge_app_id, page_id) DO UPDATE SET
           title=excluded.title, title_hash=excluded.title_hash, space_name=excluded.space_name, status='pending',
           mermaid=NULL, kind=NULL, confidence=NULL, generated_at=NULL, requested_at=excluded.requested_at
         WHERE title_draft.title_hash <> excluded.title_hash`,
      ).bind(c.cloudId, c.forgeAppId, pageId, title, hash, spaceName ?? null, Date.now()).run();
      return OkResponse({ status: 'pending' });
    }
    if (row.status === 'ready') return OkResponse({ status: 'ready', mermaid: row.mermaid, kind: row.kind, confidence: row.confidence });
    return OkResponse({ status: row.status });
  } catch {
    return response(503, 'title_draft_unavailable');
  }
}

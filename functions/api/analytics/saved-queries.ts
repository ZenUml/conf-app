import { response } from '../../OkResponse';

interface Env {
  DB: D1Database;
}

interface SavedQueryPayload {
  slug?: string;
  title?: string;
  description?: string;
  config?: unknown;
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const slug = url.searchParams.get('slug');
    const baseSql = `SELECT slug, title, description, configJson, createdAt, updatedAt
                     FROM AnalyticsSavedQuery`;
    const query = slug
      ? await env.DB.prepare(`${baseSql} WHERE slug = ?1`).bind(slug).first<Record<string, unknown>>()
      : await env.DB.prepare(`${baseSql} ORDER BY updatedAt DESC`).all<Record<string, unknown>>();

    const rows = slug ? (query ? [query] : []) : ((query as D1Result<Record<string, unknown>>).results || []);
    return Response.json({
      rows: rows.map((row) => ({
        ...row,
        config: typeof row.configJson === 'string' ? JSON.parse(row.configJson) : row.configJson,
      })),
    });
  }

  if (request.method === 'POST') {
    const body = await request.json<SavedQueryPayload>();
    if (!body.title || !body.config) {
      return response(400, 'title and config are required');
    }

    const slug = normalizeSlug(body.slug || body.title);
    if (!slug) {
      return response(400, 'Unable to derive saved query slug');
    }

    const configJson = JSON.stringify(body.config);
    await env.DB.prepare(
      `INSERT INTO AnalyticsSavedQuery (slug, title, description, configJson, createdAt, updatedAt)
       VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(slug) DO UPDATE SET
         title = excluded.title,
         description = excluded.description,
         configJson = excluded.configJson,
         updatedAt = CURRENT_TIMESTAMP`
    ).bind(
      slug,
      body.title,
      body.description || null,
      configJson,
    ).run();

    return Response.json({
      ok: true,
      slug,
    });
  }

  if (request.method === 'DELETE') {
    const url = new URL(request.url);
    const slug = url.searchParams.get('slug');
    if (!slug) {
      return response(400, 'slug is required');
    }

    await env.DB.prepare('DELETE FROM AnalyticsSavedQuery WHERE slug = ?1').bind(slug).run();
    return Response.json({ ok: true });
  }

  return response(405, 'Method Not Allowed');
};

import { response } from '../../OkResponse';
import { buildEventQuery } from '../../utils/analyticsQueries';

interface Env {
  DB: D1Database;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== 'GET') {
    return response(405, 'Method Not Allowed');
  }

  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') || '100');
    const offset = Number(url.searchParams.get('offset') || '0');
    const { sql, params } = buildEventQuery({
      startDate: url.searchParams.get('startDate') || undefined,
      endDate: url.searchParams.get('endDate') || undefined,
      event: url.searchParams.get('event') || undefined,
      clientDomain: url.searchParams.get('clientDomain') || undefined,
      confluenceSpace: url.searchParams.get('confluenceSpace') || undefined,
      diagramType: url.searchParams.get('diagramType') || undefined,
      eventCategory: url.searchParams.get('eventCategory') || undefined,
      isLite: url.searchParams.get('isLite') || undefined,
      limit,
      offset,
    });

    const results = await env.DB.prepare(sql).bind(...params).all<Record<string, unknown>>();

    return Response.json({
      rows: results.results || [],
      paging: {
        limit,
        offset,
        nextOffset: (results.results || []).length === Math.min(Math.max(limit, 1), 500)
          ? offset + Math.min(Math.max(limit, 1), 500)
          : null,
      },
    });
  } catch (error) {
    return response(400, error instanceof Error ? error.message : 'Invalid analytics event query');
  }
};

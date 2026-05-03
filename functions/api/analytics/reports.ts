import { response } from '../../OkResponse';

const REPORTS: Record<string, string> = {
  'installed-uninstalled': 'SELECT * FROM AnalyticsReportInstalledUninstalled',
  'csat-average': 'SELECT * FROM AnalyticsReportCsatAverage',
  'active-clients-view-save-weekly': 'SELECT * FROM AnalyticsReportActiveClientsViewSaveWeekly',
  'active-clients-view-save-full-weekly': 'SELECT * FROM AnalyticsReportActiveClientsViewSaveFullWeekly',
  'all-events-unique-users-daily': 'SELECT * FROM AnalyticsReportAllEventsUniqueUsersDaily',
  'view-macro-paynet-daily': 'SELECT * FROM AnalyticsReportViewMacroPayNetDaily',
  'macros-per-day-ex-mermaid': 'SELECT * FROM AnalyticsReportMacrosPerDayExMermaid',
  'view-macro-unique-macro-daily': 'SELECT * FROM AnalyticsReportViewMacroUniqueMacroDaily',
};

interface Env {
  DB: D1Database;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== 'GET') {
    return response(405, 'Method Not Allowed');
  }

  const url = new URL(request.url);
  const report = url.searchParams.get('report');
  if (!report || !REPORTS[report]) {
    return response(400, 'Unsupported analytics report');
  }

  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || '500'), 1), 1000);

  let sql = REPORTS[report];
  const params: unknown[] = [];
  if (startDate || endDate) {
    const where: string[] = [];
    if (startDate) {
      params.push(startDate);
      where.push(`eventDate >= ?${params.length}`);
    }
    if (endDate) {
      params.push(endDate);
      where.push(`eventDate <= ?${params.length}`);
    }
    sql += ` WHERE ${where.join(' AND ')}`;
  }
  sql += ` ORDER BY eventDate LIMIT ${limit}`;

  const statement = env.DB.prepare(sql).bind(...params);
  const results = await statement.all<Record<string, unknown>>();

  return Response.json({
    report,
    rows: results.results || [],
  });
};

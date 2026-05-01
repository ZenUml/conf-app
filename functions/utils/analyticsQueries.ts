export type ExploreMetric = 'count' | 'uniqueUsers' | 'uniqueClients' | 'uniqueMacros';
export type ExploreDimension =
  | 'eventDate'
  | 'event'
  | 'clientDomain'
  | 'confluenceSpace'
  | 'diagramType'
  | 'eventCategory'
  | 'isLite';

const DIMENSION_SQL: Record<ExploreDimension, string> = {
  eventDate: 'eventDate',
  event: 'event',
  clientDomain: 'COALESCE(clientDomain, \'\')',
  confluenceSpace: 'COALESCE(confluenceSpace, \'\')',
  diagramType: 'COALESCE(diagramType, \'\')',
  eventCategory: 'COALESCE(eventCategory, \'\')',
  isLite: 'COALESCE(isLite, -1)',
};

const METRIC_SQL: Record<ExploreMetric, string> = {
  count: 'COUNT(*)',
  uniqueUsers: 'COUNT(DISTINCT canonicalUserId)',
  uniqueClients: 'COUNT(DISTINCT clientDomain)',
  uniqueMacros: 'COUNT(DISTINCT macroUuid)',
};

export interface ExploreQueryInput {
  metric: ExploreMetric;
  groupBy?: ExploreDimension;
  startDate?: string;
  endDate?: string;
  event?: string;
  clientDomain?: string;
  confluenceSpace?: string;
  diagramType?: string;
  eventCategory?: string;
  isLite?: string;
  limit?: number;
}

export interface EventQueryInput {
  startDate?: string;
  endDate?: string;
  event?: string;
  clientDomain?: string;
  confluenceSpace?: string;
  diagramType?: string;
  eventCategory?: string;
  isLite?: string;
  offset?: number;
  limit?: number;
}

function buildWhereClause(input: Omit<ExploreQueryInput, 'metric' | 'groupBy' | 'limit'>) {
  const params: unknown[] = [];
  const where: string[] = [];

  const bind = (value: unknown) => {
    params.push(value);
    return `?${params.length}`;
  };

  if (input.startDate) where.push(`eventDate >= ${bind(input.startDate)}`);
  if (input.endDate) where.push(`eventDate <= ${bind(input.endDate)}`);
  if (input.event) where.push(`event = ${bind(input.event)}`);
  if (input.clientDomain) where.push(`clientDomain = ${bind(input.clientDomain)}`);
  if (input.confluenceSpace) where.push(`confluenceSpace = ${bind(input.confluenceSpace)}`);
  if (input.diagramType) where.push(`diagramType = ${bind(input.diagramType)}`);
  if (input.eventCategory) where.push(`eventCategory = ${bind(input.eventCategory)}`);
  if (input.isLite != null && input.isLite !== '') where.push(`isLite = ${bind(Number(input.isLite))}`);

  return {
    params,
    whereClause: where.length ? `WHERE ${where.join(' AND ')}` : '',
  };
}

export function buildExploreQuery(input: ExploreQueryInput): { sql: string; params: unknown[] } {
  const metricSql = METRIC_SQL[input.metric];
  if (!metricSql) {
    throw new Error(`Unsupported metric: ${input.metric}`);
  }

  const { params, whereClause } = buildWhereClause(input);
  const limit = Math.min(Math.max(Number(input.limit || 100), 1), 500);

  if (input.groupBy) {
    const dimensionSql = DIMENSION_SQL[input.groupBy];
    if (!dimensionSql) {
      throw new Error(`Unsupported groupBy: ${input.groupBy}`);
    }

    return {
      sql: `SELECT ${dimensionSql} AS dimension, ${metricSql} AS value
            FROM AnalyticsEventFact
            ${whereClause}
            GROUP BY ${dimensionSql}
            ORDER BY value DESC
            LIMIT ${limit}`,
      params,
    };
  }

  return {
    sql: `SELECT ${metricSql} AS value
          FROM AnalyticsEventFact
          ${whereClause}
          LIMIT 1`,
    params,
  };
}

export function buildEventQuery(input: EventQueryInput): { sql: string; params: unknown[] } {
  const { params, whereClause } = buildWhereClause(input);
  const limit = Math.min(Math.max(Number(input.limit || 100), 1), 500);
  const offset = Math.max(Number(input.offset || 0), 0);

  params.push(limit, offset);

  return {
    sql: `SELECT
            eventId,
            event,
            action,
            eventTime,
            eventDate,
            canonicalUserId,
            userAccountId,
            clientDomain,
            confluenceSpace,
            contentId,
            macroUuid,
            diagramType,
            eventCategory,
            eventLabel,
            cloudId,
            isLite,
            addonKey,
            appVersion,
            eventSource,
            licenseState,
            r2Key
          FROM AnalyticsEventFact
          ${whereClause}
          ORDER BY eventTime DESC
          LIMIT ?${params.length - 1} OFFSET ?${params.length}`,
    params,
  };
}

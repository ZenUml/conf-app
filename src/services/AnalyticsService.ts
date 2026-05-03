export interface AnalyticsFilters {
  startDate?: string;
  endDate?: string;
  event?: string;
  clientDomain?: string;
  confluenceSpace?: string;
  diagramType?: string;
  eventCategory?: string;
  isLite?: string;
  limit?: number;
  offset?: number;
}

export interface ExploreFilters extends AnalyticsFilters {
  metric: 'count' | 'uniqueUsers' | 'uniqueClients' | 'uniqueMacros';
  groupBy?: 'eventDate' | 'event' | 'clientDomain' | 'confluenceSpace' | 'diagramType' | 'eventCategory' | 'isLite' | '';
}

export interface SavedAnalyticsQuery {
  slug: string;
  title: string;
  description?: string;
  config: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

function toQueryString(params: Record<string, unknown> | AnalyticsFilters | ExploreFilters): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    searchParams.set(key, String(value));
  }
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

async function requestJson<T>(endpoint: string, init?: RequestInit): Promise<T> {
  const response = await fetch(endpoint, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}: ${body || response.statusText}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchAnalyticsReport(report: string, filters: AnalyticsFilters = {}) {
  return requestJson<{ rows: Record<string, unknown>[] }>(`/api/analytics/reports${toQueryString({ report, ...filters })}`);
}

export async function fetchAnalyticsExplore(filters: ExploreFilters) {
  return requestJson<{ rows: Record<string, unknown>[] }>(`/api/analytics/explore${toQueryString(filters)}`);
}

export async function fetchAnalyticsEvents(filters: AnalyticsFilters = {}) {
  return requestJson<{ rows: Record<string, unknown>[]; paging?: { limit: number; offset: number; nextOffset: number | null } }>(`/api/analytics/events${toQueryString(filters)}`);
}

export async function listSavedAnalyticsQueries(slug?: string): Promise<{ rows: SavedAnalyticsQuery[] }> {
  return requestJson(`/api/analytics/saved-queries${toQueryString({ slug })}`);
}

export async function saveAnalyticsQuery(query: Omit<SavedAnalyticsQuery, 'createdAt' | 'updatedAt'>) {
  return requestJson('/api/analytics/saved-queries', {
    method: 'POST',
    body: JSON.stringify(query),
  });
}

export async function deleteAnalyticsQuery(slug: string) {
  return requestJson(`/api/analytics/saved-queries${toQueryString({ slug })}`, {
    method: 'DELETE',
  });
}

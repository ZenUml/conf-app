import { describe, expect, it } from 'vitest';
import {
  buildAnalyticsR2Key,
  normalizeForgeInstallAnalyticsEvent,
  normalizeFrontendAnalyticsEvent,
  normalizeMappedAnalyticsEvent,
  normalizeUninstallAnalyticsEvent,
} from '../../functions/utils/analytics';
import { buildEventQuery, buildExploreQuery } from '../../functions/utils/analyticsQueries';

describe('analytics normalization', () => {
  it('normalizes frontend events into the canonical shape', () => {
    const event = normalizeFrontendAnalyticsEvent(
      {
        action: 'view_macro',
        user_account_id: 'user-1',
        client_domain: 'example.atlassian.net',
        confluence_space: 'ENG',
        macro_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        event_category: 'Sequence',
        event_label: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        isLite: 'False',
        addon_key: 'com.zenuml.confluence-addon',
        version: '1.2.3',
        event_source: 'app.zenuml.com',
        time: '1745580000',
      },
      new Request('https://example.com/track'),
    );

    expect(event.event).toBe('view_macro');
    expect(event.action).toBe('view_macro');
    expect(event.canonicalUserId).toBe('user-1');
    expect(event.clientDomain).toBe('example.atlassian.net');
    expect(event.confluenceSpace).toBe('ENG');
    expect(event.diagramType).toBe('sequence');
    expect(event.isLite).toBe(0);
    expect(buildAnalyticsR2Key(event)).toContain('/frontend/');
  });

  it('normalizes mapped forge events into the canonical shape', () => {
    const event = normalizeMappedAnalyticsEvent(
      {
        action: 'page_viewed',
        event_source: 'forge_trigger',
        user_account_id: 'user-2',
        client_domain: 'whimet4.atlassian.net',
        confluence_space: 'OPS',
        cloud_id: 'cloud-1',
        content_id: 'page-1',
        event_created_date: '2026-04-25T03:00:00.000Z',
        forge_app_id: 'app-1',
        forge_app_version: '2.0.0',
      },
      'forge',
    );

    expect(event.sourceType).toBe('forge');
    expect(event.event).toBe('page_viewed');
    expect(event.clientDomain).toBe('whimet4.atlassian.net');
    expect(event.contentId).toBe('page-1');
    expect(event.cloudId).toBe('cloud-1');
  });

  it('normalizes install lifecycle events into canonical analytics facts', () => {
    const event = normalizeForgeInstallAnalyticsEvent({
      eventType: 'avi:forge:installed:app',
      id: 'install-1',
      context: 'ari:cloud:confluence::site/cloud-123',
      installerAccountId: 'user-3',
      app: {
        id: 'app-1',
        name: 'ZenUML Lite',
        ownerAccountId: 'owner-1',
        version: '3.0.0',
      },
      environment: { id: 'env-1' },
      permissions: {
        scopes: [],
        external: { fetch: { backend: [], client: [] } },
        frames: [],
        scripts: [],
      },
    });

    expect(event.event).toBe('installed');
    expect(event.cloudId).toBe('cloud-123');
    expect(event.isLite).toBe(1);
  });

  it('normalizes uninstall lifecycle events into canonical analytics facts', () => {
    const event = normalizeUninstallAnalyticsEvent({
      key: 'com.zenuml.confluence-addon-lite',
      clientKey: 'client-1',
      baseUrl: 'https://whimet4.atlassian.net',
    });

    expect(event.event).toBe('uninstalled');
    expect(event.clientDomain).toBe('whimet4.atlassian.net');
    expect(event.isLite).toBe(1);
  });
});

describe('analytics explore query builder', () => {
  it('builds grouped exploration queries with safe allowlisted dimensions', () => {
    const query = buildExploreQuery({
      metric: 'uniqueUsers',
      groupBy: 'clientDomain',
      startDate: '2026-04-01',
      endDate: '2026-04-30',
      event: 'view_macro',
      limit: 20,
    });

    expect(query.sql).toContain('COUNT(DISTINCT canonicalUserId)');
    expect(query.sql).toContain('GROUP BY COALESCE(clientDomain, \'\')');
    expect(query.params).toEqual(['2026-04-01', '2026-04-30', 'view_macro']);
  });

  it('rejects unsupported metrics', () => {
    expect(() => buildExploreQuery({
      metric: 'nope' as never,
    })).toThrow('Unsupported metric');
  });

  it('builds event drill-through queries with paging', () => {
    const query = buildEventQuery({
      event: 'view_macro',
      startDate: '2026-04-01',
      limit: 25,
      offset: 50,
    });

    expect(query.sql).toContain('FROM AnalyticsEventFact');
    expect(query.sql).toContain('ORDER BY eventTime DESC');
    expect(query.params).toEqual(['2026-04-01', 'view_macro', 25, 50]);
  });
});

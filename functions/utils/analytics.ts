import { D1Database } from '@cloudflare/workers-types';
import { ForgeAppRequestBody } from '../RequestBody';

export interface AnalyticsEvent {
  eventId: string;
  event: string;
  action: string;
  sourceType: 'frontend' | 'forge';
  eventTime: string;
  eventDate: string;
  canonicalUserId: string | null;
  distinctId: string | null;
  userAccountId: string | null;
  clientDomain: string | null;
  confluenceSpace: string | null;
  contentId: string | null;
  macroUuid: string | null;
  diagramType: string | null;
  eventCategory: string | null;
  eventLabel: string | null;
  cloudId: string | null;
  isLite: number;
  addonKey: string | null;
  appVersion: string | null;
  eventSource: string | null;
  licenseState: string | null;
}

export interface ReplayAnalyticsOptions {
  prefix?: string;
  limit?: number;
  refreshAggregates?: boolean;
  cursor?: string;
}

type AnalyticsPayload = Record<string, unknown>;

const KNOWN_DIAGRAM_TYPES = new Set(['sequence', 'mermaid', 'graph', 'openapi', 'embed']);

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return value == null ? null : String(value);
  }

  return value === '' ? null : value;
}

function normalizeBoolean(value: unknown): number {
  if (value === true || value === 'true' || value === 'True') {
    return 1;
  }
  if (value === false || value === 'false' || value === 'False') {
    return 0;
  }
  return -1;
}

function parseEventTime(value: unknown): Date {
  const normalized = normalizeString(value);
  if (!normalized) {
    return new Date();
  }

  const asNumber = Number(normalized);
  if (Number.isFinite(asNumber)) {
    const millis = asNumber > 10_000_000_000 ? asNumber : asNumber * 1000;
    return new Date(millis);
  }

  const asDate = new Date(normalized);
  if (!Number.isNaN(asDate.getTime())) {
    return asDate;
  }

  return new Date();
}

function maybeUuid(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

function detectDiagramType(payload: AnalyticsPayload): string | null {
  const direct = normalizeString(payload.diagram_type) || normalizeString(payload.diagramType);
  if (direct) {
    return direct.toLowerCase();
  }

  const category = normalizeString(payload.event_category)?.toLowerCase() || null;
  if (category && KNOWN_DIAGRAM_TYPES.has(category)) {
    return category;
  }

  return null;
}

function detectMacroUuid(payload: AnalyticsPayload): string | null {
  return maybeUuid(normalizeString(payload.macro_uuid))
    || maybeUuid(normalizeString(payload.event_label))
    || null;
}

function extractCloudIdFromContext(value: unknown): string | null {
  const context = normalizeString(value);
  if (!context) {
    return null;
  }

  const match = context.match(/site\/([^/]+)$/);
  return match ? match[1] : null;
}

function hostnameFromUrl(value: unknown): string | null {
  const raw = normalizeString(value);
  if (!raw) {
    return null;
  }

  try {
    return new URL(raw).hostname;
  } catch {
    return raw;
  }
}

export function buildAnalyticsR2Key(analyticsEvent: AnalyticsEvent): string {
  const eventDate = analyticsEvent.eventDate.replaceAll('-', '/');
  const hour = analyticsEvent.eventTime.slice(11, 13) || '00';
  return `analytics/raw/${analyticsEvent.sourceType}/${eventDate}/${hour}/${analyticsEvent.eventId}.json`;
}

export async function archiveAnalyticsEvent(
  bucket: R2Bucket | undefined,
  analyticsEvent: AnalyticsEvent,
  rawPayload: AnalyticsPayload,
): Promise<string | null> {
  if (!bucket) {
    return null;
  }

  const key = buildAnalyticsR2Key(analyticsEvent);
  await bucket.put(
    key,
    JSON.stringify({
      analyticsEvent,
      rawPayload,
    }),
    {
      httpMetadata: {
        contentType: 'application/json',
      },
    },
  );
  return key;
}

export async function insertAnalyticsEventFact(
  db: D1Database,
  analyticsEvent: AnalyticsEvent,
  r2Key: string | null,
): Promise<void> {
  await db.prepare(
    `INSERT INTO AnalyticsEventFact (
      eventId, event, action, sourceType, eventTime, eventDate, canonicalUserId, distinctId,
      userAccountId, clientDomain, confluenceSpace, contentId, macroUuid, diagramType,
      eventCategory, eventLabel, cloudId, isLite, addonKey, appVersion, eventSource, licenseState, r2Key
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)
    ON CONFLICT(eventId) DO NOTHING`
  ).bind(
    analyticsEvent.eventId,
    analyticsEvent.event,
    analyticsEvent.action,
    analyticsEvent.sourceType,
    analyticsEvent.eventTime,
    analyticsEvent.eventDate,
    analyticsEvent.canonicalUserId,
    analyticsEvent.distinctId,
    analyticsEvent.userAccountId,
    analyticsEvent.clientDomain,
    analyticsEvent.confluenceSpace,
    analyticsEvent.contentId,
    analyticsEvent.macroUuid,
    analyticsEvent.diagramType,
    analyticsEvent.eventCategory,
    analyticsEvent.eventLabel,
    analyticsEvent.cloudId,
    analyticsEvent.isLite,
    analyticsEvent.addonKey,
    analyticsEvent.appVersion,
    analyticsEvent.eventSource,
    analyticsEvent.licenseState,
    r2Key || '',
  ).run();
}

export async function refreshAnalyticsAggregates(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM AnalyticsDailyEventSummary').run();
  await db.prepare(
    `INSERT INTO AnalyticsDailyEventSummary (
      eventDate, event, clientDomain, confluenceSpace, diagramType, eventCategory, isLite,
      eventCount, uniqueUsers, uniqueClients, uniqueSpaces, uniqueContents, uniqueMacros
    )
    SELECT
      eventDate,
      event,
      COALESCE(clientDomain, ''),
      COALESCE(confluenceSpace, ''),
      COALESCE(diagramType, ''),
      COALESCE(eventCategory, ''),
      COALESCE(isLite, -1),
      COUNT(*),
      COUNT(DISTINCT canonicalUserId),
      COUNT(DISTINCT clientDomain),
      COUNT(DISTINCT confluenceSpace),
      COUNT(DISTINCT contentId),
      COUNT(DISTINCT macroUuid)
    FROM AnalyticsEventFact
    GROUP BY eventDate, event, COALESCE(clientDomain, ''), COALESCE(confluenceSpace, ''), COALESCE(diagramType, ''), COALESCE(eventCategory, ''), COALESCE(isLite, -1)`
  ).run();

  await db.prepare('DELETE FROM AnalyticsWeeklyClientActivity').run();
  await db.prepare(
    `INSERT INTO AnalyticsWeeklyClientActivity (weekStart, event, scope, activeClients)
    SELECT
      DATE(eventDate, '-' || ((CAST(STRFTIME('%w', eventDate) AS INTEGER) + 6) % 7) || ' days'),
      event,
      'all',
      COUNT(DISTINCT clientDomain)
    FROM AnalyticsEventFact
    WHERE event IN ('view_macro', 'save_macro')
      AND clientDomain IS NOT NULL
    GROUP BY 1, 2`
  ).run();
  await db.prepare(
    `INSERT INTO AnalyticsWeeklyClientActivity (weekStart, event, scope, activeClients)
    SELECT
      DATE(eventDate, '-' || ((CAST(STRFTIME('%w', eventDate) AS INTEGER) + 6) % 7) || ' days'),
      event,
      'full',
      COUNT(DISTINCT clientDomain)
    FROM AnalyticsEventFact
    WHERE event IN ('view_macro', 'save_macro')
      AND clientDomain IS NOT NULL
      AND isLite = 0
    GROUP BY 1, 2`
  ).run();

  await db.prepare('DELETE FROM AnalyticsDailyCsat').run();
  await db.prepare(
    `INSERT INTO AnalyticsDailyCsat (
      eventDate, clientDomain, isLite, responseCount, averageCsat, minimumCsat, maximumCsat
    )
    SELECT
      eventDate,
      COALESCE(clientDomain, ''),
      COALESCE(isLite, -1),
      COUNT(*),
      ROUND(AVG(CAST(eventLabel AS REAL)), 2),
      MIN(CAST(eventLabel AS REAL)),
      MAX(CAST(eventLabel AS REAL))
    FROM AnalyticsEventFact
    WHERE event = 'csat'
      AND eventLabel IS NOT NULL
      AND eventLabel GLOB '[0-9]*'
    GROUP BY eventDate, COALESCE(clientDomain, ''), COALESCE(isLite, -1)`
  ).run();
}

export async function purgeAnalyticsFactRetention(
  db: D1Database,
  keepDays: number,
): Promise<{ deletedRows: number }> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - keepDays);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const result = await db.prepare(
    'DELETE FROM AnalyticsEventFact WHERE eventDate < ?1'
  ).bind(cutoffDate).run();

  return {
    deletedRows: result.meta?.changes || 0,
  };
}

export async function replayAnalyticsEventsFromR2(
  db: D1Database,
  bucket: R2Bucket | undefined,
  options: ReplayAnalyticsOptions = {},
): Promise<{ processed: number; nextCursor: string | null }> {
  if (!bucket) {
    throw new Error('EVENT_BUCKET is required for analytics replay');
  }

  const prefix = options.prefix || 'analytics/raw/';
  const limit = Math.min(Math.max(options.limit || 100, 1), 2000);
  let processed = 0;
  let cursor = options.cursor;

  while (processed < limit) {
    const page = await bucket.list({
      prefix,
      cursor,
      limit: Math.min(100, limit - processed),
    });

    for (const object of page.objects) {
      const response = await bucket.get(object.key);
      if (!response) {
        continue;
      }

      const json = await response.json<{
        analyticsEvent?: AnalyticsEvent;
      }>();

      if (json.analyticsEvent) {
        await insertAnalyticsEventFact(db, json.analyticsEvent, object.key);
        processed += 1;
      }
    }

    if (!page.truncated || !page.cursor || processed >= limit) {
      cursor = page.truncated ? page.cursor : undefined;
      break;
    }

    cursor = page.cursor;
  }

  if (options.refreshAggregates && processed > 0) {
    await refreshAnalyticsAggregates(db);
  }

  return {
    processed,
    nextCursor: cursor || null,
  };
}

export function normalizeFrontendAnalyticsEvent(
  payload: AnalyticsPayload,
  request: Request,
): AnalyticsEvent {
  const event = normalizeString(payload.event) || normalizeString(payload.action) || 'unknown_event';
  const action = normalizeString(payload.action) || event;
  const eventDateTime = parseEventTime(payload.time || payload.timestamp);
  const userAccountId = normalizeString(payload.user_account_id);
  const distinctId = userAccountId || normalizeString(payload.distinct_id);

  return {
    eventId: crypto.randomUUID(),
    event,
    action,
    sourceType: 'frontend',
    eventTime: eventDateTime.toISOString(),
    eventDate: eventDateTime.toISOString().slice(0, 10),
    canonicalUserId: distinctId,
    distinctId,
    userAccountId,
    clientDomain: normalizeString(payload.client_domain),
    confluenceSpace: normalizeString(payload.confluence_space),
    contentId: normalizeString(payload.content_id),
    macroUuid: detectMacroUuid(payload),
    diagramType: detectDiagramType(payload),
    eventCategory: normalizeString(payload.event_category)?.toLowerCase() || null,
    eventLabel: normalizeString(payload.event_label),
    cloudId: normalizeString(payload.cloud_id),
    isLite: normalizeBoolean(payload.isLite),
    addonKey: normalizeString(payload.addon_key),
    appVersion: normalizeString(payload.version),
    eventSource: normalizeString(payload.event_source) || new URL(request.url).hostname,
    licenseState: normalizeString(payload.license),
  };
}

export function normalizeMappedAnalyticsEvent(
  payload: AnalyticsPayload,
  sourceType: 'forge' | 'frontend',
): AnalyticsEvent {
  const event = normalizeString(payload.event) || normalizeString(payload.action) || 'unknown_event';
  const action = normalizeString(payload.action) || event;
  const eventDateTime = parseEventTime(payload.event_created_date || payload.time || payload.timestamp);
  const userAccountId = normalizeString(payload.user_account_id) || normalizeString(payload.atlassian_user_id);
  const distinctId = userAccountId || normalizeString(payload.distinct_id);

  return {
    eventId: crypto.randomUUID(),
    event,
    action,
    sourceType,
    eventTime: eventDateTime.toISOString(),
    eventDate: eventDateTime.toISOString().slice(0, 10),
    canonicalUserId: distinctId,
    distinctId,
    userAccountId,
    clientDomain: normalizeString(payload.client_domain),
    confluenceSpace: normalizeString(payload.confluence_space) || normalizeString(payload.space_key),
    contentId: normalizeString(payload.content_id),
    macroUuid: detectMacroUuid(payload),
    diagramType: detectDiagramType(payload),
    eventCategory: normalizeString(payload.event_category)?.toLowerCase() || null,
    eventLabel: normalizeString(payload.event_label),
    cloudId: normalizeString(payload.cloud_id),
    isLite: normalizeBoolean(payload.isLite),
    addonKey: normalizeString(payload.addon_key) || normalizeString(payload.forge_app_id),
    appVersion: normalizeString(payload.version) || normalizeString(payload.forge_app_version),
    eventSource: normalizeString(payload.event_source),
    licenseState: normalizeString(payload.license),
  };
}

export function normalizeForgeInstallAnalyticsEvent(
  payload: ForgeAppRequestBody,
): AnalyticsEvent {
  const eventDateTime = new Date().toISOString();
  const event = payload.eventType === 'avi:forge:installed:app' ? 'installed' : 'upgraded';
  const cloudId = extractCloudIdFromContext(payload.context);

  return {
    eventId: crypto.randomUUID(),
    event,
    action: event,
    sourceType: 'forge',
    eventTime: eventDateTime,
    eventDate: eventDateTime.slice(0, 10),
    canonicalUserId: payload.installerAccountId || null,
    distinctId: payload.installerAccountId || null,
    userAccountId: payload.installerAccountId || null,
    clientDomain: null,
    confluenceSpace: null,
    contentId: null,
    macroUuid: null,
    diagramType: null,
    eventCategory: 'lifecycle',
    eventLabel: payload.app.name || null,
    cloudId,
    isLite: payload.app.name?.toLowerCase().includes('lite') ? 1 : 0,
    addonKey: payload.app.id,
    appVersion: payload.app.version || null,
    eventSource: 'forge_installed',
    licenseState: null,
  };
}

export function normalizeUninstallAnalyticsEvent(
  payload: Record<string, unknown>,
): AnalyticsEvent {
  const eventDateTime = new Date().toISOString();

  return {
    eventId: crypto.randomUUID(),
    event: 'uninstalled',
    action: 'uninstalled',
    sourceType: 'forge',
    eventTime: eventDateTime,
    eventDate: eventDateTime.slice(0, 10),
    canonicalUserId: null,
    distinctId: normalizeString(payload.clientKey),
    userAccountId: null,
    clientDomain: hostnameFromUrl(payload.baseUrl),
    confluenceSpace: null,
    contentId: null,
    macroUuid: null,
    diagramType: null,
    eventCategory: 'lifecycle',
    eventLabel: normalizeString(payload.key),
    cloudId: normalizeString(payload.clientKey),
    isLite: normalizeString(payload.key)?.includes('-lite') ? 1 : 0,
    addonKey: normalizeString(payload.key),
    appVersion: null,
    eventSource: 'connect_uninstalled',
    licenseState: null,
  };
}

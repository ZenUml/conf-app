import { json } from '../OkResponse';
import { validateContextToken } from '../utils/authenticate';
import { getAuthorizationHeader } from '../utils/requestUtils';

const FULL_APP_ID = 'd9e4002b-120b-426b-834b-402a4a5adce7';
const MAX_VALIDITY_MS = 24 * 60 * 60 * 1000;
const ENVIRONMENTS = new Set(['development', 'staging', 'production']);
const NO_STORE = { 'Cache-Control': 'no-store' };

type Env = { KV_FEATURE_FLAGS: KVNamespace };
type NoticeRecord = { checkedAt: string; expiresAt: string };

function isoTimestamp(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return NaN;
  const time = Date.parse(value);
  // Reject calendar overflow, which Date.parse otherwise normalizes.
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 19) !== value.slice(0, 19)) return NaN;
  return time;
}

function validRecord(value: unknown, now: number): value is NoticeRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || record.licenseType !== 'LEGACY_FREE'
    || record.source !== 'atlassian_marketplace'
    || typeof record.entitlementId !== 'string' || !record.entitlementId.trim()) return false;
  const checkedAt = isoTimestamp(record.checkedAt);
  const expiresAt = isoTimestamp(record.expiresAt);
  return Number.isFinite(checkedAt) && Number.isFinite(expiresAt)
    && checkedAt <= now && expiresAt > now && expiresAt > checkedAt
    && expiresAt - checkedAt <= MAX_VALIDITY_MS;
}

/** Read a short-lived Marketplace fact for the authenticated Full installation. */
export async function onRequest({ request, env }: { request: Request; env: Env }): Promise<Response> {
  if (request.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, { status: 405, headers: { ...NO_STORE, Allow: 'GET' } });
  }
  const token = getAuthorizationHeader(request);
  if (!token) return json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });

  let fit: Awaited<ReturnType<typeof validateContextToken>>;
  try {
    // This endpoint serves Full only, irrespective of broader deployment allowlists.
    fit = await validateContextToken(token, FULL_APP_ID);
  } catch {
    return json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }
  if (fit.forgeAppId !== FULL_APP_ID) {
    return json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });
  }
  const unknown = () => json({ state: 'unknown' }, { headers: NO_STORE });
  const environment = fit.environmentType?.toLowerCase();
  if (!environment || !ENVIRONMENTS.has(environment) || !fit.cloudId?.trim()) return unknown();
  const app = fit.payload?.app as { license?: { active?: unknown } } | undefined;
  if (app?.license?.active === true) return unknown();

  try {
    const raw = await env.KV_FEATURE_FLAGS.get(`license-notice:${FULL_APP_ID}:${environment}:${fit.cloudId}`);
    if (!raw) return unknown();
    const record: unknown = JSON.parse(raw);
    if (!validRecord(record, Date.now())) return unknown();
    return json({ state: 'legacy_free', checkedAt: record.checkedAt, expiresAt: record.expiresAt }, { headers: NO_STORE });
  } catch {
    // A failed read says nothing about the installation's license status.
    return unknown();
  }
}

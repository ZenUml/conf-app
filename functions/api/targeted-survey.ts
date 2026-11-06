import type { ForgeRequestContext, ForgeRequestData } from '../utils/authenticate';
import { json } from '../OkResponse';

interface Env {
  SPACE_LICENSE_KV: KVNamespace;
  DB: D1Database;
}

const FULL_APP_ID = 'd9e4002b-120b-426b-834b-402a4a5adce7';
const LITE_APP_ID = '8ad26115-211f-4216-971b-0540f606303d';
const ACTIVE_KEY = 'targeted-survey:active';
const LEASE_MS = 15_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPTION_IDS = ['performance', 'editing', 'display', 'export', 'missing_feature', 'other'] as const;
const OPTION_SET = new Set<string>(OPTION_IDS);

interface SurveyConfig {
  uuid: string;
  revision: number;
  enabled: boolean;
  products: Array<'full' | 'lite'>;
  cloudId: string;
  accountId: string;
  startsAt: string;
  expiresAt: string;
  title: string;
  question: string;
  options: Array<{ id: string; label: string }>;
}

const NO_STORE = { 'cache-control': 'no-store' };

function identity(fit: ForgeRequestContext | undefined): fit is ForgeRequestContext & {
  cloudId: string; accountId: string; forgeAppId: string;
} {
  return !!fit && (fit.forgeAppId === FULL_APP_ID || fit.forgeAppId === LITE_APP_ID)
    && typeof fit.cloudId === 'string' && fit.cloudId.length > 0
    && typeof fit.accountId === 'string' && fit.accountId.length > 0;
}

function parseConfig(value: unknown): SurveyConfig | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Record<string, unknown>;
  if (typeof c.uuid !== 'string' || !UUID.test(c.uuid)
    || !Number.isSafeInteger(c.revision) || Number(c.revision) < 1
    || c.enabled !== true
    || !Array.isArray(c.products) || c.products.length < 1 || c.products.length > 2
    || c.products.some((p) => p !== 'full' && p !== 'lite')
    || new Set(c.products).size !== c.products.length
    || typeof c.cloudId !== 'string' || !c.cloudId
    || typeof c.accountId !== 'string' || !c.accountId
    || typeof c.startsAt !== 'string' || typeof c.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(c.startsAt)) || !Number.isFinite(Date.parse(c.expiresAt))
    || typeof c.title !== 'string' || !c.title.trim() || c.title.length > 120
    || typeof c.question !== 'string' || !c.question.trim() || c.question.length > 240
    || !Array.isArray(c.options) || c.options.length === 0 || c.options.length > OPTION_IDS.length
    || c.options.some((o) => !o || typeof o !== 'object'
      || typeof o.id !== 'string' || !OPTION_SET.has(o.id)
      || typeof o.label !== 'string' || !o.label.trim() || o.label.length > 80)
    || new Set(c.options.map((o) => o.id)).size !== c.options.length) return null;
  return c as unknown as SurveyConfig;
}

async function eligible(env: Env, fit: ForgeRequestContext, excludeTerminal = false): Promise<SurveyConfig | null> {
  if (!identity(fit) || !env.SPACE_LICENSE_KV || !env.DB) return null;
  const raw = await env.SPACE_LICENSE_KV.get(ACTIVE_KEY);
  const survey = parseConfig(raw ? JSON.parse(raw) : null);
  const product = fit.forgeAppId === FULL_APP_ID ? 'full' : 'lite';
  if (!survey || !survey.products.includes(product)
    || survey.cloudId !== fit.cloudId || survey.accountId !== fit.accountId) return null;
  const now = Date.now();
  if (now < Date.parse(survey.startsAt) || now >= Date.parse(survey.expiresAt)) return null;
  // Do not show a form that cannot be stored. A storage failure is treated as
  // no eligible survey by callers; the response never leaks target metadata.
  await env.DB.prepare('SELECT id FROM TargetedSurveyResponse LIMIT 1').first();
  await env.DB.prepare('SELECT claimToken FROM TargetedSurveyLease LIMIT 1').first();
  if (excludeTerminal) {
    const terminal = await env.DB.prepare(`
      SELECT terminal FROM TargetedSurveyLease
      WHERE surveyUuid = ?1 AND surveyRevision = ?2 AND cloudId = ?3 AND accountId = ?4
    `).bind(survey.uuid, survey.revision, fit.cloudId, fit.accountId).first<{ terminal: string | null }>();
    if (terminal?.terminal) return null;
    const response = await env.DB.prepare(`
      SELECT id FROM TargetedSurveyResponse
      WHERE surveyUuid = ?1 AND surveyRevision = ?2 AND cloudId = ?3 AND accountId = ?4
    `).bind(survey.uuid, survey.revision, fit.cloudId, fit.accountId).first();
    if (response) return null;
  }
  return survey;
}

export const onRequestGet: PagesFunction<Env, string, ForgeRequestData> = async ({ env, data }) => {
  if (!identity(data.forgeContext)) return json({ survey: null }, { status: 200, headers: NO_STORE });
  try {
    const survey = await eligible(env, data.forgeContext, true);
    return json({ survey: survey ? {
      uuid: survey.uuid,
      revision: survey.revision,
      expiresAt: survey.expiresAt,
      title: survey.title,
      question: survey.question,
      options: survey.options.map(({ id, label }) => ({ id, label })),
    } : null }, { status: 200, headers: NO_STORE });
  } catch {
    return json({ survey: null }, { status: 503, headers: NO_STORE });
  }
};

/** Atomic claim or reclaim. A live lease and a terminal outcome cannot be stolen. */
export const onRequestPut: PagesFunction<Env, string, ForgeRequestData> = async ({ request, env, data }) => {
  const fit = data.forgeContext;
  if (!identity(fit)) return json({ claimed: false }, { status: 404, headers: NO_STORE });
  let survey: SurveyConfig | null;
  try { survey = await eligible(env, fit); }
  catch { return json({ claimed: false }, { status: 503, headers: NO_STORE }); }
  if (!survey) return json({ claimed: false }, { status: 404, headers: NO_STORE });
  let body: any;
  try {
    const raw = await request.text();
    if (raw.length > 1024) return json({ claimed: false }, { status: 413, headers: NO_STORE });
    body = JSON.parse(raw);
  } catch { return json({ claimed: false }, { status: 400, headers: NO_STORE }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || body.surveyUuid !== survey.uuid || body.revision !== survey.revision) {
    return json({ claimed: false }, { status: 400, headers: NO_STORE });
  }
  const claimToken = crypto.randomUUID();
  const now = Date.now();
  try {
    const result = await env.DB.prepare(`
      INSERT INTO TargetedSurveyLease
        (surveyUuid, surveyRevision, cloudId, accountId, forgeAppId, claimToken, expiresAtMs)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
      ON CONFLICT (surveyUuid, surveyRevision, cloudId, accountId) DO UPDATE SET
        forgeAppId = excluded.forgeAppId,
        claimToken = excluded.claimToken,
        expiresAtMs = excluded.expiresAtMs
      WHERE TargetedSurveyLease.terminal IS NULL AND TargetedSurveyLease.expiresAtMs <= ?8
    `).bind(survey.uuid, survey.revision, fit.cloudId, fit.accountId,
      fit.forgeAppId, claimToken, now + LEASE_MS, now).run();
    if (!result.success || (result.meta?.changes !== 0 && result.meta?.changes !== 1)) {
      return json({ claimed: false }, { status: 503, headers: NO_STORE });
    }
    return result.meta.changes === 1
      ? json({ claimed: true, claimToken, leaseMs: LEASE_MS }, { status: 200, headers: NO_STORE })
      : json({ claimed: false }, { status: 200, headers: NO_STORE });
  } catch { return json({ claimed: false }, { status: 503, headers: NO_STORE }); }
};

/** Confirm a live pending display, or dismiss a confirmed display. */
export const onRequestPatch: PagesFunction<Env, string, ForgeRequestData> = async ({ request, env, data }) => {
  const fit = data.forgeContext;
  if (!identity(fit)) return json({ ok: false }, { status: 404, headers: NO_STORE });
  let survey: SurveyConfig | null;
  try { survey = await eligible(env, fit); }
  catch { return json({ ok: false }, { status: 503, headers: NO_STORE }); }
  if (!survey) return json({ ok: false }, { status: 404, headers: NO_STORE });
  let body: any;
  try {
    const raw = await request.text();
    if (raw.length > 1024) return json({ ok: false }, { status: 413, headers: NO_STORE });
    body = JSON.parse(raw);
  } catch { return json({ ok: false }, { status: 400, headers: NO_STORE }); }
  if (!body || body.surveyUuid !== survey.uuid || body.revision !== survey.revision
    || typeof body.claimToken !== 'string' || !UUID.test(body.claimToken)
    || (body.action !== 'shown' && body.action !== 'dismiss')) return json({ ok: false }, { status: 400, headers: NO_STORE });
  const now = Date.now();
  try {
    const result = await env.DB.prepare(body.action === 'shown' ? `
      UPDATE TargetedSurveyLease SET terminal = 'shown'
      WHERE surveyUuid = ?1 AND surveyRevision = ?2 AND cloudId = ?3 AND accountId = ?4
        AND forgeAppId = ?5 AND claimToken = ?6 AND terminal IS NULL AND expiresAtMs > ?7
    ` : `
      UPDATE TargetedSurveyLease SET terminal = 'dismissed'
      WHERE surveyUuid = ?1 AND surveyRevision = ?2 AND cloudId = ?3 AND accountId = ?4
        AND forgeAppId = ?5 AND claimToken = ?6 AND terminal = 'shown'
    `).bind(...(body.action === 'shown'
      ? [survey.uuid, survey.revision, fit.cloudId, fit.accountId, fit.forgeAppId, body.claimToken, now]
      : [survey.uuid, survey.revision, fit.cloudId, fit.accountId, fit.forgeAppId, body.claimToken])).run();
    if (!result.success) return json({ ok: false }, { status: 503, headers: NO_STORE });
    if (result.meta?.changes !== 1) {
      const existing = await env.DB.prepare(`
        SELECT terminal FROM TargetedSurveyLease WHERE surveyUuid = ?1 AND surveyRevision = ?2
          AND cloudId = ?3 AND accountId = ?4 AND forgeAppId = ?5 AND claimToken = ?6
      `).bind(survey.uuid, survey.revision, fit.cloudId, fit.accountId, fit.forgeAppId,
        body.claimToken).first<{ terminal: string | null }>();
      if (body.action === 'shown' && existing?.terminal === 'shown'
        || body.action === 'dismiss' && (existing?.terminal === 'dismissed' || existing?.terminal === 'submitted')) {
        return json({ ok: true }, { status: 200, headers: NO_STORE });
      }
      return json({ ok: false }, { status: 409, headers: NO_STORE });
    }
    return json({ ok: true }, { status: 200, headers: NO_STORE });
  } catch { return json({ ok: false }, { status: 503, headers: NO_STORE }); }
};

export const onRequestPost: PagesFunction<Env, string, ForgeRequestData> = async ({ request, env, data }) => {
  const fit = data.forgeContext;
  if (!identity(fit)) return json({ ok: false, error: 'unavailable' }, { status: 404, headers: NO_STORE });
  let survey: SurveyConfig | null;
  try {
    survey = await eligible(env, fit);
  } catch {
    return json({ ok: false, error: 'unavailable', retryable: true }, { status: 503, headers: NO_STORE });
  }
  if (!survey) return json({ ok: false, error: 'unavailable' }, { status: 404, headers: NO_STORE });

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 4096) return json({ ok: false, error: 'response_too_large' }, { status: 413, headers: NO_STORE });
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: 'invalid_json' }, { status: 400, headers: NO_STORE });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ ok: false, error: 'invalid_response' }, { status: 400, headers: NO_STORE });
  }
  const response = body as Record<string, unknown>;
  const text = typeof response.text === 'string' ? response.text.trim() : '';
  const options = response.options;
  if (response.surveyUuid !== survey.uuid || response.revision !== survey.revision
    || typeof response.submissionId !== 'string' || !UUID.test(response.submissionId)
    || !Array.isArray(options) || options.length > survey.options.length
    || options.some((o) => typeof o !== 'string' || !survey.options.some((option) => option.id === o))
    || new Set(options).size !== options.length
    || (response.text !== undefined && typeof response.text !== 'string')
    || text.length > 2000 || (!text && options.length === 0)) {
    return json({ ok: false, error: 'invalid_response' }, { status: 400, headers: NO_STORE });
  }

  try {
    const owner = await env.DB.prepare(`
      SELECT claimToken, forgeAppId, terminal FROM TargetedSurveyLease
      WHERE surveyUuid = ?1 AND surveyRevision = ?2 AND cloudId = ?3 AND accountId = ?4
    `).bind(survey.uuid, survey.revision, fit.cloudId, fit.accountId)
      .first<{ claimToken: string; forgeAppId: string; terminal: string | null }>();
    if (!owner || owner.claimToken !== response.claimToken || owner.forgeAppId !== fit.forgeAppId
      || (owner.terminal !== 'shown' && owner.terminal !== 'submitted')) {
      return json({ ok: false, error: 'lease_lost' }, { status: 409, headers: NO_STORE });
    }
    const result = await env.DB.prepare(`
      INSERT OR IGNORE INTO TargetedSurveyResponse
      (surveyUuid, surveyRevision, cloudId, accountId, forgeAppId, submissionId, optionIds, responseText)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
      WHERE EXISTS (
        SELECT 1 FROM TargetedSurveyLease WHERE surveyUuid = ?1 AND surveyRevision = ?2
          AND cloudId = ?3 AND accountId = ?4 AND forgeAppId = ?5 AND claimToken = ?9
          AND terminal = 'shown'
      )
    `).bind(survey.uuid, survey.revision, fit.cloudId, fit.accountId, fit.forgeAppId,
      response.submissionId, JSON.stringify(options), text || null, response.claimToken).run();
    if (!result.success) throw new Error('D1 write failed');
    const saved = await env.DB.prepare(`
      SELECT submissionId FROM TargetedSurveyResponse WHERE surveyUuid = ?1 AND surveyRevision = ?2
        AND cloudId = ?3 AND accountId = ?4
    `).bind(survey.uuid, survey.revision, fit.cloudId, fit.accountId).first<{ submissionId: string }>();
    if (!saved || saved.submissionId !== response.submissionId) return json({ ok: false, error: 'lease_lost' }, { status: 409, headers: NO_STORE });
    await env.DB.prepare(`
      UPDATE TargetedSurveyLease SET terminal = 'submitted'
      WHERE surveyUuid = ?1 AND surveyRevision = ?2 AND cloudId = ?3 AND accountId = ?4
        AND forgeAppId = ?5 AND claimToken = ?6 AND terminal = 'shown'
    `).bind(survey.uuid, survey.revision, fit.cloudId, fit.accountId, fit.forgeAppId,
      response.claimToken).run();
    return json({ ok: true }, { status: 201, headers: NO_STORE });
  } catch {
    return json({ ok: false, error: 'storage_unavailable', retryable: true }, { status: 503, headers: NO_STORE });
  }
};

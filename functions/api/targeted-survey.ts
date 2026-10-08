import type { ForgeRequestContext, ForgeRequestData } from '../utils/authenticate';

interface Env {
  SPACE_LICENSE_KV: KVNamespace;
  DB: D1Database;
}

const FULL_APP_ID = 'd9e4002b-120b-426b-834b-402a4a5adce7';
const LITE_APP_ID = '8ad26115-211f-4216-971b-0540f606303d';
const ACTIVE_KEY = 'targeted-survey:active';
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

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

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

async function eligible(env: Env, fit: ForgeRequestContext, excludeClaimed = false): Promise<SurveyConfig | null> {
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
  await env.DB.prepare('SELECT id FROM TargetedSurveyClaim LIMIT 1').first();
  if (excludeClaimed) {
    const existing = await env.DB.prepare(`
      SELECT id FROM TargetedSurveyClaim WHERE surveyUuid = ?1 AND cloudId = ?2 AND accountId = ?3
    `).bind(survey.uuid, fit.cloudId, fit.accountId).first();
    if (existing) return null;
  }
  return survey;
}

export const onRequestGet: PagesFunction<Env, string, ForgeRequestData> = async ({ env, data }) => {
  if (!identity(data.forgeContext)) return json(200, { survey: null });
  try {
    const survey = await eligible(env, data.forgeContext, true);
    return json(200, { survey: survey ? {
      uuid: survey.uuid,
      revision: survey.revision,
      expiresAt: survey.expiresAt,
      title: survey.title,
      question: survey.question,
      options: survey.options.map(({ id, label }) => ({ id, label })),
    } : null });
  } catch {
    return json(503, { survey: null });
  }
};

/** Irreversible, atomic display claim shared by the Lite and Full backends. */
export const onRequestPut: PagesFunction<Env, string, ForgeRequestData> = async ({ request, env, data }) => {
  const fit = data.forgeContext;
  if (!identity(fit)) return json(404, { claimed: false });
  let survey: SurveyConfig | null;
  try {
    survey = await eligible(env, fit);
  } catch {
    return json(503, { claimed: false });
  }
  if (!survey) return json(404, { claimed: false });
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 1024) return json(413, { claimed: false });
    body = JSON.parse(raw);
  } catch {
    return json(400, { claimed: false });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || (body as any).surveyUuid !== survey.uuid || (body as any).revision !== survey.revision) {
    return json(400, { claimed: false });
  }
  const claimToken = crypto.randomUUID();
  try {
    const result = await env.DB.prepare(`
      INSERT OR IGNORE INTO TargetedSurveyClaim
      (surveyUuid, cloudId, accountId, forgeAppId, claimToken)
      VALUES (?1, ?2, ?3, ?4, ?5)
    `).bind(survey.uuid, fit.cloudId, fit.accountId, fit.forgeAppId, claimToken).run();
    if (!result.success || result.meta?.changes !== 1 && result.meta?.changes !== 0) {
      return json(503, { claimed: false });
    }
    return result.meta.changes === 1
      ? json(200, { claimed: true, claimToken })
      : json(200, { claimed: false });
  } catch {
    return json(503, { claimed: false });
  }
};

export const onRequestPost: PagesFunction<Env, string, ForgeRequestData> = async ({ request, env, data }) => {
  const fit = data.forgeContext;
  if (!identity(fit)) return json(404, { ok: false, error: 'unavailable' });
  let survey: SurveyConfig | null;
  try {
    survey = await eligible(env, fit);
  } catch {
    return json(503, { ok: false, error: 'unavailable', retryable: true });
  }
  if (!survey) return json(404, { ok: false, error: 'unavailable' });

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 4096) return json(413, { ok: false, error: 'response_too_large' });
    body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: 'invalid_json' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json(400, { ok: false, error: 'invalid_response' });
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
    return json(400, { ok: false, error: 'invalid_response' });
  }

  try {
    const claim = await env.DB.prepare(`
      SELECT claimToken, forgeAppId FROM TargetedSurveyClaim WHERE surveyUuid = ?1 AND cloudId = ?2 AND accountId = ?3
    `).bind(survey.uuid, fit.cloudId, fit.accountId).first<{ claimToken: string; forgeAppId: string }>();
    if (!claim || typeof response.claimToken !== 'string' || response.claimToken !== claim.claimToken
      || claim.forgeAppId !== fit.forgeAppId) {
      return json(404, { ok: false, error: 'unavailable' });
    }
  } catch {
    return json(503, { ok: false, error: 'storage_unavailable', retryable: true });
  }

  try {
    const result = await env.DB.prepare(`
      INSERT OR IGNORE INTO TargetedSurveyResponse
      (surveyUuid, surveyRevision, cloudId, accountId, forgeAppId, submissionId, optionIds, responseText)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    `).bind(survey.uuid, survey.revision, fit.cloudId, fit.accountId, fit.forgeAppId,
      response.submissionId, JSON.stringify(options), text || null).run();
    if (!result.success) throw new Error('D1 write failed');
    return json(201, { ok: true });
  } catch {
    // No response content or tenant identity is logged.
    return json(503, { ok: false, error: 'storage_unavailable', retryable: true });
  }
};

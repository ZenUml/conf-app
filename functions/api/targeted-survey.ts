import type { ForgeRequestContext, ForgeRequestData } from '../utils/authenticate';

interface Env {
  SPACE_LICENSE_KV: KVNamespace;
  DB: D1Database;
}

const FULL_APP_ID = 'd9e4002b-120b-426b-834b-402a4a5adce7';
const ACTIVE_KEY = 'targeted-survey:active';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPTION_IDS = ['performance', 'editing', 'display', 'export', 'missing_feature', 'other'] as const;
const OPTION_SET = new Set<string>(OPTION_IDS);

interface SurveyConfig {
  uuid: string;
  revision: number;
  enabled: boolean;
  product: 'full';
  cloudId: string;
  accountId: string;
  startsAt: string;
  expiresAt: string;
  title: string;
  question: string;
  options: string[];
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
  return !!fit && fit.forgeAppId === FULL_APP_ID
    && typeof fit.cloudId === 'string' && fit.cloudId.length > 0
    && typeof fit.accountId === 'string' && fit.accountId.length > 0;
}

function parseConfig(value: unknown): SurveyConfig | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Record<string, unknown>;
  if (typeof c.uuid !== 'string' || !UUID.test(c.uuid)
    || !Number.isSafeInteger(c.revision) || Number(c.revision) < 1
    || c.enabled !== true || c.product !== 'full'
    || typeof c.cloudId !== 'string' || !c.cloudId
    || typeof c.accountId !== 'string' || !c.accountId
    || typeof c.startsAt !== 'string' || typeof c.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(c.startsAt)) || !Number.isFinite(Date.parse(c.expiresAt))
    || typeof c.title !== 'string' || !c.title.trim() || c.title.length > 120
    || typeof c.question !== 'string' || !c.question.trim() || c.question.length > 240
    || !Array.isArray(c.options) || c.options.length === 0 || c.options.length > OPTION_IDS.length
    || c.options.some((o) => typeof o !== 'string' || !OPTION_SET.has(o))
    || new Set(c.options).size !== c.options.length) return null;
  return c as unknown as SurveyConfig;
}

async function eligible(env: Env, fit: ForgeRequestContext): Promise<SurveyConfig | null> {
  if (!identity(fit) || !env.SPACE_LICENSE_KV || !env.DB) return null;
  const raw = await env.SPACE_LICENSE_KV.get(ACTIVE_KEY);
  const survey = parseConfig(raw ? JSON.parse(raw) : null);
  if (!survey || survey.cloudId !== fit.cloudId || survey.accountId !== fit.accountId) return null;
  const now = Date.now();
  if (now < Date.parse(survey.startsAt) || now >= Date.parse(survey.expiresAt)) return null;
  // Do not show a form that cannot be stored. A storage failure is treated as
  // no eligible survey by callers; the response never leaks target metadata.
  await env.DB.prepare('SELECT id FROM TargetedSurveyResponse LIMIT 1').first();
  return survey;
}

export const onRequestGet: PagesFunction<Env, string, ForgeRequestData> = async ({ env, data }) => {
  if (!identity(data.forgeContext)) return json(200, { survey: null });
  try {
    const survey = await eligible(env, data.forgeContext);
    return json(200, { survey: survey ? {
      uuid: survey.uuid,
      revision: survey.revision,
      expiresAt: survey.expiresAt,
      title: survey.title,
      question: survey.question,
      options: survey.options,
    } : null });
  } catch {
    return json(503, { survey: null });
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
    || options.some((o) => typeof o !== 'string' || !survey.options.includes(o))
    || new Set(options).size !== options.length
    || (response.text !== undefined && typeof response.text !== 'string')
    || text.length > 2000 || (!text && options.length === 0)) {
    return json(400, { ok: false, error: 'invalid_response' });
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

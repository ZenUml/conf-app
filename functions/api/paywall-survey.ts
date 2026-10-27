import { getAuthorizationHeader } from '../utils/requestUtils';
import { validateContextToken } from '../utils/authenticate';
import { captureError } from '../utils/sentry';
// Same transform the macro-count snapshots use (URL or bare host -> bare
// Confluence subdomain). Imported rather than re-spelled: a fourth local copy
// is how one tenant ends up in two buckets.
import { normalizeClientDomain } from '../metrics-cache/snapshot/common';
import { spaceLicenseKey, upsertSpaceLicense, type SpaceLicenseRecord } from './space-license';

interface Env {
  DB: D1Database;
  SPACE_LICENSE_KV: KVNamespace;
  ALLOWED_FORGE_APP_IDS?: string;
}

/**
 * What the automatic license write did. Mirrors `PaywallSurveyGrant` in
 * src/utils/analytics/catalog.ts — duplicated rather than imported because
 * functions/ and src/ are separate builds (the same reason analyticsTypes.ts
 * duplicates the event catalog). Keep the two in sync.
 *
 * `none` is this endpoint's own extra value: a partial save grants nothing.
 */
export type SurveyGrant = 'none' | 'granted' | 'existing' | 'already_granted' | 'error';

export interface PaywallSurveyApiResponse {
  ok: boolean;
  responseId?: string;
  submitted?: boolean;
  grant?: SurveyGrant;
  expiresAt?: string;
  error?: string;
  message?: string;
  /** Which body field failed validation — one name, never the offending value. */
  field?: string;
  /** Completeness failures on submit: every missing or invalid answer at once. */
  fields?: string[];
}

// The reward: 15 days of user-scoped editing on the space they were blocked
// on. One per user per space, ever — see grantSurveyLicense.
const REWARD_DAYS = 15;
// Every survey-issued grant is stamped with this prefix so a later survey can
// recognise its own previous reward without a second KV index. Support grants
// (`support:*`) and Stripe writes are deliberately NOT matched by it.
const SURVEY_ACTIVATED_BY_PREFIX = 'survey:';
const SURVEY_ACTIVATED_BY = 'survey:pricing-15d';

const MAX_SPACE_KEY_CHARS = 255;
const MAX_APP_VERSION_CHARS = 64;
const MAX_COMMENT_CHARS = 500;
const MAX_MACRO_COUNT = 1_000_000;
const MAX_PRICE_USD = 1_000_000;

// Lowercase UUID v4, exactly as crypto.randomUUID() emits it. The id is minted
// by the client so partial saves can converge on one row; pinning the shape
// keeps it from becoming a free-text key.
const RESPONSE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const ROLES = ['space_admin', 'editor', 'site_admin', 'other'] as const;
const UNITS = ['per_space_year', 'per_user_month', 'per_active_author', 'per_diagram'] as const;
const BLOCKERS = ['budget', 'admin_approval', 'procurement', 'no_owner', 'other'] as const;

type Role = (typeof ROLES)[number];
type Unit = (typeof UNITS)[number];
type Blocker = (typeof BLOCKERS)[number];

/** The four Van Westendorp prices, in the order they must be non-decreasing. */
const PRICE_FIELDS = ['priceTooCheap', 'priceBargain', 'priceExpensive', 'priceTooExpensive'] as const;
type PriceField = (typeof PRICE_FIELDS)[number];

interface SurveyAnswers {
  role: Role | null;
  priceTooCheap: number | null;
  priceBargain: number | null;
  priceExpensive: number | null;
  priceTooExpensive: number | null;
  unitMost: Unit | null;
  unitLeast: Unit | null;
  blocker: Blocker | null;
  comment: string | null;
}

interface SurveyRequest {
  responseId: string;
  spaceKey: string;
  macroCount: number | null;
  appVersion: string | null;
  answers: SurveyAnswers;
  submitted: boolean;
}

/** A validation failure carrying the body field that caused it. */
class BodyError extends Error {
  constructor(readonly field: string) {
    super(`invalid_body:${field}`);
  }
}

/** Forge invokeRemote requires valid JSON + application/json for every status. */
function jsonResponse(status: number, body: PaywallSurveyApiResponse): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Never cached: the response reports a license write, and it varies by
      // the caller's accountId.
      'Cache-Control': 'no-store',
    },
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string
): T | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new BodyError(field);
  return value as T;
}

function optionalInteger(value: unknown, max: number, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) {
    throw new BodyError(field);
  }
  return value;
}

/**
 * Strict body validation. Anything unexpected is a 400 naming the field —
 * never a coerced value, because a coerced price silently corrupts the only
 * research output this feature exists to produce.
 */
export function parseSurveyRequest(raw: unknown): SurveyRequest {
  if (!isPlainObject(raw)) throw new BodyError('body');

  const responseId = raw.responseId;
  if (typeof responseId !== 'string' || !RESPONSE_ID_RE.test(responseId)) {
    throw new BodyError('responseId');
  }

  const spaceKey = raw.spaceKey;
  if (typeof spaceKey !== 'string' || spaceKey.length < 1 || spaceKey.length > MAX_SPACE_KEY_CHARS) {
    throw new BodyError('spaceKey');
  }

  const macroCount = optionalInteger(raw.macroCount, MAX_MACRO_COUNT, 'macroCount');

  let appVersion: string | null = null;
  if (raw.appVersion !== undefined && raw.appVersion !== null) {
    if (typeof raw.appVersion !== 'string' || raw.appVersion.length > MAX_APP_VERSION_CHARS) {
      throw new BodyError('appVersion');
    }
    appVersion = raw.appVersion;
  }

  if (typeof raw.submitted !== 'boolean') throw new BodyError('submitted');
  if (!isPlainObject(raw.answers)) throw new BodyError('answers');
  const a = raw.answers;

  let comment: string | null = null;
  if (a.comment !== undefined && a.comment !== null) {
    if (typeof a.comment !== 'string' || a.comment.length > MAX_COMMENT_CHARS) {
      throw new BodyError('answers.comment');
    }
    comment = a.comment;
  }

  return {
    responseId,
    spaceKey,
    macroCount,
    appVersion,
    submitted: raw.submitted,
    answers: {
      role: optionalEnum(a.role, ROLES, 'answers.role'),
      priceTooCheap: optionalInteger(a.priceTooCheap, MAX_PRICE_USD, 'answers.priceTooCheap'),
      priceBargain: optionalInteger(a.priceBargain, MAX_PRICE_USD, 'answers.priceBargain'),
      priceExpensive: optionalInteger(a.priceExpensive, MAX_PRICE_USD, 'answers.priceExpensive'),
      priceTooExpensive: optionalInteger(a.priceTooExpensive, MAX_PRICE_USD, 'answers.priceTooExpensive'),
      unitMost: optionalEnum(a.unitMost, UNITS, 'answers.unitMost'),
      unitLeast: optionalEnum(a.unitLeast, UNITS, 'answers.unitLeast'),
      blocker: optionalEnum(a.blocker, BLOCKERS, 'answers.blocker'),
      comment,
    },
  };
}

/**
 * Completeness gate for a final submit. Returns every offending field at once
 * so the UI can mark them all rather than walk the user round one at a time.
 *
 * The price battery only means anything monotonic: too cheap <= bargain <=
 * expensive <= too expensive. A crossed pair is not a cheap answer, it is an
 * unusable one, so it fails here instead of polluting the corpus. The two unit
 * questions must differ for the same reason — "most and least preferred are
 * the same" carries no preference.
 */
export function findIncompleteFields(answers: SurveyAnswers): string[] {
  const fields: string[] = [];
  if (!answers.role) fields.push('role');

  const prices = PRICE_FIELDS.map((field) => answers[field]);
  PRICE_FIELDS.forEach((field, i) => {
    if (prices[i] === null) fields.push(field);
  });
  if (prices.every((price): price is number => price !== null)) {
    for (let i = 1; i < prices.length; i += 1) {
      if (prices[i] < prices[i - 1]) fields.push(PRICE_FIELDS[i] as PriceField);
    }
  }

  if (!answers.unitMost) fields.push('unitMost');
  if (!answers.unitLeast) fields.push('unitLeast');
  if (answers.unitMost && answers.unitLeast && answers.unitMost === answers.unitLeast) {
    fields.push('unitLeast');
  }
  if (!answers.blocker) fields.push('blocker');

  return [...new Set(fields)];
}

/** End of the Nth UTC day from now, matching the support grants' convention. */
export function rewardExpiresAt(now: Date, days: number): string {
  const expiry = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days, 23, 59, 59, 0)
  );
  return expiry.toISOString();
}

interface ExistingRow {
  cloudId: string;
  userAccountId: string;
  submitted: number;
}

async function readExistingRow(db: D1Database, responseId: string): Promise<ExistingRow | null> {
  const row = await db
    .prepare('SELECT cloudId, userAccountId, submitted FROM PaywallSurveyResponse WHERE responseId = ?1')
    .bind(responseId)
    .first<ExistingRow>();
  return row ?? null;
}

/**
 * One row per responseId. Answers are written wholesale on every save — the
 * client sends the full current state as the user types, so a cleared answer
 * must land as NULL rather than keeping the previous keystroke's value.
 *
 * cloudId, userAccountId and createdAt are deliberately absent from the UPDATE
 * clause: identity is fixed at creation (a mismatch is a 403 before we get
 * here) and the first-seen time is what makes an abandoned survey datable.
 */
async function saveRow(
  db: D1Database,
  input: SurveyRequest & { cloudId: string; clientDomain: string | null; accountId: string; now: string }
): Promise<void> {
  const { answers } = input;
  await db
    .prepare(
      `INSERT INTO PaywallSurveyResponse (
        responseId, cloudId, clientDomain, spaceKey, userAccountId, macroCount, appVersion,
        role, priceTooCheap, priceBargain, priceExpensive, priceTooExpensive,
        unitMost, unitLeast, blocker, comment, submitted, createdAt, updatedAt
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
      ON CONFLICT(responseId) DO UPDATE SET
        clientDomain = excluded.clientDomain,
        spaceKey = excluded.spaceKey,
        macroCount = excluded.macroCount,
        appVersion = excluded.appVersion,
        role = excluded.role,
        priceTooCheap = excluded.priceTooCheap,
        priceBargain = excluded.priceBargain,
        priceExpensive = excluded.priceExpensive,
        priceTooExpensive = excluded.priceTooExpensive,
        unitMost = excluded.unitMost,
        unitLeast = excluded.unitLeast,
        blocker = excluded.blocker,
        comment = excluded.comment,
        submitted = excluded.submitted,
        updatedAt = excluded.updatedAt`
    )
    .bind(
      input.responseId,
      input.cloudId,
      input.clientDomain,
      input.spaceKey,
      input.accountId,
      input.macroCount,
      input.appVersion,
      answers.role,
      answers.priceTooCheap,
      answers.priceBargain,
      answers.priceExpensive,
      answers.priceTooExpensive,
      answers.unitMost,
      answers.unitLeast,
      answers.blocker,
      answers.comment,
      input.submitted ? 1 : 0,
      input.now,
      input.now
    )
    .run();
}

async function saveGrantOutcome(
  db: D1Database,
  responseId: string,
  grant: SurveyGrant,
  expiresAt: string | null,
  now: string
): Promise<void> {
  await db
    .prepare(
      'UPDATE PaywallSurveyResponse SET grantStatus = ?1, grantExpiresAt = ?2, updatedAt = ?3 WHERE responseId = ?4'
    )
    .bind(grant, expiresAt, now, responseId)
    .run();
}

/**
 * The reward, applied to the user-scoped key only — never the space-wide one,
 * which would hand a whole space free editing for one person's survey.
 *
 * Three outcomes, in this order:
 *   already_granted — this user already took a survey grant on this space. Once
 *                     per user per space, ever, whatever its status: otherwise
 *                     a lapsed reward could be re-earned by retaking the survey.
 *   existing        — an active grant already runs past the reward window (a
 *                     support extension, typically). Never shorten it.
 *   granted         — nothing in the way; write 15 days.
 */
async function grantSurveyLicense(
  kv: KVNamespace,
  args: { cloudId: string; spaceKey: string; accountId: string; responseId: string; newExpiresAt: string }
): Promise<{ grant: Exclude<SurveyGrant, 'none' | 'error'>; expiresAt: string }> {
  const key = spaceLicenseKey(args.cloudId, args.spaceKey, args.accountId);
  const raw = await kv.get(key);
  const existing = raw ? (JSON.parse(raw) as SpaceLicenseRecord) : null;

  if (existing?.activatedBy?.startsWith(SURVEY_ACTIVATED_BY_PREFIX)) {
    return { grant: 'already_granted', expiresAt: existing.expiresAt };
  }

  if (
    existing
    && existing.status === 'active'
    && new Date(existing.expiresAt) > new Date(args.newExpiresAt)
  ) {
    return { grant: 'existing', expiresAt: existing.expiresAt };
  }

  await upsertSpaceLicense(kv, {
    cloudId: args.cloudId,
    spaceKey: args.spaceKey,
    userAccountId: args.accountId,
    expiresAt: args.newExpiresAt,
    activatedBy: `${SURVEY_ACTIVATED_BY}:${args.responseId}`,
  });

  return { grant: 'granted', expiresAt: args.newExpiresAt };
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'method_not_allowed', message: 'Method Not Allowed' });
  }

  try {
    const jwt = getAuthorizationHeader(request);
    if (!jwt) {
      return jsonResponse(401, {
        ok: false,
        error: 'unauthorized',
        message: 'Missing or invalid Authorization header',
      });
    }

    if (!env.ALLOWED_FORGE_APP_IDS) {
      console.error('paywall-survey: ALLOWED_FORGE_APP_IDS is not set');
      return jsonResponse(500, { ok: false, error: 'server_configuration' });
    }
    if (!env.DB || !env.SPACE_LICENSE_KV) {
      console.error('paywall-survey: DB or SPACE_LICENSE_KV binding not configured');
      return jsonResponse(500, { ok: false, error: 'server_configuration' });
    }

    const payload = await validateContextToken(jwt, env.ALLOWED_FORGE_APP_IDS);

    // Identity comes from the verified token only. Taking any of it from the
    // body would let one user file answers — and claim a license — as another.
    const rawCloudId = payload.cloudId || payload.payload.context?.cloudId;
    const cloudId = typeof rawCloudId === 'string' && rawCloudId ? rawCloudId : undefined;
    if (!cloudId) {
      return jsonResponse(400, { ok: false, error: 'missing_context' });
    }

    const rawPrincipal = payload.payload.principal;
    const accountId = typeof rawPrincipal === 'string' && rawPrincipal ? rawPrincipal : undefined;
    if (!accountId) {
      return jsonResponse(401, { ok: false, error: 'missing_principal' });
    }

    const rawSiteUrl = payload.payload.context?.siteUrl;
    const clientDomain =
      typeof rawSiteUrl === 'string' && rawSiteUrl ? normalizeClientDomain(rawSiteUrl) || null : null;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { ok: false, error: 'invalid_body', field: 'body' });
    }

    let parsed: SurveyRequest;
    try {
      parsed = parseSurveyRequest(body);
    } catch (error) {
      if (error instanceof BodyError) {
        return jsonResponse(400, { ok: false, error: 'invalid_body', field: error.field });
      }
      throw error;
    }

    const existingRow = await readExistingRow(env.DB, parsed.responseId);
    if (existingRow && (existingRow.cloudId !== cloudId || existingRow.userAccountId !== accountId)) {
      // A guessed or replayed responseId from another tenant or another user.
      console.warn('paywall-survey: responseId belongs to another identity', {
        responseId: parsed.responseId,
      });
      return jsonResponse(403, { ok: false, error: 'forbidden' });
    }
    if (existingRow && existingRow.submitted === 1) {
      return jsonResponse(409, {
        ok: false,
        responseId: parsed.responseId,
        error: 'already_submitted',
      });
    }

    if (parsed.submitted) {
      const missing = findIncompleteFields(parsed.answers);
      if (missing.length > 0) {
        return jsonResponse(400, { ok: false, error: 'incomplete', fields: missing });
      }
    }

    const now = new Date();
    const nowIso = now.toISOString();
    await saveRow(env.DB, {
      ...parsed,
      cloudId,
      clientDomain,
      accountId,
      now: nowIso,
    });

    if (!parsed.submitted) {
      return jsonResponse(200, {
        ok: true,
        responseId: parsed.responseId,
        submitted: false,
        grant: 'none',
      });
    }

    const newExpiresAt = rewardExpiresAt(now, REWARD_DAYS);
    let outcome: { grant: Exclude<SurveyGrant, 'none' | 'error'>; expiresAt: string };
    try {
      outcome = await grantSurveyLicense(env.SPACE_LICENSE_KV, {
        cloudId,
        spaceKey: parsed.spaceKey,
        accountId,
        responseId: parsed.responseId,
        newExpiresAt,
      });
    } catch (error) {
      // The answers are already stored and immutable, so the reward is the only
      // thing lost here — record that on the row (best effort) so a failed
      // grant is recoverable from the table, then let the 500 surface it.
      try {
        await saveGrantOutcome(env.DB, parsed.responseId, 'error', null, nowIso);
      } catch (writeError) {
        console.error('paywall-survey: could not record the failed grant', writeError);
      }
      throw error;
    }

    await saveGrantOutcome(env.DB, parsed.responseId, outcome.grant, outcome.expiresAt, nowIso);

    return jsonResponse(200, {
      ok: true,
      responseId: parsed.responseId,
      submitted: true,
      grant: outcome.grant,
      expiresAt: outcome.expiresAt,
    });
  } catch (error) {
    // Deliberately no request detail in the log: the body carries free-text
    // comment and the token carries the account id, and neither belongs in
    // logs or Sentry.
    console.error('paywall-survey: request failed');
    captureError(error);
    return jsonResponse(500, { ok: false, error: 'internal_error', message: 'Internal Server Error' });
  }
};

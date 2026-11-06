import { getContext } from '@/model/globals/forgeGlobal';
import { callRemote } from '@/utils/requestUtil';
import { deriveUnplacedIdentity } from '@/utils/byline/unplacedMarker';
import { readUnplacedProperty } from '@/utils/byline/unplacedProperty';
import { isSurveyTerminal, surveyTerminalKey } from './ownership';

export interface PublicSurvey {
  uuid: string;
  revision: number;
  expiresAt: string;
  title: string;
  question: string;
  options: Array<{ id: string; label: string }>;
}

export interface TargetedSurveyCandidate {
  survey: PublicSurvey;
  terminalKey: string;
}
export type SurveyClaimResult = { claimToken: string; leaseMs: number; startedAt: number } | {
  reason: 'already_claimed' | 'unavailable' | 'invalid_response';
};

const OPTION_IDS = new Set(['performance', 'editing', 'display', 'export', 'missing_feature', 'other']);
const LOOKUP_TIMEOUT_MS = 2500;

async function withinDeadline<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

function validSurvey(value: unknown): value is PublicSurvey {
  if (!value || typeof value !== 'object') return false;
  const s = value as PublicSurvey;
  return typeof s.uuid === 'string' && /^[0-9a-f-]{36}$/i.test(s.uuid)
    && Number.isSafeInteger(s.revision) && s.revision > 0
    && typeof s.expiresAt === 'string' && Date.parse(s.expiresAt) > Date.now()
    && typeof s.title === 'string' && typeof s.question === 'string'
    && Array.isArray(s.options) && s.options.length > 0
    && s.options.every((o) => !!o && typeof o.id === 'string' && OPTION_IDS.has(o.id)
      && typeof o.label === 'string' && o.label.length > 0 && o.label.length <= 80);
}

/** Called only after the existing synchronous page-banner priorities say none. */
export async function loadTargetedSurvey(): Promise<TargetedSurveyCandidate | null> {
  if (import.meta.env.PRODUCT_TYPE !== 'full' && import.meta.env.PRODUCT_TYPE !== 'lite') return null;
  try {
    const context = await getContext();
    if (typeof context?.cloudId !== 'string' || !context.cloudId
      || typeof context?.accountId !== 'string' || !context.accountId) return null;

    // invokeRemote is not abortable. A timed-out result is ignored; only this
    // race's winner is allowed to mount a banner.
    const raw = await withinDeadline(callRemote('/api/targeted-survey', 'GET'), LOOKUP_TIMEOUT_MS);
    if (!raw) return null;
    const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!validSurvey(body?.survey)) return null;
    const survey = body.survey;
    const terminalKey = surveyTerminalKey(context.cloudId, context.accountId, survey.uuid, survey.revision);
    if (isSurveyTerminal(terminalKey)) return null;

    // This second pageBanner module is gated by a Confluence property, not by
    // decidePageBanner(). It can mount independently, so an uncertain property
    // read suppresses this lower-priority survey.
    const unplacedIdentity = deriveUnplacedIdentity();
    if (!unplacedIdentity) return null;
    const property = await withinDeadline(readUnplacedProperty(unplacedIdentity.pageId), LOOKUP_TIMEOUT_MS);
    if (property?.status !== 'absent') return null;
    return { survey, terminalKey };
  } catch {
    return null;
  }
}

/** The server's unique D1 constraint arbitrates across Forge app origins. */
export async function requestSurveyClaim(survey: PublicSurvey): Promise<SurveyClaimResult> {
  try {
    const startedAt = Date.now();
    const raw = await withinDeadline(callRemote('/api/targeted-survey', 'PUT', {
      surveyUuid: survey.uuid,
      revision: survey.revision,
    }), LOOKUP_TIMEOUT_MS);
    if (!raw) return { reason: 'unavailable' };
    const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (body?.claimed === false) return { reason: 'already_claimed' };
    if (body?.claimed === true && typeof body.claimToken === 'string'
      && /^[0-9a-f-]{36}$/i.test(body.claimToken)
      && Number.isInteger(body.leaseMs) && body.leaseMs > 0) return { claimToken: body.claimToken, leaseMs: body.leaseMs, startedAt };
    return { reason: 'invalid_response' };
  } catch {
    return { reason: 'unavailable' };
  }
}

/** Confirm visible ownership or persist the recipient's dismissal. */
export async function updateSurveyClaim(
  survey: PublicSurvey, claimToken: string, action: 'shown' | 'dismiss',
): Promise<boolean> {
  try {
    const raw = await withinDeadline(callRemote('/api/targeted-survey', 'PATCH', {
      surveyUuid: survey.uuid, revision: survey.revision, claimToken, action,
    }), LOOKUP_TIMEOUT_MS);
    if (!raw) return false;
    const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return body?.ok === true;
  } catch { return false; }
}

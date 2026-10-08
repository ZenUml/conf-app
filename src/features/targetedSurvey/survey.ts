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
  if (import.meta.env.PRODUCT_TYPE !== 'full') return null;
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
    const terminalKey = surveyTerminalKey(context.cloudId, context.accountId, survey.uuid);
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

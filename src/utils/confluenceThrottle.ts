/**
 * Confluence rate limiting (HTTP 429) in the browser's requestConfluence
 * traffic: one per-site circuit breaker, plus bounded retry for save-path
 * requests.
 *
 * Why. In 2026-10-18..24 one Lite tenant produced 198 of the fleet's 228
 * explicit 429s. They came in its working hours, in step with its
 * ~1,000–2,000 macro views an hour, and they hit both optional per-view work
 * (the PNG backfill's attachments GET) and users' saves (POST
 * /wiki/api/v2/custom-content, and the save's existence-check GET), which
 * failed on the first 429. Atlassian answers 429 with a `Retry-After` header
 * (seconds) and recommends exponential backoff with jitter that honours it
 * (developer.atlassian.com/cloud/confluence/rate-limiting).
 *
 * What.
 * - Every 429 that `forgeRequest` sees opens (or extends) a cooldown for the
 *   site (cloudId). It lives in localStorage, because every macro iframe on a
 *   site shares the origin, so one iframe's 429 makes all of them stand down.
 *   When storage is blocked it falls back to this iframe's memory.
 * - `priority: 'background'` requests (optional work: attachment backfill,
 *   related-diagram lookups) throw `ConfluenceThrottledError` without sending
 *   while the cooldown runs, so the site's remaining budget goes to saves.
 * - `priority: 'user'` requests (the save path) retry a 429 with exponential
 *   backoff and jitter, honouring Retry-After, within a fixed attempt count
 *   and a wait budget that one save's requests share. A 429 means the request was refused, not processed, so even
 *   a POST is safe to resend. When the budget runs out, the 429 response goes
 *   to the caller exactly as before, so the editor's save-failed handling is
 *   unchanged.
 * - Requests without a priority behave exactly as before, except that their
 *   429s also feed the breaker.
 */
import forgeGlobal from '@/model/globals/forgeGlobal';
import { templateUrl } from '@/utils/forgeRequestError';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import type { Surface } from '@/utils/analytics/catalog';

export type RequestPriority = 'user' | 'background';

const COOLDOWN_KEY_PREFIX = 'zenuml:confluence:throttled-until:';
/** Used when the 429 carries no usable Retry-After header. */
export const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;
/** Upper bound, so a bad Retry-After value cannot stop background work for long. */
export const MAX_COOLDOWN_MS = 60 * 60 * 1000;
/** Lower bound: a `Retry-After: 0` would not reduce any traffic. */
export const MIN_COOLDOWN_MS = 30 * 1000;

/** Retries after the first 429 on a save-path request. */
export const MAX_SAVE_RETRIES = 3;
/** First backoff without Retry-After; doubles each retry (2 s, 4 s, 8 s before jitter). */
export const SAVE_RETRY_BASE_DELAY_MS = 2000;
/**
 * Total time a save may spend waiting between retries. Kept short so a save
 * the site cannot serve soon still fails within seconds and the editor stays
 * open for the user to retry, rather than looking hung. A Retry-After longer
 * than what is left is not waited for at all.
 *
 * Shared by every user-priority request in this iframe within
 * SAVE_RETRY_WINDOW_MS, not granted per request: one save makes up to five
 * Confluence requests (existence GET, page ADF GET, PUT, and on a version
 * conflict a re-GET and a second PUT), and a per-request budget would let a
 * single save wait several times over.
 */
export const SAVE_RETRY_BUDGET_MS = 20_000;
/** How long the shared save budget lasts, from the first wait drawn on it; then it starts afresh. */
export const SAVE_RETRY_WINDOW_MS = 60_000;

export type KvStore = Pick<Storage, 'getItem' | 'setItem'>;

const memoryDeadlines = new Map<string, number>();
/** The shared save retry budget: when its window opened, and how much of it is spent. */
let saveBudget = { windowStart: 0, spentMs: 0 };

function saveBudgetLeftMs(now: number): number {
  if (now - saveBudget.windowStart > SAVE_RETRY_WINDOW_MS) saveBudget = { windowStart: now, spentMs: 0 };
  return SAVE_RETRY_BUDGET_MS - saveBudget.spentMs;
}
/** Endpoints this iframe already reported as deferred, by the cooldown deadline they saw. */
const reportedDeferrals = new Map<string, number>();

/**
 * A background request that was not sent because the site is in a 429
 * cooldown. `status` is 429 so callers that branch on the HTTP status treat it
 * as the rate limit it stands for.
 */
export class ConfluenceThrottledError extends Error {
  readonly status = 429;
  readonly deferred = true;
  readonly endpoint: string;
  readonly cooldownRemainingMs: number;

  constructor(endpoint: string, cooldownRemainingMs: number) {
    super(`Confluence rate-limited this site; deferred ${endpoint} for ${Math.ceil(cooldownRemainingMs / 1000)}s`);
    this.name = 'ConfluenceThrottledError';
    this.endpoint = endpoint;
    this.cooldownRemainingMs = cooldownRemainingMs;
  }
}

/**
 * Where this iframe runs, from the Forge context. Not from the priority: a
 * user-priority save also comes from the viewer's in-place rename.
 */
function currentSurface(): Surface {
  const ext = forgeGlobal.forgeContext?.extension;
  if (ext?.modal) return 'modal';
  return ext?.macro?.isConfiguring || ext?.macro?.isInserting ? 'editor' : 'viewer';
}

function siteKey(): string {
  return forgeGlobal.forgeContext?.cloudId ?? 'unknown';
}

function safeStore(store?: KvStore): KvStore | null {
  try {
    return store ?? window.localStorage;
  } catch {
    return null; // storage blocked (third-party storage settings, non-browser test env)
  }
}

function readDeadline(site: string, store?: KvStore): number {
  let stored = 0;
  const s = safeStore(store);
  if (s) {
    try {
      const value = Number(s.getItem(COOLDOWN_KEY_PREFIX + site));
      if (Number.isFinite(value)) stored = value;
    } catch {
      // fall back to memory
    }
  }
  return Math.max(stored, memoryDeadlines.get(site) ?? 0);
}

/**
 * Milliseconds until the Retry-After header allows another request: either
 * delta-seconds (`120`) or an HTTP date. Undefined when absent or unparseable.
 */
export function parseRetryAfterMs(header: string | null | undefined, now = Date.now()): number | undefined {
  const value = header?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

export interface CooldownStart {
  cooldownMs: number;
  source: 'header' | 'default';
  /** The header's value in seconds, before clamping. Only when `source` is 'header'. */
  retryAfterS?: number;
}

/** Open (or extend) this site's cooldown after a 429. Never throws. */
export function noteConfluenceThrottled(
  retryAfterHeader?: string | null,
  now = Date.now(),
  store?: KvStore,
  site = siteKey(),
): CooldownStart {
  const fromHeader = parseRetryAfterMs(retryAfterHeader, now);
  const cooldownMs = fromHeader === undefined
    ? DEFAULT_COOLDOWN_MS
    : Math.min(MAX_COOLDOWN_MS, Math.max(MIN_COOLDOWN_MS, fromHeader));
  // Another iframe may already have set a later deadline; keep the later one.
  const until = Math.max(now + cooldownMs, readDeadline(site, store));
  memoryDeadlines.set(site, until);
  const s = safeStore(store);
  if (s) {
    try {
      s.setItem(COOLDOWN_KEY_PREFIX + site, String(until));
    } catch {
      // quota/blocked: the in-memory deadline still covers this iframe
    }
  }
  return fromHeader === undefined
    ? { cooldownMs, source: 'default' }
    : { cooldownMs, source: 'header', retryAfterS: Math.round(fromHeader / 1000) };
}

/** Milliseconds left in this site's cooldown; 0 when none is running. */
export function confluenceThrottleRemainingMs(now = Date.now(), store?: KvStore, site = siteKey()): number {
  // Capped: a deadline written by a skewed clock must not hold for longer.
  return Math.min(MAX_COOLDOWN_MS, Math.max(0, readDeadline(site, store) - now));
}

/**
 * Gate for optional background work. Returns the error to throw (or, for a
 * caller that is not a request, simply to return on) when the site is in a
 * cooldown, else undefined. Reports the deferral at most once per endpoint
 * per cooldown in this iframe.
 */
export function deferIfThrottled(
  endpoint: string,
  now = Date.now(),
  store?: KvStore,
  site = siteKey(),
): ConfluenceThrottledError | undefined {
  const remaining = confluenceThrottleRemainingMs(now, store, site);
  if (remaining <= 0) return undefined;
  const deadline = now + remaining;
  const reportKey = `${site} ${endpoint}`;
  if ((reportedDeferrals.get(reportKey) ?? 0) < deadline - 1000) {
    reportedDeferrals.set(reportKey, deadline);
    trackAnalyticsEvent('confluence_background_request_deferred', {
      feature_area: 'confluence',
      surface: currentSurface(),
      request_endpoint: endpoint,
      cooldown_remaining_ms: remaining,
    });
  }
  return new ConfluenceThrottledError(endpoint, remaining);
}

/**
 * Wait before retry `attempt` (0-based), or undefined when no retry fits the
 * remaining budget. Retry-After wins over the computed backoff; jitter
 * (×0.7–1.3, per Atlassian's guidance) keeps the site's iframes from retrying
 * in lockstep.
 */
export function saveRetryDelayMs(
  attempt: number,
  retryAfterHeader: string | null | undefined,
  budgetLeftMs: number,
  now = Date.now(),
  random: () => number = Math.random,
): number | undefined {
  if (attempt >= MAX_SAVE_RETRIES) return undefined;
  const fromHeader = parseRetryAfterMs(retryAfterHeader, now);
  const delay = fromHeader !== undefined
    ? fromHeader
    : Math.round(SAVE_RETRY_BASE_DELAY_MS * 2 ** attempt * (0.7 + 0.6 * random()));
  return delay <= budgetLeftMs ? delay : undefined;
}

export interface SendDeps {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Send a Confluence request through `send`, feeding every 429 into the
 * breaker and, for `priority: 'user'`, retrying it within the save budget.
 * Returns the last response, which is a 429 only when the retries ran out (or
 * the priority does not retry); the caller handles it as it always has.
 */
export async function sendWithThrottleHandling(
  send: () => Promise<Response>,
  request: { method: string; url: string; priority?: RequestPriority },
  deps: SendDeps = {},
): Promise<Response> {
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const endpoint = `${request.method.toUpperCase()} ${templateUrl(request.url)}`;
  let retries = 0;
  let waitedMs = 0;
  for (;;) {
    const response = await send();
    if (response.status !== 429) {
      if (retries > 0) reportRetried(endpoint, 'recovered', retries, waitedMs);
      return response;
    }
    const retryAfter = response.headers?.get?.('retry-after') ?? null;
    const cooldown = noteConfluenceThrottled(retryAfter, now());
    const delay = request.priority === 'user'
      ? saveRetryDelayMs(retries, retryAfter, saveBudgetLeftMs(now()), now(), deps.random)
      : undefined;
    trackAnalyticsEvent('confluence_request_throttled', {
      feature_area: 'confluence',
      surface: currentSurface(),
      request_endpoint: endpoint,
      request_priority: request.priority ?? 'default',
      http_status: 429,
      retry_after_source: cooldown.source,
      ...(cooldown.retryAfterS !== undefined ? { retry_after_s: cooldown.retryAfterS } : {}),
      cooldown_ms: cooldown.cooldownMs,
      will_retry: delay !== undefined,
    });
    if (delay === undefined) {
      if (retries > 0) reportRetried(endpoint, 'exhausted', retries, waitedMs);
      return response;
    }
    saveBudget.spentMs += delay;
    await sleep(delay);
    waitedMs += delay;
    retries += 1;
  }
}

function reportRetried(endpoint: string, outcome: 'recovered' | 'exhausted', retries: number, waitedMs: number) {
  trackAnalyticsEvent('confluence_request_retried', {
    feature_area: 'confluence',
    surface: currentSurface(),
    request_endpoint: endpoint,
    retry_outcome: outcome,
    retry_attempts: retries,
    retry_wait_ms: waitedMs,
  });
}

export function _resetForTesting(): void {
  memoryDeadlines.clear();
  reportedDeferrals.clear();
  saveBudget = { windowStart: 0, spentMs: 0 };
}

import { getLocalStorageKey, getLocalState } from '@/utils/window';
import forgeGlobal from '@/model/globals/forgeGlobal';

/** Base key; the stored key is tenant-scoped via getLocalStorageKey (see pendingKey). */
export const CSAT_PENDING_KEY = 'csatPending';

/** Base key for the per-account suppression record; tenant-scoped by getLocalState. */
export const CSAT_STATE_KEY = 'csat_state';

/** A fresh csatPending signal triggers the banner on the next page load. */
export const CSAT_PENDING_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Tenant-scoped storage key: `csatPending-<clientDomain>`, the SAME namespacing
 * the suppression state (csat_state) uses. Without it the raw global key would
 * leak across tenants sharing one browser — a save on tenant A would fire the
 * survey on tenant B, whose per-tenant suppression couldn't gate it. The editor
 * (writer) and pageBanner (reader) iframes both resolve the same domain because
 * each initializes the Forge context before reading/writing.
 */
function pendingKey(): string {
  return getLocalStorageKey(CSAT_PENDING_KEY);
}

/**
 * All csatPending helpers are best-effort: the survey must NEVER let a
 * localStorage failure (quota, disabled storage, partitioned cross-origin
 * iframe) propagate into the save/close path or strand the pageBanner frame.
 * On any failure we log and degrade — write becomes a no-op, read becomes
 * "not pending" — so the banner simply doesn't fire rather than breaking.
 */

/** Arm the CSAT banner after a successful save. */
export function markCsatPending(): void {
  try {
    localStorage.setItem(pendingKey(), String(Date.now()));
  } catch (e) {
    console.warn('[csat] failed to set csatPending', e);
  }
}

/** True if a fresh trigger is present. Reads are best-effort: failure → false. */
export function isCsatPendingFresh(now: number = Date.now()): boolean {
  try {
    const raw = localStorage.getItem(pendingKey());
    const ts = raw ? Number(raw) : 0;
    return !!(ts && now - ts < CSAT_PENDING_MAX_AGE_MS);
  } catch (e) {
    console.warn('[csat] failed to read csatPending', e);
    return false;
  }
}

/** Consume the trigger so it fires once. Best-effort: failure is swallowed. */
export function clearCsatPending(): void {
  try {
    localStorage.removeItem(pendingKey());
  } catch (e) {
    console.warn('[csat] failed to clear csatPending', e);
  }
}

/** One user's suppression record, as useCSATState writes it. */
interface CsatUserState {
  lastUpdated?: string | Date;
  /** Absent means suppressed forever; a legacy shape we still honour. */
  expires?: string | Date;
}
interface CsatLocalState {
  users: Record<string, CsatUserState>;
  lastUpdated: string | Date;
}

/** Fresh default each call — `users` is mutated in place by the writers. */
function defaultCsatState(): CsatLocalState {
  return { users: {}, lastUpdated: new Date() };
}

/**
 * Has THIS account opted out of the survey, and is that opt-out still in force?
 *
 * Split out from useCSATState so the banner's own gate and the priority cascade
 * ask ONE question of ONE record. They used to ask different ones: the cascade
 * knew only that a trigger had been armed (`csatPending`, fresh for 10 minutes)
 * and yielded the slot to CSAT on that alone, while the survey's real
 * eligibility — this record — was consulted for the first time inside
 * CsatBanner, asynchronously, after the yield was already spent. A user who had
 * dismissed CSAT in the past week therefore got neither banner for ten minutes
 * after every save: the unplaced notice stood down for a survey that closed
 * itself on mount. Delegating both sides here is what keeps them from drifting
 * apart again.
 *
 * Synchronous on purpose. The account id is the same one `_getCurrentUser()`
 * returns, read straight off the Forge context (forgeIndex resolves that before
 * any banner code runs), and the record is a plain localStorage read — so the
 * cascade can consult it without becoming async and without a request.
 *
 * Callers that already hold a resolved user pass its id via
 * `isCsatSuppressedForAccount`; the no-argument form reads the context itself.
 */
export function isCsatSuppressedForAccount(
  accountId: string | undefined,
  now: number = Date.now(),
): boolean {
  try {
    const localState: CsatLocalState = getLocalState(CSAT_STATE_KEY, defaultCsatState());
    // Indexed exactly as the writers index it, undefined id included: an id we
    // cannot resolve must read as "not suppressed" on BOTH sides rather than
    // silently suppressing (or silently yielding) on one of them.
    const userState = localState?.users?.[accountId as string];
    if (!userState) return false;
    return !userState.expires || now < new Date(userState.expires).getTime();
  } catch (e) {
    console.warn('[csat] failed to read csat_state', e);
    return false;
  }
}

/** Suppression for the account in the current Forge context. */
export function isCsatSuppressed(now: number = Date.now()): boolean {
  return isCsatSuppressedForAccount(forgeGlobal.forgeContext?.accountId, now);
}

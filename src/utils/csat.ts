import { getLocalStorageKey } from '@/utils/window';

/** Base key; the stored key is tenant-scoped via getLocalStorageKey (see pendingKey). */
export const CSAT_PENDING_KEY = 'csatPending';

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

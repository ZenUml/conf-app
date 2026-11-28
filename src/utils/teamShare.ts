import { getLocalStorageKey, getLocalState, setLocalState } from '@/utils/window';
import forgeGlobal from '@/model/globals/forgeGlobal';
import { isUsablePageId } from '@/utils/pageId';
import type ApWrapper2 from '@/model/ApWrapper2';

/**
 * "Share it with your team" prompt, shown once after a person's first diagram
 * on a small site. Two records, both tenant-scoped like the CSAT ones:
 *
 *  - `teamSharePending-<domain>`: written by the editor at save time, read by
 *    the page banner on the next view-mode load of THAT page. Fresh for 24 h.
 *  - `team_share_state-<domain>`: per-account "already shown", forever.
 *
 * Every helper is best-effort. The prompt must never fail a save or strand a
 * banner frame: on any storage or network failure it degrades to "no prompt".
 */

export const TEAM_SHARE_PENDING_KEY = 'teamSharePending';
export const TEAM_SHARE_STATE_KEY = 'team_share_state';
export const TEAM_SHARE_PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Prompt only on sites with at most this many diagrams (counting the new one). */
export const TEAM_SHARE_MAX_SITE_DIAGRAMS = 5;
/** Hard bound on the arming lookup so a slow search never delays a save. */
export const TEAM_SHARE_ARM_TIMEOUT_MS = 2500;

export interface TeamSharePending {
  ts: number;
  pageId: string;
  contentId: string;
  diagramTitle: string;
  /** Site diagram count at arm time, for the analytics bucket only. */
  siteDiagramCount: number;
}

function pendingKey(): string {
  return getLocalStorageKey(TEAM_SHARE_PENDING_KEY);
}

function productAllowed(): boolean {
  const p = import.meta.env.PRODUCT_TYPE;
  return p === 'lite' || p === 'full';
}

interface ShownState {
  users: Record<string, { shownAt?: string }>;
}

function defaultState(): ShownState {
  return { users: {} };
}

/** Has this account already been shown the prompt on this site? */
export function isTeamShareShown(accountId: string | undefined = forgeGlobal.forgeContext?.accountId): boolean {
  try {
    const state: ShownState = getLocalState(TEAM_SHARE_STATE_KEY, defaultState());
    return !!state?.users?.[accountId as string];
  } catch (e) {
    console.warn('[team-share] failed to read state', e);
    return false;
  }
}

/** Record that the prompt was displayed. Forever; best-effort. */
export function markTeamShareShown(accountId: string | undefined = forgeGlobal.forgeContext?.accountId): void {
  try {
    const state: ShownState = getLocalState(TEAM_SHARE_STATE_KEY, defaultState());
    const users = state?.users || {};
    users[accountId as string] = { shownAt: new Date().toISOString() };
    setLocalState(TEAM_SHARE_STATE_KEY, { users });
  } catch (e) {
    console.warn('[team-share] failed to write state', e);
  }
}

export function readTeamSharePending(): TeamSharePending | null {
  try {
    const raw = localStorage.getItem(pendingKey());
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v.ts !== 'number' || !v.pageId) return null;
    return {
      ts: v.ts,
      pageId: String(v.pageId),
      contentId: String(v.contentId ?? ''),
      diagramTitle: typeof v.diagramTitle === 'string' ? v.diagramTitle : '',
      siteDiagramCount: typeof v.siteDiagramCount === 'number' ? v.siteDiagramCount : 0,
    };
  } catch (e) {
    console.warn('[team-share] failed to read pending', e);
    return null;
  }
}

/** True when a fresh marker exists for exactly this page. */
export function isTeamSharePendingFor(pageId: string | undefined, now: number = Date.now()): boolean {
  if (!pageId) return false;
  const p = readTeamSharePending();
  return !!p && p.pageId === String(pageId) && now - p.ts >= 0 && now - p.ts < TEAM_SHARE_PENDING_MAX_AGE_MS;
}

export function clearTeamSharePending(): void {
  try {
    localStorage.removeItem(pendingKey());
  } catch (e) {
    console.warn('[team-share] failed to clear pending', e);
  }
}

/** The page banner is in the editor, not the view-mode page. */
function isEditLocation(location: string | undefined): boolean {
  return !!location && (location.includes('/edit-v2/') || location.includes('/edit/'));
}

/**
 * Synchronous gate shared by the page-banner host and the unplaced module (so
 * they reach the same verdict in two iframes): fresh marker for THIS page, this
 * account not yet shown, view mode, Lite/Full.
 */
export function isTeamSharePendingNow(now: number = Date.now()): boolean {
  try {
    if (!productAllowed()) return false;
    const ext = forgeGlobal.forgeContext?.extension;
    if (isEditLocation(ext?.location)) return false;
    if (isTeamShareShown()) return false;
    return isTeamSharePendingFor(ext?.content?.id, now);
  } catch {
    return false;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('team-share arm timeout')), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Called at save time for a first create. Arms the prompt when the account has
 * not seen it and the site holds at most TEAM_SHARE_MAX_SITE_DIAGRAMS diagrams.
 * Never throws; any error or timeout means "not armed". Returns whether armed,
 * so the caller can leave the CSAT survey for a later save.
 */
export async function armTeamShareIfEligible(args: {
  contentId: string;
  diagramTitle?: string;
  apWrapper: Pick<ApWrapper2, 'countSiteDiagramsUpTo' | '_getCurrentPageId'>;
}): Promise<boolean> {
  try {
    if (!productAllowed()) return false;
    if (isTeamShareShown()) return false;
    const pageId = forgeGlobal.forgeContext?.extension?.content?.id || (await args.apWrapper._getCurrentPageId());
    if (!isUsablePageId(pageId)) return false;
    const count = await withTimeout(
      args.apWrapper.countSiteDiagramsUpTo(TEAM_SHARE_MAX_SITE_DIAGRAMS + 1),
      TEAM_SHARE_ARM_TIMEOUT_MS,
    );
    if (!(count >= 0) || count > TEAM_SHARE_MAX_SITE_DIAGRAMS) return false;
    const marker: TeamSharePending = {
      ts: Date.now(),
      pageId: String(pageId),
      contentId: String(args.contentId),
      diagramTitle: args.diagramTitle || '',
      siteDiagramCount: count,
    };
    localStorage.setItem(pendingKey(), JSON.stringify(marker));
    return true;
  } catch (e) {
    console.warn('[team-share] not armed', e);
    return false;
  }
}

/** A title worth quoting: not empty, not a placeholder, not a uuid. */
export function usableDiagramTitle(title: string | undefined | null): string {
  const t = (title ?? '').trim();
  if (!t) return '';
  if (/^untitled\b/i.test(t)) return '';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return '';
  if (/^[0-9a-f]{32}$/i.test(t)) return '';
  return t;
}

export function siteCountBucket(count: number): '1' | '2-5' {
  return count <= 1 ? '1' : '2-5';
}

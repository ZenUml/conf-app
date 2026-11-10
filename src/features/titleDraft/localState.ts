import forgeGlobal from '@/model/globals/forgeGlobal'
import { getClientDomain } from '@/utils/ContextParameters/ContextParameters'

/**
 * Per-browser state for the title-draft offer. Every reader fails CLOSED when
 * localStorage is unavailable: no storage means we cannot remember a refusal,
 * so the offer is withheld rather than repeated. Nothing here throws.
 */

export interface TitleDraftIdentity {
  clientDomain: string
  accountId: string
}

export interface JustAdded {
  pageId: string
  contentId: string
  at: number
}

const HOUR = 3600_000
export const LOOKUP_FRESH_MS = 24 * HOUR
/** A pending draft may be ready soon, so it is looked up again sooner. */
export const PENDING_RECHECK_MS = HOUR
export const ENTRY_FLAG_INTERVAL_MS = 24 * HOUR
export const JUST_ADDED_TTL_MS = 2 * 60_000

/** Site and account, or null when the account is unknown (then no offer). */
export function deriveTitleDraftIdentity(): TitleDraftIdentity | null {
  const accountId = (forgeGlobal.forgeContext as any)?.accountId
  if (!accountId) return null
  return { clientDomain: getClientDomain() || 'unknown', accountId: String(accountId) }
}

const part = (v: string) => encodeURIComponent(v || 'unknown')
const person = (id: TitleDraftIdentity) => `${part(id.clientDomain)}:${part(id.accountId)}`
const key = (name: string, id: TitleDraftIdentity, pageId?: string) =>
  ['titleDraft', name, person(id), ...(pageId === undefined ? [] : [part(pageId)])].join(':')

function read(k: string): string | null | undefined {
  try {
    const ls = window.localStorage
    if (!ls) return undefined
    return ls.getItem(k)
  } catch {
    return undefined // unavailable
  }
}

function write(k: string, v: string): boolean {
  try {
    const ls = window.localStorage
    if (!ls) return false
    ls.setItem(k, v)
    return true
  } catch {
    return false
  }
}

function remove(k: string): void {
  try {
    window.localStorage?.removeItem(k)
  } catch {
    /* best effort */
  }
}

function readNumber(k: string): number | null | undefined {
  const raw = read(k)
  if (raw === undefined) return undefined
  if (raw === null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function markNotNow(id: TitleDraftIdentity, pageId: string): void {
  write(key('notNow', id, pageId), '1')
}

/** Unavailable storage reads as "not now": no offer. */
export function isNotNow(id: TitleDraftIdentity, pageId: string): boolean {
  const raw = read(key('notNow', id, pageId))
  return raw === undefined || raw !== null
}

export function recordLookup(
  id: TitleDraftIdentity,
  pageId: string,
  now: number = Date.now(),
  freshMs: number = LOOKUP_FRESH_MS,
): void {
  // The default window stays a plain timestamp, so stored values remain compatible.
  write(key('lookup', id, pageId), freshMs === LOOKUP_FRESH_MS ? String(now) : `${now}+${freshMs}`)
}

/**
 * Unavailable storage reads as fresh: do not re-ask the backend.
 * A lookup may carry its own window as "<at>+<ms>"; a plain number means 24 hours.
 */
export function isLookupFresh(id: TitleDraftIdentity, pageId: string, now: number = Date.now()): boolean {
  const raw = read(key('lookup', id, pageId))
  if (raw === undefined) return true
  if (raw === null) return false
  const [atText, msText, ...rest] = raw.split('+')
  if (rest.length) return false
  const at = Number(atText)
  const ms = msText === undefined ? LOOKUP_FRESH_MS : Number(msText)
  if (!atText || (msText !== undefined && !msText) || !Number.isFinite(at) || !Number.isFinite(ms)) return false
  return now - at < ms
}

export function canShowEntryFlag(id: TitleDraftIdentity, now: number = Date.now()): boolean {
  const at = readNumber(key('entryFlag', id))
  if (at === undefined) return false
  return at === null || now - at >= ENTRY_FLAG_INTERVAL_MS
}

export function markEntryFlagShown(id: TitleDraftIdentity, now: number = Date.now()): void {
  write(key('entryFlag', id), String(now))
}

/** True exactly once per person per site; false when it cannot be recorded. */
export function consumeFirstNotNow(id: TitleDraftIdentity): boolean {
  const k = key('firstNotNow', id)
  const raw = read(k)
  if (raw === undefined || raw !== null) return false
  return write(k, '1')
}

export function writeJustAdded(id: TitleDraftIdentity, record: JustAdded): void {
  write(key('justAdded', id), JSON.stringify(record))
}

/** Returns and clears the record when it matches the page and is under 2 minutes old. */
export function takeJustAdded(id: TitleDraftIdentity, pageId: string, now: number = Date.now()): JustAdded | null {
  const k = key('justAdded', id)
  const raw = read(k)
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<JustAdded>
    if (
      typeof v?.pageId !== 'string' || typeof v.contentId !== 'string' || typeof v.at !== 'number'
      || v.pageId !== pageId || now - v.at >= JUST_ADDED_TTL_MS || now < v.at
    ) return null
    remove(k)
    return { pageId: v.pageId, contentId: v.contentId, at: v.at }
  } catch {
    return null
  }
}

/**
 * First-vs-repeat classification for macro_viewed.
 *
 * macro_viewed was 48% of billable Mixpanel volume, and most of it repeats a
 * render the same viewer already reported that day: 46,182 events over 18,690
 * user x macro x UTC-day keys on 2026-11-04..05, 646 keys above ten each. The
 * first render per day answers every readership question (who viewed, which
 * macro, which tenant), so it is always sent; repeats are sampled
 * (MACRO_VIEWED_REPEAT_SAMPLE_RATE) and carry `sample_rate` so total renders
 * still extrapolate.
 *
 * One localStorage record per site holds today's keys, reset when the UTC day
 * changes. localStorage is per browser, which the account-id cache in
 * trackAnalyticsEvent already treats as per user. Every macro iframe of one app
 * shares the origin, so all macros on a page read and write the same record.
 * Two iframes writing at once can lose a key; that macro then counts as `first`
 * once more, which errs toward sending.
 *
 * Unlike connectMcpShown, a failure here SENDS the event: macro_viewed is the
 * core readership metric, so "cannot remember" returns null and the caller
 * emits at full rate without a `view_of_day`.
 */

const KEY_PREFIX = 'zenuml.macroViewedToday'

// Bounds the record on a site where one browser renders very many macros in a
// day. Past the cap new keys are not remembered, so they keep counting as
// `first` (full rate) rather than growing storage without limit.
export const MAX_KEYS_PER_DAY = 1000

export type ViewOfDay = 'first' | 'repeat'

export interface MacroViewScope {
  clientDomain?: string | null
  /** Custom content id, else the macro's local id. */
  macroKey?: string | null
  surface: string
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

interface DayRecord {
  d: string
  k: string[]
}

function defaultStorage(): Storage | null {
  try {
    return window.localStorage ?? null
  } catch {
    return null
  }
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

function readRecord(raw: string | null, today: string): DayRecord {
  if (!raw) return { d: today, k: [] }
  try {
    const parsed = JSON.parse(raw) as Partial<DayRecord>
    if (parsed?.d === today && Array.isArray(parsed.k)) return { d: today, k: parsed.k }
  } catch {
    // A corrupt record is treated as a fresh day.
  }
  return { d: today, k: [] }
}

/**
 * Record this render and say whether it is the first one today. Null when the
 * browser cannot remember: the caller emits at full rate.
 */
export function classifyMacroView(
  scope: MacroViewScope,
  storage: Storage | null = defaultStorage(),
  clock: () => number = Date.now,
): ViewOfDay | null {
  if (!storage || !scope.macroKey) return null
  try {
    const key = `${KEY_PREFIX}:${scope.clientDomain || '-'}`
    const viewKey = `${scope.surface}:${scope.macroKey}`
    const record = readRecord(storage.getItem(key), utcDay(clock()))
    if (record.k.includes(viewKey)) return 'repeat'
    if (record.k.length < MAX_KEYS_PER_DAY) {
      record.k.push(viewKey)
      storage.setItem(key, JSON.stringify(record))
    }
    return 'first'
  } catch {
    return null
  }
}

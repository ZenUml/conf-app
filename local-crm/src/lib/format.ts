const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
}

/**
 * The year a bare '27 Aug' belongs to. A trailing 2-digit year overrides it.
 *
 * Two producers emit bare strings: `human()` below, which omits the suffix for
 * exactly this year and prints it for every other year, and the dataset literals
 * in `data/placeholder.ts`. The pair is lossless only while this value matches
 * the dataset year, so `data/index.ts` sets it from `dataset.today` at load
 * instead of leaving a literal here to drift once the year turns.
 */
let bareDateYear = '2026'

/** Bind bare day-month strings to the dataset's year. Called once, at bootstrap. */
export function setBareDateYear(year: string): void {
  if (!/^\d{4}$/.test(year)) throw new RangeError(`setBareDateYear: not a year ${JSON.stringify(year)}`)
  bareDateYear = year
}

/** The year bare day-month strings are read against. */
export function bareYear(): string {
  return bareDateYear
}

const DATE_PATTERN = /^(\d{1,2}) ([A-Z][a-z]{2})(?: (\d{2}))?$/

/**
 * '27 Aug' -> '2026-08-27'. '26 Nov 25' -> '2025-11-26'.
 *
 * Throws on anything else. The previous reader defaulted an unknown month to
 * January and passed the day through untouched: 'unknown' became
 * '2026-01-unknown', and the console's own en-GB '30 Sept' became 30 January.
 * A date the console cannot read is an error to surface, never a value to invent.
 */
export function iso(value: string): string {
  const match = DATE_PATTERN.exec(String(value).trim())
  if (!match) throw new RangeError(`iso: unreadable date ${JSON.stringify(value)}`)
  const [, day, monthName, shortYear] = match
  const month = MONTHS[monthName]
  if (!month) throw new RangeError(`iso: unknown month ${JSON.stringify(monthName)}`)
  const dayNumber = Number(day)
  if (dayNumber < 1 || dayNumber > 31) {
    throw new RangeError(`iso: day out of range ${JSON.stringify(value)}`)
  }
  return `${shortYear ? `20${shortYear}` : bareDateYear}-${month}-${day.padStart(2, '0')}`
}

/** `iso()` for a caller holding a value that is legitimately absent ('unknown'). */
export function isoOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  try {
    return iso(value)
  } catch {
    return null
  }
}

/** '2026-08-27' -> '27 Aug'. Off-year dates keep their 2-digit year. */
export function human(value: string): string {
  const [year, month, day] = value.split('-')
  const name = Object.keys(MONTHS).find(key => MONTHS[key] === month)
  return `${day} ${name}${year === bareDateYear ? '' : ` ${year.slice(2)}`}`
}

/**
 * The date on a JSM request row, in the console's own month vocabulary, carrying
 * the year whenever the request is not from the dataset year.
 *
 * The screen used `toLocaleDateString('en-GB', { day, month })`, which drops the
 * year and writes September as 'Sept'. Five 2025 requests rendered identically
 * to 2026 rows — ZEN-1157, created 2025-04-07, read 'requested 07 Apr'.
 */
export function requestedLabel(timestamp: string | null | undefined): string | null {
  if (!timestamp) return null
  const day = String(timestamp).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const month = day.slice(5, 7)
  if (!Object.values(MONTHS).includes(month)) return null
  return human(day)
}

/** Whole days between an ISO date and today, worded. */
export function relative(value: string, today: string): string {
  const days = Math.round((Date.parse(value) - Date.parse(today)) / 86_400_000)
  if (!Number.isFinite(days)) return 'date unavailable'
  if (days === 0) return 'today'
  if (days === -1) return 'yesterday'
  if (days > 0) return `in ${days} ${days === 1 ? 'day' : 'days'}`
  return `${-days} days ago`
}

/** 1407 -> '1,407'. Every count in this console is grouped. */
export function count(value: number): string {
  return value.toLocaleString('en-US')
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** A grant domain that resolved to nothing is parenthesised, never suffixed. */
export function hostname(domain: string): string {
  return domain.startsWith('(') ? domain : `${domain}.atlassian.net`
}

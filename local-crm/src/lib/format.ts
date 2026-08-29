const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
}

/** The year every bare '27 Aug' belongs to. A trailing 2-digit year overrides it. */
const DEFAULT_YEAR = '2026'

/** '27 Aug' -> '2026-08-27'. '26 Nov 25' -> '2025-11-26'. */
export function iso(value: string): string {
  const parts = String(value).trim().split(/\s+/)
  const year = parts[2] ? `20${parts[2]}` : DEFAULT_YEAR
  const month = MONTHS[parts[1]] ?? '01'
  return `${year}-${month}-${parts[0].padStart(2, '0')}`
}

/** '2026-08-27' -> '27 Aug'. Off-year dates keep their 2-digit year. */
export function human(value: string): string {
  const [year, month, day] = value.split('-')
  const name = Object.keys(MONTHS).find(key => MONTHS[key] === month)
  return `${day} ${name}${year === DEFAULT_YEAR ? '' : ` ${year.slice(2)}`}`
}

/** Whole days between an ISO date and today, worded. */
export function relative(value: string, today: string): string {
  const days = Math.round((Date.parse(value) - Date.parse(today)) / 86_400_000)
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

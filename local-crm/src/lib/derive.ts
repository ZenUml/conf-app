import type { AppKey, Dataset, Grant, Registration } from '@/data/types'
import { human, hostname, iso, isoOrNull, plural, relative } from './format'
import { type CaseKind, lifecycleOf, requesterOf, grantState } from './lifecycle'
import { PRODUCT } from './palette'

export interface CaseEvent {
  id: string
  /** ISO day the event happened, or is scheduled for. */
  day: string
  kind: CaseKind
  /** Site hostname, or the name of the run. */
  who: string
  tag: string
  /** Chip tone for the event-type chip. */
  chip: 'full' | 'lite' | 'dia' | 'api' | 'grant' | 'expiry' | 'ingest'
  /** Status-dot colour. Solid in the past, a 2px ring when scheduled. */
  dot: string
  what: string
  meta: string
  /** Present on registration cases. */
  registration?: Registration
  /** Present on grant and expiry cases. */
  grant?: Grant
  /** Space key, carried so the scheduled card does not have to parse the sentence. */
  space?: string
}

export type FeedFilter = 'all' | 'registered' | 'granted' | 'expired'

export interface FeedDay {
  day: string
  date: string
  rel: string
  /** True when the day has not happened yet — hollow dots, tinted cards. */
  scheduled: boolean
  events: CaseEvent[]
}

/**
 * One reverse-chronological stream: a licence row appearing for the first time,
 * an editing extension granted, and that grant running out.
 *
 * Expiries that have not happened yet are emitted too, but they are separated
 * out by `pastEvents` / `scheduledEvents` rather than mixed into the stream —
 * "the stream shows what has happened; grants that have not run out yet are
 * scheduled, so they sit in their own block and are counted separately."
 */
/** A grant has no id of its own; its identity is the KV key's own three parts. */
function grantKey(grant: Grant): string {
  return `${grant.domain}:${grant.space}:${grant.created}`.replace(/\s+/g, '-')
}

export function buildEvents(data: Dataset): CaseEvent[] {
  const out: CaseEvent[] = []

  data.registrations.forEach(row => {
    const product = PRODUCT[row.p]
    // A row with an unreadable `seen` value keeps its card, dated at the console's
    // as-of day and labelled, rather than sorting under an invented January date.
    const seenDay = isoOrNull(row.seen)
    out.push({
      id: `registration:${row.id}:seen`,
      day: seenDay ?? data.today,
      kind: 'registered',
      registration: row,
      who: hostname(row.domain),
      tag: 'registered',
      chip: row.p,
      dot: product.color,
      what: `First licence row for ${product.name} — ${row.licence.toLowerCase()}, ${row.tier}. No welcome was sent; the contact is held as backlog.`,
      meta: `cloud_id ${row.cloudId}${row.flag ? ` · ${row.flag}` : ''}${seenDay ? '' : ' · first-seen date unreadable'}`
    })
  })

  data.grants.forEach(grant => {
    const site = hostname(grant.domain)
    const scope = grant.wide ? 'whole space' : 'one requester'
    out.push({
      id: `grant:${grantKey(grant)}:created`,
      day: isoOrNull(grant.created) ?? data.today,
      kind: 'granted',
      grant,
      space: grant.space,
      who: site,
      tag: `${grant.days ?? '7-day'} extension`,
      chip: 'grant',
      dot: 'var(--color-primary)',
      what: `Editing extension on space ${grant.space}, scoped to ${scope}. Runs to ${grant.expires}.`,
      meta: `${grantState(data, grant)[0]} · requester ${requesterOf(data, grant)}`
    })
    out.push({
      id: `grant:${grantKey(grant)}:expires`,
      day: isoOrNull(grant.expires) ?? data.today,
      kind: 'expired',
      grant,
      space: grant.space,
      who: site,
      tag: grant.active ? 'expires' : 'expired',
      chip: 'expiry',
      dot: 'var(--gray-400)',
      what: grant.active
        ? `Editing access on space ${grant.space} runs out unless it is renewed.`
        : `Editing access on space ${grant.space} ended. Nothing follows it up.`,
      meta: `granted ${grant.created} · ${grant.origin}`
    })
  })

  out.push({
    id: `ingest:${data.ingest.runDay.replace(/\s+/g, '-')}`,
    day: isoOrNull(data.ingest.runDay) ?? data.today,
    kind: 'ingest',
    who: 'bootstrap ingest',
    tag: 'ingest',
    chip: 'ingest',
    dot: 'var(--accent-plantuml-500)',
    what: `${data.ingest.contactsWritten.toLocaleString('en-US')} contacts written across four apps and held as backlog, so the existing base can never be welcomed retroactively.`,
    meta: `ingest-licenses.mjs --bootstrap · ${data.ingest.rowsRead.toLocaleString('en-US')} rows read, ${data.ingest.rejected} rejected`
  })

  // Ids name the row they describe. They used to be the position in this sorted
  // array, so one new grant renumbered every case below it and carried each
  // action stamp in `done` to a different customer.
  return out.sort((a, b) => b.day.localeCompare(a.day))
}

export function pastEvents(data: Dataset, events: CaseEvent[]): CaseEvent[] {
  return events.filter(event => event.day <= data.today)
}

export function scheduledEvents(data: Dataset, events: CaseEvent[]): CaseEvent[] {
  return events
    .filter(event => event.day > data.today)
    .sort((a, b) => a.day.localeCompare(b.day))
}

/** Group the stream into day blocks, preserving the incoming order. */
export function groupByDay(data: Dataset, events: CaseEvent[]): FeedDay[] {
  const days: FeedDay[] = []
  events.forEach(event => {
    let day = days[days.length - 1]
    if (!day || day.day !== event.day) {
      day = {
        day: event.day,
        date: human(event.day),
        rel: relative(event.day, data.today),
        scheduled: event.day > data.today,
        events: []
      }
      days.push(day)
    }
    day.events.push(event)
  })
  return days
}

export interface ScheduledDay {
  date: string
  rel: string
  what: string
}

/** The next three upcoming days, one line each. */
export function scheduledHead(data: Dataset, ahead: CaseEvent[]): ScheduledDay[] {
  const days = groupByDay(data, ahead)
  return days.slice(0, 3).map(day => ({
    date: day.date,
    rel: day.rel,
    what:
      day.events.length === 1
        ? `${day.events[0].who} — space ${day.events[0].space}`
        : `${day.events.length} spaces at ${day.events[0].who}`
  }))
}

/**
 * The days the head could not fit, plus what makes them unusual. The tail
 * clause is read off the grants that land there, never asserted.
 */
export function scheduledRest(data: Dataset, ahead: CaseEvent[]): string {
  const seen = [...new Set(ahead.map(event => event.day))].sort()
  const rest = seen.slice(3)
  if (!rest.length) return ''

  const thisYear = data.today.slice(0, 4)
  const beyond = ahead.filter(event => event.day > `${thisYear}-12-31`)
  const described = beyond
    .map(event =>
      event.grant?.kind === 'test marker'
        ? 'a test marker'
        : event.grant?.kind === 'off-convention'
          ? 'an operator-issued grant'
          : 'a grant'
    )
    .filter((label, index, all) => all.indexOf(label) === index)

  const tail = beyond.length
    ? ` — ${beyond.length} of those ${beyond.length === 1 ? 'is' : 'are'} ${described.join(' and ')} running past ${thisYear}.`
    : '.'
  return `Then ${rest.map(human).join(', ')}${tail}`
}

export interface SiteRow {
  domain: string
  cloudId: string
  /** True when no licence row carries a cloud ID for this site. */
  cloudIdMissing: boolean
  apps: AppKey[]
  extensions: string
  last: string
}

/**
 * Every site we hold context for: the union of sites that registered this month
 * and sites holding an editing extension. Grouped by domain — a cloud ID exists
 * only where the site appears in the Marketplace licence export.
 */
export function buildSites(data: Dataset): SiteRow[] {
  interface Acc {
    domain: string
    cloudId: string | null
    apps: Set<AppKey>
    grants: number
    active: number
    day: string
  }
  const sites = new Map<string, Acc>()
  const touch = (domain: string, day: string): Acc => {
    let entry = sites.get(domain)
    if (!entry) {
      entry = { domain, cloudId: null, apps: new Set(), grants: 0, active: 0, day }
      sites.set(domain, entry)
    }
    if (day > entry.day) entry.day = day
    return entry
  }

  data.registrations.forEach(row => {
    const entry = touch(row.domain, isoOrNull(row.seen) ?? data.today)
    entry.cloudId = row.cloudId
    entry.apps.add(row.p)
  })
  // An editing extension is a Lite-only mechanism, so a grant implies lite.
  // A grant whose cloud ID resolves to no site carries a parenthesised
  // placeholder, not a domain: grouping it here invented a site row and counted
  // it in "sites on file". Those grants stay on the unresolved list only.
  data.grants.forEach(grant => {
    if (grant.domain.startsWith('(')) return
    const entry = touch(grant.domain, isoOrNull(grant.created) ?? data.today)
    entry.apps.add('lite')
    entry.grants += 1
    if (grant.active) entry.active += 1
  })

  return [...sites.values()]
    .sort((a, b) => b.day.localeCompare(a.day))
    .map(entry => ({
      domain: hostname(entry.domain),
      cloudId: entry.cloudId ?? 'none on file',
      cloudIdMissing: !entry.cloudId,
      apps: [...entry.apps],
      extensions: entry.grants
        ? `${plural(entry.grants, 'grant')}${entry.active ? ` · ${entry.active} active` : ' · all expired'}`
        : '—',
      last: human(entry.day)
    }))
}

export interface SiteStat {
  label: string
  value: number
  tone: 'plain' | 'brand' | 'rust'
}

export function buildSiteStats(data: Dataset, sites: SiteRow[]): SiteStat[] {
  const holders = new Set(data.grants.map(grant => grant.domain))
  return [
    { label: 'sites on file', value: sites.length, tone: 'plain' },
    { label: 'new this month', value: data.registrations.length, tone: 'brand' },
    { label: 'hold an extension', value: holders.size, tone: 'plain' },
    { label: 'no cloud ID', value: unresolvedGrants(data).length, tone: 'rust' }
  ]
}

export interface TenantRow {
  domain: string
  grants: number
  active: string
  hasActive: boolean
  spaces: string
  window: string
}

/** Who keeps asking, repeat requests first. */
export function buildTenants(data: Dataset): TenantRow[] {
  interface Acc {
    domain: string
    n: number
    active: number
    spaces: Set<string>
    first: string
    last: string
  }
  const tenants = new Map<string, Acc>()
  data.grants.forEach(grant => {
    let entry = tenants.get(grant.domain)
    if (!entry) {
      entry = { domain: grant.domain, n: 0, active: 0, spaces: new Set(), first: '9', last: '0' }
      tenants.set(grant.domain, entry)
    }
    const day = isoOrNull(grant.created) ?? data.today
    entry.n += 1
    if (grant.active) entry.active += 1
    entry.spaces.add(grant.space)
    if (day < entry.first) entry.first = day
    if (day > entry.last) entry.last = day
  })

  return [...tenants.values()]
    .sort((a, b) => b.n - a.n || b.last.localeCompare(a.last))
    .map(entry => ({
      domain: hostname(entry.domain),
      grants: entry.n,
      active: entry.active ? `${entry.active} active` : 'none',
      hasActive: entry.active > 0,
      spaces: [...entry.spaces].join(', '),
      window: entry.first === entry.last ? human(entry.first) : `${human(entry.first)} → ${human(entry.last)}`
    }))
}

/** Grants whose cloud ID matches nothing in the licence export. */
export function unresolvedGrants(data: Dataset): Grant[] {
  return data.grants.filter(grant => grant.domain.startsWith('('))
}

export interface UnresolvedRow {
  key: string
  detail: string
  audit: string
  state: string
  active: boolean
  expires: string
}

export function buildUnresolved(data: Dataset): UnresolvedRow[] {
  return unresolvedGrants(data).map(grant => ({
    key: `license:<cloudId>:${grant.space}:<accountId>`,
    detail:
      grant.kind === 'test marker'
        ? 'Granted space-wide by an end-to-end test in April and set to run until the end of 2027. No licence row anywhere carries this cloud ID, so no client can be attached to it.'
        : 'Granted automatically from a support ticket. The cloud ID resolved at grant time but appears in no current licence export, so the site behind it cannot be identified.',
    audit: `activatedBy ${grant.origin} · granted ${grant.created}`,
    state: grant.active ? 'active' : 'expired',
    active: Boolean(grant.active),
    expires: `expires ${grant.expires}`
  }))
}

/** Filter pill counts, computed over the past stream only. */
export function filterCounts(events: CaseEvent[]): Record<FeedFilter, number> {
  return {
    all: events.length,
    registered: events.filter(event => event.kind === 'registered').length,
    granted: events.filter(event => event.kind === 'granted').length,
    expired: events.filter(event => event.kind === 'expired').length
  }
}

export { lifecycleOf }

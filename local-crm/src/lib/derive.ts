import type { AppKey, Dataset, Grant, Registration } from '@/data/types'
import { human, hostname, iso, plural, relative } from './format'
import {
  type CaseKind,
  lifecycleOf,
  requesterOf,
  grantState,
  grantStatusOf,
  grantCreatedDay,
  grantExpiryDay
} from './lifecycle'
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
export function buildEvents(data: Dataset): CaseEvent[] {
  const out: CaseEvent[] = []

  data.registrations.forEach(row => {
    const product = PRODUCT[row.p]
    out.push({
      id: `registration:${row.id}:seen`,
      day: iso(row.seen),
      kind: 'registered',
      registration: row,
      who: hostname(row.domain),
      tag: 'registered',
      chip: row.p,
      dot: product.color,
      what: `First licence row for ${product.name} — ${row.licence.toLowerCase()}, ${row.tier}. No welcome was sent; the contact is held as backlog.`,
      meta: `cloud_id ${row.cloudId}${row.flag ? ` · ${row.flag}` : ''}`
    })
  })

  data.grants.forEach((grant, index) => {
    const site = hostname(grant.domain)
    const scope = grant.wide ? 'whole space' : 'one requester'
    const grantId = grant.id ?? `fixture-${index}`
    const status = grantStatusOf(grant)
    const createdDay = grantCreatedDay(grant)
    const expiryDay = grantExpiryDay(grant)
    const eventDay = createdDay ?? grant.sourceObservedAt?.slice(0, 10) ?? data.today
    const timing = status === 'active'
      ? `Runs to ${grant.expires}.`
      : status === 'expired'
        ? `Recorded expiry ${grant.expires}.`
        : status === 'inactive'
          ? `KV status is inactive; recorded expiresAt is ${grant.expires}.`
          : `Current grant status is unknown; recorded expiresAt is ${grant.expires}.`
    out.push({
      id: `grant:${grantId}:created`,
      day: eventDay,
      kind: 'granted',
      grant,
      space: grant.space,
      who: site,
      tag: createdDay ? `${grant.days ?? 'duration-unknown'} extension` : 'observed grant · createdAt unknown',
      chip: 'grant',
      dot: 'var(--color-primary)',
      what: `${createdDay ? 'Editing extension' : 'Current extension record observed; createdAt is unknown'} on space ${grant.space}, scoped to ${scope}. ${timing}`,
      meta: `${grantState(data, grant)[0]} · requester ${requesterOf(data, grant)}`
    })
    if ((status === 'active' || status === 'expired') && expiryDay) {
      out.push({
        id: `grant:${grantId}:expires`,
        day: expiryDay,
        kind: 'expired',
        grant,
        space: grant.space,
        who: site,
        tag: status === 'active' ? 'expires' : 'expired',
        chip: 'expiry',
        dot: 'var(--gray-400)',
        what: status === 'active'
          ? `Editing access on space ${grant.space} runs out unless it is renewed.`
          : `The recorded expiresAt for editing access on space ${grant.space} has passed; access impact is not joined.`,
        meta: `granted ${grant.created} · ${grant.origin}`
      })
    }
  })

  out.push({
    id: `ingest:${data.ingest.runDay}`,
    day: iso(data.ingest.runDay),
    kind: 'ingest',
    who: 'bootstrap ingest',
    tag: 'ingest',
    chip: 'ingest',
    dot: 'var(--accent-plantuml-500)',
    what: `${data.ingest.contactsWritten.toLocaleString('en-US')} contacts written across four apps and held as backlog, so the existing base can never be welcomed retroactively.`,
    meta: `ingest-licenses.mjs --bootstrap · ${data.ingest.rowsRead.toLocaleString('en-US')} rows read, ${data.ingest.rejected} rejected`
  })

  return out.sort((a, b) => b.day.localeCompare(a.day) || a.id.localeCompare(b.id))
}

export function pastEvents(data: Dataset, events: CaseEvent[]): CaseEvent[] {
  return events.filter(event =>
    event.day <= data.today
      && !(event.kind === 'expired' && event.grant && grantStatusOf(event.grant) === 'active')
  )
}

export function scheduledEvents(data: Dataset, events: CaseEvent[]): CaseEvent[] {
  return events
    .filter(event => event.day > data.today
      || (event.kind === 'expired' && event.grant && grantStatusOf(event.grant) === 'active'))
    .sort((a, b) => a.day.localeCompare(b.day))
}

/** The newest full-timestamp grant event for one rendered tenant hostname. */
export function latestGrantEventForDomain(
  events: CaseEvent[],
  domain: string
): CaseEvent | undefined {
  return events
    .filter(event =>
      event.kind === 'granted'
        && event.grant
        && hostname(event.grant.domain) === domain
    )
    .sort((a, b) => {
      const aCreated = a.grant?.createdAt ?? grantCreatedDay(a.grant!) ?? ''
      const bCreated = b.grant?.createdAt ?? grantCreatedDay(b.grant!) ?? ''
      return bCreated.localeCompare(aCreated) || a.id.localeCompare(b.id)
    })[0]
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
  return days.slice(0, 3).map(day => {
    const tenants = new Set(day.events.map(event => event.who))
    return {
      date: day.date,
      rel: day.rel,
      what:
        day.events.length === 1
          ? `${day.events[0].who} — space ${day.events[0].space}`
          : tenants.size === 1
            ? `${day.events.length} spaces at ${day.events[0].who}`
            : `${day.events.length} expiries across ${tenants.size} tenants`
    }
  })
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
    const entry = touch(row.domain, iso(row.seen))
    entry.cloudId = row.cloudId
    entry.apps.add(row.p)
  })
  // An editing extension is a Lite-only mechanism, so a grant implies lite.
  data.grants.forEach(grant => {
    const day = grantCreatedDay(grant) ?? grant.sourceObservedAt?.slice(0, 10) ?? data.today
    const entry = touch(grant.domain, day)
    if (grant.cloudId) entry.cloudId ??= grant.cloudId
    entry.apps.add('lite')
    entry.grants += 1
    if (grantStatusOf(grant) === 'active') entry.active += 1
  })

  return [...sites.values()]
    .sort((a, b) => b.day.localeCompare(a.day))
    .map(entry => ({
      domain: hostname(entry.domain),
      cloudId: entry.cloudId ?? 'none on file',
      cloudIdMissing: !entry.cloudId,
      apps: [...entry.apps],
      extensions: entry.grants
        ? `${plural(entry.grants, 'grant')} · ${entry.active} active`
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

/** Current grant records grouped by tenant, highest grant count first. */
export function buildTenants(data: Dataset): TenantRow[] {
  interface Acc {
    domain: string
    n: number
    active: number
    spaces: Set<string>
    first: string | null
    last: string | null
    unknownDates: number
  }
  const tenants = new Map<string, Acc>()
  data.grants.forEach(grant => {
    const tenantKey = grant.cloudId ?? grant.domain
    let entry = tenants.get(tenantKey)
    if (!entry) {
      entry = { domain: grant.domain, n: 0, active: 0, spaces: new Set(), first: null, last: null, unknownDates: 0 }
      tenants.set(tenantKey, entry)
    } else if (entry.domain.startsWith('(') && !grant.domain.startsWith('(')) {
      entry.domain = grant.domain
    }
    const day = grantCreatedDay(grant)
    entry.n += 1
    if (grantStatusOf(grant) === 'active') entry.active += 1
    entry.spaces.add(grant.space)
    if (!day) {
      entry.unknownDates += 1
    } else {
      if (!entry.first || day < entry.first) entry.first = day
      if (!entry.last || day > entry.last) entry.last = day
    }
  })

  return [...tenants.values()]
    .sort((a, b) => b.n - a.n || (b.last ?? '').localeCompare(a.last ?? ''))
    .map(entry => ({
      domain: hostname(entry.domain),
      grants: entry.n,
      active: `${entry.active} active`,
      hasActive: entry.active > 0,
      spaces: [...entry.spaces].join(', '),
      window: !entry.first || !entry.last
        ? 'createdAt unknown'
        : `${entry.first === entry.last ? human(entry.first) : `${human(entry.first)} → ${human(entry.last)}`}${entry.unknownDates ? ` · ${entry.unknownDates} unknown` : ''}`
    }))
}

/** Grants whose current site hostname is unavailable or unresolved. */
export function unresolvedGrants(data: Dataset): Grant[] {
  return data.grants.filter(grant => grant.domain.startsWith('('))
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

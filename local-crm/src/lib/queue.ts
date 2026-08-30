import type { Grant } from '@/data/types'
import type { ExtensionCommentEvidence, OpenExtensionRequest, OpenExtensionRequestStream } from '@/data/extensionsContract'
import { count, hostname, human } from './format'

/**
 * Today's work queue.
 *
 * It lists what the next move belongs to us on, across the three lifecycles the
 * console covers. Welcome and expiry/cancellation have no source yet and appear as
 * one `todo` row each; extension is the live one.
 *
 * Two judgements are made here and nowhere else, and both are stated on the row
 * they produce: an extension inside `EXPIRING_WITHIN_DAYS` needs a decision, and a
 * request parked on the customer returns at `NUDGE_IDLE_DAYS` and again at
 * `CLOSE_IDLE_DAYS`. Everything else is a stored field.
 */

/** A grant this close to running out is a decision, not a fact to read later. */
export const EXPIRING_WITHIN_DAYS = 7
/** A request parked on the customer this long has stopped being their move. */
export const NUDGE_IDLE_DAYS = 30
/** Past this, no nudge has worked and the ask is closing, not waiting. */
export const CLOSE_IDLE_DAYS = 90
/** How long a settled item stays visible as the readback that the action landed. */
export const SETTLED_WINDOW_DAYS = 14

const OURS_NOW = new Set(['Waiting for support', 'In Progress', 'Work in progress'])
const PARKED = 'Waiting for customer'

export type QueueLifecycle = 'extension' | 'welcome' | 'expiry'
export type QueueReason = 'waiting_on_support' | 'in_progress' | 'expiring' | 'nudge' | 'close'

export interface QueueRow {
  id: string
  lifecycle: QueueLifecycle
  reason: QueueReason
  /** The stored date this row displays, ISO day. */
  date: string
  /** Action urgency retained as data; display order is newest stored date first. */
  score: number
  title: string
  /** Why the row is here, in the words of the rule that put it there. */
  detail: string
  /** The facts the grant-or-refuse decision needs, one line. */
  evidence: string
  ticketKey: string | null
  ticketUrl: string | null
  cloudId: string | null
  spaceKey: string | null
  requester: string | null
  /** JSM comment metadata only; bodies are intentionally absent from the contract. */
  comments: ExtensionCommentEvidence | null
  /** Copy-ready grant command, or null when the site did not resolve. */
  command: string | null
  /**
   * The stream event this row can open in the drawer. An expiry row has one — the
   * grant it derives from. A request that produced no grant has no case to open,
   * so the row links out to JSM instead of opening an empty drawer.
   */
  eventId: string | null
}

export interface SettledRow {
  /** ISO day. */
  date: string
  text: string
}

export interface TodoRow {
  lifecycle: QueueLifecycle
  note: string
}

export interface QueueInput {
  grants: Grant[]
  openRequests: OpenExtensionRequestStream | null
  /** The console's as-of day, ISO. */
  today: string
}

export interface QueueView {
  rows: QueueRow[]
  settled: SettledRow[]
  todos: TodoRow[]
}

const JSM_BROWSE = 'https://zenuml.atlassian.net/browse/'

function day(value: string | null | undefined): string | null {
  if (!value) return null
  const iso = String(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000)
}

/** The `extend-space-license` invocation, with nothing left for the operator to look up. */
function grantCommand(cloudId: string | null, spaceKey: string | null): string | null {
  if (!cloudId || !spaceKey) return null
  return `/extend-space-license --cloud-id ${cloudId} --space ${spaceKey} --days 7`
}

function requestEvidence(row: OpenExtensionRequest): string {
  const parts: string[] = []
  if (row.macroCount !== null) {
    parts.push(`${count(row.macroCount)} macros${row.macrosLimit !== null ? ` · limit ${row.macrosLimit}` : ''}`)
  }
  const prior = row.priorGrants
  if (prior.count > 0) {
    const active = prior.activeCount > 0 ? `, ${prior.activeCount} active` : ''
    const latest = prior.latestExpiresAt ? `, latest to ${human(day(prior.latestExpiresAt) ?? '')}` : ''
    parts.push(`${prior.count} prior grant${prior.count === 1 ? '' : 's'} on this space${active}${latest}`)
  } else {
    parts.push('no prior grant on this space')
  }
  if (row.comments.state === 'known' && row.comments.lastCommentAuthor) {
    parts.push(`last reply by ${row.comments.lastCommentAuthor}`)
  }
  return parts.join(' · ')
}

function fromRequests(stream: OpenExtensionRequestStream | null, today: string): QueueRow[] {
  if (!stream || stream.state === 'unavailable') return []
  return stream.rows.flatMap(row => {
    if (row.currentGrant === 'observed') return []
    const status = row.status ?? ''
    const updated = day(row.updatedAt) ?? day(row.createdAt)
    if (!updated) return []

    let reason: QueueReason | null = null
    let score = 0
    let detail = ''
    const idle = daysBetween(updated, today)

    if (OURS_NOW.has(status)) {
      reason = status === 'Waiting for support' ? 'waiting_on_support' : 'in_progress'
      score = 0
      detail = status === 'Waiting for support' ? 'waiting for support' : 'in progress, unfinished'
    } else if (status === PARKED && idle >= CLOSE_IDLE_DAYS) {
      reason = 'close'
      score = -(idle - CLOSE_IDLE_DAYS)
      detail = `no reply in ${idle} days · close`
    } else if (status === PARKED && idle >= NUDGE_IDLE_DAYS) {
      reason = 'nudge'
      score = -(idle - NUDGE_IDLE_DAYS)
      detail = `no reply in ${idle} days · nudge or close`
    }
    if (!reason) return []

    return [{
      id: `request:${row.ticketKey}`,
      lifecycle: 'extension' as const,
      reason,
      date: updated,
      score,
      // An older ticket form recorded neither field; the row says that once rather
      // than printing two placeholders where a target should be.
      title: row.typedDomain || row.typedSpace
        ? `${row.typedDomain ?? `Unavailable · ${row.unavailableReasons.typedDomain ?? 'JSM form Client domain unavailable'}`} / ${row.typedSpace ?? `Unavailable · ${row.unavailableReasons.typedSpace ?? 'JSM form Space key unavailable'}`}`
        : 'Unavailable · JSM request target facts unavailable',
      detail,
      evidence: requestEvidence(row),
      ticketKey: row.ticketKey,
      ticketUrl: `${JSM_BROWSE}${row.ticketKey}`,
      cloudId: row.cloudId,
      spaceKey: row.typedSpace,
      requester: row.requester,
      comments: row.comments,
      command: grantCommand(row.cloudId, row.typedSpace),
      eventId: null
    }]
  })
}

function fromGrants(grants: Grant[], today: string): QueueRow[] {
  return grants.flatMap(grant => {
    const expires = day(grant.expiresAt)
    if (!expires || grant.status !== 'active') return []
    const remaining = daysBetween(today, expires)
    if (remaining < 0 || remaining > EXPIRING_WITHIN_DAYS) return []
    const space = grant.space ?? null
    return [{
      id: `expiry:${grant.id ?? `${grant.cloudId}:${space}`}`,
      lifecycle: 'extension' as const,
      reason: 'expiring' as const,
      date: expires,
      score: remaining,
      title: `${hostname(grant.domain, grant.domainUnavailableReason)} / ${space ?? 'space unknown'}`,
      detail: remaining === 0
        ? 'access stops today'
        : `access stops in ${remaining} day${remaining === 1 ? '' : 's'}`,
      evidence: `granted ${grant.created ?? `unavailable (${grant.createdUnavailableReason ?? 'KV grant createdAt is unavailable'})`}${grant.origin ? ` · ${grant.origin}` : ` · unavailable (${grant.originUnavailableReason ?? 'KV grant activatedBy is unavailable'})`}`,
      ticketKey: grant.ticketKey ?? null,
      ticketUrl: grant.ticketKey ? `${JSM_BROWSE}${grant.ticketKey}` : null,
      cloudId: grant.cloudId ?? null,
      spaceKey: space,
      requester: null,
      comments: null,
      command: grantCommand(grant.cloudId ?? null, space),
      eventId: grant.id ? `grant:${grant.id}:created` : null
    }]
  })
}

/** Grants written and expiries reached inside the window — the readback, one line each. */
function settledTail(grants: Grant[], today: string): SettledRow[] {
  const rows: SettledRow[] = []
  grants.forEach(grant => {
    const space = grant.space ?? 'space unknown'
    const created = day(grant.createdAt)
    if (created && daysBetween(created, today) >= 0 && daysBetween(created, today) <= SETTLED_WINDOW_DAYS) {
      rows.push({ date: created, text: `granted ${hostname(grant.domain, grant.domainUnavailableReason)} / ${space}` })
    }
    const expires = day(grant.expiresAt)
    if (expires && daysBetween(expires, today) >= 0 && daysBetween(expires, today) <= SETTLED_WINDOW_DAYS) {
      rows.push({ date: expires, text: `expired ${hostname(grant.domain, grant.domainUnavailableReason)} / ${space}` })
    }
  })
  return rows.sort((a, b) => b.date.localeCompare(a.date))
}

const TODOS: TodoRow[] = [
  {
    lifecycle: 'welcome',
    note: 'no source yet — migration 0025 is applied nowhere, the sending domain is unverified, and every contact sits under bootstrap_backlog'
  },
  {
    lifecycle: 'expiry',
    note: 'no source yet — lifecycle_touchpoint is empty and a lapse carries the ingest run’s date, not a cancellation date'
  }
]

export function buildQueue({ grants, openRequests, today }: QueueInput): QueueView {
  const rows = [...fromRequests(openRequests, today), ...fromGrants(grants, today)]
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
  return { rows, settled: settledTail(grants, today), todos: TODOS }
}

import type { Dataset, Grant, JsmTicket } from '@/data/types'
import { count, human, iso } from './format'

/**
 * `skip` is the load-bearing state: it means **never entered**, and it is not
 * the same as `todo` (not reached yet) or `done` (genuinely completed). Grant
 * cases legitimately sit at `applied` with `checking` and `ready-to-grant`
 * never entered, because no eligibility check ever ran. Painting a stage green
 * because it precedes the current one would be a lie the data does not support.
 */
export type StageState = 'done' | 'now' | 'open' | 'skip' | 'todo'

export interface Stage {
  name: string
  state: StageState
  /** Why the stage is in that state. Rendered under the name in the drawer. */
  note: string
}

export interface LifecycleView {
  /** True when the case cannot move on its own. Recolours `now` from blue to amber. */
  stalled: boolean
  /** One muted line naming the branch states this case never entered. */
  branches: string
  stages: Stage[]
}

export type CaseKind = 'registered' | 'granted' | 'expired' | 'ingest'

/** Action keys that write somewhere real. Suppressed whenever a case is blocked. */
export const WRITE_ACTIONS = [
  'revoke',
  'feedback',
  'regrant',
  'release',
  'internal',
  'migrate',
  'schedule'
] as const

const TICKET = /^ZEN-\d+$/

export function recordedTicketOf(grant: Grant): string | null {
  if (grant.ticketKey && TICKET.test(grant.ticketKey)) return grant.ticketKey
  return TICKET.test(String(grant.origin ?? '')) ? grant.origin : null
}

export function ticketOf(grant: Grant): string | null {
  if (grant.requestTicket && TICKET.test(grant.requestTicket)) return grant.requestTicket
  return recordedTicketOf(grant)
}

export function jsmOf(data: Dataset, grant: Grant): JsmTicket | null {
  const ticket = ticketOf(grant)
  return ticket ? data.jsm[ticket] ?? null : null
}

export function grantStatusOf(grant: Grant): NonNullable<Grant['status']> {
  return grant.status ?? (grant.active ? 'active' : 'expired')
}

export function grantCreatedDay(grant: Grant): string | null {
  if (grant.createdAt) return grant.createdAt.slice(0, 10)
  return grant.created === 'unknown' ? null : iso(grant.created)
}

export function grantExpiryDay(grant: Grant): string | null {
  if (grant.expiresAt) return grant.expiresAt.slice(0, 10)
  return grant.expires === 'unknown' ? null : iso(grant.expires)
}

function hasUnknown(grant: Grant, value: string): boolean {
  return Boolean(grant.unknowns?.includes(value))
}

/** The requester line, or the reason there is no single one. */
export function requesterOf(data: Dataset, grant: Grant): string {
  const ticket = jsmOf(data, grant)
  if (ticket) {
    return grant.requestMatchedBy === 'domain_space'
      ? `${ticket.requester} — reporter on a correlated request; not proven grant origin`
      : ticket.requester
  }
  if (grant.wide) return 'whole space — no single requester'
  if (hasUnknown(grant, 'JSM request matching is unavailable')) {
    return grant.userAccountId
      ? 'target account is present; JSM request matching is unavailable'
      : 'target account unavailable; JSM request matching is unavailable'
  }
  return grant.userAccountId
    ? 'target account is present; no JSM candidate matched in the fetched search window'
    : 'no JSM candidate matched in the fetched search window; target account unavailable in this fixture'
}

/**
 * Where a grant sits in the Extension state machine. KV persists active/inactive;
 * expired/unknown are derived at read time from that stored value and expiresAt.
 */
export function grantState(data: Dataset, grant: Grant): [string, string] {
  if (grant.kind === 'test marker') {
    return [
      'applied · test marker',
      'A synthetic grant left behind by an upgrade-prompt end-to-end test. It lives in the same store as real ones and runs to 31 Dec 2027.'
    ]
  }
  if (grant.domain.startsWith('(')) {
    const mappingUnavailable = hasUnknown(grant, 'Marketplace site mapping is unavailable')
    return [
      mappingUnavailable ? 'site mapping unavailable' : 'needs-details',
      mappingUnavailable
        ? 'Marketplace could not be read, so this cloud ID cannot currently be resolved to a site.'
        : 'The cloud ID in this key matches no site in the Marketplace export, so the eligibility evidence behind it cannot be rebuilt.'
    ]
  }
  const status = grantStatusOf(grant)
  if (status === 'inactive') {
    return [
      'inactive, KV-observed',
      'The current KV record is explicitly inactive. Its expiresAt does not establish why or when it became inactive.'
    ]
  }
  if (status === 'unknown') {
    return [
      'status unknown',
      'The current KV record is present, but its stored status or expiry is missing or invalid; no active/expired claim is made.'
    ]
  }
  const recordedTicket = recordedTicketOf(grant)
  const requestTicket = ticketOf(grant)
  const correlatedOnly = Boolean(
    requestTicket && !recordedTicket && grant.requestMatchedBy === 'domain_space'
  )
  const auditUnavailable = hasUnknown(grant, 'ExtensionAction audit source is unavailable')
  const requestContext = correlatedOnly
    ? `JSM ${requestTicket} is correlated by exact domain, space, target scope and causal time; it is not recorded as this grant's origin. `
    : recordedTicket
      ? `The grant records ${recordedTicket} in activatedBy. `
      : ''
  if (!recordedTicket && !requestTicket) {
    const requestAvailability = hasUnknown(grant, 'JSM request matching is unavailable')
      ? 'JSM request matching is unavailable.'
      : 'No JSM request candidate matched in the fetched search window.'
    const auditAvailability = auditUnavailable
      ? ' ExtensionAction audit is unavailable.'
      : grant.actionAudit?.length
        ? ' An exact-target ExtensionAction row is available.'
        : ' No exact-target ExtensionAction row matched.'
    return [
      'outside the request flow',
      `Activated by ${grant.origin}. ${requestAvailability}${auditAvailability}`
    ]
  }
  if (grant.actionAudit?.some(row => row.status === 'applied')) {
    return [
      'applied, audited',
      `${requestContext}The current KV record and ${count(grant.actionAudit.length)} matching ExtensionAction ${grant.actionAudit.length === 1 ? 'row are both' : 'rows are'} available.`
    ]
  }
  if (grant.actionAudit?.length) {
    return [
      'applied, audit pending',
      `${requestContext}The current KV record exists, but ${count(grant.actionAudit.length)} matching ExtensionAction ${grant.actionAudit.length === 1 ? 'row is' : 'rows are'} still pending.`
    ]
  }
  if (grant.sourceObservedAt) {
    return [
      'applied, KV-observed',
      `${requestContext}The current KV record was read at ${grant.sourceObservedAt}; ${auditUnavailable ? 'ExtensionAction audit is unavailable.' : 'no exact-target ExtensionAction audit row exists.'}`
    ]
  }
  return [
    'applied, unverified',
    `${requestContext}The fixture records activatedBy as ${grant.origin}; no live source observation is attached.`
  ]
}

/**
 * The one function that owns per-stage state. The list-page rail and the drawer
 * both read this; neither derives stage state independently.
 */
export function lifecycleOf(data: Dataset, kind: CaseKind, grant: Grant | null): LifecycleView {
  if (kind === 'registered') {
    return {
      stalled: true,
      branches:
        'Branch states not entered: excluded, delivery-failed, contact-corrected, do-not-contact.',
      stages: [
        { name: 'discovered', state: 'done', note: `Classified NEW by the ${data.ingest.runAt.split(' ').slice(0, 2).join(' ')} ingest and not a Connect migration or a backfill row.` },
        { name: 'needs-contact', state: 'open', note: 'The contact column was dropped at extraction, so there is no address to check against.' },
        { name: 'blocked', state: 'now', note: 'The sender itself cannot deliver. This is where the case sits, and it is not this site’s fault.' },
        { name: 'ready-to-send', state: 'todo', note: 'Out of reach until both the contact and the sender clear.' },
        { name: 'sending', state: 'todo', note: '' },
        { name: 'sent', state: 'todo', note: 'No attempt has ever been made for this contact — 0 touchpoints.' },
        { name: 'routed', state: 'todo', note: 'Would record that the contact handed the material to the right owner. Communication, not activation.' },
        { name: 'site-signal-observed', state: 'todo', note: 'No usage table is joined to this cloud ID, so a first macro would not be seen.' }
      ]
    }
  }

  if (kind === 'granted' && grant) {
    const ticket = ticketOf(grant)
    const recordedTicket = recordedTicketOf(grant)
    const correlatedOnly = Boolean(
      ticket && !recordedTicket && grant.requestMatchedBy === 'domain_space'
    )
    const state = grantState(data, grant)[0]
    const needsDetails = state === 'needs-details' || state === 'site mapping unavailable'
    const hasAudit = Boolean(grant.actionAudit?.length)
    const hasAppliedAudit = Boolean(grant.actionAudit?.some(row => row.status === 'applied'))
    const auditUnavailable = hasUnknown(grant, 'ExtensionAction audit source is unavailable')
    const jsmUnavailable = hasUnknown(grant, 'JSM request matching is unavailable')
    const observed = Boolean(grant.sourceObservedAt)
    return {
      stalled: needsDetails || grantStatusOf(grant) === 'unknown',
      branches: 'Branch states not entered: not-grantable, needs-retry.',
      stages: [
        {
          name: 'received',
          state: ticket ? 'done' : 'skip',
          note: recordedTicket
            ? `activatedBy records ${recordedTicket}${jsmOf(data, grant)
              ? ', and JSM returned the request.'
              : jsmUnavailable
                ? '; JSM details are unavailable.'
                : '; no matching issue was returned by the JSM pull.'}`
            : correlatedOnly
              ? `${ticket} is correlated by exact domain, space, target scope and causal time; it is not proven to be this grant's origin.`
              : jsmUnavailable
                ? `JSM request matching is unavailable; activatedBy is ${grant.origin}.`
                : `No JSM request candidate matched in the fetched search window. activatedBy is ${grant.origin}.`
        },
        {
          name: 'needs-details',
          state: needsDetails ? 'now' : 'skip',
          note: state === 'site mapping unavailable'
            ? 'Marketplace site mapping is unavailable, so the cloud ID cannot be resolved.'
            : needsDetails
              ? 'The cloud ID resolves to no site in the export.'
              : ''
        },
        {
          name: 'checking',
          state: hasAudit ? 'done' : 'skip',
          note: hasAudit
            ? 'A matching ExtensionAction row exists; its recorded macro count is shown in Audit.'
            : auditUnavailable
              ? 'ExtensionAction audit is unavailable, so eligibility-check evidence is unknown.'
              : 'No exact-target ExtensionAction row records an eligibility check for this grant.'
        },
        {
          name: 'ready-to-grant',
          state: hasAppliedAudit ? 'done' : hasAudit ? 'open' : 'skip',
          note: hasAppliedAudit
            ? 'The matching action row is applied.'
            : hasAudit
              ? 'The matching action row remains pending.'
            : auditUnavailable
              ? 'The action source is unavailable; this state cannot be checked.'
              : 'No action row proves that this state was entered.'
        },
        {
          name: 'applying',
          state: needsDetails ? 'todo' : 'done',
          note: hasAudit
            ? 'The KV record and matching action row are both present.'
            : auditUnavailable
              ? 'The current KV record exists; action-row evidence is unavailable.'
              : 'The current KV record exists; no exact-target action row is present.'
        },
        {
          name: 'applied',
          state: needsDetails ? 'todo' : 'now',
          note: needsDetails
            ? ''
            : observed
              ? `Current KV value observed at ${grant.sourceObservedAt}.`
              : 'This is a fixture row with no live source observation.'
        },
        {
          name: 'already-applied',
          state: 'skip',
          note: 'The current KV snapshot does not establish previous grants, so repeat status is not inferred.'
        }
      ]
    }
  }

  if (kind === 'expired' && grant) {
    const past = grantStatusOf(grant) === 'expired'
    return {
      stalled: past,
      branches: 'Branch states not entered: closed-unresolved, do-not-contact.',
      stages: [
        { name: 'detected', state: 'done', note: 'Derived from the current KV status and expiresAt; no separate expiry-event evidence is present in this response.' },
        {
          name: 'needs-evidence',
          state: past ? 'now' : 'todo',
          note: past
            ? 'The access impact is unchecked and no reachable site contact is resolved for this cloud ID.'
            : 'Not reached — the grant is still running.'
        },
        { name: 'not-actionable', state: 'skip', note: 'Where this lands if no contact can be safely reached.' },
        { name: 'ready-to-contact', state: 'todo', note: 'Needs the event, the impact and the contact relationship all explainable.' },
        { name: 'contacted', state: 'todo', note: 'No post-expiry delivery evidence is joined in this response.' },
        { name: 'context-confirmed', state: 'todo', note: 'Would record ownership, a routing, background, or a refusal to be contacted.' },
        { name: 'recovery-in-progress', state: 'todo', note: 'Renewal or a re-granted extension runs in its own flow, not from here.' },
        { name: 'resolved', state: 'todo', note: '' }
      ]
    }
  }

  const { ingest } = data
  return {
    stalled: true,
    branches: '',
    stages: [
      { name: 'read', state: 'done', note: `${count(ingest.rowsRead)} of ${count(ingest.rowsTotal)} rows read from the Marketplace export.` },
      { name: 'classified', state: 'done', note: `${ingest.rejected} rejected, ${ingest.unmapped} unmapped to our four apps.` },
      { name: 'written', state: 'done', note: `${count(ingest.contactsWritten)} contacts upserted into the local D1 on the ${ingest.localSchema} schema.` },
      { name: 'logged', state: 'now', note: 'Nowhere to write a run row. Migration 0025 has never been applied, so no run can be verified after the fact.' },
      { name: 'eligibility scored', state: 'todo', note: 'The per-contact eligibility columns arrive with the same migration.' },
      { name: 'scheduled', state: 'todo', note: 'Four independent gates are closed: package outside the workspace, no deploy job, cron triggers commented out, handler a no-op without a flag.' }
    ]
  }
}

/**
 * The rail label: the stage the case actually stands at, its position, and the
 * total. An `open` stage AFTER the current one takes over the label; an `open`
 * stage BEFORE it is appended as unresolved-earlier instead.
 */
export function stageLabel(view: LifecycleView): string {
  const nowIndex = view.stages.findIndex(stage => stage.state === 'now')
  let index = nowIndex < 0 ? 0 : nowIndex
  view.stages.forEach((stage, i) => {
    if (stage.state === 'open' && i > index) index = i
  })
  const earlier = view.stages.filter((stage, i) => stage.state === 'open' && i < index).length
  const base = `${view.stages[index].name} · ${index + 1} of ${view.stages.length}`
  return earlier ? `${base} · ${earlier} unresolved earlier` : base
}

/** Amber whenever the case is stalled or carries an unresolved stage. */
export function stageLabelTone(view: LifecycleView): 'amber' | 'muted' {
  return view.stalled || view.stages.some(stage => stage.state === 'open') ? 'amber' : 'muted'
}

/** Both the compact rail dot and the drawer's vertical dot read this. */
export function dotColor(state: StageState, stalled: boolean): string {
  switch (state) {
    case 'done':
      return 'var(--color-success)'
    case 'now':
      return stalled ? 'var(--accent-drawio-500)' : 'var(--color-blue-600)'
    case 'open':
      return 'var(--accent-drawio-500)'
    case 'skip':
      return '' // transparent with a ring — never entered
    default:
      return 'var(--gray-200)'
  }
}

export { human, iso }

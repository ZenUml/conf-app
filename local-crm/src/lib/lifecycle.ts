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

export function ticketOf(grant: Grant): string | null {
  return TICKET.test(String(grant.origin ?? '')) ? grant.origin : null
}

export function jsmOf(data: Dataset, grant: Grant): JsmTicket | null {
  return data.jsm[String(grant.origin ?? '')] ?? null
}

/** The requester line, or the reason there is no single one. */
export function requesterOf(data: Dataset, grant: Grant): string {
  const ticket = jsmOf(data, grant)
  if (ticket) return ticket.requester
  return grant.wide
    ? 'whole space — no single requester'
    : 'no request; account id in the KV key was not carried through'
}

/**
 * Where a grant sits in the Extension state machine, read off the data rather
 * than stored. There is no status column: KV carries `status: "active"` plus an
 * `expiresAt`, and nothing else.
 */
export function grantState(data: Dataset, grant: Grant): [string, string] {
  if (grant.kind === 'test marker') {
    return [
      'applied · test marker',
      'A synthetic grant left behind by an upgrade-prompt end-to-end test. It lives in the same store as real ones and runs to 31 Dec 2027.'
    ]
  }
  if (grant.domain.startsWith('(')) {
    return [
      'needs-details',
      'The cloud ID in this key matches no site in the Marketplace export, so the eligibility evidence behind it cannot be rebuilt.'
    ]
  }
  if (!TICKET.test(String(grant.origin ?? ''))) {
    return [
      'outside the request flow',
      `Activated by ${grant.origin}. There was no request, no eligibility check and no reply — the state machine never saw this grant.`
    ]
  }
  // Day-granular and strictly earlier missed the case the console exists to
  // show: two writes to the same space on the same day. Order inside a day is
  // not recorded, so the second row in dataset order carries the repeat.
  const siblings = data.grants.filter(
    other => other.domain === grant.domain && other.space === grant.space
  )
  const position = siblings.indexOf(grant)
  const repeat = siblings.some(
    (other, index) =>
      other !== grant &&
      (iso(other.created) < iso(grant.created) ||
        (iso(other.created) === iso(grant.created) && index < position))
  )
  if (repeat) {
    return [
      'already-applied',
      'This space was granted before. With no ExtensionAction row, nothing stopped a second grant and nothing records that it was a repeat.'
    ]
  }
  return [
    'applied, unverified',
    `Granted from ${grant.origin} and never read back. The write is the only evidence that it worked.`
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
    const state = grantState(data, grant)[0]
    const needsDetails = state === 'needs-details'
    return {
      stalled: needsDetails,
      branches: 'Branch states not entered: not-grantable, needs-retry.',
      stages: [
        {
          name: 'received',
          state: ticket ? 'done' : 'skip',
          note: ticket
            ? `${ticket} is the request this grant came from.`
            : `No request exists. ${grant.origin} wrote straight to KV.`
        },
        {
          name: 'needs-details',
          state: needsDetails ? 'now' : 'skip',
          note: needsDetails ? 'The cloud ID resolves to no site in the export.' : ''
        },
        {
          name: 'checking',
          state: 'skip',
          note: 'No eligibility check is recorded. The space macro count, the metric age and the paid rail were never read for this grant.'
        },
        {
          name: 'ready-to-grant',
          state: 'skip',
          note: 'Never entered, so no Site Contact notification was built and nothing gated the write.'
        },
        {
          name: 'applying',
          state: needsDetails ? 'todo' : 'done',
          note: 'The KV write happened. No pending audit row guarded it against a concurrent replay.'
        },
        {
          name: 'applied',
          state: needsDetails ? 'todo' : 'now',
          note: needsDetails ? '' : 'Claimed by the write alone. The readback that would confirm it has not run.'
        },
        {
          name: 'already-applied',
          state: state === 'already-applied' ? 'open' : 'skip',
          note:
            state === 'already-applied'
              ? 'This space has been granted before and nothing recorded that this was a repeat.'
              : ''
        }
      ]
    }
  }

  if (kind === 'expired' && grant) {
    const past = iso(grant.expires) <= data.today
    return {
      stalled: past,
      branches: 'Branch states not entered: closed-unresolved, do-not-contact.',
      stages: [
        { name: 'detected', state: 'done', note: 'Derived from the KV expiresAt. No expiry event was ever persisted, so this row is reconstructed each load.' },
        {
          name: 'needs-evidence',
          state: past ? 'now' : 'todo',
          note: past
            ? 'The access impact is unchecked and no reachable site contact is resolved for this cloud ID.'
            : 'Not reached — the grant is still running.'
        },
        { name: 'not-actionable', state: 'skip', note: 'Where this lands if no contact can be safely reached.' },
        { name: 'ready-to-contact', state: 'todo', note: 'Needs the event, the impact and the contact relationship all explainable.' },
        { name: 'contacted', state: 'todo', note: 'Nothing has ever been sent after an expiry.' },
        { name: 'context-confirmed', state: 'todo', note: 'Would record ownership, a routing, background, or a refusal to be contacted.' },
        { name: 'recovery-in-progress', state: 'todo', note: 'Renewal or a re-granted extension runs in its own flow, not from here.' },
        { name: 'resolved', state: 'todo', note: '' }
      ]
    }
  }

  // A grant or expiry case arriving without its grant used to fall through to
  // the ingest run's stages. The evidence is absent; the view states that.
  if (kind === 'granted' || kind === 'expired') {
    return {
      stalled: true,
      branches: '',
      stages: [
        {
          name: 'evidence unavailable',
          state: 'open',
          note: 'This case carries no grant record, so no stage of the extension flow can be read.'
        }
      ]
    }
  }

  if (kind !== 'ingest') {
    throw new RangeError(`lifecycleOf: no lifecycle for case kind ${JSON.stringify(kind)}`)
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
  if (view.stages.length === 0) return 'no stages recorded'
  const nowIndex = view.stages.findIndex(stage => stage.state === 'now')
  const aheadIndex = view.stages.findIndex(
    stage => stage.state !== 'done' && stage.state !== 'skip'
  )
  let index = nowIndex >= 0 ? nowIndex : aheadIndex >= 0 ? aheadIndex : view.stages.length - 1
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

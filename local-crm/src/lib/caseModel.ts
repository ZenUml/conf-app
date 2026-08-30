import type { Dataset } from '@/data/types'
import type { CaseEvent } from './derive'
import { count, hostname, human, iso, relative } from './format'
import {
  grantState,
  grantStatusOf,
  jsmOf,
  lifecycleOf,
  recordedTicketOf,
  requesterOf,
  ticketOf,
  type LifecycleView
} from './lifecycle'
import { PRODUCT, type ChipTone } from './palette'

/** A row in the 118px fact grid. `problem` renders the value in danger red. */
export interface Fact {
  k: string
  v: string
  problem?: boolean
}

function available(value: string | null | undefined, reason: string | null | undefined): string {
  return value ?? `unavailable — ${reason ?? 'source fact unavailable'}`
}

export interface ActionSpec {
  key: string
  label: string
  cta?: string
  note?: string
  /** Present when the action cannot run at all. Carries the reason, not a hint. */
  blocked?: string
  confirm?: boolean
  confirmText?: string
  tone?: 'primary' | 'danger'
  /** Rendered inline after the action runs. Nothing here performs a real write. */
  result?: string
}

export interface Track {
  name: string
  who: string
  state: string
  chip: ChipTone
  rows: Fact[]
}

/** Retention only: which of the four departure types this event actually is. */
export interface DepartureClass {
  name: string
  verdict: string
  note: string
  applies: boolean
}

export interface CaseModel {
  caseType: string
  status: string
  statusChip: ChipTone
  who: string
  what: string
  date: string
  rel: string
  lifecycle: LifecycleView
  facts: Fact[]
  actions: ActionSpec[]
  /** Action key promoted into the Only-next-step block, if any. */
  nextKey: string
  nextLabel: string
  nextWhy: string
  /** Non-empty means blocked: every write-class action is suppressed. */
  blockers: string[]
  classes: DepartureClass[]
  tracks: Track[]
  commsNote: string
  audits: Fact[]
  provenance: string
  footer: string
}

export function buildCase(data: Dataset, event: CaseEvent): CaseModel {
  const common = {
    who: event.who,
    what: event.what,
    date: human(event.day),
    rel: relative(event.day, data.today),
    lifecycle: lifecycleOf(data, event.kind, event.grant ?? null)
  }

  if (event.kind === 'registered' && event.registration) {
    return { ...common, ...registeredCase(data, event.registration) }
  }
  if (event.kind === 'granted' && event.grant) {
    return { ...common, ...grantedCase(data, event.grant) }
  }
  if (event.kind === 'expired' && event.grant) {
    return { ...common, ...expiredCase(data, event.grant) }
  }
  return { ...common, ...ingestCase(data) }
}

type CaseBody = Omit<CaseModel, 'who' | 'what' | 'date' | 'rel' | 'lifecycle'>

function registeredCase(data: Dataset, row: Dataset['registrations'][number]): CaseBody {
  const product = PRODUCT[row.p]
  const template = `welcome-${product.name}.html`
  return {
    caseType: 'Welcome',
    status: 'blocked',
    statusChip: 'blocked',
    facts: [
      { k: 'cloud_id', v: row.cloudId },
      { k: 'app', v: product.name },
      { k: 'licence', v: row.licence },
      { k: 'seats', v: row.tier },
      { k: 'first seen', v: `${human(iso(row.seen))} (Marketplace)` },
      { k: 'contact', v: 'dropped at extraction', problem: true },
      { k: 'step', v: 'welcome · held as backlog' },
      { k: 'welcome sent', v: 'no — 0 touchpoints', problem: true }
    ],
    actions: [
      // Defined for the record and then filtered out before rendering: with the
      // ESP unverified there is nothing a rendered preview could be checked against.
      {
        key: 'preview',
        label: 'Preview the welcome email',
        cta: 'Render',
        note: `Renders ${template} with this contact’s data to disk. Nothing is sent.`,
        result: `Rendered to out/preview/${product.name}-${row.domain}.html. Two merge tags are still literal placeholder text.`
      },
      {
        key: 'release',
        label: 'Release from the backlog hold',
        cta: 'Release',
        confirm: true,
        tone: 'primary',
        confirmText:
          'This makes the contact due on the next sender run. Delivery is still blocked, so nothing leaves the machine today.',
        note: 'The bootstrap hold is the only thing keeping this contact out of the drip.',
        result:
          'Released. The next run will treat it as due — and fail at the ESP until the sending domain is verified.'
      },
      {
        key: 'profile',
        label: 'Pull the full client profile',
        cta: 'Run',
        note: 'Paid status, install history and licence timeline for this domain.',
        result: `Profile returned for ${hostname(row.domain)} — forge-direct install, no Connect history, no paid rail.`
      },
      {
        key: 'internal',
        label: 'Mark as internal and exclude',
        cta: 'Exclude',
        confirm: true,
        tone: 'danger',
        confirmText:
          'Excluded domains disappear from every future acquisition count. Only do this for our own tenants.',
        note: 'Use for test and staff tenants that would otherwise read as growth.',
        result: 'Added to the internal domain list. Future ingests will skip it and past counts will restate.'
      }
    ],
    nextKey: '',
    nextLabel: 'Fix the send preconditions',
    nextWhy:
      'Nothing about this contact is wrong. The sender itself cannot deliver, so the case cannot reach ready-to-send and no send action is offered.',
    blockers: [
      'support@zenuml.com is not a verified sending domain at Resend — every attempt fails at the ESP',
      `The unsubscribe and preference URLs in ${template} are still literal placeholder text`,
      'Two merge tags render as raw tokens instead of this site’s values',
      'The welcome sender has no connected live run and no run history table to write to'
    ],
    classes: [],
    tracks: [
      {
        name: 'Email delivery',
        who: 'operations → Site Technical Contact',
        state: 'no attempt',
        chip: 'skipped',
        rows: [
          { k: 'touchpoint', v: 'none — 0 email_sent rows for this contact', problem: true },
          { k: 'esp id', v: 'n/a' },
          { k: 'template', v: `${template}, version unpinned`, problem: true }
        ]
      },
      {
        name: 'Contact reply',
        who: 'owns · routed · contact-corrected · do-not-contact',
        state: 'not possible',
        chip: 'skipped',
        rows: [
          { k: 'reply', v: 'no message was sent, so no reply can exist', problem: true },
          { k: 'address', v: 'unavailable — no source-backed contact address fact is present in this dataset', problem: true }
        ]
      },
      {
        name: 'Site-level signal',
        who: 'evidence from the site, never attributed to the recipient',
        state: 'none joined',
        chip: 'skipped',
        rows: [
          { k: 'first macro', v: 'not joined — no usage table reaches this cloud ID', problem: true },
          { k: 'save / embed', v: 'not joined', problem: true }
        ]
      }
    ],
    commsNote:
      'These three tracks stay separate on purpose. A delivered email is not a routed contact, and a routed contact is not site usage.',
    audits: [
      { k: 'touchpoints', v: '0', problem: true },
      { k: 'eligibility cols', v: 'absent — migration 0025 is unapplied', problem: true },
      { k: 'run log', v: 'the table does not exist', problem: true },
      { k: 'suppression', v: 'held as backlog (bootstrap hold)' },
      { k: 'operator', v: '—' },
      { k: 'last change', v: `ingest write, ${data.ingest.runAt}` }
    ],
    provenance:
      'new_customers.py --sync --app all · verdict NEW · joined to licenses.raw on cloudSiteHostname',
    footer: 'No welcome can actually be delivered until support@zenuml.com is verified at Resend.'
  }
}

function grantedCase(data: Dataset, grant: Dataset['grants'][number]): CaseBody {
  const ticket = ticketOf(grant)
  const recordedTicket = recordedTicketOf(grant)
  const jsm = jsmOf(data, grant)
  const [state, why] = grantState(data, grant)
  const needsDetails = state === 'needs-details' || state === 'site mapping unavailable'
  const keyPath = `license:${grant.cloudId ?? '<cloudId>'}:${grant.space}${grant.wide ? '' : ':<accountId>'}`
  const auditCount = grant.actionAudit?.length ?? 0
  const currentState = grantStatusOf(grant)
  const marketplace = grant.marketplace ?? []
  const marketplaceUnavailable = Boolean(
    grant.unknowns?.includes('Marketplace site mapping is unavailable')
  )
  const jsmUnavailable = Boolean(
    grant.unknowns?.includes('JSM request matching is unavailable')
  )
  const auditUnavailable = Boolean(
    grant.unknowns?.includes('ExtensionAction audit source is unavailable')
  )
  const correlatedOnly = Boolean(
    ticket && !recordedTicket && grant.requestMatchedBy === 'domain_space'
  )

  const facts: Fact[] = [
    { k: 'requester', v: requesterOf(data, grant), problem: !jsm && !grant.wide },
    {
      k: 'identity',
      v: jsm
        ? jsm.portalUnsigned === true
          ? 'self-asserted — filed from the portal while not signed in'
          : jsm.portalUnsigned === false
            ? 'signed-in Atlassian account'
            : 'unknown — authentication state unavailable from this JSM payload'
        : 'unknown',
      problem: Boolean(jsm && jsm.portalUnsigned !== false)
    },
    {
      k: 'target account',
      v: grant.wide ? 'n/a — whole space' : (grant.userAccountId ?? jsm?.accountId ?? 'unknown'),
      problem: !grant.wide && !grant.userAccountId && !jsm
    }
  ]
  // Conditional rows appear only on mismatch — never a row that repeats its neighbour.
  if (!marketplaceUnavailable && jsm?.typedDomain) {
    if (!grant.domain) {
      facts.push({ k: 'typed domain', v: `${jsm.typedDomain} — requester-typed and unverified; Marketplace resolved no site`, problem: true })
    } else if (jsm.typedDomain !== grant.domain) {
      facts.push({ k: 'typed domain', v: `${jsm.typedDomain} — does not resolve to this site`, problem: true })
    }
  }
  if (jsm?.typedSpace && jsm.typedSpace !== grant.space) {
    facts.push({ k: 'typed space', v: `${jsm.typedSpace} — does not match the granted space`, problem: true })
  }
  if (jsm && jsm.note) {
    facts.push({ k: 'flag', v: jsm.note, problem: true })
  }
  if (jsm?.macroCount !== null && jsm?.macroCount !== undefined) {
    facts.push({
      k: 'request macro count',
      v: `${jsm.macroCount}${jsm.macrosLimit !== null && jsm.macrosLimit !== undefined ? ` · limit ${jsm.macrosLimit}` : ' · limit unknown'}`
    })
  }
  facts.push(
    { k: 'space', v: grant.space },
    { k: 'scope', v: grant.wide ? 'whole space' : 'one requester' },
    { k: 'duration', v: grant.days ?? 'duration unknown' },
    { k: 'activatedBy', v: available(grant.activatedBy ?? grant.origin, grant.originUnavailableReason) },
    { k: 'granted', v: available(grant.created, grant.createdUnavailableReason) },
    { k: 'expires', v: available(grant.expires, grant.expiresUnavailableReason) },
    { k: 'state', v: currentState, problem: currentState !== 'active' },
    {
      k: 'Marketplace',
      v: marketplaceUnavailable
        ? 'source unavailable — no mapping or licence claim can be made'
        : marketplace.length
        ? marketplace.map(row => `${row.app} · ${row.licenseType ?? 'type unknown'} · ${row.status ?? 'status unknown'} · ${row.tier ?? 'tier unknown'}`).join(' | ')
        : 'no licence row matched this cloud ID',
      problem: marketplaceUnavailable || marketplace.length === 0
    },
    {
      k: 'ExtensionAction',
      v: auditUnavailable
        ? 'source unavailable'
        : auditCount
          ? `${auditCount} matching ${auditCount === 1 ? 'row' : 'rows'}`
          : 'no exact-target row matched',
      problem: auditUnavailable || auditCount === 0
    }
  )
  if (grant.unknowns?.length) {
    facts.push({ k: 'source unknowns', v: grant.unknowns.join(' · '), problem: true })
  }

  const actions: ActionSpec[] = [
    {
      key: 'verify',
      label: 'Review the current KV read',
      cta: 'Review',
      tone: 'primary',
      note: 'Uses the value already returned by the loopback API; this performs no write.',
      result: `${keyPath} was observed ${currentState}, with expiry ${grant.expires}${grant.sourceObservedAt ? `, at ${grant.sourceObservedAt}` : ''}.`
    },
    ticket && jsm
      ? {
          key: 'ticket',
          label: `Review ${correlatedOnly ? 'correlated ' : ''}${ticket} evidence`,
          cta: 'Review',
          note: correlatedOnly
            ? 'Correlated by exact domain, space, target scope and causal time; not proven to be the grant origin.'
            : 'Matched by the ticket key recorded in activatedBy.',
          result: `${ticket} is ${jsm.status ?? `unavailable (${jsm.unavailableReasons?.status ?? 'JSM status was unavailable'})`}; ${jsm.commentsKnown ? `${jsm.publicComments ?? 0} public comments are visible` : 'comment evidence is unavailable'}.${correlatedOnly ? ' This remains contextual correlation, not grant-origin proof.' : ''}`
        }
      : {
          key: 'ticket',
          label: jsmUnavailable
            ? 'JSM request evidence unavailable'
            : ticket
              ? `${ticket} was not returned by JSM`
              : 'No JSM candidate matched',
          blocked: jsmUnavailable
            ? 'The JSM source failed, so absence cannot be established.'
            : ticket
              ? 'The grant names a ticket, but the JSM source did not return it.'
              : needsDetails
                ? 'No explicit ticket is recorded, and domain correlation requires a verified Marketplace site.'
                : 'Neither activatedBy nor the exact domain + space + target + time fallback matched a request in the fetched JSM window.',
          note: 'No conversation facts are inferred without a matching request.'
        },
    {
      key: 'feedback',
      label: 'Feedback extension is read-only here',
      blocked: 'This first integrated slice exposes GET endpoints only; no mutation endpoint is available.',
      note: 'The console will not imply that an extension or JSM reply was written.'
    },
    {
      key: 'revoke',
      label: 'Revoke is read-only here',
      blocked: 'This first integrated slice exposes GET endpoints only; no KV delete endpoint is available.',
      note: 'The current grant remains unchanged.'
    }
  ]

  const statusChip: ChipTone =
    state === 'needs-details' || state === 'site mapping unavailable' || state === 'status unknown'
      ? 'failed'
      : state === 'inactive, KV-observed'
        ? 'lapsed'
        : state === 'applied, audited'
          ? 'sent'
          : state === 'applied, audit pending' || state === 'applied, KV-observed' || state === 'applied, unverified'
            ? 'pending'
            : 'blocked'

  const requesterRows: Fact[] = ticket
    ? jsm
      ? [
          { k: 'requester', v: jsm.requester ?? `unavailable — ${jsm.unavailableReasons?.requester ?? 'JSM reporter identity was unavailable'}`, problem: !jsm.requester },
          {
            k: 'identity',
            v: jsm.portalUnsigned === true
              ? 'self-asserted from the portal, unsigned'
              : jsm.portalUnsigned === false
                ? 'signed-in account'
                : 'unknown — authentication state unavailable from this JSM payload',
            problem: jsm.portalUnsigned !== false
          },
          {
            k: 'public comments',
            v: jsm.commentsKnown
              ? `${jsm.publicComments ?? 0}; last comment ${jsm.lastReply ?? `unavailable — ${jsm.unavailableReasons?.lastReply ?? 'JSM comment timestamp was unavailable'}`}`
              : 'unknown — comment fetch failed',
            problem: !jsm.commentsKnown
          },
          ...(jsm.note ? [{ k: 'flag', v: jsm.note, problem: true }] : []),
          {
            k: 'delivered',
            v: 'unknown — JSM comment presence is not per-recipient delivery',
            problem: true
          },
          {
            k: 'requester comments',
            v: jsm.requesterComments === null || jsm.requesterComments === undefined
              ? 'unknown — requester account could not be matched'
              : `${jsm.requesterComments} public comments matched the reporter account`,
            problem: jsm.requesterComments === null || jsm.requesterComments === undefined
          },
          { k: 'last comment author', v: jsm.lastCommentAuthor ?? 'unknown' },
          { k: 'jsm status', v: jsm.status ?? `unavailable — ${jsm.unavailableReasons?.status ?? 'JSM status was unavailable'}`, problem: !jsm.status }
        ]
      : [
          {
            k: 'request',
            v: jsmUnavailable
              ? `${ticket} — JSM source unavailable`
              : `${ticket} — not present in the JSM pull`
          },
          { k: 'sent', v: 'unknown', problem: true },
          { k: 'replied', v: 'unknown', problem: true }
        ]
    : [
        { k: 'channel', v: `activated by ${grant.origin}; no explicit ZEN ticket is linked`, problem: true },
        {
          k: 'conversation',
          v: jsmUnavailable
            ? 'unknown — JSM request source is unavailable'
            : needsDetails
              ? 'unknown — no explicit ticket is recorded; correlation cannot run without a verified Marketplace site'
              : 'no request conversation candidate matched in the fetched JSM window',
          problem: true
        }
      ]

  return {
    caseType: 'Extension',
    status: state,
    statusChip,
    facts,
    actions,
    nextKey: needsDetails ? '' : 'verify',
    nextLabel: needsDetails
      ? 'Resolve the cloud ID before touching this grant'
      : 'Review the current KV evidence',
    nextWhy: needsDetails
      ? why
      : why,
    blockers: needsDetails
      ? [
          marketplaceUnavailable
            ? `Marketplace site mapping for the cloud ID in ${keyPath} is unavailable`
            : marketplace.length
              ? `Marketplace licence context is present but no site hostname is available for the cloud ID in ${keyPath}`
              : `The cloud ID in ${keyPath} matches no row in the Marketplace export`,
          'Without a verified site mapping there is no independently verified site-metrics count, paid-rail check or contact to notify',
          'Revoking blind would end editing for a site that cannot be independently identified here'
        ]
      : [],
    classes: [],
    tracks: [
      {
        name: 'Requester',
        who: correlatedOnly
          ? `reporter on correlated ${ticket}; not proven grant origin`
          : ticket
            ? `requester on explicitly linked ${ticket}`
            : jsmUnavailable
              ? 'request evidence unavailable'
              : 'no request linked to this grant',
        state: correlatedOnly ? 'correlated context' : ticket ? 'ticket linked' : 'no linked channel',
        chip: ticket ? 'pending' : 'skipped',
        rows: requesterRows
      },
      {
        name: 'Site Contact',
        who: 'the site’s technical contact, for transparency and correction',
        state: 'unknown',
        chip: 'skipped',
        rows: [
          { k: 'notification', v: 'unknown — this source slice does not fetch Site Contact delivery', problem: true },
          { k: 'governance reply', v: 'unknown — no Site Contact reply source is joined', problem: true }
        ]
      }
    ],
    commsNote:
      'Requester-ticket evidence and Site Contact evidence remain separate; a JSM comment is never presented as site-level consent.',
    audits: [
      {
        k: 'ExtensionAction',
        v: auditUnavailable
          ? 'source unavailable'
          : auditCount
            ? `${auditCount} matching ${auditCount === 1 ? 'row' : 'rows'}`
            : '0 exact-target rows',
        problem: auditUnavailable || auditCount === 0
      },
      {
        k: 'KV observation',
        v: grant.sourceObservedAt ?? 'not live — fixture row',
        problem: !grant.sourceObservedAt
      },
      { k: 'stored status', v: grant.storedStatus ?? 'unknown' },
      ...((grant.actionAudit ?? []).map((row, index) => ({
        k: `action ${index + 1}`,
        v: `${row.action} · ${row.status} · macros ${row.macroCount ?? 'unknown'} · expires ${row.expiresAt ?? 'unknown'}`
      }))),
      ...((grant.history ?? []).map((row, index) => ({
        k: `history ${index + 1}`,
        v: `${row.label} · ${row.at ?? 'time unknown'} · ${row.evidence}`
      }))),
      { k: 'operator/source', v: available(grant.activatedBy ?? grant.origin, grant.originUnavailableReason) }
    ],
    provenance: grant.sourceObservedAt
      ? `Loopback API · SPACE_LICENSE_KV current value + ${marketplaceUnavailable ? 'Marketplace unavailable' : 'Marketplace'} + ${jsmUnavailable ? 'JSM unavailable' : 'JSM'} + ${auditUnavailable ? 'ExtensionAction D1 unavailable' : 'ExtensionAction D1'} · observed ${grant.sourceObservedAt}`
      : 'Sanitized fixture; no live source observation is attached.',
    footer: auditUnavailable
      ? 'ExtensionAction D1 was unavailable; action-history absence cannot be established.'
      : auditCount
      ? 'The drawer shows the matching ExtensionAction evidence returned by D1.'
      : 'Production D1 returned no exact-target ExtensionAction row for this current grant; only current KV timestamps can be shown as history.'
  }
}

function expiredCase(data: Dataset, grant: Dataset['grants'][number]): CaseBody {
  const currentStatus = grantStatusOf(grant)
  const past = currentStatus === 'expired'
  const expiredCount = data.grants.filter(g => grantStatusOf(g) === 'expired').length
  const activeCount = data.grants.filter(g => grantStatusOf(g) === 'active').length
  const marketplace = grant.marketplace ?? []
  const marketplaceUnavailable = Boolean(
    grant.unknowns?.includes('Marketplace site mapping is unavailable')
  )
  const auditCount = grant.actionAudit?.length ?? 0
  const auditUnavailable = Boolean(
    grant.unknowns?.includes('ExtensionAction audit source is unavailable')
  )
  const evaluationEnds = [...new Set(
    marketplace
      .filter(row => row.app === 'lite' && row.licenseType === 'EVALUATION')
      .map(row => row.evaluationEndsAt)
      .filter((value): value is string => Boolean(value))
  )]
  const evaluationEnd = evaluationEnds.length === 1 ? evaluationEnds[0] : null

  return {
    caseType: 'Retention',
    status: past ? 'needs-evidence' : 'active, expiring',
    statusChip: past ? 'failed' : 'pending',
    facts: [
      { k: 'space', v: grant.space },
      { k: 'scope', v: grant.wide ? 'whole space' : 'one requester' },
      { k: 'granted', v: available(grant.created, grant.createdUnavailableReason) },
      { k: 'ran', v: grant.days ?? 'duration unknown' },
      { k: 'expires', v: available(grant.expires, grant.expiresUnavailableReason), problem: past },
      { k: 'activatedBy', v: available(grant.activatedBy ?? grant.origin, grant.originUnavailableReason) },
      { k: 'stored status', v: grant.storedStatus ?? 'unknown' },
      { k: 'KV observation', v: grant.sourceObservedAt ?? 'fixture only' },
      {
        k: 'Marketplace',
        v: marketplaceUnavailable
          ? 'source unavailable — no mapping or licence claim can be made'
          : marketplace.length
            ? marketplace.map(row => `${row.app} · ${row.licenseType ?? 'type unknown'} · ${row.status ?? 'status unknown'}`).join(' | ')
            : 'no licence row matched this cloud ID',
        problem: marketplaceUnavailable || marketplace.length === 0
      },
      { k: 'follow-up evidence', v: 'not joined — no follow-up source is connected', problem: true }
    ],
    actions: [
      {
        key: 'convert',
        label: 'Review Marketplace licence context',
        cta: 'Review',
        tone: 'primary',
        note: 'Shows the licence rows already joined by cloud ID; this does not infer conversion.',
        result: marketplaceUnavailable
          ? 'Marketplace source unavailable; absence or licence state cannot be established.'
          : marketplace.length
            ? marketplace.map(row => `${row.app} · ${row.licenseType ?? 'type unknown'} · ${row.status ?? 'status unknown'}`).join(' | ')
            : 'No Marketplace licence row matched this cloud ID.'
      },
      {
        key: 'regrant',
        label: past ? 'Regrant is read-only here' : 'Renew is read-only here',
        blocked: 'This first integrated slice exposes GET endpoints only; no KV write endpoint is available.',
        note: 'The current grant remains unchanged.'
      },
      {
        key: 'note',
        label: 'Case notes are read-only here',
        blocked: 'No case-note store or write endpoint is connected to this slice.',
        note: 'The console will not claim that a note was saved.'
      }
    ],
    nextKey: 'convert',
    nextLabel: past ? 'Review the evidence before making any retention claim' : 'Review the current licence context',
    nextWhy: past
      ? 'The current KV record is past expiresAt. That does not prove the site is blocked, the customer left, or a conversion occurred.'
      : `The current KV record is still active on ${human(data.today)}; this read-only slice does not make a renewal decision.`,
    blockers: [],
    classes: [
      {
        name: 'extension-expired',
        verdict: past ? 'this event' : 'scheduled',
        applies: past,
        note: past
          ? `KV-derived status for ${grant.space} is expired at ${grant.expires}. This does not establish access impact.`
          : `KV-derived status remains active; expiresAt is ${grant.expires}. No expiry is claimed yet.`
      },
      {
        name: 'evaluation-ended',
        verdict: marketplaceUnavailable
          ? 'unknown'
          : evaluationEnd
            ? (evaluationEnd.slice(0, 10) <= data.today ? 'ended' : 'not ended')
            : evaluationEnds.length > 1
              ? 'ambiguous'
              : 'not available',
        applies: Boolean(!marketplaceUnavailable && evaluationEnd && evaluationEnd.slice(0, 10) <= data.today),
        note: marketplaceUnavailable
          ? 'Marketplace source is unavailable; evaluation state cannot be established.'
          : evaluationEnd
            ? `Marketplace evaluationEndsAt is ${evaluationEnd.slice(0, 10)}.`
            : evaluationEnds.length > 1
              ? 'Multiple Lite evaluation end dates are joined; none is selected as canonical.'
              : 'No joined Lite Marketplace evaluation row carries an evaluation end date.'
      },
      {
        name: 'marketplace-lapsed',
        verdict: 'not derivable',
        applies: false,
        note: marketplaceUnavailable
          ? 'Marketplace source is unavailable; neither licence presence nor a lifecycle lapse transition can be established.'
          : marketplace.length
            ? 'Marketplace licence rows are present, but no lifecycle lapse transition is joined to this grant and no cancellation reason is inferred.'
            : 'No Marketplace licence row matched this cloud ID; no lifecycle lapse transition or cancellation reason is inferred.'
      },
      {
        name: 'cancellation-unverified',
        verdict: 'not claimed',
        applies: false,
        note: 'No cancellation event or manual cancellation source is joined to this grant.'
      }
    ],
    tracks: [
      {
        name: 'Site Contact',
        who: 'site-level communication evidence',
        state: 'unknown',
        chip: 'skipped',
        rows: [
          { k: 'sent', v: 'unknown — no expiry-delivery source is joined', problem: true },
          { k: 'contact', v: 'not fetched by this source slice', problem: true },
          { k: 'preference', v: 'unknown — no preference source is joined' }
        ]
      }
    ],
    commsNote:
      'No communication outcome is inferred from the grant expiry or Marketplace licence state.',
    audits: [
      { k: 'original scope', v: grant.wide ? `whole space ${grant.space}` : `${grant.space}, one requester` },
      { k: 'original expiry', v: available(grant.expires, grant.expiresUnavailableReason) },
      { k: 'expiry event', v: 'no separate expiry-event evidence is joined — this row is derived', problem: true },
      {
        k: 'ExtensionAction',
        v: auditUnavailable
          ? 'source unavailable'
          : `${auditCount} matching ${auditCount === 1 ? 'row' : 'rows'}`,
        problem: auditUnavailable || auditCount === 0
      },
      ...((grant.history ?? []).map((row, index) => ({
        k: `history ${index + 1}`,
        v: `${row.label} · ${row.at ?? 'time unknown'} · ${row.evidence}`
      }))),
      { k: 'operator/source', v: available(grant.activatedBy ?? grant.origin, grant.originUnavailableReason) }
    ],
    provenance: grant.sourceObservedAt
      ? `Loopback API · current KV expiresAt observed ${grant.sourceObservedAt} + ${marketplaceUnavailable ? 'Marketplace unavailable' : 'Marketplace'} + ${auditUnavailable ? 'ExtensionAction D1 unavailable' : 'ExtensionAction D1'}; no separate expiry event is stored.`
      : 'Sanitized fixture · derived from expiresAt; no live source observation is attached.',
    footer: past
      ? `${expiredCount} of the ${data.grants.length} current grant records are past expiresAt.`
      : `${activeCount} grants are still active on ${human(data.today)}.`
  }
}

function ingestCase(data: Dataset): CaseBody {
  const { ingest } = data
  return {
    caseType: 'Ingest run',
    status: 'finished, unlogged',
    statusChip: 'blocked',
    facts: [
      { k: 'rows read', v: `${count(ingest.rowsRead)} of ${count(ingest.rowsTotal)}` },
      { k: 'contacts written', v: count(ingest.contactsWritten) },
      {
        k: 'rejected',
        v: `${ingest.rejected} — ${ingest.rejectedNoCloudId} no cloud ID, ${ingest.rejectedRtbf} RTBF, ${ingest.rejectedNoAddress} no address`,
        problem: true
      },
      { k: 'unmapped', v: `${ingest.unmapped} rows for other vendor apps` },
      { k: 'welcomes sent', v: '0', problem: true },
      { k: 'run history', v: 'none — the table does not exist', problem: true }
    ],
    actions: [
      {
        key: 'rerun',
        label: 'Run the ingest again',
        cta: 'Run',
        tone: 'primary',
        note: 'Re-reads the Marketplace export and upserts. Idempotent and safe to repeat.',
        result: `Finished: ${count(ingest.rowsRead)} rows read, ${ingest.rejected} rejected, 0 inserted, ${count(ingest.contactsWritten)} updated.`
      },
      {
        key: 'migrate',
        label: 'Apply migration 0025',
        cta: 'Apply',
        confirm: true,
        confirmText: 'Additive only, but it lands on the database the sender reads from.',
        note: 'Adds the eligibility columns and the run log. Written months ago, applied nowhere.',
        result: '0025 applied to the local D1. Run history and per-contact eligibility now have somewhere to live.'
      },
      {
        key: 'schedule',
        label: 'Turn on the scheduled ingest',
        cta: 'Enable',
        blocked:
          'Four gates are closed: the package is outside the workspace, no deploy job exists, the cron triggers are commented out, and the handler is a no-op unless a flag is set.',
        note: 'Cadence is still undecided — the export rate limits were never measured.'
      }
    ],
    nextKey: 'migrate',
    nextLabel: 'Apply migration 0025',
    nextWhy:
      'The run worked and left no record of itself. Until the run log and eligibility columns exist, every later run is unverifiable and every contact stays held as backlog.',
    blockers: [],
    classes: [],
    tracks: [
      {
        name: 'No external recipient',
        who: 'this is an internal run — nobody is contacted by it',
        state: 'n/a',
        chip: 'skipped',
        rows: [
          { k: 'sent', v: 'the ingest writes contacts, it never messages them' },
          { k: 'downstream', v: `${count(ingest.contactsWritten)} contacts created, all held as backlog`, problem: true }
        ]
      }
    ],
    commsNote: 'The run is the reason the welcome queue exists, and the reason none of it has moved.',
    audits: [
      { k: 'run row', v: 'none — no run history table', problem: true },
      { k: 'schema', v: `local ${ingest.localSchema} · production ${ingest.productionSchema}`, problem: true },
      { k: 'started', v: ingest.runAt },
      { k: 'operator', v: 'laptop, by hand' },
      { k: 'idempotent', v: 'yes — safe to repeat' }
    ],
    provenance: `ingest-licenses.mjs --bootstrap · local miniflare D1, ${ingest.localSchema} schema · production is at ${ingest.productionSchema}`,
    footer: 'Every contact this run created is held as backlog, which is why no welcome followed.'
  }
}

import type { Dataset } from '@/data/types'
import type { CaseEvent } from './derive'
import { count, hostname, human, iso, relative } from './format'
import {
  grantState,
  jsmOf,
  lifecycleOf,
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
          { k: 'address', v: 'dropped at extraction — the contact column was not carried through', problem: true }
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
  const jsm = jsmOf(data, grant)
  const [state, why] = grantState(data, grant)
  const needsDetails = state === 'needs-details'
  const keyPath = `license:<cloudId>:${grant.space}:<accountId>`
  const unconfirmedAuthor = ticket ? data.jsmUnconfirmedAuthor.includes(ticket) : false

  const facts: Fact[] = [
    { k: 'requester', v: requesterOf(data, grant), problem: !jsm && !grant.wide },
    {
      k: 'identity',
      v: jsm
        ? jsm.portalUnsigned
          ? 'self-asserted — filed from the portal while not signed in'
          : 'signed-in Atlassian account'
        : 'unknown',
      problem: Boolean(jsm && jsm.portalUnsigned)
    },
    { k: 'target account', v: jsm ? jsm.accountId : 'not carried through', problem: !jsm }
  ]
  // Conditional rows appear only on mismatch — never a row that repeats its neighbour.
  if (jsm && jsm.typedDomain !== grant.domain) {
    facts.push({ k: 'typed domain', v: `${jsm.typedDomain} — does not resolve to this site`, problem: true })
  }
  if (jsm && jsm.typedSpace !== grant.space) {
    facts.push({ k: 'typed space', v: `${jsm.typedSpace} — does not match the granted space`, problem: true })
  }
  if (jsm && jsm.note) {
    facts.push({ k: 'flag', v: jsm.note, problem: true })
  }
  facts.push(
    { k: 'space', v: grant.space },
    { k: 'scope', v: grant.wide ? 'whole space' : 'one requester' },
    { k: 'duration', v: grant.days ?? '7-day' },
    { k: 'activatedBy', v: grant.origin },
    { k: 'granted', v: human(iso(grant.created)) },
    { k: 'expires', v: grant.expires },
    { k: 'state', v: grant.active ? 'active' : 'expired', problem: !grant.active },
    { k: 'audit row', v: 'none — written straight to KV', problem: true }
  )

  const actions: ActionSpec[] = [
    {
      key: 'verify',
      label: 'Read the licence key back',
      cta: 'Verify',
      tone: 'primary',
      note: 'Confirms the KV record is really active with the expected target and expiry.',
      result: `${keyPath} read back ${grant.active ? `active through ${grant.expires}` : `expired on ${grant.expires}`}.`
    },
    ticket
      ? {
          key: 'ticket',
          label: `Open ${ticket} in the ZEN project`,
          cta: 'Open',
          note: 'The service-desk request this grant came from.',
          result: `Opened ${ticket}. The customer-visible reply and the Waiting for customer transition are both present.`
        }
      : {
          key: 'ticket',
          label: 'No ticket to open',
          blocked: `This grant was activated by ${grant.origin}, not a ZEN request, so there is no conversation behind it.`,
          note: 'Four of the 37 grants are off-convention like this one.'
        },
    ticket
      ? {
          key: 'feedback',
          label: 'Apply the 60-day feedback extension',
          cta: 'Apply',
          confirm: true,
          confirmText:
            'Only after reading the reply and confirming it answers all four questions. This posts publicly and resolves the request.',
          note: 'Renews the same requester for sixty days in exchange for product feedback.',
          result: 'Applied. New expiry written, public reply posted, request resolved.'
        }
      : {
          key: 'feedback',
          label: 'Feedback extension unavailable',
          blocked:
            'The endpoint derives its target from an applied initial action on the same ticket. There is none.',
          note: 'Space-wide and arbitrary durations stay manual exceptions.'
        },
    {
      key: 'revoke',
      label: 'Revoke the grant',
      cta: 'Revoke',
      confirm: true,
      tone: 'danger',
      confirmText: 'Editing access ends the moment the key is deleted, with no notice to the customer.',
      note: 'Deletes the KV record ahead of its expiry.',
      result: 'Key deleted. Editing access ended immediately; license-index updated.'
    }
  ]

  const statusChip: ChipTone =
    state === 'needs-details'
      ? 'failed'
      : state === 'already-applied'
        ? 'lapsed'
        : state === 'applied, unverified'
          ? 'pending'
          : 'blocked'

  const requesterRows: Fact[] = ticket
    ? jsm
      ? [
          { k: 'requester', v: jsm.requester },
          {
            k: 'identity',
            v: jsm.portalUnsigned ? 'self-asserted from the portal, unsigned' : 'signed-in account',
            problem: jsm.portalUnsigned
          },
          {
            k: 'sent',
            v: unconfirmedAuthor
              ? `${jsm.replies} public comment on ${jsm.lastReply}, authored by Automation for Jira — the pull could not confirm it came from us`
              : `${jsm.replies} public ${jsm.replies === 1 ? 'reply' : 'replies'}, last on ${jsm.lastReply}`,
            problem: unconfirmedAuthor
          },
          ...(jsm.note ? [{ k: 'flag', v: jsm.note, problem: true }] : []),
          {
            k: 'delivered',
            v: 'posted on the ticket — JSM does not expose per-recipient delivery',
            problem: true
          },
          {
            k: 'replied',
            v: `no customer-authored comment exists${
              jsm.status === 'Waiting for customer'
                ? `; still Waiting for customer since ${jsm.lastReply}`
                : '; closed by us, not by them'
            }`,
            problem: true
          },
          { k: 'jsm status', v: jsm.status }
        ]
      : [
          { k: 'request', v: `${ticket} — not present in the JSM pull` },
          { k: 'sent', v: 'unknown', problem: true },
          { k: 'replied', v: 'unknown', problem: true }
        ]
    : [
        { k: 'channel', v: `activated by ${grant.origin}, not a ZEN request`, problem: true },
        { k: 'sent', v: 'nothing — there is no conversation to reply on', problem: true }
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
      : 'Read the licence key back',
    nextWhy: needsDetails
      ? why
      : `${why} Nothing has compared the stored record against the intended cloud ID, space and expiry.`,
    blockers: needsDetails
      ? [
          `The cloud ID in ${keyPath} matches no row in the Marketplace export`,
          'Without a site there is no macro count, no paid-rail check and no contact to notify',
          'Revoking blind would end editing for a site nobody here can name'
        ]
      : [],
    classes: [],
    tracks: [
      {
        name: 'Requester',
        who: ticket ? `the person who hit the paywall, via ${ticket}` : 'no request behind this grant',
        state: ticket ? 'ticket exists' : 'no channel',
        chip: ticket ? 'pending' : 'skipped',
        rows: requesterRows
      },
      {
        name: 'Site Contact',
        who: 'the site’s technical contact, for transparency and correction',
        state: 'never notified',
        chip: 'skipped',
        rows: [
          { k: 'queued', v: 'no — the grant endpoint sends nothing to the site contact', problem: true },
          { k: 'governance reply', v: 'no route exists to correct ownership or scope', problem: true }
        ]
      }
    ],
    commsNote:
      'The spec asks for two independent tracks so a requester reply is never read as site-level consent. Only one of them is wired.',
    audits: [
      { k: 'ExtensionAction', v: 'no row — written straight to KV', problem: true },
      { k: 'kv readback', v: 'not run' },
      { k: 'idempotency', v: 'a replay cannot be told from a first grant', problem: true },
      { k: 'operator', v: grant.origin },
      { k: 'written', v: human(iso(grant.created)) },
      { k: 'retries', v: 'none recorded' }
    ],
    provenance: `SPACE_LICENSE_KV · key listing + value read · ${data.grants.length} license:* records, ${new Set(data.grants.map(g => g.domain)).size} tenants`,
    footer: 'ExtensionAction holds no row for this grant, so a replay cannot be told from a first grant.'
  }
}

function expiredCase(data: Dataset, grant: Dataset['grants'][number]): CaseBody {
  const past = iso(grant.expires) <= data.today
  const expiredCount = data.grants.filter(g => iso(g.expires) <= data.today).length
  const activeCount = data.grants.length - expiredCount

  return {
    caseType: 'Retention',
    status: past ? 'needs-evidence' : 'active, expiring',
    statusChip: past ? 'failed' : 'pending',
    facts: [
      { k: 'space', v: grant.space },
      { k: 'scope', v: grant.wide ? 'whole space' : 'one requester' },
      { k: 'granted', v: human(iso(grant.created)) },
      { k: 'ran', v: grant.days ?? '7-day' },
      { k: 'expires', v: grant.expires, problem: past },
      { k: 'activatedBy', v: grant.origin },
      { k: 'follow-up', v: 'none is automatic', problem: true }
    ],
    actions: [
      {
        key: 'regrant',
        label: past ? 'Grant another seven days' : 'Renew before it runs out',
        cta: past ? 'Grant' : 'Renew',
        tone: 'primary',
        confirm: true,
        confirmText:
          'This reaches a real customer: it writes a live licence record and posts a public reply on the ticket.',
        note: 'The endpoint owns the duration — a day count cannot be passed in.',
        result: 'New grant written and read back active. Public reply posted with the four feedback questions.'
      },
      {
        key: 'convert',
        label: 'Check whether they converted',
        cta: 'Check',
        note: 'Looks for a paid install on this cloud ID before offering more free time.',
        result: `Paid-rail check queued for ${hostname(grant.domain)}.`
      },
      {
        key: 'note',
        label: 'Record what happened',
        cta: 'Add note',
        note: 'Nothing follows an expiry on its own, so the decision to drop it should be written down.',
        result: 'Note attached to this client. It will show in the stream on the next load.'
      }
    ],
    nextKey: past ? 'convert' : 'regrant',
    nextLabel: past ? 'Confirm the access impact before contacting anyone' : 'Decide before it lapses',
    nextWhy: past
      ? 'The key is gone, which is not the same as the site being blocked or the customer having left. Check the paid rail first — a message that claims either without evidence is the thing this queue exists to prevent.'
      : `Still active on ${human(data.today)}. Renewing now is a choice, not a recovery, and it writes a live record.`,
    blockers: [],
    classes: [
      {
        name: 'extension-expired',
        verdict: 'this event',
        applies: true,
        note: `KV expiresAt for ${grant.space} is ${grant.expires}. Confirms only that this grant, for this scope, ended.`
      },
      {
        name: 'evaluation-ended',
        verdict: 'not derivable',
        applies: false,
        note: 'The extraction carries the licence type but not maintenanceEndDate, so the Marketplace evaluation window cannot be checked against this site.'
      },
      {
        name: 'marketplace-lapsed',
        verdict: 'not derivable',
        applies: false,
        note: 'The lifecycle ingest writes absent-or-inactive against a contact record. That flag is not joined to this cloud ID here, and it carries no cancellation reason.'
      },
      {
        name: 'cancellation-unverified',
        verdict: 'not claimed',
        applies: false,
        note: 'No manual lead exists for this site. Any cancellation would enter as unverified and stay that way until a system event backs it.'
      }
    ],
    tracks: [
      {
        name: 'Site Contact',
        who: 'the only external channel — the end user is never the recipient',
        state: 'nothing sent',
        chip: 'skipped',
        rows: [
          { k: 'sent', v: 'no expiry message exists — nothing follows an expiry automatically', problem: true },
          { k: 'contact', v: 'no reachable site contact resolved for this cloud ID', problem: true },
          { k: 'preference', v: 'no do-not-contact record either way' }
        ]
      }
    ],
    commsNote:
      'One track only. This platform does not treat the end user as a recipient, so the requester who lost editing is not written to from here.',
    audits: [
      { k: 'original scope', v: grant.wide ? `whole space ${grant.space}` : `${grant.space}, one requester` },
      { k: 'original expiry', v: grant.expires },
      { k: 'expiry event', v: 'none persisted — this row is derived', problem: true },
      { k: 'follow-up', v: 'none automatic', problem: true },
      { k: 'operator', v: grant.origin },
      { k: 'reopenable', v: 'yes — nothing closes this case' }
    ],
    provenance: 'derived from the KV record’s expiresAt — there is no expiry event in any store',
    footer: past
      ? `${expiredCount} of the ${data.grants.length} grants have expired with no recorded follow-up.`
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

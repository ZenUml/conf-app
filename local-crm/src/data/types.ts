/**
 * The four data sources behind the console, as types.
 *
 * Every field here exists because a screen reads it. Where the real store has
 * no column for something the UI needs, the type says so rather than inventing
 * a default — see `Grant.active` (derived from `expiresAt`, never stored) and
 * `Registration.contact` (absent by design: contacts are dropped at extraction).
 */

/** ADDON_APP_MAP's four values, keyed as the ingest keys them. */
export type AppKey = 'full' | 'lite' | 'dia' | 'api'

/** One licence row appearing for the first time. Verdict NEW only. */
export interface Registration {
  id: string
  /** '27 Aug' — day + short month; a trailing 2-digit year overrides the default. */
  seen: string
  /** Atlassian subdomain prefix, without `.atlassian.net`. */
  domain: string
  /** First 8 characters of the cloud ID. */
  cloudId: string
  p: AppKey
  /** FREE / EVALUATION / COMMERCIAL / LEGACY_FREE / ACADEMIC. */
  licence: string
  /** Seat tier as the export words it, e.g. '697 users' or 'evaluation'. */
  tier: string
  /** Data-quality note shown on the card and in the drawer. */
  flag?: string
}

/**
 * One `license:*` record in SPACE_LICENSE_KV.
 *
 * The key is `license:<cloudId>:<spaceKey>:<accountId>`. Live rows retain the
 * target account segment, while the sanitized fixture may omit it.
 */
export interface Grant {
  /** Stable API id when the row came from the loopback backend. */
  id?: string
  created: string
  createdAt?: string
  updatedAt?: string
  /** '(not in export)' when the cloud ID resolves to no site in the licence export. */
  domain: string
  /** Live Marketplace join result; absent on the sanitized fixture. */
  siteMapping?: 'matched' | 'unmatched' | 'unavailable'
  space: string
  /** Space-wide when true, one requester when absent. */
  wide?: boolean
  /** `activatedBy`, verbatim; never replaced with a correlated request key. */
  origin: string
  expires: string
  expiresAt?: string
  /** Derived at read time from `expiresAt`. There is no persisted expiry event. */
  active?: boolean
  /** Full read-time state. Fixtures without this field fall back to `active`. */
  status?: 'active' | 'expired' | 'inactive' | 'unknown'
  kind?: 'automatic' | 'off-convention' | 'no ticket' | 'outreach' | 'test marker'
  /** '14-day' where the grant broke the 7-day convention. */
  days?: string
  /** Raw KV operator/source. `origin` stays the normalized ticket/bucket label. */
  activatedBy?: string
  /** Ticket recovered directly from `activatedBy`, if present. */
  ticketKey?: string
  /** JSM request correlated to this grant, including guarded domain+space matches. */
  requestTicket?: string
  requestMatchedBy?: 'ticket_key' | 'domain_space'
  cloudId?: string
  userAccountId?: string
  storedStatus?: 'active' | 'inactive' | 'unknown'
  sourceObservedAt?: string
  actionAudit?: Array<{
    action: 'initial' | 'feedback' | 'unknown'
    status: 'pending' | 'applied' | 'unknown'
    macroCount: number | null
    expiresAt: string | null
    createdAt: string | null
    updatedAt: string | null
  }>
  history?: Array<{
    kind: 'kv_record_created' | 'kv_record_updated' | 'extension_action'
    at: string | null
    label: string
    evidence: 'space_license_kv' | 'extension_action_d1'
  }>
  unknowns?: string[]
  marketplace?: Array<{
    app: 'lite' | 'full' | 'diagramly' | 'asyncapi' | 'unknown'
    licenseType: string | null
    status: string | null
    tier: string | null
    evaluationStartedAt: string | null
    evaluationEndsAt: string | null
  }>
}

/**
 * One ZEN service-desk request, keyed by ticket.
 *
 * `portalUnsigned` is tri-state. Live JSM reads leave it null because reporter
 * account-id shape does not prove how the request was authenticated.
 */
export interface JsmTicket {
  requester: string
  /** Target account id, as JSM returns it. */
  accountId: string
  /** Reporter identity used only to classify portal-auth state/comment authorship. */
  reporterAccountId?: string
  status: string
  /** Date of the last public vendor reply. */
  lastReply: string
  replies: number
  /** Domain as the requester typed it — compared against the granted site. */
  typedDomain: string
  /** Space as the requester typed it — compared against the granted space. */
  typedSpace: string
  portalUnsigned: boolean | null
  note: string
  commentsKnown?: boolean
  publicComments?: number | null
  requesterComments?: number | null
  lastCommentAuthor?: string | null
  matchedBy?: 'ticket_key' | 'domain_space'
  macroCount?: number | null
  macrosLimit?: number | null
}

export interface AutomationRule {
  title: string
  badge: string
  tone: 'good' | 'warn' | 'bad'
  scope: string
  items: string[]
  audit: string
}

/** Acquisitions this month for one app, against the new-customers baseline. */
export interface AppCount {
  app: AppKey
  n: number
  /** How the count reads against that app's own baseline. */
  note: string
  /** True when the classifier could not be trusted for this app. */
  unverified?: boolean
}

/** Ingested contacts for one app, split by the step they are parked at. */
export interface StepSplit {
  app: AppKey
  welcome: number
  lapsed: number
}

/** One `activatedBy` bucket on the Extensions screen. */
export interface OriginBucket {
  n: number
  label: string
  accent: 'brand' | 'cerulean' | 'radical' | 'leaf' | 'rust'
  note: string
  pattern: string
}

export interface Dataset {
  /** The date the whole console is read as-of. ISO. */
  today: string
  operator: string
  /** Shown under the wordmark. The console binds to loopback only. */
  origin: string

  marketplace: {
    licences: number
    transactions: number
    /** '29 Aug' */
    syncedOn: string
    vendor: string
    /** 'Marketplace 29 Aug · D1 28 Aug 03:04' */
    freshness: string
  }

  /** The bootstrap ingest run. Counts are what the run itself reported. */
  ingest: {
    rowsRead: number
    rowsTotal: number
    rejected: number
    /** 'no cloud ID' rejections — the group with a possible queue behind it. */
    rejectedNoCloudId: number
    rejectedRtbf: number
    rejectedNoAddress: number
    unmapped: number
    contactsWritten: number
    /** '28 Aug 03:04 UTC' — as the operator would quote it. */
    runAt: string
    /** '28 Aug' — the day the run lands on in the stream. */
    runDay: string
    /** The schema each database is actually at. */
    localSchema: string
    productionSchema: string
  }

  registrations: Registration[]
  grants: Grant[]
  jsm: Record<string, JsmTicket>
  /** Tickets where the pull could not confirm who wrote the reply. */
  jsmUnconfirmedAuthor: string[]

  byApp: AppCount[]
  steps: StepSplit[]
  /** Things the console would show if a store existed for them. */
  gaps: string[]
  origins: OriginBucket[]
  rules: AutomationRule[]

  /** True for the shipped placeholder rows; false for a real extraction. */
  placeholder: boolean
}

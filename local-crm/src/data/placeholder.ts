import type { Dataset } from './types'

/**
 * The dataset this repo ships.
 *
 * Shape-faithful, identity-free. Every count, date, licence type, origin
 * bucket, repeat-grant collision and unresolved cloud ID matches the real
 * 2026-08-29 extraction, because the screens are built around those
 * structures — 9 grants on one tenant across 6 spaces, 2 grants whose cloud ID
 * resolves to nothing, 15 of 37 grants carrying a ZEN ticket, one ticket whose
 * reply authorship is unconfirmed. Only the identities are substituted.
 * Ticket keys and space keys use reserved-looking synthetic sequences so the
 * fixture cannot be mistaken for an exported JSM request or customer space.
 *
 * `docs/policies/client-privacy.md` keeps real tenant hostnames, cloud IDs and
 * contact identities out of the public repo. The real extraction lives in the
 * git-excluded `private/local-data/lifecycle/` and is loaded over the top of
 * this file at runtime — see `./index.ts` and README.md § Real data.
 */
export const placeholderDataset: Dataset = {
  today: '2026-08-29',
  operator: 'peng.xiao',
  origin: 'localhost:7331',

  marketplace: {
    licences: 1771,
    transactions: 5310,
    syncedOn: '29 Aug',
    vendor: '1215266',
    freshness: 'Marketplace 29 Aug · D1 28 Aug 03:04'
  },

  ingest: {
    rowsRead: 1610,
    rowsTotal: 1844,
    rejected: 88,
    rejectedNoCloudId: 67,
    rejectedRtbf: 12,
    rejectedNoAddress: 9,
    unmapped: 234,
    contactsWritten: 1407,
    runAt: '28 Aug 03:04 UTC',
    runDay: '28 Aug',
    localSchema: '0024',
    productionSchema: '0023'
  },

  // 21 defensible NEW rows: 16 lite + 3 full + 2 asyncapi. The four LEGACY_FREE
  // asyncapi rows with 51–453 seats were excluded on inspection — a new customer
  // does not arrive on a lapsed non-paying licence with hundreds of seats.
  registrations: [
    { id: 'g1', seen: '27 Aug', domain: 'example-01', cloudId: 'aa10f001', p: 'lite', licence: 'FREE', tier: '697 users' },
    { id: 'g2', seen: '27 Aug', domain: 'example-02', cloudId: 'aa10f002', p: 'api', licence: 'EVALUATION', tier: 'evaluation', flag: 'only 2 of 6 AsyncAPI rows survived inspection' },
    { id: 'g3', seen: '25 Aug', domain: 'tenant-m', cloudId: 'aa10f003', p: 'full', licence: 'EVALUATION', tier: 'evaluation', flag: 'also holds an expired 7-day extension on space FOR' },
    { id: 'g4', seen: '25 Aug', domain: 'example-04', cloudId: 'aa10f004', p: 'lite', licence: 'FREE', tier: '30 users' },
    { id: 'g5', seen: '25 Aug', domain: 'example-05', cloudId: 'aa10f005', p: 'lite', licence: 'FREE', tier: '17 users' },
    { id: 'g6', seen: '21 Aug', domain: 'example-06', cloudId: 'aa10f006', p: 'lite', licence: 'FREE', tier: '25 users' },
    { id: 'g7', seen: '19 Aug', domain: 'example-07', cloudId: 'aa10f007', p: 'lite', licence: 'FREE', tier: '22 users' },
    { id: 'g8', seen: '18 Aug', domain: 'example-08', cloudId: 'aa10f008', p: 'lite', licence: 'FREE', tier: '250 users' },
    { id: 'g9', seen: '18 Aug', domain: 'example-09', cloudId: 'aa10f009', p: 'lite', licence: 'FREE', tier: '9 users' },
    { id: 'g10', seen: '13 Aug', domain: 'example-10', cloudId: 'aa10f010', p: 'lite', licence: 'FREE', tier: '7 users' },
    { id: 'g11', seen: '13 Aug', domain: 'example-11', cloudId: 'aa10f011', p: 'lite', licence: 'FREE', tier: '1 user' },
    { id: 'g12', seen: '10 Aug', domain: 'example-12', cloudId: 'aa10f012', p: 'full', licence: 'EVALUATION', tier: 'evaluation' },
    { id: 'g13', seen: '10 Aug', domain: 'example-13', cloudId: 'aa10f013', p: 'lite', licence: 'FREE', tier: '29 users' },
    { id: 'g14', seen: '08 Aug', domain: 'example-14', cloudId: 'aa10f014', p: 'lite', licence: 'FREE', tier: '10 users' },
    { id: 'g15', seen: '08 Aug', domain: 'example-15', cloudId: 'aa10f015', p: 'api', licence: 'EVALUATION', tier: 'evaluation', flag: 'only 2 of 6 AsyncAPI rows survived inspection' },
    { id: 'g16', seen: '07 Aug', domain: 'example-16', cloudId: 'aa10f016', p: 'lite', licence: 'FREE', tier: '38 users' },
    { id: 'g17', seen: '07 Aug', domain: 'example-17', cloudId: 'aa10f017', p: 'lite', licence: 'FREE', tier: '132 users' },
    { id: 'g18', seen: '06 Aug', domain: 'example-18', cloudId: 'aa10f018', p: 'lite', licence: 'FREE', tier: '9 users' },
    { id: 'g19', seen: '05 Aug', domain: 'example-19', cloudId: 'aa10f019', p: 'lite', licence: 'FREE', tier: '39 users' },
    { id: 'g20', seen: '03 Aug', domain: 'example-20', cloudId: 'aa10f020', p: 'full', licence: 'EVALUATION', tier: 'evaluation' },
    { id: 'g21', seen: '03 Aug', domain: 'example-21', cloudId: 'aa10f021', p: 'lite', licence: 'FREE', tier: '70 users' }
  ],

  // 37 license:* records, 19 distinct tenants, 11 active on 29 Aug,
  // 22 per-user / 15 space-wide.
  grants: [
    { created: '25 Aug', domain: 'tenant-a', space: 'DEMO01', wide: true, origin: 'experiment:ab-tenant-a-2026-08', expires: '22 Sep', active: true },
    { created: '25 Aug', domain: 'tenant-a', space: 'DEMO02', wide: true, origin: 'experiment:ab-tenant-a-2026-08', expires: '22 Sep', active: true },
    { created: '25 Aug', domain: 'tenant-a', space: 'DEMO03', wide: true, origin: 'experiment:ab-tenant-a-2026-08', expires: '22 Sep', active: true },
    { created: '25 Aug', domain: 'tenant-a', space: 'DEMO04', wide: true, origin: 'experiment:ab-tenant-a-2026-08', expires: '22 Sep', active: true },
    { created: '25 Aug', domain: 'tenant-a', space: 'DEMO05', wide: true, origin: 'experiment:ab-tenant-a-2026-08', expires: '22 Sep', active: true },
    { created: '25 Aug', domain: 'tenant-g', space: 'DEMO06', origin: 'ZEN-990015', expires: '01 Sep', active: true },
    { created: '21 Aug', domain: 'tenant-c', space: 'DEMO07', origin: 'ZEN-990014', expires: '28 Aug' },
    { created: '19 Aug', domain: 'tenant-h', space: 'DEMO08', origin: 'ZEN-990012', expires: '26 Aug' },
    { created: '19 Aug', domain: null, domainUnavailableReason: 'Fixture has no source-backed Marketplace site mapping', space: 'DEMO09', origin: 'ZEN-990013', kind: 'automatic', expires: '26 Aug' },
    { created: '18 Aug', domain: 'tenant-i', space: 'DEMO10', origin: 'ZEN-990011', expires: '26 Aug' },
    { created: '16 Aug', domain: 'tenant-b', space: 'DEMO11', origin: 'ZEN-990010', expires: '23 Aug' },
    { created: '13 Aug', domain: 'tenant-b', space: 'DEMO11', origin: 'ZEN-990009', expires: '20 Aug' },
    { created: '12 Aug', domain: 'tenant-c', space: 'DEMO12', origin: 'ZEN-990008', expires: '19 Aug' },
    { created: '11 Aug', domain: 'tenant-j', space: 'DEMO13', origin: 'ZEN-990006', expires: '19 Aug' },
    { created: '11 Aug', domain: 'tenant-k', space: 'DEMO14', origin: 'ZEN-990007', expires: '19 Aug' },
    { created: '07 Aug', domain: 'tenant-b', space: 'DEMO11', origin: 'ZEN-990016', expires: '03 Sep', active: true },
    { created: '07 Aug', domain: 'tenant-e', space: 'DEMO15', origin: 'ZEN-990005', kind: 'off-convention', expires: '21 Aug' },
    { created: '31 Jul', domain: 'tenant-l', space: 'DEMO16', origin: 'ZEN-990004', days: '14-day', expires: '15 Aug' },
    { created: '28 Jul', domain: 'tenant-m', space: 'DEMO17', origin: 'proactive-champion-watch', kind: 'outreach', expires: '04 Aug' },
    { created: '28 Jul', domain: 'tenant-e', space: 'DEMO18', origin: 'proactive-champion-watch', kind: 'outreach', expires: '04 Aug' },
    { created: '28 Jul', domain: 'tenant-n', space: 'DEMO19', origin: 'proactive-champion-watch', kind: 'outreach', expires: '04 Aug' },
    { created: '25 Jul', domain: 'tenant-a', space: 'DEMO20', origin: 'ZEN-990002', days: '14-day', expires: '08 Aug' },
    { created: '25 Jul', domain: 'tenant-a', space: 'DEMO20', origin: 'ZEN-990003', expires: '02 Aug' },
    { created: '24 Jul', domain: 'tenant-o', space: 'DEMO21', origin: 'temp-14d-extension', days: '14-day', kind: 'no ticket', expires: '07 Aug' },
    { created: '20 Jul', domain: 'tenant-d', space: 'DEMO22', origin: 'temp-7d-extension', kind: 'no ticket', expires: '27 Jul' },
    { created: '16 Jul', domain: 'tenant-f', space: 'DEMO23', origin: 'temp-14d-extension', days: '14-day', kind: 'no ticket', expires: '30 Jul' },
    { created: '15 Jul', domain: 'tenant-a', space: 'DEMO20', origin: 'ZEN-990001', expires: '22 Jul' },
    { created: '30 Jun', domain: 'tenant-c', space: 'DEMO24', wide: true, origin: 'temp-14d-extension', days: '14-day', kind: 'no ticket', expires: '14 Jul' },
    { created: '30 Jun', domain: 'tenant-a', space: 'DEMO20', wide: true, origin: 'experiment:ab-tenant-a-2026-08', expires: '22 Sep', active: true },
    { created: '23 Jun', domain: 'tenant-d', space: 'DEMO22', wide: true, origin: 'temp-14d-extension', days: '14-day', kind: 'no ticket', expires: '19 Jul' },
    { created: '23 Jun', domain: 'tenant-b', space: 'DEMO11', wide: true, origin: 'temp-14d-extension', days: '14-day', kind: 'no ticket', expires: '22 Jul' },
    { created: '22 Jun', domain: 'tenant-d', space: 'DEMO25', wide: true, origin: 'temp-14d-extension', days: '14-day', kind: 'no ticket', expires: '06 Jul' },
    { created: '22 Jun', domain: 'tenant-p', space: 'DEMO26', wide: true, origin: 'temp-14d-extension', days: '14-day', kind: 'no ticket', expires: '07 Jul' },
    { created: '16 Jun', domain: 'tenant-f', space: 'DEMO27', wide: true, origin: 'pengxiao', kind: 'off-convention', expires: '30 Jun' },
    { created: '06 Apr', domain: null, domainUnavailableReason: 'Fixture has no source-backed Marketplace site mapping', space: 'DEMO09', wide: true, origin: 'upgrade-prompt-e2e', kind: 'test marker', expires: '31 Dec 27', active: true },
    { created: '06 Apr', domain: 'example-stg', space: 'DEMO28', wide: true, origin: 'peng', kind: 'off-convention', expires: '06 Apr 27', active: true },
    { created: '26 Nov 25', domain: 'tenant-q', space: 'DEMO29', wide: true, origin: '(customer address)', kind: 'off-convention', expires: '26 Nov', active: true }
  ],

  // 16 tickets. 15 of them carry a `qm:` account id, meaning the request was
  // filed from the portal while not signed in. No ticket carries a
  // customer-authored comment.
  jsm: {
    'ZEN-990001': { requester: 'requester-01@tenant-a.example', accountId: '712020:qm-0185', status: 'Resolved', lastReply: '11 Aug', replies: 2, typedDomain: 'tenant-a', typedSpace: 'DEMO20', portalUnsigned: true, note: '' },
    'ZEN-990002': { requester: 'requester-02@personal.example', accountId: '712020:qm-0191', status: 'Resolved', lastReply: '11 Aug', replies: 2, typedDomain: 'tenant-a', typedSpace: 'DEMO20', portalUnsigned: true, note: 'personal mail address, not a tenant-a domain' },
    'ZEN-990003': { requester: 'requester-03@tenant-a.example', accountId: '712020:qm-0192', status: 'Resolved', lastReply: '11 Aug', replies: 2, typedDomain: 'tenant-a', typedSpace: 'DEMO20', portalUnsigned: true, note: '' },
    'ZEN-990004': { requester: 'requester-04@tenant-l.example', accountId: '712020:qm-0196', status: 'Waiting for customer', lastReply: '01 Aug', replies: 1, typedDomain: 'tenant-l', typedSpace: 'DEMO16', portalUnsigned: true, note: '' },
    'ZEN-990005': { requester: 'requester-05@tenant-e.example', accountId: '712020:qm-0197', status: 'Waiting for customer', lastReply: '07 Aug', replies: 1, typedDomain: 'tenant-e', typedSpace: 'DEMO15', portalUnsigned: true, note: '' },
    'ZEN-990006': { requester: 'requester-06@tenant-j.example', accountId: '5f00000000000000000000a1', status: 'Waiting for customer', lastReply: '12 Aug', replies: 1, typedDomain: 'tenant-j', typedSpace: 'DEMO13', portalUnsigned: true, note: 'target is a legacy account id, not the 712020: form' },
    'ZEN-990007': { requester: 'requester-07@tenant-k.example', accountId: '712020:qm-0200', status: 'Waiting for customer', lastReply: '12 Aug', replies: 1, typedDomain: 'tenant-k', typedSpace: 'DEMO14', portalUnsigned: true, note: '' },
    'ZEN-990008': { requester: 'requester-08@tenant-c.example', accountId: '712020:qm-0201', status: 'Waiting for customer', lastReply: '12 Aug', replies: 1, typedDomain: 'tenant-c', typedSpace: 'DEMO12', portalUnsigned: true, note: '' },
    'ZEN-990009': { requester: 'requester-09@tenant-b.example', accountId: '712020:qm-0202', status: 'Waiting for customer', lastReply: '13 Aug', replies: 1, typedDomain: 'tenant-b', typedSpace: 'DEMO11', portalUnsigned: true, note: '' },
    'ZEN-990010': { requester: 'requester-10@tenant-b.example', accountId: '712020:qm-0203', status: 'Waiting for customer', lastReply: '16 Aug', replies: 1, typedDomain: 'tenant-b', typedSpace: 'DEMO11', portalUnsigned: true, note: '' },
    'ZEN-990011': { requester: 'requester-11@tenant-i.example', accountId: '712020:qm-0204', status: 'Waiting for customer', lastReply: '19 Aug', replies: 1, typedDomain: 'tenant-i', typedSpace: 'DEMO10', portalUnsigned: true, note: '' },
    'ZEN-990012': { requester: 'requester-12@tenant-h.example', accountId: '712020:qm-0205', status: 'Waiting for customer', lastReply: '19 Aug', replies: 1, typedDomain: 'tenant-h', typedSpace: 'DEMO08', portalUnsigned: true, note: '' },
    'ZEN-990013': { requester: 'Internal tester', accountId: '712020:qm-0206', status: 'Resolved', lastReply: '19 Aug', replies: 1, typedDomain: 'example-stg.atlassian.net', typedSpace: 'DEMO09', portalUnsigned: false, note: 'a staging site typed as a full hostname; the only reply was posted by Automation for Jira, so vendor authorship is undetermined' },
    'ZEN-990014': { requester: 'requester-13@tenant-c.example', accountId: '712020:qm-0207', status: 'Waiting for customer', lastReply: '21 Aug', replies: 2, typedDomain: 'tenant-c', typedSpace: 'DEMO07', portalUnsigned: true, note: 'second reply was a correction to the first' },
    'ZEN-990015': { requester: 'requester-14@unrelated.example', accountId: '5f00000000000000000000a2', status: 'Waiting for customer', lastReply: '25 Aug', replies: 1, typedDomain: 'tenant-g', typedSpace: 'DEMO06', portalUnsigned: true, note: 'requester email domain is unrelated to the site domain; target is a legacy account id' },
    'ZEN-990016': { requester: 'requester-15@tenant-b.example', accountId: '712020:qm-0209', status: 'Waiting for customer', lastReply: '27 Aug', replies: 1, typedDomain: 'tenant-b', typedSpace: 'DEMO11', portalUnsigned: true, note: '' }
  },
  jsmUnconfirmedAuthor: ['ZEN-990013'],

  byApp: [
    { app: 'lite', n: 16, note: 'inside the 15–20 baseline' },
    { app: 'full', n: 3, note: 'top of the 1–3 baseline' },
    { app: 'api', n: 2, note: 'baseline is ~1 per half-year — unverified', unverified: true },
    { app: 'dia', n: 0, note: 'baseline is ~2 — nothing this month' }
  ],

  steps: [
    { app: 'lite', welcome: 825, lapsed: 76 },
    { app: 'full', welcome: 116, lapsed: 357 },
    { app: 'api', welcome: 15, lapsed: 15 },
    { app: 'dia', welcome: 3, lapsed: 0 }
  ],

  gaps: [
    'Run history — lifecycle_run exists in no database, so no sender run has ever been recorded and none can be re-derived.',
    'Touchpoints — lifecycle_touchpoint holds 0 rows, so there is no email_sent, no delivery failure and no lapse record to read.',
    'Per-contact eligibility — welcome_state, block_reason, retry_count and last_error arrive with migration 0025, which is unapplied.',
    'Grant audit — ExtensionAction holds 0 rows in production and 1 in staging, so a replay cannot be told from a first grant.'
  ],

  origins: [
    { n: 12, label: 'Support ticket, seven days', accent: 'brand', note: 'The intended path. A ZEN ticket, the standard duration, one requester.', pattern: 'support:temp-7d-extension:ZEN-9900##' },
    { n: 9, label: 'Fourteen days', accent: 'cerulean', note: 'A longer grant than the documented policy allows. Seven of the nine carry no ticket at all.', pattern: 'support:temp-14d-extension' },
    { n: 6, label: 'A/B experiment', accent: 'radical', note: 'One tenant, six spaces, all space-wide and all still active — issued by an experiment, not by support.', pattern: 'experiment:ab-tenant-a-2026-08' },
    { n: 3, label: 'Proactive outreach', accent: 'leaf', note: 'Granted before anyone asked, to accounts on a watch list.', pattern: 'support:temp-7d-extension:proactive-champion-watch' },
    { n: 7, label: 'Off convention', accent: 'rust', note: 'An operator name, an end-to-end test marker, a bare ticket key and a customer email address. Two of these run to 2027.', pattern: 'pengxiao · peng · upgrade-prompt-e2e · ZEN-990005' }
  ],

  rules: [
    {
      title: 'Licence ingest',
      badge: 'In code, run by hand',
      tone: 'warn',
      scope: 'ingestCore.mjs · Marketplace vendor 1215266 → D1',
      items: [
        'Rejects any row whose addonKey is not one of our four apps',
        'Rejects any row with no cloudId — 67 of 1,610 in the last export, all legacy Server',
        'Rejects the literal RTBF address and rows with no technical contact',
        'Maps the evaluation window from latestEvaluationStartDate and maintenanceEndDate'
      ],
      audit: 'last run 28 Aug 03:04 UTC from a laptop · 1,407 contacts written'
    },
    {
      title: 'Ingest on a schedule',
      badge: 'Not deployed',
      tone: 'bad',
      scope: 'workers/lifecycle-ingest · four independent gates, all closed',
      items: [
        'The package is not in pnpm-workspace.yaml, so CI never builds it',
        'No deploy job references it in either workflow',
        'The cron triggers are commented out in wrangler.toml',
        'The handler is a no-op unless LIFECYCLE_INGEST_ENABLED is the string "true"'
      ],
      audit: 'cadence still undecided — Marketplace export rate limits unverified'
    },
    {
      title: 'Welcome send',
      badge: 'In code, never fired',
      tone: 'warn',
      scope: 'senderCore.mjs · one template per app',
      items: [
        'A send needs a contact at step welcome that is not held as backlog',
        'All 1,407 contacts came from the bootstrap run, so none qualifies',
        'A success advances step to d3 and sets the next due date three days out',
        'A failure records the error and leaves the contact due — no retry inside a run'
      ],
      audit: '0 sends, 0 touchpoints, 0 rows in any store'
    },
    {
      title: 'Email delivery',
      badge: 'No account',
      tone: 'bad',
      scope: 'Resend · support@zenuml.com',
      items: [
        'The sending domain is not verified, so every live attempt would be rejected',
        'A live send needs both an API key in the environment and an explicit --yes',
        'Unsubscribe and preferences links are still literal placeholder text in all four templates'
      ],
      audit: 'the AsyncAPI template also leaves its documentation link unresolved'
    },
    {
      title: 'Eligibility state',
      badge: 'Never applied',
      tone: 'bad',
      scope: 'migration 0025 · welcome_state, block_reason, retry_count, last_error',
      items: [
        'Written on a feature branch and applied to no database at all',
        'A filesystem sweep of every local D1 found zero copies of it',
        'The function that would set these columns was never written',
        'Any per-contact eligibility state shown here therefore has no source'
      ],
      audit: 'production is at migration 0023 · the local D1 carries only the 0024 shape'
    },
    {
      title: 'Run history',
      badge: 'Never applied',
      tone: 'bad',
      scope: 'migration 0025 · lifecycle_run',
      items: [
        'One row per sender run was the intended audit trail',
        'The table does not exist anywhere, so no run has ever been recorded',
        'Outcomes cannot be re-derived from touchpoints either — that table is empty'
      ],
      audit: 'the operator has no record of what any past run did'
    },
    {
      title: 'Extension grants',
      badge: 'Live',
      tone: 'good',
      scope: 'JSM ZEN type 9 → Pages endpoint → SPACE_LICENSE_KV',
      items: [
        'Seven days on the first grant, sixty in exchange for four feedback answers',
        'The endpoint owns duration and expiry — Jira cannot pass a day count',
        'Requires a matching space key and at least 100 macros before granting',
        'Reads the key back and only then reports the grant applied'
      ],
      audit: '37 grants live in KV · 11 still active · the D1 audit table holds 0 rows'
    },
    {
      title: 'Grant audit trail',
      badge: 'Bypassed',
      tone: 'warn',
      scope: 'migration 0020 · ExtensionAction',
      items: [
        'Intended as one row per ticket and action, with the target and expiry fixed before the write',
        'Production holds no rows; staging holds one',
        'The grants that exist were written straight to KV, so idempotency has no record',
        'Four of the 37 were activated by an operator name, a test marker or a customer address'
      ],
      audit: 'no way to tell a replay from a first grant for 36 of the 37'
    }
  ],

  placeholder: true
}

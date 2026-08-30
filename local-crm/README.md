# Local CRM

Local CRM is a loopback-only operations console. Extension is the current active
scope; Welcome and Expiry/Cancellation remain explicit TODOs. It never performs
a real write; any retained action result lives only in the current browser
session.

## Run locally

```bash
pnpm --dir local-crm install
pnpm --dir local-crm dev
```

Open `http://127.0.0.1:7331`. The server is explicitly bound to loopback.

For a synthetic, user-testable UI with no live-source reads, opt in explicitly:

```bash
VITE_LOCAL_CRM_DATASET=fixture pnpm --dir local-crm dev
```

The fixture entry point is development/test-only and keeps a persistent
`FIXTURE DATA` banner visible. Running without a local dataset and without this
opt-in shows the fail-closed data-unavailable screen.

The Extensions slice needs the existing local operator credentials:

- `FORGE_EMAIL` / `FORGE_API_TOKEN` for the Marketplace vendor export
- `JSM_EMAIL` / `JSM_API_TOKEN` for the ZEN service desk
- an authenticated Wrangler session for `SPACE_LICENSE_KV` and production D1

The Vite server keeps these values server-side. It first preserves credentials
already present in the process, then fills missing values from
`.env.forge.local` in this worktree or the primary checkout discovered through
Git's common directory. This lets the same `pnpm --dir local-crm dev` command
work from an isolated worktree without copying the ignored credential file.
Only the four named server credential keys are admitted; they are never exposed
as `VITE_*` client variables and are not loaded for tests, builds, or preview.

The app fails closed when `src/data/local/dataset.ts` is absent: it renders a
data-unavailable boundary and does not mount the loaders. Synthetic fixture data
is available only with `VITE_LOCAL_CRM_DATASET=fixture` in development or test;
the UI then carries a persistent `FIXTURE DATA` banner and never presents it as
production freshness. That explicit fixture selection keeps its synthetic Today
rows visible for manual testing beneath an unavailable-source notice. If a
required grant-KV read fails after a real local dataset was selected, Today does
not substitute fixture grants: its grant and expiry rows remain empty and
explicitly unavailable. Optional source failures stay explicit
in source badges, nullable facts, unavailable reasons, and each record's
`unknowns` list.

Today reuses the same Extensions snapshot client-side. It overlays only the
API's `asOf`, current grants, correlated JSM context, and grant-origin buckets.
Registrations, contact ingest, Marketplace acquisition totals, and workflow
panels remain the labelled sanitized baseline. Expiry rows are derived from the
current KV `expiresAt`; the console does not present them as stored event
history. Sites is sourced from the live Marketplace export. Automation shows
only the observed `ExtensionAction` D1 audit: it does not infer a workflow
configuration from code or from an empty audit result.

`GET /api/local-crm/sites` is a separate, read-only loopback route. It returns
the full Marketplace inventory grouped by cloud ID, including app coverage and
license-row counts. It deliberately does not include Marketplace contact
blocks. Local CRM also owns a loopback-only lifecycle import: it writes
Marketplace technical-contact rows into ignored `local-crm/.local/lifecycle.sqlite`
as bootstrap-suppressed records and serves read-only contact rows plus the four
Welcome-template previews. This is current-contact inventory, not registration
history. Production migration 0024 exists but no lifecycle ingest Worker is
running; Local CRM does not depend on it. There is still no source-backed
assignment, Site Contact, workflow-configuration, delivery, engagement, or
recipient eligibility contract. There is no send endpoint.

Verification commands:

```bash
pnpm --dir local-crm typecheck
pnpm --dir local-crm test
pnpm --dir local-crm build
```

## Extensions API

The Vite development server owns two read-only, loopback-only routes:

- `GET /api/local-crm/extensions` — source status, aggregate counts, and all
  current grant records
- `GET /api/local-crm/extensions/:id` — one grant with the same evidence shape

`src/data/extensionsContract.ts` is the versioned contract. The response is
built from four existing stores, without a new database or migration:

1. `SPACE_LICENSE_KV` is current grant truth. Keys are
   `license:<cloudId>:<spaceKey>[:<userAccountId>]`; status is derived from the
   stored status plus `expiresAt` at response time. The key is authoritative;
   duplicated value fields are checked and any drift is returned as unknown.
2. Marketplace maps the full cloud ID to its site hostname and licence context.
   Contact blocks from the export are never copied into the response.
3. JSM is matched first by a `ZEN-*` key recorded in `activatedBy`. The fallback
   requires normalized Marketplace domain + space + the exact user/space target,
   and only a request created no later than the KV write/update can match. A
   fallback is labelled contextual correlation, never the grant origin. Comment
   bodies are not returned. Candidate issues cover all currently open requests,
   every request from 31 days before the oldest current grant, and every ticket
   explicitly recorded in `activatedBy`; an unmatched result is qualified to
   that fetched window rather than presented as proof that no request exists.
4. D1 `ExtensionAction` contributes action/idempotency evidence only when its
   explicit ticket, cloud, space, user-vs-space target, and current expiry all
   exactly match the grant.

The API is installed as Vite middleware and is deliberately absent from
`public/_routes.json`; it is not a deployable customer-facing Pages route. The
first slice exposes no mutation endpoint. Unconfirmed revoke and regrant
affordances are not rendered.

## Other real data

The checked-in placeholder dataset is identity-free but preserves the shapes and
counts the UI depends on. A local real-data override may be generated at
`src/data/local/dataset.ts`; that directory is git-ignored. The override must
default-export a `Dataset` and must never be copied into a public-repo file.

See `docs/policies/client-privacy.md` and the private lifecycle data handoff
before producing an override.

## Human requirement traceability (R0-R7)

This is the minimum mapping for the human baseline used by the Local CRM
remediation. It records evidence and gaps; it does not turn retained UI or an
unimplemented business fact into a new requirement.

| ID | Current trace |
| --- | --- |
| R0 — human requirements govern scope | This table is the traceability anchor. The retained Sites page, Extension evidence/drawer tabs, Automation ExtensionAction audit, navigation/search, and session-only readback are not promoted to required features by this mapping. |
| R1 — lightweight evaluator-to-paid CRM across four apps | `src/data/types.ts` retains the Lite, Full, Diagramly, and AsyncAPI app keys, and `src/App.tsx` remains a loopback-only lightweight console. A source-backed paid/conversion state is not implemented or claimed. |
| R2 — Welcome, Extension, Expiry/Cancellation lifecycle | `src/screens/TodayScreen.tsx` keeps the three lifecycle labels in one queue; only Extension has active records. |
| R3 — Extension now; other lifecycles TODO | `src/screens/AutomationScreen.tsx` renders Welcome and Expiry/Cancellation only as TODOs. `src/lib/actions.ts` and `src/components/drawer/CaseDrawer.tsx` restrict the case drawer to Extension. Covered by `src/stores/crm.test.ts`. |
| R4 — simple untitled Today queue, dated newest-first cards | `src/App.tsx` omits the Today top bar; `src/screens/TodayScreen.tsx` renders one `today-queue` and a date on every actionable row; `src/lib/queue.ts` sorts rows descending by stored date. Covered by `src/stores/crm.test.ts` and `src/lib/queue.test.ts`. |
| R5 — real, traceable Extension evidence | `src/data/datasetSelection.ts` fails closed unless a local dataset exists or fixture mode is explicitly selected; `src/main.tsx` labels fixture mode persistently. `server/extensionsData.ts` and `src/data/extensionsContract.ts` preserve raw JSM values, use nullable facts plus unavailable reasons, join requests to KV evidence, and expose comment metadata plus only the first non-empty line. `src/lib/derive.ts` gives grants stable identities and does not substitute `today` for an invalid grant date. Covered by dataset, server, adapter, integrity, and adversarial tests. |
| R6 — confirmed Extension business facts without invented writes | The Extension contract carries available requester, site, Space, macro count, timestamps, and prior-grant history. Missing research answers, administrator-contact refresh, distributor exclusion, and unresolved repeat-extension rules are not invented. The console has no mutation endpoint; unconfirmed revoke/regrant affordances are filtered. |
| R7 — Welcome eventually, TODO now | `src/screens/AutomationScreen.tsx` exposes only a Welcome TODO and no delivery workflow, template dashboard, contact table, or send action. Covered by `src/stores/crm.test.ts`. |

## Minimal manual check

1. Start explicit fixture mode with the command above and open
   `http://127.0.0.1:7331`.
2. Confirm the persistent `FIXTURE DATA` banner is visible. On Today, confirm
   there is no page title, the work is one queue, every actionable card shows a
   date, and those dates run newest to oldest.
3. Confirm Welcome and Expiry/Cancellation appear only as `(todo)` rows. Open an
   Extension row and confirm it opens the matching Extension evidence rather
   than a different same-day grant.
4. Open Automation and confirm Welcome and Expiry/Cancellation are TODO-only;
   confirm no revoke, regrant, or 60-day application affordance is visible.
5. Stop the server. No deployment or production write is part of this check.

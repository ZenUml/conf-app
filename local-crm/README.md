# Local CRM

Local CRM is a loopback-only operations console for reviewing Welcome,
Extension, Retention, and ingest evidence in one place. It never performs a real
write; action results live only in the current browser session.

## Run locally

```bash
pnpm --dir local-crm install
pnpm --dir local-crm dev
```

Open `http://127.0.0.1:7331`. The server is explicitly bound to loopback.

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

If a required grant-KV read fails, the Extensions page leaves the sanitized
fixture visible and labels it as a failed live load. Today does not substitute
those fixture grants: its grant and expiry rows remain empty and explicitly
unavailable until the authoritative KV read succeeds. Optional source failures
stay explicit in the source badges and in each record's `unknowns` list.

Today reuses the same Extensions snapshot client-side. It overlays only the
API's `asOf`, current grants, correlated JSM context, and grant-origin buckets.
Registrations, contact ingest, Marketplace acquisition totals, and workflow
panels remain the labelled sanitized baseline. Expiry rows are derived from the
current KV `expiresAt`; the console does not present them as stored event
history. Sites is sourced from the live Marketplace export. Automation shows
only the observed `ExtensionAction` D1 audit: it does not infer a workflow
configuration from code or from an empty audit result.

Pending also reuses the Extensions snapshot client-side; there is no second API
read. Queue membership is available only when both `SPACE_LICENSE_KV` and the
Marketplace export were read successfully, and includes only current grants
whose cloud ID cannot be joined to a site hostname. A Marketplace outage never
turns every grant into a pending row, and a healthy empty result never falls
back to fixtures. JSM and `ExtensionAction` failures retain the queue but label
their review evidence unavailable. Rows open the existing grant drawer by the
API's stable grant id. No assignment, Site Contact, case-note, or mutation store
is connected, so the page makes no ownership claim and exposes no write action.
Open JSM requests without a current KV grant are outside this slice.

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
first slice exposes no mutation endpoint. Extension and revoke controls remain
visibly read-only in the drawer.

## Other real data

The checked-in placeholder dataset is identity-free but preserves the shapes and
counts the UI depends on. A local real-data override may be generated at
`src/data/local/dataset.ts`; that directory is git-ignored. The override must
default-export a `Dataset` and must never be copied into a public-repo file.

See `docs/policies/client-privacy.md` and the private lifecycle data handoff
before producing an override.

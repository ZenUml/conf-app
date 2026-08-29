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
history. Sites, Pending, and Automation continue to use the sanitized dataset.

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

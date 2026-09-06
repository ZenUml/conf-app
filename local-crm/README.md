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

Verification commands:

```bash
pnpm --dir local-crm typecheck
pnpm --dir local-crm test
pnpm --dir local-crm build
```

## Real data

The checked-in placeholder dataset is identity-free but preserves the shapes and
counts the UI depends on. A local real-data override may be generated at
`src/data/local/dataset.ts`; that directory is git-ignored. The override must
default-export a `Dataset` and must never be copied into a public-repo file.

See `docs/policies/client-privacy.md` and the private lifecycle data handoff
before producing an override.

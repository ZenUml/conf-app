# Client privacy — no client names in public files

## Policy

The names of specific Confluence client tenants (customer subdomain prefixes, full hostnames matching `<customer>.atlassian.net`, customer-named page titles, customer-specific `cloudId`s) **MUST NOT appear in any file checked into this public repo** — code, docs, comments, JSDoc, help text, fixtures, snapshots, ADRs, research specs, runbook examples.

The public repo is intended to be open to anyone with the link; client identities are not.

## Where client-naming artifacts go

The private companion repo `ZenUml/conf-app-private` is mounted as a git submodule at `private/`.

| Artifact | Public path | Private path |
|---|---|---|
| Per-customer paywall data, anomalies, interpretation, runbook examples | — | `private/paywall/*.md` |
| Research / design specs that reference real tenants | — | `private/research/<date>-<slug>.md` |
| Operations data (customer lists, migration trackers) | — | `private/operations/*` |
| Per-feature growth contracts (may reference tenants in baselines) | — | `private/growth/*.yml` |

## When writing new code or docs

- Use generic placeholders (`tenant-a`, `tenant-b`, `example-tenant`, `example.atlassian.net`, `example-one`, `example-two`) in pedagogical examples, JSDoc, or help text.
- For operational scripts that need to enumerate real domains, read them from the live KV/D1 source at runtime — never hardcode (see `.claude/skills/paywall/SKILL.md` for the `jq` pattern that pulls from `CUSTOMER_SUCCESS_SERVICE`).
- If a public-side doc legitimately needs a worked example with a real tenant, put the example in `private/<area>/<file>.md` and link from the public doc with a one-line summary that names no tenant.
- Customer **content** — diagram bodies, extracted participant labels, model outputs, per-tenant pilot artifacts, space/app ids — is never committed to any repository, the `private/` submodule included (user rule, 2026-08-27). Keep it under the git-ignored `private/local-data/` folder and point tools at it through an environment variable (see `tools/architecture-tokens/README.md`, `$ARCHTOK_DIR`).
- The `.gitignore` excludes `/page-snapshot.yml`, `/paywall-snap-*.yml`, `/spotcheck-*.yml` at repo root — these often capture real page content and must stay local.

## Pre-commit discovery check

Before committing, sanity-check with:

```bash
grep -rE '[a-z0-9][a-z0-9-]+\.atlassian\.net' --exclude-dir=private --exclude-dir=node_modules --exclude-dir=.git \
  --include='*.md' --include='*.ts' --include='*.vue' --include='*.js' --include='*.py' --include='*.json' --include='*.yml' . \
  | grep -ivE '(zenuml|whimet|lite-stg|lite-dev|dia-stg|full-stg|peng-dev|example|tenant|foo|my-site|your-site|drawio|ecosystem|<)'
```

Expected output: empty. Any hits are likely real customer hostnames — move to `private/` or replace with a placeholder.

## Background

Historical violations (paywall references, customer lists in `operations/`, per-tenant research specs) were migrated to `private/` in #108. The cleanup found ~47 distinct customer names across 15+ files. Re-introducing client names into the public repo undoes that work and exposes customer relationships.

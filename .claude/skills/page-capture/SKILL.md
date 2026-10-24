---
name: page-capture
description: Inspect and manage the Confluence page-content capture pipeline (forge-page-capture, R2 page-snapshots, the PAGE_CAPTURE_ENABLED kill switch, and the PAGE_CAPTURE_ALLOWED_DOMAINS allowlist) for the ZenUML Confluence app variants. Use when asked about page capture, content capture, page snapshots, the page-capture kill switch, PAGE_CAPTURE_ALLOWED_DOMAINS, or whether a tenant's page content is actually being captured.
---

# Page Capture

Manages one pipeline only: `functions/forge-page-capture.ts` writing to the R2 bucket
`atlassian-events` under the `page-snapshots/` prefix, gated by the Forge kill switch
`PAGE_CAPTURE_ENABLED` (per app, per environment) and the GitHub Actions variables
`PAGE_CAPTURE_ALLOWED_DOMAINS_STG` / `_PROD`. It does not cover other content-storage
paths (`CustomContentVersion`, macro custom content, etc.) — those have their own
tooling (the `conf-app` skill, direct D1 queries).

## Setup

All scripts run from the repo root and need Forge + Cloudflare credentials in the
environment:

```bash
set -a; source .env.forge.local; set +a   # FORGE_EMAIL, FORGE_API_TOKEN
# CLOUDFLARE_ACCOUNT_ID: from env or repo-root .env
# Cloudflare auth: CLOUDFLARE_API_TOKEN if set, else the local `wrangler login` session
```

No `wrangler.toml` is required — `wrangler d1 execute <name> --remote` and
`wrangler r2 object get <bucket>/<key> --remote` both resolve by name/path directly
against the account.

## Default: health check (read-only)

```bash
node .claude/skills/page-capture/scripts/health_check.mjs
```

Prints one JSON object to stdout — no formatting, no prose. Render the report in
the conversation's own language; do not print the raw JSON as the final answer.

Gathers:

1. **Kill switches** — `PAGE_CAPTURE_ENABLED` for all 4 apps (lite, full, diagramly,
   asyncapi) x 2 environments (staging, production). Unset means the switch is
   effectively ON (`page-capture.js` only short-circuits on the literal string `'false'`).
2. **Allowlist** — the GitHub Actions source-of-truth value for each environment, plus
   what's actually deployed on each Cloudflare Pages project right now (diagramly and
   asyncapi share Lite's backend project, so only `conf-lite`/`conf-full` and
   `conf-stg-lite`/`conf-stg-full` are checked).
3. **R2 snapshots** — everything under `page-snapshots/` (objects expire after 7 days —
   this is a rolling window, not full history), grouped by `cloudId`, each resolved to
   a `clientDomain` and the Forge app actually installed there per `ForgeInstallation`
   (this is ground truth for "which app's trigger captured this" — a domain's name is
   not a reliable proxy for which variant is installed on it; a "full-stg"-named site
   can have only Lite installed).
4. **Consistency checks**, computed from 1-3:
   - `killSwitchBlocksAllowlistedDomain` — a domain is in the allowlist but the app it
     resolves to has its kill switch off in that environment.
   - `allowlistedNoRecentCapture` — kill switch is on and the domain is allowlisted,
     but no R2 record exists in the 7-day retention window. This is a reported fact,
     not a conclusion — it can mean no page was edited, or something else in the chain
     is broken.
   - `allowlistDrift` — a Cloudflare Pages project's live `PAGE_CAPTURE_ALLOWED_DOMAINS`
     value doesn't match the GitHub Actions source value, because that project hasn't
     redeployed since the source was last edited.

## Write operations (explicit args only — never triggered by a bare health check)

### Toggle a kill switch

```bash
node .claude/skills/page-capture/scripts/toggle_kill_switch.mjs --app <lite|full|diagramly|asyncapi> --env <staging|production> --value <true|false>
```

Staging executes immediately. Production requires a second call with `--confirm` —
the first call only reports `before`/`requestedAfter` and does not write. Show that
diff to the user and wait for explicit go-ahead before adding `--confirm` (per this
repo's deploy-confirmation policy: production runtime-config changes need a
go-ahead, staging doesn't). There is no persisted change log — if a production
toggle needs reverting, read the printed `before` value and run the command again
with it.

```bash
node .claude/skills/page-capture/scripts/toggle_kill_switch.mjs --app lite --env production --value true --confirm
```

### Edit the allowlist

Incremental — add or remove one domain, never retype the full list:

```bash
node .claude/skills/page-capture/scripts/edit_allowlist.mjs --env <staging|production> --action <add|remove> --domain <domain-prefix>
node .claude/skills/page-capture/scripts/edit_allowlist.mjs --env production --action remove --domain economical --confirm
```

Same staging-executes / production-needs-`--confirm` rule as the kill switch. A
domain is the bare subdomain prefix (`airwallex`, not `airwallex.atlassian.net`).

### Read a captured snapshot by domain

No cloudId or contentId required — the script resolves the domain against both
D1 databases and lists what R2 actually has for it:

```bash
node .claude/skills/page-capture/scripts/read_snapshot.mjs --domain <domain-prefix>
```

If the domain maps to more than one captured page, it returns `needsSelection: true`
with the candidate list — re-run with `--content-id <id>` rather than guessing.
Output is a summary (title, version, spaceKey, body byte size) by default; the
captured page body can be large (Confluence storage-format HTML), so it's only
included with `--full`:

```bash
node .claude/skills/page-capture/scripts/read_snapshot.mjs --domain airwallex --content-id 141000755 --full
node .claude/skills/page-capture/scripts/read_snapshot.mjs --domain airwallex --content-id 141000755 --version 5
```

## Known design gaps (not re-checked by health_check.mjs — static, not time-varying)

- **staging and production share one physical R2 bucket.** Both `wrangler-stg.toml`
  and `wrangler-prod.toml` set `bucket_name = "atlassian-events"` — there is no
  environment isolation, so staging test captures and production captures live in
  the same object space. Confirmed 2026-08-15: every object found in
  `page-snapshots/` at that time was a staging tenant (`full-stg`, `lite-stg`), none
  production, despite production having an active allowlist.
- **`PAGE_CAPTURE_SECRET` is stored as a GitHub Actions *Variable*, not a *Secret*** —
  readable in plaintext via `gh variable list`. It authenticates the public
  `/forge-page-capture` Worker endpoint (`X-Page-Capture-Token` header); without it,
  anyone could POST forged payloads into the bucket or overwrite real snapshot
  records. Rotating it (and migrating it to a real Secret) touches 4 Forge apps and
  the GitHub Actions variable together and is a one-time fix, not a routine
  operation — do it by hand, not through this skill.

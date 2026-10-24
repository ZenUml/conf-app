# Feeding real data into the Local CRM prototype

`Local CRM.dc.html` currently runs on placeholder clients (`tenant-a`…`tenant-h`).
Everything else in it — the four app keys, licence types and tiers, welcome
outcomes, `lifecycle_run` fields, extension outcome codes — is lifted from the
codebase. This file is the one-step handoff to replace the placeholders with
real rows.

## Why you have to run these, not me

- No credentials in the mounted folder. Root has `.env.forge.dia` / `.full` /
  `.lite` (app IDs and connect keys only) and `.env.forge.local.example`. There
  is no `.env.forge.local`. The `private/` submodule is mounted and empty. No
  cached `marketplace.db`, no D1 dump.
- The credentials in `docs/reference/agent-container-credentials.md`
  (`FORGE_EMAIL`, `CLOUDFLARE_API_TOKEN`, `MIXPANEL_SA_SECRET`) are environment
  variables of the Claude Code remote container, not files in the repo.
- I have no shell, so `new_customers.py` cannot run, and my scripting sandbox has
  no outbound network — it cannot reach `marketplace.atlassian.net` or the
  Cloudflare D1 REST API and cannot do HTTP Basic auth. Credentials alone would
  not be enough.

So: run any one of the three blocks below and either paste the output into chat
or drop the file into this project folder. I read project files directly.

## 1 · Who registered, on which product, recently

Feeds the **Registered recently** table: client, contact, cloud_id, app, licence,
tier, first seen.

```bash
# from the conf-app repo root, with .env.forge.local in place
python3 .claude/skills/new-customers/scripts/new_customers.py \
  --sync --app all --contacts --json > new-customers.json
```

Notes from that skill's own docs:

- `--sync` refreshes the Marketplace snapshot via `mp_report.py` (~15s).
- Verdicts are `NEW` / `PRE-EXISTING` / `INTERNAL`. **Only `NEW` belongs on the
  homepage** — raw licence rows read as fake growth because Atlassian's
  Connect→Forge migration backfilled FREE rows for pre-existing tenants
  (lite took 876 such rows in April 2026).
- Sanity baselines as of 2026-07: lite ≈ 15–20 NEW/month, diagramly ≈ 2,
  full ≈ 1–3, asyncapi ≈ 1 per half-year. If the output is wildly above that,
  the classifier did not fire.
- `my-api` (AsyncAPI) is D1-blind — its Connect worker never persisted installs,
  so the backfill filter cannot fire there. Eyeball those rows.

## 2 · Was the welcome actually sent

Feeds the **Welcome** column and the record drawer.

Database: `conf-zenuml-prod`, id `2e34f32e-5ddd-40dc-9e3d-019f9b1d431f`
(staging is `conf-zenuml-stg`, `5894387c-08be-43d7-b8dc-0b7b8eb7c264`).

```sql
SELECT contact_email, app, cloud_id, license_type, seat_tier,
       step, step_due_at, first_seen_at, last_seen_at
  FROM lifecycle_contact
 ORDER BY first_seen_at DESC
 LIMIT 40;

SELECT contact_email, app, kind, step, meta, created_at
  FROM lifecycle_touchpoint
 ORDER BY created_at DESC
 LIMIT 40;
```

`kind` is the answer to "was it sent": `email_sent` means a real send,
`note` carries `meta.error` for a failure, `lapsed` is the ingest lapse pass.

**Check first that migrations 0024 and 0025 are applied to the target database.**
The `lifecycle-ingest` Worker has never been deployed (four independent gates in
`workers/lifecycle-ingest/wrangler.toml`), so prod may have empty tables and the
only populated copy may be your local miniflare D1 file. If so, point the queries
at that file instead:

```bash
sqlite3 <path-to-local-d1.sqlite> ".mode json" "SELECT ... ;"
```

If you also want the run history that the rail card shows:

```sql
SELECT id, started_at, finished_at, mode, due, sent, blocked, failed,
       skipped_reason
  FROM lifecycle_run
 ORDER BY id DESC
 LIMIT 10;
```

## 3 · Extension grants

Feeds the **Editing extensions granted** table. Table from
`functions/migrations/0020_add_extension_action.sql`, same database as above.

```sql
SELECT ticketKey, action, status, clientDomain, cloudId, spaceKey,
       macroCount, expiresAt, createdAt, updatedAt
  FROM ExtensionAction
 ORDER BY createdAt DESC
 LIMIT 20;
```

`action` is `initial` (7 days) or `feedback` (60 days); `status` is `pending` or
`applied`. The API-level outcomes the UI shows — `applied`, `already_applied`,
`validation_failed`, `temporary_failure` — are response values, not columns, so
they are derived: a `pending` row is a `temporary_failure` that can be resumed,
and a second call against an `applied` row returns `already_applied`.

`userAccountId` is deliberately omitted above — the UI only needs it truncated
inside the `license:<cloudId>:<spaceKey>:<accountId>` key, and the analytics
contract for this endpoint forbids account IDs in events.

## Cloudflare REST, if you would rather not install wrangler

```bash
curl -sS -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database/2e34f32e-5ddd-40dc-9e3d-019f9b1d431f/query" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"sql":"SELECT contact_email, app, cloud_id, license_type, seat_tier, step, first_seen_at FROM lifecycle_contact ORDER BY first_seen_at DESC LIMIT 40"}' \
  > lifecycle-contacts.json
```

Account id is in `workers/lifecycle-ingest/wrangler.toml`:
`8d5fc7ce04adc5096f52485cce7d7b3d`.

## One decision before you paste

`docs/policies/client-privacy.md` forbids real tenant hostnames, cloudIds and
customer-named artifacts in the public repo, and routes them to `private/`. A
prototype holding real client domains and technical-contact emails falls under
that rule if it is ever committed.

Tell me which you want:

1. **Full real data** — domains and contact emails as they come. Correct for a
   local operator tool; keep this file out of the public repo.
2. **Domains only** — real hostnames and cloudIds, contact emails dropped.
3. **Shapes only** — real counts, licence mix, welcome outcomes and extension
   states, with `tenant-a`-style identities kept.

Default if you say nothing: option 2.

## What I will do with it

- Replace the `REG` array (registrations, one row per first-seen contact) and the
  `EXT` array (extension grants) in `Local CRM.dc.html`.
- Recompute the rail: ingest totals, skip breakdown, last sender run, contacts by
  step.
- Keep the "no welcome has reached a real inbox" banner only if the touchpoint
  data still says so. If `kind = 'email_sent'` rows exist with real `esp_id`
  values, that banner comes off and the Welcome column starts showing genuine
  sends.

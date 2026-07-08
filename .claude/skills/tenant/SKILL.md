---
name: tenant
description: >-
  Look up ONE Confluence tenant (by domain / slug / cloudId) and answer "is this a paying
  customer, how big are they, what state are they in" — across all ZenUML apps (Full / Lite /
  Diagramly), including the Lite Stripe/KV space-license layer. Use whenever the question is about
  a SINGLE tenant: "is <domain> a paying customer", "look up / who is <domain>", "tenant profile",
  "how big is <domain>", "is X on a trial / when does the trial expire", or a tenant's paid status
  for a paywall / conversion / extension-request decision. For cohort / rollup / portfolio questions
  (total revenue, renewals due in a window, overdue payers, top payers) use the `marketplace-audit`
  skill instead. Discriminator: one domain in the question -> this skill; a cohort/time-window/ranking
  -> marketplace-audit. Triggers on tenant, whois, "is <domain> paying", paid status, tenant lookup,
  cloudId, tenant profile, tenant size, trial expiry.
---

# Tenant lookup

Answers per-tenant questions off Atlassian Marketplace license/transaction data **plus** the Lite
Stripe/KV space-license layer. It's the single-tenant primitive over `marketplace-audit`'s engine
(`mp_report.py`) — same auth, cloudId join, and SQLite snapshot — so there is no separate code to
drift. (The script physically lives under `marketplace-audit/scripts/`; this skill references it by
path, the same way `macro-count` references `mixpanel`'s script.)

## The one command you want

```bash
S=.claude/skills/marketplace-audit/scripts/mp_report.py
python3 $S whois <domain>          # the card: cloudId, users, per-app STATE, lifetime $, + Lite Layer-B KV
python3 $S whois <domain> --json   # machine-readable (self-documents data vintage in --local mode)
```

**Always read `whois` before concluding anything about a tenant's paid status** — a naive Marketplace
`$0` is the single most common wrong answer here.

## What the card encodes (the traps baked in)

- **State per app, not a binary.** `FREE` (Lite free rider) / `TRIAL — expires D (⚠ Nd left)` (active
  evaluation) / `PAID $X paid_thru D` / `LAPSED` (was paying, coverage ended). A `$0` is NOT "not a
  customer": it may be an active trial (a hot conversion, e.g. a Full eval expiring in 2 days) or a
  churned payer.
- **Lite → Layer B auto-checked.** Lite is free on the Marketplace (`$0` by design); real Lite paid
  status lives in the **Stripe/KV space-license** layer. `whois` shells `wrangler kv … --remote`
  (the `--remote` is baked in — without it wrangler v4 reads LOCAL state and returns a false empty)
  and prints `[Layer B: none / N space-licenses]`. `--no-kv` skips it (~2s).
- **cloudId is the join key.** Transactions carry `cloudId` + company but NO hostname, so a text
  search by hostname finds the license yet misses every transaction → a false `$0`. `whois` joins on
  cloudId; do not hand-roll a text search.
- **Slug typo → suggestions.** A miss prints near-match hosts (`woolworth-agile` → `woolworths-agile`).

## Drill-downs (same script)

```bash
python3 $S client <name>   # full license + transaction history for one tenant ("did they ever pay, how much, what plan")
python3 $S tier <domain>   # quick tier / license-type / status
```

## Determinism / offline (optional)

`python3 $S sync` builds a local SQLite snapshot; then add `--local` to any command for
byte-deterministic, offline, sub-100ms lookups. Billing may be stale (it prints the snapshot age and
warns past 24h); Lite Layer-B is skipped in `--local` mode and says so. Use `--local` for batch /
reproducible reports, live for "is X paying right now". See `marketplace-audit` for `sync` details.

## Related

- `marketplace-audit` — the cohort/rollup side: revenue, renewals due, overdue/lapsing, top payers.
- `paywall` / `extend-space-license` — act on a Lite tenant's paid status once you know it.
- `metrics` / `macro-count` — per-space KV / usage: whether the tenant is *using* the app (vs *paying*).

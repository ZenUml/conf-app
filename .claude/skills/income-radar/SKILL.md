---
name: income-radar
description: >-
  Near-term Atlassian Marketplace cash view for the ZenUML apps — what vendor income to
  expect over the next few days (client subscriptions renewing) and which paying clients
  missed a payment in the past few days (renewal lapsed / in grace / dead payment method).
  Use when the user asks "what income am I expecting", "what's landing this week", "any
  renewals coming up", "did anyone miss a payment", "who's late", "income projection for
  the next few days", or wants a daily payments radar. Built on the marketplace-audit engine
  (licenses + transactions joined on cloudId), payers only, all revenue apps. For lifetime
  revenue / top payers / a full renewals-in-a-window audit use `marketplace-audit`; for a
  single tenant's paid status use `tenant`.
---

# Income Radar

A daily near-term cash view built on top of the `marketplace-audit` engine: what's about to
land, and what already slipped.

## Quick start

```bash
# from the conf-app repo root (creds auto-load from .env.forge.local)
S=.claude/skills/marketplace-audit/scripts/mp_report.py

python3 $S radar                 # default: +/-7 days around today
python3 $S radar --days 14       # wider window
python3 $S radar --asof 2026-07-01 --json
python3 $S radar --local         # offline, from the last `sync` snapshot (fast, no creds)
```

`--local` needs a snapshot first (`python3 $S sync`, ~14s, run from `marketplace-audit`).

## What it reports

Two sections:

- **INCOMING** — renewals due in the next N days, summed as expected income. Each row carries
  the same payment-risk `flags` as MISSED, and the header splits out how much of the expected
  total sits on a flagged/dead card (a renewal on `no-payment-method` is the *leading*
  indicator it will fail and land in MISSED next cycle).
- **MISSED** — payer renewals that lapsed in the past N days without a new payment landing,
  summed as income at risk.
- **EVALUATIONS** — trials (`licenseType = EVALUATION`) expiring in the next N days (a
  conversion window — act before they lapse) or that expired in the past N days. A conversion
  signal, **not income** — shown in its own section, kept out of the $ totals. Each row shows
  `converted` (does this tenant+app already have a paid transaction). Lite is excluded (free,
  no paid conversion).

Scope: **all revenue apps** (Full + Diagramly + AsyncAPI; Lite is a free Marketplace listing,
so it's ~$0 here — its paid layer is Stripe/KV, see `extend-space-license` / `paywall`).
**Payers only** — clients with lifetime vendor $ > 0. A never-paying trial or free install
never shows up in either bucket.

One row **per (tenant, app) subscription** — a tenant that pays for both Full and Diagramly
gets two rows (its two real renewals), but a tenant with a paid Full license plus a leftover
free Lite listing gets one (the empty Lite bucket is $0 and drops out — this is why revenue
is aggregated by `(cloudId, addonKey)`, not cloudId alone, so a phantom Lite row can't
double-count the Full income). ZenUML's own internal instances (`zenuml`, `zenuml-connect`)
are excluded.

## Definitions

- **`paid_thru`** — the latest `maintenanceEndDate` among a client's *paid* transactions.
- **expected amount** — the `vendorAmount` of that client's most recent *paid* transaction
  (the number most likely to repeat on the next cycle).
- **INCOMING**: `today <= paid_thru <= today + N`.
- **MISSED**: `today - N <= paid_thru < today` — no newer paid transaction has extended
  coverage past today. Reinforced with `inGracePeriod = Yes` and
  `invoiceDunningReason` ("no-payment-method") flags, plus `inactive` if the license itself
  went inactive.

## Caveats

Dates are customer-renewal timing — a **proxy** for income, not a disbursement schedule.
Atlassian pays out vendors on its own monthly cycle, independent of any one client's renewal
date. A lapse in the last 1-2 days may just be settlement lag, not a true miss — read the
grace / no-payment-method flags before treating a fresh MISSED row as lost revenue.

## Fast path (`--local`)

`--local` reads the shared `marketplace-audit` SQLite snapshot instead of hitting the live
API. Run `python3 $S sync` first to build/refresh it. The command prints the snapshot age on
stderr and warns past 24h — for a "what does today actually look like" answer, run live
instead (radar is billing-sensitive, unlike the cloudId↔domain identity that snapshot lookups
elsewhere rely on).

## Related

- `marketplace-audit` — the shared engine (`mp_report.py`, `sync`), lifetime revenue, top
  payers, and a full renewals-in-a-window audit (`renewals --from --to`).
- `tenant` — single-tenant lookup ("is `<domain>` paying, how big, what state").
- `extend-space-license` / `paywall` — the Lite Stripe/KV layer; Lite paid access isn't in
  Marketplace transactions, so it never appears in this radar.

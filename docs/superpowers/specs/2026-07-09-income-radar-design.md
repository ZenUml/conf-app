# Income Radar — near-term Marketplace payments view

**Date:** 2026-07-09
**Status:** approved (brainstorming)

## Problem

The founder wants a daily-use answer to two questions, driven by Atlassian
Marketplace transaction data:

1. **What income should I expect over the next few days?** — which client
   subscriptions renew soon and how much revenue that represents.
2. **Have any clients missed a payment in the past few days?** — subscriptions
   that were due to renew but whose payment hasn't landed (lapsed / in grace /
   dead payment method).

This is **not** a statistical forecast. It is a near-term, both-directions cash
radar centred on today.

## Data source

Atlassian Marketplace vendor reporting (vendor `1215266`): **licenses** joined
to **sales transactions** on `cloudId`. All of this is already fetched, joined,
and de-trapped by `.claude/skills/marketplace-audit/scripts/mp_report.py`
(bulk-export endpoint, 50-row page-cap fix, cloudId join, billing-period truth,
`--local` SQLite snapshot). The radar **reuses that engine** — it does not
re-implement fetching.

Key per-transaction fields: `vendorAmount` (income to us), `billingPeriod`
(Annual/Monthly), `saleDate`, `maintenanceEndDate` (paid coverage end).

## Definitions (the judgment calls)

For each **paying** subscription (lifetime `vendorAmount` > 0 — never-paid
installs are excluded so the radar doesn't cry wolf), let
`paid_thru` = latest `maintenanceEndDate` among that cloudId's *paid*
transactions, and `expected_amount` = the `vendorAmount` of its most recent
*paid* transaction (best estimate of the next renewal; tier may drift).

- **Incoming (next N days):** `today <= paid_thru <= today + N`. A renewal is due
  in the window. Report date, app, billing period, expected amount, tier,
  company/host. Sum = **expected income, next N days**.
- **Missed / late (past N days):** `today - N <= paid_thru < today` and no newer
  paid transaction has extended coverage (guaranteed, since `paid_thru` is the
  *latest* paid coverage end). The renewal was due and hasn't landed. Reinforce
  with Atlassian's own signals: `inGracePeriod = Yes`,
  `invoiceDunningReason = "PAYMENT METHOD IS NOT SET"`. Report `paid_thru`,
  days late, amount at risk, flags. Sum = **income at risk, past N days**.

### Caveats surfaced in the output (not hidden)

- Dates are **customer-renewal timing**, a proxy for income — Atlassian disburses
  vendor money on its own monthly cycle, so this is not the literal day cash
  arrives.
- A lapse in the **last 1–2 days** may be settlement lag (renewal in flight), not
  a true miss. The `grace` / `no-payment-method` flags disambiguate.

## Scope

- **Apps:** all revenue-bearing Marketplace apps — Full
  (`com.zenuml.confluence-addon`), Diagramly (`gptdock-confluence`), and AsyncAPI
  (`my-api`), each a real payer. Lite (`com.zenuml.confluence-addon-lite`), and the
  two zero-revenue P&D listings (`…whiteboard`, `…jira…diagramly`) carry ≈$0 and
  drop out via the paying-only filter. Implemented by loading every vendor app and
  filtering to payers; no per-app narrowing in v1 (YAGNI — the output has an `app`
  column). Note: `sync`/`--local` snapshot coverage was extended to include
  `my-api`, else `radar --local` silently under-reports AsyncAPI income.
- **Window:** `--days N`, default **7**, symmetric each direction.
- **New sales / trial conversions are out of scope** — unpredictable; only
  renewals of existing payers are projectable.

## Design

### 1. Extend `aggregate_tx()` in `mp_report.py` (additive only)

Add two keys to the per-cloudId aggregate: `last_paid_amount` and
`last_paid_date` — the `vendorAmount` and `saleDate` of the most recent
transaction with `vendorAmount > 0`. Additive keys only; existing commands are
untouched.

Also add `aggregate_tx_by_app(txs)` — the same aggregation keyed by
**`(cloudId, addonKey)`** instead of cloudId alone. **Why:** a tenant can hold a
paid Full license *and* a leftover free Lite listing on one cloudId. Aggregating
by cloudId puts all revenue in one bucket, so both license rows read the same
paid amount and the income is counted twice (verified against live data: one
large annual renewal was double-counted as a phantom Lite row, ~halving the
inflated 7-day total). Splitting by app gives the empty Lite
bucket $0, which drops out under payers-only. Revenue nets correctly to one row
per real subscription.

### 2. New `radar` subcommand: `cmd_radar(args, auth)`

- Args: `--days N` (default 7), `--asof YYYY-MM-DD` (default today); inherits the
  shared `--json` / `--local` / `--db` / `--env`.
- Loads all vendor licenses + transactions, aggregates by `(cloudId, addonKey)`,
  emits **one row per (tenant, app) subscription**, keeps payers (`vendor > 0`),
  excludes ZenUML's own internal instances (`zenuml`, `zenuml-connect`), and
  buckets each into **incoming** or **missed** per the definitions above with both
  dollar totals.
- Text output: two sections with a headline total each; JSON output:
  `{asof, days, incoming:{total,count,rows}, missed:{total,count,rows}}`.
- Incoming sorted by date ascending; missed sorted by amount descending
  (biggest at-risk first).

### 3. New skill: `.claude/skills/income-radar/SKILL.md`

Thin wrapper documenting the daily "what's landing / who slipped" framing,
pointing at `python3 mp_report.py radar --days 7`, the caveats, and the
`--local`/`sync` fast path. Triggers: "income projection", "what am I expecting",
"who missed a payment", "renewals due", "expected income this week".

### 4. Evaluations dimension (added 2026-07-09)

Beyond income, `radar` also lists **evaluations** (`licenseType = EVALUATION`) expiring in
the next N days (a conversion window) or expired in the past N days. Trials are $0, so this
is a conversion signal kept in its own section, **out of the income totals**. Each row shows
`converted` (the tenant+app already has a paid transaction). Lite evals are excluded (free
listing, no paid conversion). Internal instances excluded, one row per (tenant, app).

## Testing

Smoke-test offline via `--local --db <existing snapshot>` to confirm the code
path parses and produces both sections. Cross-check a couple of rows against
`mp_report.py renewals` / `overdue` for the same window.

## Out of scope / future

Per-app narrowing, configurable asymmetric windows, growth-adjusted long-range
projection, Stripe/KV Lite space-license income.

---
name: tenant
description: >-
  Look up ONE Confluence tenant (by domain / slug / cloudId) and answer "is this a paying
  customer, how big are they, what state are they in" — across all ZenUML apps (Full / Lite /
  Diagramly), including the Lite Stripe/KV space-license layer. Use whenever the question is about
  a SINGLE tenant: "is <domain> a paying customer", "look up / who is <domain>", "tenant profile",
  "how big is <domain>", "is X on a trial / when does the trial expire", **"how much would <domain>
  pay if they upgraded"**, or a tenant's paid status for a paywall / conversion / extension-request
  decision. Also owns the report shape for a tenant write-up: a commercial judgement (who they are,
  what the account is worth, what blocks conversion, what to do) with the telemetry pushed to an
  evidence block at the bottom. Pricing numbers come from `marketplace/scripts/mp_pricing.py`; this
  skill fronts it for the single-tenant case so a price question about a named customer never has
  to route elsewhere. For cohort / rollup / portfolio questions (total revenue, renewals due in a
  window, overdue payers, top payers) use the `marketplace` skill instead. Discriminator, one rule:
  a named tenant in the question -> this skill; a cohort, time window, ranking, or a bare user count
  with no tenant -> marketplace. Triggers on tenant, whois, "is <domain> paying", paid status,
  tenant lookup, cloudId, tenant profile, tenant size, trial expiry, "how much would <domain> pay".
---

# Tenant lookup

Answers per-tenant questions off Atlassian Marketplace license/transaction data **plus** the Lite
Stripe/KV space-license layer. It's the single-tenant primitive over `marketplace`'s engine
(`mp_report.py`) — same auth, cloudId join, and SQLite snapshot — so there is no separate code to
drift. (The script physically lives under `marketplace/scripts/`; this skill references it by
path, the same way `macro-count` references `mixpanel`'s script.)

## The one command you want

```bash
S=.claude/skills/marketplace/scripts/mp_report.py
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
reproducible reports, live for "is X paying right now". See `marketplace` for `sync` details.

## Report shape — a commercial judgement, not a telemetry dump

`whois` gives you the card. When the user asks about a tenant, what they want back is a decision:
**is this tenant worth acting on, and what is the action.** Write these four blocks, in this order.

```
<domain> — <seats> seats, <$X>/year, <the time-sensitive fact>

【Who】   Company, industry, country. Industry needs a web lookup — the licence carries only
         `contactDetails.company` and `country`. Then seats, main space, macro count, macro-type
         mix, and the named contacts. Different contacts on different apps is a signal: say so.
【Opportunity】 currentUsd -> potentialUsd. Get the number from
         `marketplace/scripts/mp_pricing.py quote <seats>`, never from memory. Name any trial
         window and its expiry date.
【Blocker】 The concrete fact stopping conversion. Not the mechanism — the consequence.
【Action】 1. In-product lever (always allowed, do this first).
         2. Outreach, marked "terms unverified" — see the no-outreach rule; you may list it, not
            lead with it.
---
Evidence: one line per load-bearing number, each with the command that reproduces it.
```

**The body carries no telemetry.** No event names, no `policy_source`, no `gate_fired` counts, no
file paths, no code excerpts. Those are how you *know*; they are not what the reader is deciding
about. They belong in the Evidence block at the bottom, where they can be checked and otherwise
cost nothing to skip.

Worked example, 2026-08-11 (`example-tenant`, a small-seat Lite site): the first four attempts led
with paywall event counts, gate evaluations and `functions/feature-flags.ts` internals, and never
once said who the company was or what the account was worth. The user's verdict: *"结构非常不好。
不是我关心的东西"*. The identity lookup was the highest-value missing line — the tenant turned out
to be a venture-funded AI-infrastructure company that had closed a nine-figure round that month,
which settles instantly whether a $611/year plan is a real obstacle. (Tenant identity stays in
`private/`; see [client privacy](../../../docs/policies/client-privacy.md).)

Data sources per block: 【Who】 licence `contactDetails` + web search + `macro-count` skill +
Mixpanel `macro_type` breakdown; 【Opportunity】 `mp_pricing.py quote`; 【Blocker】 whatever the
investigation found; 【Action】 the `paywall` / `extend-space-license` skills.

`private/client-profiles/data/<domain>.json` holds the same shape as persisted data
(`identity` / `license` / `arr` / `mixpanel` / `kv_metrics` / `status`) and renders as a Handbook
page. Update it when an investigation produces something worth keeping.

## Related

- `marketplace` — the cohort/rollup side: revenue, renewals due, overdue/lapsing, top payers.
- `paywall` / `extend-space-license` — act on a Lite tenant's paid status once you know it.
- `metrics` / `macro-count` — per-space KV / usage: whether the tenant is *using* the app (vs *paying*).

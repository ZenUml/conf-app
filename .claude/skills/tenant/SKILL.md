---
name: tenant
description: >
  Look up one Confluence site's verified product, license, payment, contact and pricing facts.
  Use for tenant profiles, paid status, site size, trials and potential annual value. Reuses
  Marketplace exports and the separate Lite KV layer; customer-followup owns action decisions.

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
  customer": it may be an active trial (whose billing outcome still needs verification) or a
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

## Report shape

Give company/site, verified product/license/payment facts, contact roles and evidence gaps. `paying_any_layer` is nullable when the Lite payment layer is unchecked or failed. True means payment evidence exists, not that the current subscription is paid through today. Review transaction periods/refunds and active coverage separately.

For a decision, pass the facts to `customer-followup`. This lookup does not grant permission for product changes, free extensions, outreach or scheduling. Contact role is not established by a technical-contact label. Full trial expiry alone is not a reason to chase purchasing.

Potential pricing comes from `marketplace/scripts/mp_pricing.py quote <seats>` using the current verified tier; report currency, source date and whether the amount is a public list price, quote or actual transaction. Keep long evidence and customer identities in `private/`.

Related: `customer-lifecycle`, `customer-feedback`, `customer-followup`, `marketplace`, `macro-count`.

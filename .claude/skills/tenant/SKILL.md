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

For a purchase check, scope the product explicitly:

```bash
python3 $S whois <domain> --app full --json --no-kv
python3 $S whois <domain> --app full --order-id <transactionId> --json --no-kv
```

**Use `verification.conclusion` for Marketplace purchase claims.** `UNVERIFIED` means the
query or identity evidence is incomplete; authentication failures and unfinished browser searches
cannot establish absence. `NO_MATCHING_PURCHASE` applies only to the reported product, verified
identity and data vintage. `PURCHASE_FOUND` establishes an order, not settlement or current access.
The legacy card still lists all installed apps; `--app` scopes `verification`. Coverage uses the
reported `asof_utc_date` (UTC calendar date), and live queries are the default.
An Evaluation license can coexist with an order whose service starts later. Browser evidence must
show a completed result and its identity/product scope before it can support a conclusion.

## What the card encodes (the traps baked in)

- **Purchase and settlement are independent.** Inspect raw transactions alongside the license. The current `whois` helper can label positive transaction amounts `PAID` without checking `paymentStatus`; its `PAID`, `paying` and lifetime totals are not independent payment confirmation. Verify raw Paid/Fully paid/Open status, source IDs and service periods in the Marketplace export/snapshot. A valid commercial order with Open status establishes purchase, while settlement stays unconfirmed. Do not describe that customer as unpaid or without an order.
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

For a purchase check, report four lines from `verification`:
- Purchase evidence: conclusion, matched transaction/line IDs and product.
- Settlement: raw `paymentStatus`; missing or unknown stays unconfirmed.
- Service: start/end dates and coverage at the stated as-of date; future coverage is not active.
- Query: completeness, verified identity, source and fetch/snapshot time, plus any gaps.

Give company/site, purchase evidence, verified product/license facts, source-reported payment status, contact roles and evidence gaps. Preserve transaction/line IDs, sale dates, amounts and coverage rather than quoting only a lifetime total. The helper's `paying_any_layer` can be unknown when Lite is unchecked, but a true result still requires raw Marketplace/Stripe verification before claiming payment. Review transaction periods/refunds and overlapping invoices separately; Open-only orders must not be described as “no transaction found”.

For purchase/renewal opportunities, pass a matched valid non-zero order with effective commercial license to `customer-followup` as a commercial win, even if settlement is Open. Exclude refunds, cancelled/voided orders and free-only rows. A paused support or technical conversation is separate from this commercial fact.

For a decision, pass the facts to `customer-followup`. This lookup does not grant permission for product changes, free extensions, outreach or scheduling. Contact role is not established by a technical-contact label. Full trial expiry alone is not a reason to chase purchasing.

Potential pricing comes from `marketplace/scripts/mp_pricing.py quote <seats>` using the current verified tier; report currency, source date and whether the amount is a public list price, quote or actual transaction. Keep long evidence and customer identities in `private/`.

Related: `customer-lifecycle`, `customer-feedback`, `customer-followup`, `marketplace`, `macro-count`.

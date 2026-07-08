---
name: marketplace-audit
description: >-
  Audit Atlassian Marketplace vendor reporting (licenses + sales transactions) for the ZenUML apps
  at the PORTFOLIO / cohort level — lifetime vendor revenue, renewals due in a date window, annual
  vs monthly billing, overdue / lapsing payers, top payers, churned payers. Use whenever the user
  asks about revenue, renewals, "who's overdue", "which annual customers renew this month", biggest
  paying customers, or any rollup across the customer base — even if they don't say "Marketplace".
  For a SINGLE tenant's paid status / size / profile ("is <domain> a paying customer", "look up
  <domain>", trial expiry), use the `tenant` skill instead. Discriminator: a cohort / time-window /
  ranking -> this skill; one domain in the question -> `tenant`. Prefer this over ad-hoc curl: it
  uses the fast bulk export endpoint and joins licenses to transactions correctly on cloudId (naive
  approaches truncate at a 50-row page cap and undercount revenue). Also hosts the shared engine
  (`scripts/mp_report.py`) + `sync` snapshot that the `tenant` skill's per-tenant lookups run on.
---

# Marketplace Audit

Answers revenue / renewal / overdue / tier questions for the ZenUML Marketplace apps by pulling
the vendor's **licenses** and **sales transactions** and joining them locally.

Run everything through `scripts/mp_report.py` — it already encodes the three things that are easy
to get wrong (see "Why the script exists"). Don't hand-roll `curl` pagination.

## Quick start

```bash
# from the conf-app repo root (creds auto-load from .env.forge.local)
S=.claude/skills/marketplace-audit/scripts/mp_report.py

python3 $S --app full renewals --from 2026-07-01 --to 2026-07-31   # renewals due this month
python3 $S --app full renewals --from 2026-07-01 --to 2026-07-15 --billing annual --paid-only
python3 $S --app full overdue --paid-only                          # real payers past-due / lapsing
python3 $S --app full revenue --period annual --top 20             # biggest annual customers
python3 $S --app all client example-tenant-g                       # one client's full history
python3 $S --app lite tier example-tenant-a                        # tier / license for a tenant
python3 $S whois example-tenant-a                                  # domain -> cloudId, users, paying?, lifetime $ (one card)
# (tenant slugs above are placeholders — pass a real slug; real names: see private/ client profiles)
```

Add `--json` to any command for machine-readable output. `--app` accepts `full`, `lite`, `both`
(both ZenUML apps), `all` (entire vendor incl. non-ZenUML apps), or an explicit `com.*` addon key.
Default is `full`.

## Subcommands

| command | what it answers |
|---|---|
| `renewals --from D --to D` | Licenses whose `maintenanceEndDate` falls in the window, joined with lifetime revenue, billing period, and paid-through date. Filter with `--billing annual\|monthly` and `--paid-only`. This is the "who renews / is due between X and Y" query. |
| `overdue [--asof D]` | Clients whose paid coverage has lapsed, who are in grace, or who have no payment method. `--paid-only` restricts to real payers (lifetime vendor $ > 0). Sorted by lifetime value so the customers worth an email float to the top. |
| `client <name>` | Full license + transaction history for one tenant (text search on company/slug). Use for "did they ever pay / how much / what plan". |
| `revenue [--period] [--top N]` | Top paying clients by lifetime vendor $, with billing period and paid-through. `--period annual\|monthly`. |
| `tier <domain>` | Quick tier + license-type + status for a tenant (the number that drives Full-plan pricing). |
| `whois <domain>` | One card for a domain across **all** apps: cloudId(s), users, and a **state** per app — `FREE` / `TRIAL (expires D, ⚠ Nd left)` / `PAID $X` / `LAPSED` (never just "paying? $0", which hides an active trial or a churned payer). Joins tx on **cloudId** (not text — see the trap below). For Lite tenants it **auto-checks the Layer-B (Stripe/KV) space-license layer** (`wrangler kv … --remote` baked in — the woolworths/coles footgun) and prints `[Layer B: none / N space-licenses]`, giving a complete Lite paid verdict in one command. On a slug miss it **suggests near-match hosts**. cloudId falls back to `_edge/tenant_info`. `--no-kv` skips the ~2s Lite KV call; `--local` skips it too (determinism) and says so. The "is X a paying customer and how big are they" primitive. |
| `sync` | Snapshot **all** apps' licenses + transactions into a local SQLite DB (`scripts/marketplace.db`, ~1.7k licenses + ~5k tx, ~14s). Then add `--local` to ANY command to run against the snapshot (sub-100ms, offline, no creds). |

### Local snapshot (`sync` + `--local`) — for batch & cross-source joins

`sync` stores each row's **raw JSON**, so with `--local` the `export()` layer hands every command the exact same dicts — `whois`/`client`/`revenue`/`overdue --local` all just work, ~17× faster (0.2s vs 3s). Use it for **batch** lookups (N domains) and **cross-source joins** (cloudId is the key to Mixpanel `macro_viewed` and D1 usage), NOT to shave time off a single live lookup.

**Freshness is the catch:** cloudId↔domain identity is stable, but **billing (transactions, lifetime $, tier, status) is volatile** — a snapshot goes stale as renewals/cancellations land. `--local` prints the snapshot age on stderr and warns past 24h. For a "who is paying **right now**" answer, `sync` first (or just run live). The `.db` is gitignored (regenerable + client-sensitive).

## Reading the output — what the fields mean

- **`lifetime_vendor`** — total `vendorAmount` the vendor actually received across all this
  client's transactions. **This is the truth of "are they a paying customer."** A `COMMERCIAL`
  license with `$0` here has *not* paid us (evaluation-converted, comped, or `LEGACY_FREE`).
- **`billing`** — `Annual` / `Monthly`, derived from the transaction `purchaseDetails.billingPeriod`
  (authoritative). Never infer billing period from license maintenance-date spans; the license
  `maintenanceStartDate` reflects the latest cycle, not the anniversary, so the span lies.
- **`paid_thru`** — the latest `maintenanceEndDate` among *paid* transactions. More reliable than a
  license's `maintenanceEndDate`, which can lag. `paid_thru < today` ⇒ their paid coverage lapsed.
- **`dunning` / `no-payment-method`** — `invoiceDunningReason = "PAYMENT METHOD IS NOT SET"`. On an
  active client near renewal it means **the next auto-renewal will fail** unless they fix their
  card. But it is *noisy*: it also appears on never-paid installs, so always read it next to
  `lifetime_vendor`. A no-payment-method flag on a `$0` client is not a lost sale.
- **`grace`** — Atlassian's official `inGracePeriod = Yes` (payment failed, still active for now).
  The strongest single "overdue right now" signal, but rare.
- **`status`** — `active` / `inactive`. Access is **soft-enforced**, so a lapsed annual payer can
  stay `active` and keep using the app long after `paid_thru` — don't read `active` as "paid".

Because ZenUML access is soft-enforced everywhere, the honest definition of an **overdue paying
client** is: `lifetime_vendor > 0` **and** (`grace` or `paid_thru < today` or a real renewal about
to fail on `no-payment-method`). The script's `overdue --paid-only` encodes exactly that.

## Why the script exists (don't bypass it)

Three traps that a naive `curl` gets wrong, all fixed inside `mp_report.py`:

1. **The paginated `?limit=&offset=` reporting endpoints cap pages at 50 rows** — asking for 100
   returns 50. The Full-app transaction set is ~4,200 rows → ~85 sequential requests ≈ 160s, which
   blows the 120s command timeout. It also silently truncates lifetime revenue if you stop early
   (this made a $3,800 customer look like $337). **The fix is the bulk export endpoint**, which
   returns the entire filtered dataset in ONE request (~3-7s):
   `/rest/2/vendors/1215266/reporting/{licenses,sales/transactions}/export?accept=json&addon=…`.
   Note the JSON export is a **bare array**, not `{"transactions": […]}`.
2. **Join licenses ↔ transactions on `cloudId`.** Transactions carry `cloudId` +
   `customerDetails.company` but **no `cloudSiteHostname`** — keying on hostname silently matches
   nothing.
3. **Billing period comes from transactions, not license date math** (see above).

Auth: `FORGE_EMAIL` / `FORGE_API_TOKEN` (Basic auth), vendor **1215266**. The script auto-discovers
`.env.forge.local` at the repo root; override with `--env <path>` or export the two vars.
Fetching Marketplace license/transaction data is **read-only** — but per deploy discipline, treat
the Marketplace credentials as sensitive and don't echo the token.

## Addon keys

| app | addonKey | notes |
|---|---|---|
| ZenUML **Full** | `com.zenuml.confluence-addon` | the paid app; where real Full revenue lives |
| ZenUML **Lite** | `com.zenuml.confluence-addon-lite` | free listing; paid Lite access is the Stripe/KV space-license layer, **not** here |

Lite is a free Marketplace listing, so `revenue`/`overdue` on `--app lite` will be near-empty by
design — paid Lite access is enforced in the separate Stripe/KV space-license layer (see the
`extend-space-license` skill and `paywall` skill), not in Marketplace transactions.

## Examples

**"Which annual customers renew in July, and are any at risk?"**
```bash
python3 $S --app full renewals --from 2026-07-01 --to 2026-07-31 --billing annual --paid-only
```

**"Who are our biggest paying customers?"**
```bash
python3 $S --app full revenue --top 25
```

**"Is <tenant> actually paying us, and on what plan?"**
```bash
python3 $S --app all client <tenant-slug>
```

## Related

- `extend-space-license` — grant a temporary Lite space license (the Stripe/KV layer).
- `paywall` — Lite paywall rollout; `metrics` / `macro-count` — per-space KV data.
- Pricing model: `docs/pricing-model.yml`. Two-billing-layers background lives in team memory.

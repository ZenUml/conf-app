---
name: marketplace
description: >-
  Authoritative source for Atlassian Marketplace PRICING, licenses, and vendor revenue for the
  ZenUML apps. Two things it answers that nothing else does: (1) what a tenant pays — the Full
  plan's cumulative per-user band table, the $299/space/year Enterprise Bundle, monthly vs annual
  (annual = 10x monthly), and how much we actually NET after Atlassian's cut, which moved 15% ->
  20% -> 0% inside 19 months and must always be derived from transactions rather than quoted from
  memory; (2) portfolio / cohort reporting — lifetime vendor revenue, renewals due in a date
  window, overdue / lapsing payers, top payers, churned payers. Use whenever the user asks "how
  much will <tenant> pay", "what's our price for N users", "what do we net", "how much does
  Atlassian take", about revenue, renewals, "who's overdue", "which annual customers renew this
  month", biggest paying customers, or any rollup across the customer base — even if they don't
  say "Marketplace". Never state a price or a take rate without running `scripts/mp_pricing.py`.
  For a SINGLE tenant's paid status / size / profile ("is <domain> a paying customer", "look up
  <domain>", trial expiry), use the `tenant` skill instead. Discriminator: a cohort / time-window /
  ranking -> this skill; one domain's paid STATUS -> `tenant` (but one domain's PRICE -> here).
  Prefer this over ad-hoc curl: it uses the fast bulk export endpoint and joins licenses to
  transactions correctly on cloudId (naive approaches truncate at a 50-row page cap and undercount
  revenue). Also hosts the shared engine (`scripts/mp_report.py`) + `sync` snapshot that the
  `tenant` skill's per-tenant lookups run on.
---

# Marketplace

Answers revenue / renewal / overdue / tier / **pricing** questions for the ZenUML Marketplace apps
by pulling the vendor's **licenses** and **sales transactions** and joining them locally.

Two scripts: `scripts/mp_report.py` for licenses and revenue, `scripts/mp_pricing.py` for what a
tenant pays and what we net. Both encode things that are easy to get wrong (see "Why the script
exists"). Don't hand-roll `curl` pagination, and don't quote a price from memory.

## What does this tenant pay? — `mp_pricing.py`

```bash
S=.claude/skills/marketplace/scripts/mp_pricing.py

python3 $S quote 152        # list price for a 152-user site + what we actually net
python3 $S takerate         # Atlassian's cut, month by month, derived from transactions
python3 $S validate         # does the band table still match real renewals?
python3 $S tiers            # the band table
```

**The Full plan is cumulative per-user bands, priced per MONTH.** Annual list = 10 × monthly
(two months free). A 152-user site pays `100 × $0.44 + 52 × $0.33 = $61.16/month`.

| band | USD per user per month |
|---|---|
| 1–100 | $0.44 |
| 101–250 | $0.33 |
| 251–1000 | $0.11 |
| 1001+ | $0.05 |
| 1–10 users | flat $40/year |

Enterprise Bundle is a separate SKU: **$299 per space per year**, flat, billed by us through
Stripe, so no Atlassian cut applies. Below ~68 users the Full plan is cheaper than one Bundle.

**Never write Atlassian's take rate down — derive it.** It moved three times in 19 months:

| period | vendor keeps | cut |
|---|---|---|
| ≤ 2026-03 | 85% | 15% |
| 2026-04 → 2026-07-19 | 80% | 20% |
| 2026-07-20 onward | 100% | **0** |

The zero-cut period is described as temporary. `mp_pricing.py quote` reads the current rate from
the last 30 days of transactions on every run, so it cannot go stale the way this table will.
It takes the **most common per-transaction ratio**, not an average: during a cutover both rates
coexist for weeks, and averaging them invents a rate no transaction ever settled at (2026-08 blends
18 zero-cut and 2 residual 80% transactions into a fictional 98.6%).

**Two traps this exists to stop** (both hit 2026-08-11):

1. A reply quoted "Atlassian takes 25%, so ~$45.87/month net". No transaction has ever settled at
   75%. The number came from nowhere.
2. The band table lived only inside `extend-space-license/scripts/grant_extension.py` as a private
   `full_plan_arr()` returning annual figures, so a monthly question had to reverse-engineer it.
   `docs/pricing-model.yml` covers Lite only and explicitly declares Full pricing out of scope.

`validate` is the guard against the bands themselves drifting: it re-checks them against real Full
monthly renewals and prints a match rate. Verified 2026-08-11 at 82/102 exact; the mismatches were
1–3 user sites settling a mid-cycle tier change pro rata. If that rate drops, Atlassian changed the
price list and `BANDS` is stale.

## Quick start

```bash
# from the conf-app repo root (creds auto-load from .env.forge.local)
S=.claude/skills/marketplace/scripts/mp_report.py

python3 $S --app full renewals --from 2026-07-01 --to 2026-07-31   # renewals due this month
python3 $S --app full renewals --from 2026-07-01 --to 2026-07-15 --billing annual --paid-only
python3 $S --app full overdue --paid-only                          # real payers past-due / lapsing
python3 $S --app full revenue --period annual --top 20             # biggest annual customers
python3 $S --app all client example-tenant-g                       # one client's full history
python3 $S --app lite tier example-tenant-a                        # tier / license for a tenant
python3 $S whois example-tenant-a                                  # domain -> cloudId, users, paying?, lifetime $ (one card)
# (tenant slugs above are placeholders — pass a real slug; real names: see private/ client profiles)
```

Add `--json` to any command for machine-readable output. `--app` accepts an alias — `full`,
`lite`, `diagramly`, `asyncapi` — or `both` (Full + Lite only), `all` (entire vendor incl.
non-ZenUML apps), a known addon key from the table below, or an explicit `com.*` addon key.
Default is `full`. Any other value is a usage error (exit 2, accepted values listed) — before
2026-09-02 an unrecognised value such as `my-api` silently returned the ALL-apps result under an
`app=my-api` header.

Unit check (no network, no credentials): `python3 .claude/skills/marketplace/scripts/test_mp_report.py`
(`python3 -m unittest <path>` cannot import a path that starts with `.claude/`; use
`python3 -m unittest discover -s .claude/skills/marketplace/scripts` instead.)

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

### cloudId ≠ customer — the site-migration false-churn trap

All revenue joins key on `cloudId`, but a customer that **migrates Confluence sites gets a new
cloudId**: the old license converts to `LEGACY_FREE` and reads as a churned payer, while the new
site reads as an unrelated new customer. Real case (2026-07): `wendys.atlassian.net` showed as a
$5.5k lapsed win-back target, but Wendy's had moved to `wentrack.atlassian.net` — COMMERCIAL,
renewed annually, paid through 2027 (caught by the user, not the tooling).

**Before declaring any payer churned, run the migration-twin check:** take the lapsed license's
`contactDetails.technicalContact.email` domain and scan **all** vendor licenses for another host
with the same contact domain holding an active `COMMERCIAL` license / recent paid transactions.
Match on the technical contact, not the billing contact — billing contacts are often resellers
(e.g. Isos Technology) shared across many unrelated customers. Residual blind spot: a migration
whose new site lists a different contact domain (e.g. only the reseller's) still slips through.

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

| app | `--app` alias | addonKey | notes |
|---|---|---|---|
| ZenUML **Full** | `full` | `com.zenuml.confluence-addon` | the paid app; where real Full revenue lives |
| ZenUML **Lite** | `lite` | `com.zenuml.confluence-addon-lite` | free listing; paid Lite access is the Stripe/KV space-license layer, **not** here |
| **Diagramly** | `diagramly` | `gptdock-confluence` | Diagramly-branded variant; second revenue app |
| **AsyncAPI for Confluence** | `asyncapi` | `my-api` | third revenue app; its own Forge app identity |

`sync` snapshots all four; `--app both` covers only Full + Lite.

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

- `income-radar` — near-term cash view built on this engine (`radar` subcommand): renewals
  due in the next few days + payments missed in the past few days, with dollar totals.
- `extend-space-license` — grant a temporary Lite space license (the Stripe/KV layer).
- `paywall` — Lite paywall rollout; `metrics` / `macro-count` — per-space KV data.
- Pricing model: `docs/pricing-model.yml`. Two-billing-layers background lives in team memory.

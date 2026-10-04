---
name: marketplace
description: >-
  Query live Atlassian Marketplace pricing, licenses, transactions and revenue cohorts for
  the ZenUML apps. Use for seat-based prices, monthly/annual quotes, vendor share, renewal
  windows, overdue candidates, top customers and portfolio rollups. Separates recorded
  purchases from source-reported payment and vendor payout; Open orders are not absent
  purchases. Use mp_pricing.py for prices and take rates, and mp_report.py for bulk exports,
  scoped license/transaction joins and local snapshots. For one tenant's status, profile or
  trial expiry use tenant, which reuses this engine; one tenant's price still belongs here.
---

# Marketplace

Answers revenue / renewal / overdue / tier / **pricing** questions for the ZenUML Marketplace apps
by pulling the vendor's **licenses** and **sales transactions** and joining them locally.

For customer status, follow [shared transaction evidence rules](../customer-data/evidence.md). Keep purchase evidence, source-reported settlement and vendor payout separate. A valid non-zero purchase/renewal transaction plus effective commercial license is a recorded commercial purchase even when `paymentStatus=Open`; it is not an absent order. Positive `vendorAmount` alone is not settled payment. `Paid` and `Fully paid` are source-reported invoice payment states, not evidence of a bank payout to the vendor.

**Current helper limitation:** `mp_report.py` still derives `PAID`, `paying`, `lifetime_vendor` and `paid_thru` from transaction amounts without checking payment status. `client` also omits the raw payment-status field. For payment, paid-only cohort or renewal conclusions, inspect the underlying bulk export / SQLite raw JSON and apply the shared evidence rules; do not treat those summary labels as proof. This skill update does not change the script or historical report values.

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

**Full annual and monthly billing use different published price shapes.** `quote` and `tiers` read the live Marketplace price list. Annual is the flat price of the tier containing the verified seat count; do not multiply a monthly price by ten. The grant tool delegates to the same implementation. If fetching or tier coverage fails, report price unknown rather than using a stale fallback.

The configured single-space reference is $299/year; verify the actual checkout before a commercial quote. Choose whether to mention it using `customer-followup` contact policy: site administrators and site-wide procurement owners receive Full only. Do not hardcode a seat break-even point.

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
| `whois <domain>` | One card across installed apps: identity, users, license state and transaction-based summaries. Joins cloudId + product; verify entitlement, raw status and source IDs from exports before payment conclusions (see helper limitation above). Lite automatically checks remote Stripe/KV; `--no-kv` / `--local` explicitly leave that layer unchecked. On a slug miss, suggests near-match hosts; cloudId can fall back to `_edge/tenant_info`. |
| `sync` | Snapshot **all** apps' licenses + transactions into a local SQLite DB (`scripts/marketplace.db`, ~1.7k licenses + ~5k tx, ~14s). Then add `--local` to ANY command to run against the snapshot (sub-100ms, offline, no creds). |

### Local snapshot (`sync` + `--local`) — for batch & cross-source joins

`sync` stores each row's **raw JSON**, so with `--local` the `export()` layer hands every command the exact same dicts — `whois`/`client`/`revenue`/`overdue --local` all just work, ~17× faster (0.2s vs 3s). Use it for **batch** lookups (N domains) and **cross-source joins** (cloudId is the key to Mixpanel `macro_viewed` and D1 usage), NOT to shave time off a single live lookup.

A refresh writes a separate database and replaces the current snapshot only after every export and metadata commit succeeds. A failed refresh preserves the previous snapshot; report its original age and the failed attempt separately.

**Freshness is the catch:** cloudId↔domain identity is stable, but **billing (transactions, lifetime $, tier, status) is volatile** — a snapshot goes stale as renewals/cancellations land. `--local` prints the snapshot age on stderr and warns past 24h. For a "who is paying **right now**" answer, `sync` first (or just run live). The `.db` is gitignored (regenerable + client-sensitive).

## Reading the output — what the fields mean

- **`lifetime_vendor`** — the current helper's raw signed transaction-amount sum, not status-filtered settlement or bank receipts. Inspect payment statuses and overlapping invoices before reporting received revenue. An Open commercial order can exist with unconfirmed settlement; neither that uncertainty nor a commercial license alone establishes non-purchase.
- **`billing`** — `Annual` / `Monthly`, derived from the transaction `purchaseDetails.billingPeriod`
  (authoritative). Never infer billing period from license maintenance-date spans; the license
  `maintenanceStartDate` reflects the latest cycle, not the anniversary, so the span lies.
- **`paid_thru`** — the current helper's latest positive-amount transaction end; despite its name, this may include Open orders. Rebuild confirmed coverage from raw statuses and matched subscription/periods before calling it paid coverage. Future-only intervals do not cover today. A newer Open renewal already records a purchase; do not label it a missing order or lost sale.
- **`dunning` / `no-payment-method`** — `invoiceDunningReason = "PAYMENT METHOD IS NOT SET"`. On an
  active client near renewal it means **the next auto-renewal will fail** unless they fix their
  card. But it is *noisy*: it also appears on never-paid installs, so always read it next to
  `lifetime_vendor`. A no-payment-method flag on a `$0` client is not a lost sale.
- **`grace`** — Atlassian's official `inGracePeriod = Yes` (payment failed, still active for now).
  The strongest single "overdue right now" signal, but rare.
- **`status`** — `active` / `inactive`. Access is **soft-enforced**, so a lapsed annual payer can
  stay `active` and keep using the app long after `paid_thru` — don't read `active` as "paid".

An overdue-payment candidate needs historical reported settlement plus a dated coverage/payment-risk signal. A newer order may already complete the buying process while settlement remains unconfirmed. Keep that case separate from an absent renewal, and never infer missing purchase or failed payment from Open alone.

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

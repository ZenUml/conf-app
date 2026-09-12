# Shared customer evidence rules

Used by all three customer skills. This directory is shared data/reference, not another skill or runtime.

## Product and identity scope

Read `products.json`. Customer screening spans all five entries. The new-customers `all` and the standard local Marketplace sync cover the four conf-app entries; Marketplace live `all` is vendor-wide and may cover more. Query Mini Sites explicitly using its registered Marketplace key and its own telemetry; do not silently omit it or substitute conf-app usage. `forge-installs all` reports the four registered Forge IDs plus Mini Sites as unsupported until its ID is verified. Never equate different tools' `all` switches.

Join site facts with verified cloudId/domain mapping and product identity. Deduplicate transactions by their source identifiers and aggregate by site + product, not site alone. A company can own multiple sites; a site can have Full and Lite installed simultaneously. Split version use first; combined unique-account totals require cross-version deduplication.

Technical-contact fields are source labels, not proof of site admin, budget owner or current employment. Keep name/email/role, role-evidence reference, source date and channel separately. Verify company country and contact timezone; a license country conflicting with company location is uncertainty, not a resolved timezone.

## Every signal carries

`site`, `product`, `kind`, `facts`, `source`, `source_ref`, `occurred_at` (or bounded observation interval), `queried_at`, `window`, `timezone`, `read_status`, `coverage`, `unknowns`. Read status is one of `ok`, `empty`, `failed`, `unavailable`, `not_queried`. `empty` is permitted only after a successful query over a stated scope. Current-state-only records have no invented transition date. Original source IDs stay with the record for deduplication; real data stays private.

Fact, inference and proposed action must be distinguishable. Query skills output facts and gaps, not a new permission to act. A cached source includes snapshot time; queried-at today does not make yesterday's snapshot current. Billing/contact decisions require checking relevant recent originals; do not repeatedly refresh an unchanged unrelated source.

## Signal × source × derivability

| Signal | Primary evidence | Can establish | Cannot establish alone |
|---|---|---|---|
| New license start | Marketplace license, subscription identity, known history | A new license-period candidate | First installation, first company acquisition or payment |
| Install added/removed | Complete Forge snapshots with same product/scope | Observed presence change between snapshots | Exact uninstall time or reason; a failed/partial fetch is not absence |
| Cancel/unsubscribe/inactive | Marketplace raw status/history or feedback | Recorded state, or transition if dated evidence exists | Uninstalled app, immediate access loss, or no intent to buy |
| Trial/maintenance deadline | Marketplace license and subscription | Specific date and license type | Automatic payment succeeded/failed or a need to chase the customer |
| Manual space/user grant deadline | Remote KV key and value with scope | Scope, status and expiry of that grant | Full subscription renewal, received money or universal editing block |
| Paid / refund | Matched Marketplace transaction; Stripe/payment reference verified in billing source | The evidenced transaction and period | Current coverage from lifetime revenue; a grant's `isPaid` flag may mean comped access |
| Customer opinion | Original Marketplace text, CSAT submission, D1 report, email/ticket | Stated request, reason or experience | Silent users' opinions or behavioural causality |
| Activity | Mixpanel macro view/create/save events | Observed operations and known-account activity in the window | Inventory, installed seats, willingness to pay, or absence outside coverage |
| Space inventory | Current Confluence/metrics inventory with timestamp | Reported current macro count per space and coverage | Count from cumulative create events or merely viewed instances |

## Analytics and schema cautions

- `macro_viewed` is engagement; D1 `page_viewed` is Confluence page activity. Creates and updates are separate operations; both are saves but neither is current macro stock.
- Exclude missing and known placeholder account IDs (`unknown_user_account_id`, `unknown`, `anonymous`, `null`, `undefined`) from person counts. Do not blanket-exclude arbitrary opaque genuine account IDs. Report anonymous event volume separately when available.
- State ranking denominator, eligible cohort, time window, product scope and tied-rank method. `client-health` uses active Lite sites and relative scores; creation breadth/seat tier is not all-user adoption. Prior-window zero can exaggerate growth. Re-check Full licenses before treating a Lite score as an upgrade opportunity.
- Current Forge sync code includes cloudId/site mappings and Graph `macro_viewed`; older documents claiming these never exist are historical. Verify production deployment, nulls and date coverage before joining D1. D1 sync can fail, so it is not a complete diagram ledger or a guaranteed inventory bound.
- D1 `FeedbackReport` capability is deployment-dependent; inspect schema/access and report missing coverage. Mixpanel workflow events need not carry the feedback report reference.
- Remote KV read failure or malformed values must remain unknown. A successfully read empty list is different. Keys use `license:<cloudId>:<spaceKey>[:<userAccountId>]`; an account ID may contain colons.

## Access and reuse

Use existing Marketplace exports/snapshots, Forge install CLI, Mixpanel query runtime, configured read-only D1 routes and Gmail/JSM connectors/browser sessions. Do not create another credential store or infer public availability of customer data. The local CRM is a source of classification semantics and known coverage limits; simulated UI actions never establish production changes.

Do not claim all sources checked when one is unavailable. Present partial useful findings and state the specific missing source, rather than turning access failures into empty results.

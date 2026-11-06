# Client Health Scoring — Design

Status: approved (brainstorming), pending implementation plan.

## Purpose

Rank ZenUML Lite tenants on two independent axes so the operator can decide
who to focus on:

- **Opportunity score** — how strong an upsell (Lite→Full) candidate a
  tenant is.
- **Risk score** — how likely a tenant is to disengage, ahead of an
  uninstall or unsubscribe.

A tenant can rank high on one axis and low on the other — the two scores
are never combined into a single number.

Motivated by this session's manual investigation of two similarly-sized
Lite tenants (tenant-a, tenant-b: both ~800 users, near-identical
`macro_viewed` volume) that turned out to have very different adoption
shapes — tenant-a's views spread across 144 unique viewers/12 creators,
tenant-b's over 38 viewers/4 creators. That comparison was done by hand,
one tenant pair at a time; this system generalizes it across the whole
Lite fleet.

## Scope

**Lite only.** Full/Diagramly/AsyncAPI are out of scope for this version —
Lite is the upsell target and the only variant with a paywall friction
signal. Full-tenant churn risk, if wanted later, is a separate design.

**Active tenants only.** A tenant is scored only if it has at least one
`macro_viewed` event in the 90-day window. Dead/never-adopted licenses are
excluded so percentile ranks stay meaningful — they would otherwise pad
the bottom of the fleet with zeros and compress the real spread.

## Architecture

```
Marketplace license export (Lite)      Mixpanel JQL (project 3373228)
  seat_tier per cloudId/domain            per-domain, 90d window:
        │                                 macro_viewed/create/save totals,
        │                                 unique creators, unique viewers,
        │                                 weekly buckets, paywall events,
        │                                 last-event date
        │                                       │
        └───────────────┬───────────────────────┘
                         ▼
              filter: active only
           (macro_viewed > 0 in window)
                         ▼
            per-tenant raw signal table
                         ▼
        percentile-rank each signal vs fleet
                         ▼
     average → Opportunity score (0-100)
     average → Risk score (0-100)
                         ▼
              CLI table, sortable
```

New skill `client-health`, script `scripts/health_score.py`. No new
credentials, no new data store — reuses:

- The Marketplace license export logic already in the `marketplace` skill
  (`--app lite` licenses, `tier` field for seat count).
- `marketplace/scripts/mp_pricing.py`'s band table, to compute Full-plan
  ARR potential from seat tier.
- The `mixpanel` skill's `mp_query.py` JQL runner, for the per-domain
  signal pull.

## Signal computation

Window: 90 days total. Growth trend compares the most recent 30 days
against the prior 30 days within that window.

**Percentile rank primitive:** `percentile_rank(tenant_value, fleet_values,
direction)`, where `direction` is `higher_is_better` or `lower_is_better`
(the latter computed as `100 − rank`). Ties use average-rank, so tied
values don't get an arbitrary ordering. Both scores are built from this
one primitive, just with different signal sets and directions.

### Opportunity score — average of 5 percentiles (all `higher_is_better`)

| # | signal | raw computation |
|---|---|---|
| 1 | size_value | avg of (seat_tier percentile, ARR-potential percentile) — deliberately combined into one component so tenant size isn't double-weighted against the other 4 dimensions |
| 2 | adoption_breadth | unique_creators (90d) / seat_tier |
| 3 | usage_volume | macro_viewed total (90d) |
| 4 | growth_trend | (views_last30d − views_prior30d) / max(views_prior30d, 1) |
| 5 | paywall_friction | paywall_triggered + paywall_blocked_create + paywall_blocked_edit (90d) |

`size_value` uses the seat tier from the Marketplace license and the
Full-plan monthly quote from `mp_pricing.py`'s band table (see marketplace
skill for the band definitions and the current-take-rate caveat — this
script does not need the take rate, only the banded monthly list price,
so it is insulated from that caveat).

### Risk score — average of 3 percentiles

| # | signal | direction | why |
|---|---|---|---|
| 1 | growth_trend | `lower_is_better` | decline = risk — same raw metric as Opportunity #4, opposite direction |
| 2 | days_since_last_event | `higher_is_better` (more days = more risk) | recency — the clearest single signal |
| 3 | adoption_breadth | `lower_is_better` | thin adoption = fragile — same raw metric as Opportunity #2, opposite direction |

Reusing `growth_trend` and `adoption_breadth` across both scores with
inverted direction is intentional: same underlying fact, opposite
implication depending on which question is being asked. It is not
duplicated code — the raw values are computed once, then percentile-ranked
twice with different `direction` arguments.

**Signals considered and explicitly excluded** (per brainstorming
decisions):
- Marketplace vendor feedback (`unsubscribe`/`uninstall` reason rows) —
  excluded from Risk. This session's investigation of tenant-a found 3 of 5
  recent "unsubscribe" feedback rows were not real churn (tenant still
  installed, still active) — too noisy to feed a score without the manual
  cross-check that investigation required.
- `duration_net_ms` rendering-performance trend — excluded from Risk.
  Currently fleet-wide and gate-rollout-driven (per
  `reference_duration_net_ms_custom_prop` memory), not yet a reliable
  per-tenant signal.

## Output

CLI table, one row per tenant:

```
domain | seat_tier | opportunity_score | risk_score | adoption_breadth% | usage_volume | growth_trend% | days_since_last_event | paywall_friction
```

Raw signal columns are included alongside the two composite scores so a
human can sanity-check the ranking, not just trust the number — same
transparency principle the `marketplace` skill's tables already follow.

Flags:
- `--sort opportunity|risk` (default `opportunity`, descending)
- `--top N` (default 20)
- `--json` (machine-readable output)

No dashboard automation in this version — building a per-tenant "Usage &
Upgrade Intent" Mixpanel dashboard (template board 11464664) for a
tenant the operator picks off this list stays a manual follow-up step,
same as this session's tenant-a/tenant-b dashboards. No persistence layer
either — this is a point-in-time CLI report, not a tracked-over-time
snapshot (unlike `marketplace sync --local`).

## Edge cases

- A domain with Mixpanel activity but no matching Marketplace Lite
  license (or vice versa) is skipped with a stderr warning, not a crash.
- `prior_30d = 0` on a brand-new active tenant: the growth_trend
  denominator floors at 1, so the ratio can spike to a large number. This
  is fine — percentile ranking cares about relative rank, not raw
  magnitude, so an outlier just sits at the top/bottom of the growth_trend
  ranking rather than distorting the average.
- Fleet too small (fewer than ~10 active tenants) for percentiles to be
  meaningful: the script still computes and prints a warning banner.

## Testing

Unit tests against a small synthetic fixture fleet (no live credentials),
same pattern as `marketplace/scripts/test_mp_report.py`:

```bash
python3 -m unittest discover -s .claude/skills/client-health/scripts
```

Cases: direction inversion correctness (`higher_is_better` vs
`lower_is_better`), tie handling (average-rank), `size_value` combination
of two sub-percentiles, and a full score computation on a fixture fleet
with hand-computed expected ranks.

No live-data integration test — the script itself gets exercised ad hoc
against real Marketplace/Mixpanel data, the same way `marketplace` and
`mixpanel` skill scripts already are.

## Out of scope (deferred, not decided against)

- Full/Diagramly/AsyncAPI risk scoring.
- Persisted history / trend-over-time tracking of the scores themselves.
- Automated dashboard generation for top-ranked tenants.
- Marketplace feedback and rendering-performance signals, if a more
  reliable per-tenant read on either becomes available later.

---
name: client-health
description: >
  Rank active ZenUML Lite tenants on two independent 0-100 scores —
  Opportunity (upsell candidate) and Risk (disengagement) — to decide
  which clients to focus on. Use whenever the user asks "which clients
  should we focus on", "who's a good upsell candidate", "which tenants
  are at risk of churning", "health score", or wants a ranked list of
  Lite tenants by engagement strength or fragility. Scope: Lite only,
  active tenants only (macro_viewed > 0 in the scoring window). For a
  SINGLE named tenant's paid status/profile use the `tenant` skill
  instead; for lifetime revenue/renewals/overdue payers use `marketplace`.
---

# Client Health Scoring

Two independent percentile scores per active Lite tenant:

- **Opportunity** — seat tier + ARR potential, adoption breadth, usage
  volume, growth trend, paywall friction. Higher = stronger upsell
  candidate.
- **Risk** — declining trend, recency of last activity, thin adoption
  breadth. Higher = more likely to disengage.

A tenant can rank high on one and low on the other — they are never
combined into a single number. See
[docs/superpowers/specs/2026-09-04-client-health-scoring-design.md](../../../docs/superpowers/specs/2026-09-04-client-health-scoring-design.md)
for the full design and the reasoning behind each signal (and which
signals were considered and explicitly excluded).

## Usage

```bash
S=.claude/skills/client-health/scripts/health_score.py

python3 $S                              # top 20 by Opportunity, 90-day window
python3 $S --sort risk --top 10         # top 10 by Risk instead
python3 $S --days 60                    # minimum window (growth_trend needs a
                                         # full 30-vs-30-day split; --days < 60
                                         # is rejected)
python3 $S --json                       # machine-readable output
```

Credentials: same as the `marketplace` and `mixpanel` skills —
`FORGE_EMAIL`/`FORGE_API_TOKEN` (auto-discovered from `.env.forge.local`,
override with `--env`) and `.env.mixpanel`'s `API_Secret`.

Unit tests (no network, no credentials):

```bash
python3 -m unittest discover -s .claude/skills/client-health/scripts
```

## Reading the output

Each row includes the raw signals alongside the two composite scores —
`adoption_breadth%`, `usage_volume`, `growth_trend%`,
`days_since_last_event`, `paywall_friction` — so you can sanity-check a
ranking rather than just trust the number, the same transparency
principle the `marketplace` skill's tables follow.

A tenant with near-identical seat tier and usage volume to another can
still score very differently — that was the finding that motivated this
skill (see the design doc's "Purpose" section): usage volume alone
doesn't distinguish broad real adoption from a handful of people
generating heavy repeat views.

This system is Lite-only and does not cross-reference Full entitlement:
a tenant that already has Full (paying) can still show up highly ranked
on Opportunity if they also have a leftover Lite install with real
usage. Sanity-check a top-ranked domain against the `tenant` skill
before treating it as a genuine upsell candidate.

## Related

- `marketplace` — lifetime revenue, renewals, overdue payers, pricing
  (`mp_pricing.py`, reused here for ARR potential).
- `mixpanel` — event names, project id, internal-domain filter
  (reused here via `mp_query.py`).
- `tenant` — single-tenant lookup ("is X paying", "how big is X").
- `paywall` — CSS enrollment and paywall friction mechanics (the
  `paywall_friction` signal here is a coarse count, not the full
  A/B analysis that skill does).

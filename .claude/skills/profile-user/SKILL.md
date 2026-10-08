---
name: profile-user
description: Profile one verified Mixpanel account within one verified Confluence tenant. Use for overlapping viewer/editor/creator roles, relative heavy/light usage, lifecycle and activity evidence, same-tenant peer ranks, trends, and optional performance or feedback context. This is read-only usage analysis and does not authorize customer contact or CRM changes.
---

# Profile one user

Use this skill when the input is a Mixpanel `distinct_id` or profile URL plus a
verified tenant. Keep the account and tenant in the requested scope; do not
guess a tenant from a shared or unresolved identity. Read the [shared customer
evidence rules](../customer-data/evidence.md), especially its coverage,
privacy, source-status, and fact-versus-inference rules.

Before forming an event hypothesis, load the `mixpanel` skill and run its
schema discovery (`mp_schema.py`). For conf-app event meaning, load the
available `conf-app` skill by name (in this environment its source is
`/Users/pengxiao/.codex/skills/conf-app/SKILL.md`) and follow its route to
`references/event-semantics.md`. Use the Mixpanel CLI runner
(`.claude/skills/mixpanel/scripts/mp_query.py --file ...`) for reproducible
queries and keep credentials out of output. Use the interactive Mixpanel MCP
only when profile resolution requires it; call its business-context operation
first. Do not put real tenant names or customer IDs in this public skill file.
A user-authorized private report may identify its verified target; keep those
identifiers out of public repository artifacts.

## Query shape

1. Resolve the target account, verified tenant, product scope, timezone, and
   exact window. Default to a trailing recent 30-day window, a month-by-month
   trend, and all available history. State the query's exact ISO cutoff as
   `[start, end)`; if reporting inclusive local dates, state those labels too.
   Default the timezone to the user's timezone and state it. Convert event
   timestamps to that timezone before making day or month buckets.
2. Query the target's history and a same-tenant aggregate in the same run
   shape. Use `product_type` and show one combined both-products view plus a
   split by product when both are present. Use the canonical internal-domain
   filter from `mixpanel` for customer-wide work. Never use the dead
   `isForge`/`isLite` fields. Exclude unknown, anonymous, placeholder, and
   system identities from people counts; report unresolved event volume
   separately when useful. If an action is sampled, extrapolate inside the
   query before comparing counts or ranks.
3. Let schema discovery determine current names, properties, sampling, and
   historical availability. Include verified legacy aliases when a window
   crosses a rename. Annotate a month where an event was not yet instrumented
   instead of presenting it as zero. For every result retain `queried_at`,
   timezone, product scope, coverage, and query status.

Use event occurrences, not distinct diagrams. The core measures are successful
new saves/creates, successful existing-content saves/edits, and macro render
views. A target is independently a:

- **viewer** with at least one target render event (`macro_viewed`, or the
  verified historical equivalent) in the period;
- **editor** with at least one successful existing-content save event; and
- **creator** with at least one successful new-content create event.

These roles overlap. Count successful create/edit events and render events;
do not replace them with a distinct-diagram count. View renders are much more
frequent than authoring events, so never infer viewer identity from a view
proportion or view-to-create ratio. A successful Confluence save remains a
successful save when a later backend sync or attachment operation fails; keep
those outcomes as separate context.

## Relative intensity and ranks

Report counts and ranks separately for views, successful edits, and successful
creates. Rank the target against known, non-system accounts in the same tenant,
with the same action, time window, and product scope. Show the eligible
population `N`, scope, and rank. Use competition rank:
`rank = 1 + number of peers with a greater count`; tied accounts therefore
share the same rank, with the next rank after the tie showing the gap.

Do not invent a universal heavy/light cutoff. If the user supplies a threshold,
apply it and state it. Otherwise use the count and peer rank together: call an
action heavy only when repeated/high activity is also high in its peer context,
and light only when both the count and relative position support limited use.
When those signals disagree, the peer group is tiny, or the evidence is thin,
report mixed/uncertain with the count, rank, and `N` instead of forcing a label.
Preserve role-specific labels (for example, heavy viewer but light creator).
A zero-count action has no rank. No activity is reported as no qualifying
activity or inactivity according to the evidence rules, never as light. Low
usage does not imply the Lite product.

## Lifecycle and activity evidence

Report first observed qualifying activity and last observed activity with their
event type and window. **Recent** means first observed in the recent window;
**established** means observed before it only when the available history covers
that earlier period. First observed is a telemetry boundary, not account
tenure. Compare first-any-activity with first-authoring-activity so a recent
creator with older views is a new author, not automatically a new user.

Call the account **active** when qualifying activity is observed in the stated
recent window with adequate coverage. Call it **inactive** only when a stated
horizon has successful, sufficiently complete coverage and no qualifying
events; include the horizon and business-day/time span. Otherwise report
activity as unknown or coverage-limited. Active days are calendar dates after
timezone conversion, not sessions. A recent last-seen timestamp alone is not
evidence of churn.

## Optional context

Query feedback or errors only when requested or needed to interpret a finding.
Use the [`customer-feedback`](../customer-feedback/SKILL.md) skill for explicit
feedback and keep sentiment, error events, and behavior separate; feedback is
context, not causal proof.
For performance, verify the properties with `mp_schema.py` and use comparable
product, macro type, and time scopes. For viewer renders, the default quality
filter is `visible_at_boot=true`, `tab_hidden=false`, and `surface=viewer`,
with offscreen observations excluded. State the duration definition from the
schema, then report mean, median, and `n`; do not make this query mandatory for
an ordinary profile.

## Return

Lead with a concise conclusion, followed by:

1. one compact table combining role, intensity, lifecycle, and activity rows.
   Each action row shows target count, eligible population, product
   scope/split, rank, time range, timezone, and evidence status;
2. an optional compact monthly trend with rename/schema-availability notes; and
3. caveats covering identity validation, coverage, sampling, first-observed
   limits, optional sources not queried, and any unknowns.

Do not infer a job title, administrator status, buyer authority, intent, or
customer opinion from activity. This skill grants no permission to contact a
customer, alter a CRM/tracker, or perform another external mutation.

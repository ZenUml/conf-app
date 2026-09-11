# Mixpanel quota check

A runbook for answering "are we going to blow the Mixpanel caps this month, and
which policy is spending them". Written for a scheduled agent with the Mixpanel
MCP connector, but a person can follow it by hand.

Project `3373228`. Call `Get-Business-Context` first — the project is shared by
three products, and conf-app is the one whose events carry **no** `product`
property.

## The two caps are unrelated, and they fail differently

The org is on a Growth plan. Both caps reset at the end of the calendar month.

| Cap | Limit | What happens when it is exceeded |
|---|---:|---|
| Session Replay | 20,000 replays | **Recording stops.** No overage billing. The rest of the month has no replays at all. |
| Tracked events | 1,000,000 | **Billed** at $0.28 per thousand. Nothing stops. |

That asymmetry decides which one to worry about. Going over on events costs
tens of dollars; going over on replays costs the back third of the month's
session data, which is the part you need when a customer reports a problem.

Read the live counters at **Settings → Org → Plan Details & Billing → Data
Usage**. That page is the only exact source; everything below is derived from
event data and is an estimate.

## What counts against the event cap

`$mp_session_record` is **not** billed as a tracked event. It is by far the
highest-volume event in the project (355,879 in the 7 days to 2026-09-06,
55% of all events), and counting it produces a projection roughly double the
real one. Replay checkpoints are billed under the replay cap instead.

So: **billable events = every event whose name does not start with `$`.**

## Procedure

### 1. Confirm which replay policies are live

Three hardcoded overrides in `_initMixpanel` (`src/utils/analytics/trackAnalyticsEvent.ts`)
and one in `_startAuthoringReplay` decide who records, independently of the
Forge flags:

| Surface | Rate | Where |
|---|---|---|
| Page banner | 0% | `moduleKey === 'zenuml-page-banner'` |
| Plan & usage page | 100% | `moduleKey === 'zenuml-plan-usage-page'` |
| Fullscreen modal | 100% | `extension.modal.macroMode === 'fullscreen'` |
| Authoring (create/edit) | `AUTHORING_REPLAY_RATE` | `_startAuthoringReplay` |

Read `AUTHORING_REPLAY_RATE` on the branch being measured. If it differs from
what the numbers below assume, say so before interpreting anything — a rate
change is the single biggest lever on replay volume.

### 2. Measure replays

Distinct count of the `$mp_replay_id` property on the `$mp_session_record`
event, per day and for the period to date. This is the billing unit. Do **not**
count `$mp_session_record` events themselves: it is a per-checkpoint event that
fires repeatedly during one recording, so raw counts conflate session count
with session length.

Then attribute, using distinct `$mp_replay_id` broken down by
`session_replay_source`:

- `macro_create_started` + `macro_edit_started` where source is `authoring` —
  the authoring policy's own consumption.
- `macro_viewed` where source is `sampled` or `targeted` — the Forge-flag
  baseline that survives any authoring rate change.

These two plus a residual should reconcile to the total. The residual is real
and belongs to authoring: events emitted before `start_session_recording()`
keep the pre-override `source`, so source-based counting **undercounts**
authoring. On 2026-09-07 the split was authoring 13,905 and flag-driven 3,838,
summing exactly to 17,743.

### 3. Measure billable events

Sum every non-`$` event over the period. The MCP connector cannot break "All
Events" down by name — that query returns empty. Two ways round it:

- JQL, which can: `.claude/skills/mixpanel/scripts/mp_query.py`, grouping
  `Events(...)` by `name`. Needs `.env.mixpanel`, so it works locally but not
  in a cloud session.
- Otherwise query the top events individually and treat the total as a floor.
  The top 10 were ~70% of billable volume on 2026-09-07.

### 4. Project and compare

Weight by weekday: weekday volume runs 4-5x weekend volume, so a straight-line
projection from a window containing a weekend understates the month. Count the
remaining weekdays and weekend days separately.

## Baseline, 2026-09-07 (day 7 of the September period)

Use these to judge whether a later reading improved or regressed.

| Measure | Value |
|---|---:|
| Replays spent | 6,139 of 20,000 (30.7%) |
| Replay run-rate | ~877/day against a 667/day ceiling |
| Projected exhaustion | ~23 Sep |
| Billable events, 7d | 292,156 |
| Projected month | ~1.25M (~25% over, ~$70 overage) |

Top billable events, 7 days to 2026-09-06:

| Event | Count | Share of billable |
|---|---:|---:|
| `macro_viewed` | 74,954 | 25.7% |
| `copy_for_ai_impression` | 56,595 | 19.4% |
| `diagram_attribution_shown` | 16,431 | 5.6% |
| `diagram_audience_registration_succeeded` | 12,728 | 4.4% |
| `cohorts_refreshed` | 11,631 | 4.0% |

`copy_for_ai_impression` is the notable one: an impression event costing ~19% of
the event bill, for a feature whose demand test was not passing. Sampling or
removing it is the cheapest single reduction available.

## Reporting

Lead with the two numbers that decide anything: replays spent against 20,000,
and projected billable events against 1,000,000. Then the attribution, so the
reader knows which policy to turn down. State plainly if a policy under test
never merged — an unchanged baseline is a valid and useful answer.

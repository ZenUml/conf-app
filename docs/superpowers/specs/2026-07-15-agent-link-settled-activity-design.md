# Live Agent Link — Settled Activity Icons (Design)

## Problem

On Lite staging, a completed Agent Link `update_diagram` task leaves the
Fullscreen activity rail showing a spinning icon indefinitely. The observable
session state is already idle: `thinkingState` is reset after render settles.
The stale animation is caused by the presentation layer classifying every
historical `"Agent is updating the diagram…"` row as in-flight, regardless of
the current task state.

## Goal

Animation means work is happening now. When an Agent Link task settles, the
rail must stop animating while retaining a readable, chronological activity
history.

## Decision

Keep the existing activity rows. Render a row with the spinning work icon only
when both conditions hold:

1. the session's `thinking` prop is `"thinking"`; and
2. the row is the newest activity row.

All older rows, including prior `"Agent is updating the diagram…"` entries,
render as static history. A settled updating row uses the standard success
icon/tone. This avoids deleting useful history and does not introduce a second
near-identical completion event: the existing outcome row remains the explicit
record of a successful or failed edit.

## Implementation boundary

`src/components/AgentLink/ConnectPanel.vue` owns presentation-only feed
classification. Its `feedRows` computation will pass each row's index and the
current `thinking` prop into classification. No relay, persistence, MCP, or
state-machine behavior changes.

`useAgentLinkSession.ts` remains the source of truth for task lifecycle:
`thinkingState` transitions to `idle` once rendering settles, or briefly to
`error` on failure/timeout. Existing analytics already record the two
lifecycle boundaries:

- `agent_link_first_feedback` when work starts;
- `agent_link_render_completed` with the terminal outcome.

This UI correction needs no new analytics event or property.

## Validation

Add component coverage for both states:

1. a newest updating row spins while `thinking` is `"thinking"`;
2. the same historical updating row is static once `thinking` is `"idle"`.

Run the focused component test and the Agent Link session unit tests. Then
repeat the Lite staging spot check: initiate a link, perform an MCP edit,
observe the connected rail after completion, and verify no feed spinner has a
running CSS animation. Restore the fixture after the check.

## Out of scope

Changing Agent Link task timing, activity copy, feed retention, backend MCP
protocols, or the existing thinking/error state machine.

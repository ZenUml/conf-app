# 100% Session Replay for Macro Authoring

## Problem

The current Session Replay policy is decided once, when the first typed
analytics event initializes Mixpanel in a Forge iframe. Two Forge feature flags
select either 100% capture for a targeted account/install, 100% capture for a
general rollout cohort, or no capture. A user who is outside those cohorts can
therefore emit `macro_create_started` or `macro_edit_started` without a replay.
That prevents replay-based investigation of create/edit journeys that do not
reach a save or publish outcome.

## Scope

Every supported macro type and product variant will request Session Replay when
either of these existing events is emitted:

- `macro_create_started`
- `macro_edit_started`

This policy applies wherever the typed Mixpanel analytics path is initialized.
It does not use a Forge feature flag, tenant list, account list, or local cohort.
Viewer-only sessions, the page-banner iframe, and all other event types retain
their existing replay-sampling behavior.

Recording begins immediately before the authoring-start event is sent. It is
not retroactive: editor bootstrap, paywall, or render activity that occurs
before the existing start event may be absent. This design intentionally uses
the observed analytics boundary rather than adding separate create/edit-mode
detection to every editor entry point.

## Analytics Contract

No new event name is required. The two existing start events are the lifecycle
signals for this policy. Before implementation code is added, the first
implementation commit will update `catalog.ts` and `types.ts` with these
properties:

- `session_replay_source: "authoring"` means the authoring policy requested
  100% recording for this iframe.
- `session_replay_percent: 100` records the effective authoring policy after the
  SDK start call returns.
- `session_replay_start_call_outcome: "returned" | "threw"` describes only the
  synchronous SDK call. `returned` must not be interpreted as proof that a
  replay was uploaded.

Mixpanel's SDK-generated `$mp_replay_id` remains the outcome evidence once the
recorder is active. The SDK start method returns before its asynchronous
recorder-resume work necessarily finishes, so the authoring start event itself
may not yet carry `$mp_replay_id`. Its absence from that one event is not proof
of failure; a replay or a later event carrying the ID confirms the outcome.

## Design

The central typed analytics path will own the behavior. After Mixpanel is
initialized and the user is identified, it will recognize the two authoring
start event names and call `mixpanel.start_session_recording()` before calling
`mixpanel.track()`.

If the call returns, the iframe registers the authoring replay source and 100%
effective policy as super-properties, then emits the original start event with
the `returned` outcome. If an existing targeted or sampled recording is already
active, Mixpanel treats the start call as an idempotent no-op; the authoring
source still records why this session is required to be captured.

The behavior is centralized instead of added to the individual Sequence,
Mermaid, PlantUML, Graph, OpenAPI, Embed, and AsyncAPI entry points. New macro
types that use the same catalog events inherit the policy automatically.

No explicit stop call is added. The replay follows the editor iframe lifecycle,
which preserves the final moments of abandoned sessions and avoids truncating
publish/save evidence during iframe teardown.

## Privacy

The existing Mixpanel DOM privacy configuration remains unchanged: text and
inputs use the SDK's default masking behavior, images/audio/video remain
blocked by default, and canvas recording remains disabled. The implementation
will not unmask diagram or specification content and will not add user or
tenant identifiers.

Product decision on 2026-08-21: retain the existing console recording behavior.
The current SDK defaults `record_console` to true, and existing editor code can
write diagram/specification content to console. DOM masking does not apply to
those console payloads. This is an explicitly accepted trade-off so replay
console errors remain available for investigation; this change will neither
disable console capture nor expand what application code logs.

## Error Handling

Replay startup is best-effort and must never suppress the original analytics
event. The `start_session_recording()` call is isolated in its own `try/catch`.
If it throws, the existing create/edit start event is still emitted with
`session_replay_start_call_outcome: "threw"`, while the prior replay source and
percentage remain unchanged. A concise console error may describe the SDK
failure but must not include diagram content, user identity, or tenant data.

Asynchronous recorder loading or upload failure cannot be proven from the
method's void return value. Downstream analysis must use `$mp_replay_id` rather
than the call outcome to count recorded authoring sessions.

## Testing

Use a red-green test cycle in `trackAnalyticsEvent.spec.ts`:

- `macro_create_started` initializes Mixpanel, identifies the user, requests
  recording, registers the authoring source, and then tracks the event;
- `macro_edit_started` follows the same path;
- `macro_viewed` and an unrelated event do not force recording;
- a thrown replay-start call does not prevent the original event from being
  tracked and records the `threw` call outcome;
- an already targeted/sampled initialization can receive the idempotent
  authoring start call without reinitializing Mixpanel;
- the page-banner iframe remains unable to enable replay through its ordinary
  events.

Focused unit tests are sufficient for the central policy. A staging validation
should then create and edit at least one macro, confirm both paths produce a
viewable replay (and that an event after recorder activation carries
`$mp_replay_id`), and visually verify the replay. UI assertions must be marked
skipped rather than passed if no replay is available.

## Success Criteria

After deployment, every `macro_create_started` and `macro_edit_started` session
requests replay regardless of the existing Forge flag cohort. Focused staging
validation must confirm that both paths produce viewable replays; production
coverage must be measured from actual replays or later events carrying
`$mp_replay_id`, not from the synchronous call outcome or the start event alone.
Actual coverage may be below 100% because browser privacy tools and network
policy can block Mixpanel. Viewer replay volume and D1 persistence behavior do
not change.

# 100% Authoring Session Replay Implementation Plan

**Goal:** Force Mixpanel Session Replay for every macro create/edit start event
while preserving existing viewer sampling, privacy configuration, and analytics
delivery on recorder failure.

**Architecture:** Keep the policy inside the public typed analytics path. After
Mixpanel initialization and identification, `trackAnalyticsEvent` recognizes
`macro_create_started` and `macro_edit_started`, requests recording, stamps the
effective authoring policy, and emits the original event. No Forge feature flag
is added. The AsyncAPI editor requires a small lifecycle correction because its
create path did not emit the event and its page-macro edit path emitted it from
the viewer iframe.

**Tech stack:** TypeScript, `mixpanel-browser`, Vitest.

## Task 1: Commit the analytics contract first

**Files:**

- Modify: `src/utils/analytics/catalog.ts`
- Modify: `src/utils/analytics/types.ts`

1. Document that `macro_create_started` and `macro_edit_started` trigger the
   authoring replay policy.
2. Add typed values for `session_replay_source`,
   `session_replay_percent`, and
   `session_replay_start_call_outcome: "returned" | "threw"`.
3. Run the existing analytics type/unit test target.
4. Commit only the catalog/type contract before production behavior changes.

## Task 2: Tracer bullet — create starts recording

**Files:**

- Modify: `src/utils/analytics/trackAnalyticsEvent.spec.ts`
- Modify: `src/utils/analytics/trackAnalyticsEvent.ts`
- Modify: `src/utils/analytics/sessionReplayFlags.ts`

1. Add the Mixpanel `start_session_recording` boundary method to the test mock.
2. Through the public `trackAnalyticsEvent` interface, add one test proving
   `macro_create_started` requests recording and is emitted with authoring
   source, 100% effective policy, and call outcome `returned`.
3. Run the focused test and confirm it fails for the missing behavior.
4. Add the smallest centralized event check and authoring source value needed
   to pass the test.
5. Rerun the focused test and confirm it passes.

## Task 3: Edit uses the same policy

**Files:**

- Modify: `src/utils/analytics/trackAnalyticsEvent.spec.ts`
- Modify: `src/utils/analytics/trackAnalyticsEvent.ts`

1. Add one public-interface test for `macro_edit_started`.
2. Confirm it fails.
3. Generalize the authoring-start predicate to cover both catalog events.
4. Confirm both create and edit tests pass.

## Task 4: Recorder failure cannot swallow analytics

**Files:**

- Modify: `src/utils/analytics/trackAnalyticsEvent.spec.ts`
- Modify: `src/utils/analytics/trackAnalyticsEvent.ts`

1. Add a test where `start_session_recording()` throws.
2. Confirm the current implementation loses or mislabels the event.
3. Isolate replay startup in `try/catch`; emit the original event with outcome
   `threw` and do not overwrite the prior replay source/percentage.
4. Confirm the failure-path test and both success-path tests pass.

## Task 5: Non-authoring sessions stay unchanged

**Files:**

- Modify: `src/utils/analytics/trackAnalyticsEvent.spec.ts`

1. Add a test proving `macro_viewed` does not force recording.
2. Confirm the test passes without widening the trigger predicate.
3. Retain the existing page-banner and feature-flag sampling tests unchanged.

## Task 6: Correct AsyncAPI editor lifecycle coverage

**Files:**

- Add: `src/utils/analytics/authoringStarted.ts`
- Add: `src/utils/analytics/authoringStarted.spec.ts`
- Modify: `src/forge-asyncapi-editor.ts`
- Modify: `src/forge-asyncapi-viewer.ts`
- Modify: `src/forge-asyncapi-embed-editor.ts`

1. Add a focused helper test for create/edit start-event classification.
2. Emit the event from the AsyncAPI editor for dashboard and macro create/edit.
3. Move page-macro edit tracking out of the viewer and into the editor iframe.
4. Trigger edit tracking at the dashboard's in-place View → Edit swap.
5. Cover the AsyncAPI embed picker, which is a separate editor entry.

## Task 7: Refactor and verify

1. Remove duplication only after all focused tests are green.
2. Run the complete `trackAnalyticsEvent` spec.
3. Run the project unit-test suite and TypeScript/build checks appropriate to
   the touched analytics module.
4. Run `git diff --check` and inspect the final diff for unrelated or
   client-identifying content.
5. Commit the implementation and test changes separately from the analytics
   contract commit.

## Deferred live validation

After the change is deployed to staging, create and edit a macro and verify a
viewable replay exists for both paths. A unit test cannot pass this UI
assertion. If staging deployment or replay access is unavailable, report the
live assertion as skipped with the blocker.

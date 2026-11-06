# Impact-based test selection proposal

Date: 2026-10-02. Status: proposed; workflows unchanged.

## Evidence

Measured [PR run 36988672805](https://github.com/ZenUml/conf-app/actions/runs/36988672805)
and [main run 36991890213](https://github.com/ZenUml/conf-app/actions/runs/36991890213).
These two runs are a sample, not a baseline for promised savings.

- PR longest jobs: Lite render 225s, build/unit 216s, Lite deployment 189s,
  Lite insert shard 2 183s. These are whole-job durations, including setup.
- Main reused Lite's successful full PR run. Full shard 2 still took 234s;
  Lite deployment took 203s. Main workflow creation-to-update was 7m49s.
- PR blob reports show typed Graph deeplink render 77.7s, the two byline-create
  cases 77.0s and 75.8s, Graph edit 67.6s, and multiple fullscreen Graph flows
  between 50.6s and 60.1s. Test durations exclude runner setup.
- The PR selection artifact chose everything: the shared `src/forgeIndex.ts`
  changed, and several new paths were unmapped. Mapping the new paths alone
  would therefore not have narrowed this particular run.
- Current selector applies only to PR Lite insert, DrawIO Publish and render.
  Other variants ordinarily test on main. Selected PR runs are excluded from
  reuse, and main selection is empty, so main restores full coverage.
- Daily production workflow runs the insert suite for Lite, Full and Diagramly.
  It does not supply full staging regression or AsyncAPI coverage.

Playwright discovery on the current checkout found 143 tests in 55 files across
all projects. Exact Mermaid path selection discovers 74 tests (51.7%); viewer
tag selection 61, editor 37, and paywall 13. These include always-selected smoke
and project dependencies. They are discovery counts, not executed tests or
variant-specific coverage; CI callers choose a subset of projects. No browser
tests were executed for this measurement.

## Proposed behavior

1. Keep fast unit and local preview checks on every relevant PR. Classify live
   integration tests by feature dependencies, variant, and essential smoke.
   Duration is reporting metadata, never a reason to omit an impacted test.
2. Replace broad OR selections for type-specific paths with explicit rules:
   a Mermaid implementation change selects Mermaid journeys and directly
   relevant shared integration contracts, rather than every viewer/editor
   journey. Truly shared viewer/editor changes still select all affected types.
   Changed E2E specs select themselves; shared harness changes select everything.
3. Produce a selection manifest containing tested tree, baseline, changed paths,
   selected test identities, suite/variant and results. Main can reuse evidence
   only for the exact tested tree and required coverage. If the tree differs,
   run the selection for the actual integrated change. Missing or ambiguous
   evidence, shared infrastructure changes, and unmapped paths run everything.
4. Apply selection to main's Full, Diagramly and AsyncAPI suites too. Keep
   current deployment ordering. A draft records whether its evidence is selected
   or full; selected success must never be represented as full regression.
5. Add daily full staging regression across all four variants and all intended
   live CI suites, with one recorded target SHA and checks that deployed versions
   match it. Prevent overlapping staging deployments from invalidating the run.
   Retain daily production insert checks and release smoke.
6. Generate shard matrices from selected tests so empty shards do not spend time
   installing dependencies. Use historical durations to balance nonempty shards,
   respecting serial groups and authentication constraints.

## Delivery and verification

First land duration/selection reporting and nightly staging coverage. Then refine
impact rules and changed-spec selection. Finally enable selected-result reuse and
variant-aware main selection once nightly evidence is available.

Verify selector fixtures for shared, unmapped, renamed and deleted paths; closed
tag/identity coverage; exact-tree reuse and rejection of incomplete evidence;
variant-specific project lists; serial groups; and nonempty shard planning.
Replay representative recent PR diffs and compare selected test identities against
the full list. Report selection rate, executed test time, runner setup time,
workflow queue time and critical-path duration separately. Review nightly failures
for missed impact rules before further reducing per-change coverage.

No model provider or paid API is required for this proposal. Deterministic rules
remain the execution authority; the existing AI logging job is outside this work.

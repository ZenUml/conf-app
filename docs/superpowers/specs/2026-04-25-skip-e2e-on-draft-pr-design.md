# Skip E2E on Draft PRs — Design

**Date:** 2026-04-25
**Status:** Approved (pending implementation)
**Owner:** Peng

## Problem

Every push to every feature branch runs the full `Build, Test and Draft Release` pipeline: build + unit test + Lite deploy + **Lite E2E (~10 min)**. After recent variant scoping (PR #1013) the per-push cost is ~14 min wall-clock and ~15 billable minutes.

The E2E run is the main contributor and is often wasted:
- The branch is incomplete and not yet meant to merge.
- The change is non-behavioural (docs, comments, refactors).
- The dev is iterating quickly and only one push in N actually needs full validation.

Yet before merging, E2E must run — it's the last line of defence between feature work and production.

## Goal

Run E2E only when the developer signals "this is mergeable", without forcing them to learn a new ritual or moving the work to a separate workflow file.

## Non-goals

- Changing the workflow file structure (must stay in `build-test-deploy.yml`).
- Changing E2E test code or test selection.
- Replacing the existing variant-scoping rule (Full + Diagramly already only run on master).

## The signal

**PR Draft → Ready for Review** is the trigger. It is:
- A built-in GitHub primitive (`pull_request: types: [ready_for_review]`).
- Already part of most developers' workflow before requesting review.
- Reversible (a PR can be moved back to Draft if iteration resumes).
- Visible in the GitHub UI without inspecting workflow files.

## CI behaviour matrix

| Event | Build | Deploy: Lite | E2E: Lite | Full+Diagramly + Drafts |
|---|---|---|---|---|
| Push to **master** | ✅ | ✅ | ✅ | ✅ |
| Push to **branch with no PR** | ✅ | ✅ | ❌ | ❌ |
| Push to **Draft PR** | ✅ | ✅ | ❌ | ❌ |
| Push to **Ready PR** | ✅ | ✅ | ✅ | ❌ |
| **Mark PR Ready for Review** | ✅ | ✅ | ✅ | ❌ |
| **Mark PR back to Draft** | ✅ | ✅ | ❌ | ❌ |

Master always gets full coverage. The smoke-test scheduled run is unaffected.

## Implementation

### `build-test-deploy.yml` triggers

Keep the existing `push:` trigger verbatim and add `pull_request:`:

```yaml
on:
  push:
    tags-ignore: ['**']
    branches:
      - '**'
      - '!**ruixiang-e2e**'
    paths-ignore: ['**.md', '!CHANGELOG.md', 'docs/**', '.claude/**', '.cursor/**']
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
    paths-ignore: ['**.md', '!CHANGELOG.md', 'docs/**', '.claude/**', '.cursor/**']
```

**Concurrency key needs an update.** `${{ github.ref }}` differs between push (`refs/heads/<branch>`) and pull_request (`refs/pull/N/merge`), so the existing key would NOT deduplicate the push + pull_request synchronize events that both fire on a single PR-branch push — we'd get two runs per push.

Change the existing concurrency block from:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/master' }}
```

to:

```yaml
concurrency:
  # head_ref is the source branch on pull_request events; ref_name is the short
  # branch name on push events. Both resolve to the bare branch name, so push
  # and pull_request synchronize events on the same branch share one group.
  # Note: github.ref (used in the original key) is "refs/heads/<branch>" on
  # push but "refs/pull/N/merge" on pull_request — those don't match, which
  # is why we use head_ref / ref_name instead.
  group: ${{ github.workflow }}-${{ github.head_ref || github.ref_name }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/master' }}
```

`cancel-in-progress` stays false for master and true for any other branch.

### `staging-lite-test` job condition

Replace the existing implicit "always run" with:

```yaml
staging-lite-test:
  if: |
    github.ref == 'refs/heads/master' ||
    (github.event_name == 'pull_request' && github.event.pull_request.draft == false)
  needs: [staging-lite, build]
  ...
```

The `staging-lite` deploy job stays unconditional — it produces a staging URL that's useful even mid-iteration.

The Full + Diagramly jobs already have `if: github.ref == 'refs/heads/master'` from PR #1013 — no change.

### Why `pull_request` not `pull_request_target`

`pull_request` runs against the PR branch's code — correct for testing changes. `pull_request_target` runs against the base branch and is needed only for fork-PR secret access; this repo doesn't accept external forks.

## Skill changes

The skills automate the PR lifecycle. Each needs a small update so the new gate doesn't surprise users.

### `submit-branch`
Default to **creating PRs as Draft**. If the dev wants Ready immediately they can pass an explicit flag (`--ready` or similar). Net effect: `submit-branch` no longer accidentally triggers E2E.

### `ship-branch`
This skill means "I want this merged". Update the sequence to:
1. Run local validation (existing).
2. Push branch (existing).
3. **If PR is Draft, mark it Ready for Review.** This is the new step.
4. Wait for E2E green via `babysit-pr`.
5. Merge.

So `ship-branch` becomes the single command that exercises the full pipeline.

### `babysit-pr`
Detect the PR's draft state at the start. If Draft, only watch `Build and Unit Test` + `Deploy: Lite`. If Ready, also watch `E2E: Lite`. Avoids waiting for jobs that will never run.

### `land-pr`
Add a guard: if the PR is Draft, refuse with a clear message — "PR is Draft. Mark Ready for Review (or run `/ship-branch`) so E2E can verify before merge." Keeps the safety net.

### `validate-branch`
No change. Local validation is independent of CI.

### `deploy-stg` / `release-app` / `forge-tunnel`
No change. They don't depend on PR state.

## Edge cases

- **PR opened directly as Ready** — fires `opened` event, condition holds (`draft == false`), E2E runs. Correct.
- **PR opened as Draft, then pushed** — fires `synchronize`, condition `draft == false` is false, E2E skipped. Correct.
- **PR Draft → Ready → push more commits** — `synchronize` fires with `draft == false`, E2E re-runs. Correct.
- **PR Ready → back to Draft → push** — `synchronize` fires with `draft == true`, E2E skipped. Correct.
- **Push to feature branch with no PR open yet** — only `push` event fires. The `if` condition's `github.event_name` is `push` so the pull_request branch is false, but the master-ref check is also false → E2E skipped. Build + deploy still run from the existing push trigger.
- **Push to master** — only `push` event (no PR for master pushes). The master-ref check is true → E2E runs. All variants run.
- **Force-push to a Draft PR** — `synchronize` event, behaves same as normal push.
- **Branch deletion** — no event triggers; nothing runs.

## What this gives us

- Iterate on a Draft PR all day: only ~5 min CI per push (build + deploy), no E2E.
- Hit Ready when ready to merge: full E2E runs once, ~10 min.
- Master gets full coverage as today.
- Mental model unchanged: same workflow file, same job names, just one new gate.

## Estimated savings

Assuming ~70% of feature-branch pushes happen while Draft (rough estimate based on usual iterate-then-review cadence), and feature-branch E2E currently consumes ~10 billable min per push:

- Current feature-branch E2E spend: ~25 pushes/mo × 10 min = 250 min/mo (~$1.50/mo).
- Post-change: ~7–8 pushes/mo (only Ready pushes) × 10 min = 75 min/mo (~$0.45/mo).
- **Savings: ~175 min/mo (~$1/mo)** plus a much faster iterate-loop wall-clock for the developer.

The dollar figure is small because the bulk-cost optimisations already shipped (PR #1011, #1013, #1021) — this design is primarily a developer-experience win that keeps the tail savings.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Dev forgets to mark Ready before merging via UI → merges without E2E | `land-pr` guard refuses Draft merges. UI merge still possible but uncommon for this team. |
| `submit-branch` defaulting to Draft surprises users | Update the skill's announcement output: "Created Draft PR — run `/ship-branch` to ship or mark Ready when ready for E2E." |
| Two jobs run simultaneously (push + pull_request synchronize) | Existing `concurrency:` group with `cancel-in-progress` on non-master deduplicates. Verify in first PR. |
| `paths-ignore` differs between push and pull_request triggers | Keep both lists identical (already in implementation snippet). |
| Smoke test or other workflows accidentally affected | Scope all changes to `build-test-deploy.yml` and the named skills only. |

## Out of scope (deferred)

- Label-based override (`run-e2e` label). Can be added later as an escape hatch if Draft state proves insufficient.
- PR-comment slash command (`/e2e`). More complex; not warranted yet.
- Playwright sharding for further wall-clock reduction. Trade-off discussed separately; not adopted.
- Switching to a third-party runner (BuildJet/Namespace). Separate workstream.

## Acceptance criteria

1. A push to a Draft PR shows `Build and Unit Test`, `Deploy: Lite` running and `E2E: Lite` as `skipped` (green).
2. Marking that PR Ready for Review triggers a fresh CI run that includes `E2E: Lite`.
3. A push to master runs build, deploy, E2E, and draft-release jobs as today.
4. A push to a branch with no open PR runs build + deploy, but not E2E.
5. `submit-branch` creates Draft PRs by default; `ship-branch` flips to Ready before merge; `land-pr` refuses Draft merges; `babysit-pr` does not wait for E2E on Draft PRs.

## Implementation order

1. Update `build-test-deploy.yml` triggers + `staging-lite-test` condition. Verify on a real PR (open as Draft, observe skip; mark Ready, observe run).
2. Update `submit-branch` skill default + announcement.
3. Update `ship-branch` skill sequence (add mark-Ready step).
4. Update `babysit-pr` skill draft-detection.
5. Update `land-pr` skill draft-guard.

Each step is its own PR so the CI behaviour is verified before the skills depend on it.

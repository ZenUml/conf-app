---
name: pr-labeling
description: Decide and publish the E2E test scope when creating or updating a conf-app PR. Queue full-suite or unresolved decisions for manual test triage.
---

# PR Labeling

For state transitions, record validation and CI enforcement, read [PR test-decision policy](../../../docs/policies/pr-test-decisions.md).

Create a current-commit E2E decision before waiting for PR E2E. Use the agent's code analysis and existing GitHub authentication; this flow makes no Jev or other model-provider API call. Build, type-check and unit-test jobs keep their own rules.

## Trusted helper checkout

Analyze the candidate diff in its feature checkout. Run `inspect`, `publish` and `request-pr-e2e` from a separate clean checkout of the trusted default branch, including for manual full decisions on catalog-changing PRs. The helper stamps its local catalogs; invoking the candidate's helper would publish candidate fingerprints that the trusted controller rejects. Do not pass candidate hashes as a workaround.

Prepare the helper checkout without running candidate setup:

```bash
git fetch origin main
trusted_controller_sha=$(git rev-parse origin/main)
trusted_controller_dir=$(mktemp -d "${TMPDIR:-/tmp}/conf-app-pr-controller.XXXXXX")
git worktree add --detach "$trusted_controller_dir" "$trusted_controller_sha"
```

Use `node "$trusted_controller_dir/scripts/test-selection/pr-decision.mjs" ...` and `node "$trusted_controller_dir/scripts/test-selection/request-pr-e2e.mjs" ...` for the commands below. Both commands also work behind a GitHub proxy that refuses `/collaborators/<login>/permission` (the Claude Code cloud container's): they then read the signed-in account's own permission from `GET /repos/<repo>`, and only for that account. CI's `check`, `sync` and `draft` keep the collaborator endpoint and fail closed. Keep decision JSON at an absolute path. After completion, remove the clean helper checkout with `git worktree remove "$trusted_controller_dir"`. If the default branch lacks this policy version, report the bootstrap blocker; do not execute candidate authorization code instead.


### Explicit labels-only bootstrap exercise

When the user explicitly asks to try labeling an existing PR before the trusted controller exists, a metadata-only exercise is allowed: read the complete current diff, record exact proposed pairs and gaps locally, add the display Feature/Interface labels plus `test:triage`, and keep or return the PR to Draft. Reconcile obsolete generated full-selection labels so they do not present a conflicting result. Use GitHub metadata operations directly for this limited exercise; do not run candidate controller code, publish an executable decision, add `test:selected`/`test:all-approved`/`test:run`, or request CI. Recheck head/base before and after mutation. Report the result as a labels-only trial, not an authorized current-commit E2E decision. This exception does not activate the policy or approve any test execution.

## Decide the scope

1. Read the complete branch diff before creating the PR. Create every PR as Draft, including when the user ultimately wants it Ready. For an existing PR or a new push, inspect it again:

   ```bash
   node "$trusted_controller_dir/scripts/test-selection/pr-decision.mjs" inspect --pr <PR_NUMBER> --repo ZenUml/conf-app
   ```

   Use its `decision_template`, current identity, changed files, product scenario catalog, uncovered scenarios and coverage floor. Retrieve the full patch with `gh pr diff <PR_NUMBER> --repo ZenUml/conf-app`, or read the complete local merge-base diff when GitHub cannot provide it. Read the changed code, callers and relevant tests. Explain the effect of every changed path, including renames and deletions. If the checkout does not match the PR head, use the correct isolated checkout before analyzing code.

2. Choose `selected` only when a concrete subset covers the changed behavior. Retain smoke, directly changed E2E specs and the known dependency selectors in the reported floor. Read the relevant contracts and conditional boundaries in root [IMPACT-MAP.md](../../../IMPACT-MAP.md). Record exact `{feature, interface}` pairs from nonempty cells. A pair is AND; multiple pairs are OR. Never generate a Cartesian product from dimension labels or expand parent interfaces. Scenarios may be empty only for a justified floor-only decision. Check assertion-backed coverage, known dependencies, variants and actual PR suite applicability; a registered product relation alone is not E2E coverage. A declared pair without registered E2E coverage cannot authorize a subset. A path that reaches shared code needs its actual callers assessed; a filename alone does not establish the coverage.

   A PR that changes the scenario catalog can still get `selected` when the change is additive only:

   | PR change to the scenario catalog | `selected` decision |
   | --- | --- |
   | None | Valid |
   | Only adds scenario-tagged tests and/or new pairs; every test entry and pair in the trusted (`main`) catalog is unchanged | Valid. Choose pairs that the trusted catalog covers (`inspect` shows them); the new spec runs through the direct-spec floor |
   | Removes, renames or retags an existing scenario test, or changes `API_LANES`, `product-impact.mjs` (IMPACT-MAP.md) or `categories.mjs` | Invalid; choose `triage` |

   A pair that only the PR's new test covers is still uncovered in the trusted catalog and cannot be selected. Details: [PR test-decision policy](../../../docs/policies/pr-test-decisions.md#activation-and-limits).

3. When a product relation, test pairing, applicable variant/suite or dependency cannot be established, choose `triage`; do not invent tags or treat source-only/UI-unverified wiring as passed E2E. When full coverage appears necessary, or the diff, dependencies or evidence are incomplete, choose `triage` and explain the gap. Full coverage is always a manual triage decision. Do not invoke `pr-triage` automatically or extend an earlier full approval to a new commit.

## Publish the decision

Write a JSON file from the inspection template. Set:

- `mode`: `selected` or `triage`;
- `source`: `labeling`;
- `scenarios`: explicit objects with `feature` and `interface` IDs;
- `reason`: the concrete impact and scope rationale;
- `evidence`: objects with `paths`, `reason` and `scenarios`, covering every changed filename.

Use decision schema v2; category-only v1 records are invalid. Retain the inspected `schema_version`, `pr_number`, `head_sha` and `base_sha`. Keep customer names and secrets out of this public record. Write JSON with a file tool, not shell interpolation.

```bash
node "$trusted_controller_dir/scripts/test-selection/pr-decision.mjs" publish --pr <PR_NUMBER> --repo ZenUml/conf-app --file <DECISION_JSON>
```

The helper checks the current identity and publishes a new decision comment. Edited comments are invalid. A trusted GitHub collaborator must publish executable decisions. Labels display the result; the comment and current commit identity authorize execution. Use the helper instead of editing labels directly.

- `test:selected` plus `feature:<id>` / `interface:<id>` display labels: an executable subset.
- `test:triage`: E2E blocked, PR remains or returns to Draft.
- `test:all-approved`: only manual triage can issue this for the current commit.

If publishing reports a stale identity, inspect the new diff and decide again. A push invalidates the previous decision; it does not inherit permission to run full coverage. A base change invalidates it only in the cases below.

### Recover when the base branch moved

A decision binds the PR head and a base commit. A `selected` decision stays valid while `main` moves, as long as its base is in `main`'s history and no new commit on `main` touches a path the PR changes ([policy table](../../../docs/policies/pr-test-decisions.md#authorization-record)). So do not merge `main` and republish as a routine step. CI still blocks E2E when:

| `main` since the decision's base | Result |
|---|---|
| A commit touches a file the PR changes, or renames one | Stale |
| A catalog changed (`IMPACT-MAP.md`, scenario coverage, categories, selectors) | Stale (`stale-policy-or-catalog`) |
| 300 or more files changed, or the decision is `all` | Stale |

Read the blocking line in the `Select E2E for this PR` job, then act on it:

| CI message | Meaning | Action |
|---|---|---|
| `E2E blocked: missing-or-stale-decision` | The published decision names an older head or base. | Run the full cycle below. |
| `E2E blocked: stale or unrelated candidate` | The decision is current, but the tested merge commit is not the PR head merged into a base that carries over: `main` changed a PR file after GitHub built the merge ref. Publishing again does not change it. | Run the full cycle below; the push in step 2 rebuilds the merge ref. |

Full cycle, in this order:

1. In the feature checkout: `git fetch origin main`, then `git merge origin/main`. Never rebase or force-push. A conflict means the diff changed, so analyze it again.
2. Push the branch.
3. Refresh the trusted helper checkout to the new `origin/main` (remove the old one, add a new detached worktree), because the helper stamps its own catalogs.
4. `inspect` again and copy the new `head_sha` and `base_sha` into the decision JSON. Reuse the earlier scenarios and evidence only if the merge added no files to the PR diff and changed no path the evidence relies on; otherwise decide again.
5. `publish`, then `request-pr-e2e`.

Publishing again without steps 1 and 2 fixes only the first message and then fails with the second. If `main` moves again while the run waits for staging, repeat the cycle; the earlier green run does not carry over to the new head.

_(2026-11-21, PR 1246: `main` moved after the decision was published. Publishing again alone produced `stale or unrelated candidate`; merging `origin/main`, pushing, then publishing and requesting passed.)_

## Run and report

For an executable published decision, request a fresh PR-associated validation run:

```bash
node "$trusted_controller_dir/scripts/test-selection/request-pr-e2e.mjs" --pr <PR_NUMBER> --repo ZenUml/conf-app
```

The helper validates the current executable decision and requests a PR event through GitHub. CI checks the decision again; the request itself grants no coverage permission. Use this helper rather than editing a request label or dispatching the workflow on `main`.

Keep the PR Draft. Ready for Review is the author's separate choice. Monitor the matching candidate run through `babysit-pr` when submission or CI monitoring is in scope.

For triage, report the PR URL, current commit, unresolved reason and that E2E is blocked. Finish the independent basic checks already in progress. Leave manual triage to an explicit user request.

Completion means the published decision matches the current PR commit and base, labels match it, and the report distinguishes selected tests from tests actually executed. Report GitHub access failures or unavailable trusted tooling as blockers; they do not authorize full-suite fallback.

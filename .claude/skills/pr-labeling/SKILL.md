---
name: pr-labeling
description: Decide and publish the E2E test scope when creating or updating a conf-app PR. Queue full-suite or unresolved decisions for manual test triage.
---

# PR Labeling

For state transitions, record validation and CI enforcement, read [PR test-decision policy](../../../docs/policies/pr-test-decisions.md).

Create a current-commit E2E decision before waiting for PR E2E. Use the agent's code analysis and existing GitHub authentication; this flow makes no Jev or other model-provider API call. Build, type-check and unit-test jobs keep their own rules.

## Decide the scope

1. Read the complete branch diff before creating the PR. Create every PR as Draft, including when the user ultimately wants it Ready. For an existing PR or a new push, inspect it again:

   ```bash
   node scripts/test-selection/pr-decision.mjs inspect --pr <PR_NUMBER> --repo ZenUml/conf-app
   ```

   Use its `decision_template`, current identity, changed files, category catalog and coverage floor. Retrieve the full patch with `gh pr diff <PR_NUMBER> --repo ZenUml/conf-app`, or read the complete local merge-base diff when GitHub cannot provide it. Read the changed code, callers and relevant tests. Explain the effect of every changed path, including renames and deletions. If the checkout does not match the PR head, use the correct isolated checkout before analyzing code.

2. Choose `selected` only when a concrete subset covers the changed behavior. Retain smoke, directly changed E2E specs and the known dependency selectors in the reported floor. Categories may be empty for a justified smoke-only decision. Check category dependencies and variants against the catalog. A path that reaches shared code needs its actual callers assessed; a filename alone does not establish the coverage.

3. When full coverage appears necessary, or the diff, dependencies or evidence are incomplete, choose `triage` and explain the gap. Full coverage is always a manual triage decision. Do not invoke `pr-triage` automatically or extend an earlier full approval to a new commit.

## Publish the decision

Write a JSON file from the inspection template. Set:

- `mode`: `selected` or `triage`;
- `source`: `labeling`;
- `categories`: catalog category IDs for the selected behavior;
- `reason`: the concrete impact and scope rationale;
- `evidence`: objects with `paths`, `reason` and `categories`, covering every changed filename.

Retain the inspected `schema_version`, `pr_number`, `head_sha` and `base_sha`. Keep customer names and secrets out of this public record. Write JSON with a file tool, not shell interpolation.

```bash
node scripts/test-selection/pr-decision.mjs publish --pr <PR_NUMBER> --repo ZenUml/conf-app --file <DECISION_JSON>
```

The helper checks the current identity and publishes a new decision comment. Edited comments are invalid. A trusted GitHub collaborator must publish executable decisions. Labels display the result; the comment and current commit identity authorize execution. Use the helper instead of editing labels directly.

- `test:selected` plus category labels: an executable subset.
- `test:triage`: E2E blocked, PR remains or returns to Draft.
- `test:all-approved`: only manual triage can issue this for the current commit.

If publishing reports a stale identity, inspect the new diff and decide again. A push or base change invalidates the previous decision; it does not inherit permission to run full coverage.

## Run and report

For an executable published decision, request a fresh PR-associated validation run:

```bash
node scripts/test-selection/request-pr-e2e.mjs --pr <PR_NUMBER> --repo ZenUml/conf-app
```

The helper validates the current executable decision and requests a PR event through GitHub. CI checks the decision again; the request itself grants no coverage permission. Use this helper rather than editing a request label or dispatching the workflow on `main`.

Keep the PR Draft. Ready for Review is the author's separate choice. Monitor the matching candidate run through `babysit-pr` when submission or CI monitoring is in scope.

For triage, report the PR URL, current commit, unresolved reason and that E2E is blocked. Finish the independent basic checks already in progress. Leave manual triage to an explicit user request.

Completion means the published decision matches the current PR commit and base, labels match it, and the report distinguishes selected tests from tests actually executed. Report GitHub access failures or unavailable trusted tooling as blockers; they do not authorize full-suite fallback.

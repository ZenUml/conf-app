# PR E2E decisions

Every PR starts Draft. The creating or updating agent uses `pr-labeling` to inspect the complete diff and publish its E2E decision. Build, type-check, unit-test and deployment jobs keep their independent rules. A valid test decision allows E2E while the PR remains Draft; only the author chooses Ready for Review.

## States

| Labels | Meaning | PR E2E |
| --- | --- | --- |
| `test:triage` | Missing, stale, incomplete or unresolved decision | Blocked; return to Draft |
| `test:selected` and category labels | Evidence supports a subset | Smoke, direct specs, known dependencies and selected behaviors |
| `test:all-approved` | Manual triage justified full coverage for this commit | Full configured PR suites |

All proposed full-suite decisions enter the manual queue. Invoke `pr-triage` explicitly to investigate a named PR or the queue. It can approve a subset, approve full coverage with concrete affected behaviors and an explanation of why a subset is insufficient, or leave the decision unresolved. Shared paths, unknown paths and absent model output do not by themselves justify full approval.

Neither workflow invokes Jev for PR classification. Main, nightly and production workflows retain their existing test policies and model configuration.

## Authorization record

`scripts/test-selection/pr-decision.mjs` posts an append-only decision comment through the agent's existing `gh` login. An executable record must come from a repository collaborator whose current permission is write, maintain or admin. It binds the PR number, current head and base commits, complete changed-file fingerprint, selector catalog and evidence for every changed path. Labels show the state; they cannot grant permission on their own. The request-only `test:run` label also grants no permission.

The newest trusted record supersedes older records. Editing a record invalidates it. Deleting one leaves a controller-generated triage record so that an older approval cannot become active again. The GitHub Actions controller can revoke authorization, but cannot approve tests. A later collaborator decision can resolve the revocation.

Each push requires a new labeling decision. Full approval never transfers to the next commit. A changed base or selector catalog also requires revalidation. Renamed and removed paths still need evidence, but specs that no longer exist cannot be required executable tests.

The minimum subset includes smoke, directly changed surviving E2E specs, explicit helper dependencies, mapped behavior selectors and transitive category dependencies. Browser preview, Mixpanel-isolation and export checks remain required local coverage once a PR has authorization. Missing artifacts, stale decisions, incomplete inventories and invalid plans block PR E2E; they never fall back to full coverage. A valid empty auxiliary render plan stays empty.

## Execution

1. Create the PR with `--draft` and publish its decision using `pr-labeling`.
2. For a subset, run `node scripts/test-selection/request-pr-e2e.mjs --pr NUMBER`. For triage, stop E2E processing and leave the queue for an explicit triage request.
3. The request helper verifies current authorization and requests a fresh PR-associated validation run. This preserves PR check provenance. A diagnostic `workflow_dispatch` on main cannot substitute for the PR's own checks.
4. The trusted default-branch controller reads the decision and produces immutable raw/resolved artifacts for the candidate merge. The child, plan and shard entrypoints recheck the decision. The planner retains the mandatory floor and produces concrete test identities.
5. `Pipeline outcome` requires selection and all configured PR E2E stages to succeed. Report executed test evidence separately from the selected plan.

`pr-test-decision.yml` handles PR creation and updates before the app pipeline finishes, including documentation-only PRs. It uses `pull_request_target` only for metadata: it checks out default-branch code and never executes PR code. It reconciles labels, converts unresolved PRs to Draft and publishes the head's `PR test decision` check. Independent basic checks may still run while E2E is blocked.

## Activation and limits

The controller must exist on the trusted default branch before it can authorize tests. A bootstrap PR introducing this policy cannot authorize itself by executing candidate controller code with the metadata token. Validate its local policy tests and basic CI; the new test gate remains blocked until trusted tooling is available. Do not work around that restriction by using the old full override.

Old PR branches that explicitly modify workflow files may retain old workflow definitions. Bring them onto the current base and inspect those changes before relying on this policy. Historical workflow runs retain their original definitions; use a fresh PR-associated run after activation.

Draft conversion is asynchronous. Enforcing `PR test decision` and the current PR's `Pipeline outcome` as required checks in repository rules is a separate rollout action; without required checks, a check by itself does not prevent GitHub merging. This implementation does not change repository-wide branch protection. The landing skills require both a valid decision and successful matching PR E2E evidence.

This changes CI and agent tooling only. Confluence UI validation and product Mixpanel event registration do not apply.

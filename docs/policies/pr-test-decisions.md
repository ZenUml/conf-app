# PR E2E decisions

Every PR starts Draft. The creating or updating agent uses `pr-labeling` to inspect the complete diff and publish its E2E decision. Build, type-check, unit-test and deployment jobs keep their independent rules. A valid test decision allows E2E while the PR remains Draft; only the author chooses Ready for Review.

## States

| Labels | Meaning | PR E2E |
| --- | --- | --- |
| `test:triage` | Missing, stale, incomplete or unresolved decision | Blocked; return to Draft |
| `test:selected` and Feature/Interface labels | Evidence supports explicit scenario pairs | Smoke, direct specs, known dependencies and exact paired tests |
| `test:all-approved` | Manual triage justified full coverage for this commit | Full configured PR suites |

All proposed full-suite decisions enter the manual queue. Invoke `pr-triage` explicitly to investigate a named PR or the queue. It can approve a subset, approve full coverage with concrete affected behaviors and an explanation of why a subset is insufficient, or leave the decision unresolved. Shared paths, unknown paths and absent model output do not by themselves justify full approval.

Neither workflow invokes Jev for PR classification. Main, nightly and production workflows retain their existing test policies and model configuration.

## Product scope and test metadata

Root [IMPACT-MAP.md](../../IMPACT-MAP.md) is the product vocabulary and relation registry. `config/product-impact.mjs` reads it directly and requires matrix/contract agreement; it is not a second hand-maintained product map. Product applicability, source wiring and verified E2E coverage remain separate.

A v2 decision carries `scenarios: [{feature: "editing", interface: "fullscreen-editor"}]`. Each path-evidence item carries its own explicit `scenarios`. Every selected pair needs path evidence and registered assertion-backed test coverage. Empty scenarios permit a reasoned floor-only plan, not an omission of known product impact. Unknown pairs and coverage gaps require triage; there is no automatic full fallback.

Tests keep `@feature:<id>` and `@interface:<id>` display tags, plus an atomic `@scenario:<feature>:<interface>` tag for every declared pair. A test with two pairs executes once if either matches. Independent dimension tags never reconstruct combinations. Existing `@test:<category>` tags remain for main Jev and known dependency floors; they no longer authorize PR behavior selection.

`config/scenario-coverage.mjs` derives the assertion-backed union, file locations and variant applicability from literal test tags without importing tests. Its fingerprint includes this runnable metadata. Empty entries explicitly retain infrastructure or retired journeys without asserting product coverage. A union is coverage metadata, not permission to select its entire category. Category dependencies reached from matched pairs remain additional required coverage.

The trusted `config/api-lanes.mjs` registry binds `oauth-token` to `agent-authorization × oauth-protocol` and `agent-authorization × external-agent`. It is included alongside browser inventory in the scenario-coverage fingerprint. Selecting either pair requires the HTTP integration lane; `all` schedules every registered API lane present in the candidate. The controller reads the immutable candidate tree: a wholly absent OAuth suite is omitted from full mode, while a partial suite blocks execution. An absent lane supplies no coverage. The child workflow checks current authorization on the default branch, then verifies that the candidate's `tests/integration/oauth-token/scenarios.json` has exactly the registered pairs before running the fixed OAuth integration command. Candidate metadata cannot add a lane or grant coverage. Missing or mismatched candidate files fail the lane. The manifest agreement confirms scope, not execution success or the quality of assertions; inspect the run evidence separately.

The OAuth suite uses a local HTTP server and Cloudflare storage. It does not verify browser consent, live Atlassian SSO, a production deployment, or the Cloudflare edge. It is introduced by the separate OAuth integration PR: until that suite is present in the candidate, selecting either API pair will fail; full mode omits the wholly absent suite. Land and activate the trusted policy before relying on the authorized lane, then validate the OAuth candidate against it. The OAuth PR's separate path-triggered workflow is an independent, low-cost integration check; it can run without a PR test decision and does not authorize or replace the selected child workflow or browser E2E. Once the suite lands, changes matching its path filters can run both checks.

Labeling must inspect applicable variants and configured PR suites: a test tagged for another variant or lane is not evidence that this PR ran it. Resolving triage must preserve the verified lesson in IMPACT-MAP.md and test coverage metadata so later agents can reuse it. Source-only or unverified UI behavior stays marked accordingly.

## Authorization record

`scripts/test-selection/pr-decision.mjs` posts an append-only decision comment through the agent's existing `gh` login. Inspect, publish and request helpers run from a clean trusted default-branch checkout; candidate analysis stays in the feature checkout. The helper stamps its local catalogs, so candidate helper invocation cannot publish a trusted catalog-upgrade decision. An executable record must come from a repository collaborator whose current permission is write, maintain or admin. It binds the PR number, current head and base commits, complete changed-file fingerprint, selector catalog, complete product-document and scenario-coverage fingerprints, and evidence for every changed path. Labels show the state; they cannot grant permission on their own. The request-only `test:run` label also grants no permission.

The newest trusted record supersedes older records. Editing a record invalidates it. Deleting one leaves a controller-generated triage record so that an older approval cannot become active again. The GitHub Actions controller can revoke authorization, but cannot approve tests. A later collaborator decision can resolve the revocation.

Each push requires a new labeling decision. Full approval never transfers to the next commit. A changed base or selector catalog also requires revalidation. Renamed and removed paths still need evidence, but specs that no longer exist cannot be required executable tests.

The minimum subset includes smoke, directly changed surviving E2E specs, explicit helper dependencies, mapped floor selectors and known transitive category dependencies reached through selected pairs, direct specs and floor categories. Browser preview, Mixpanel-isolation and export checks remain required local coverage once a PR has authorization. Missing artifacts, stale decisions, incomplete inventories and invalid plans block PR E2E; they never fall back to full coverage. A valid empty auxiliary render plan stays empty.


### Explicit labels-only bootstrap exercise

When the user explicitly asks to try labeling an existing PR before the trusted controller exists, a metadata-only exercise is allowed: read the complete current diff, record exact proposed pairs and gaps locally, add the display Feature/Interface labels plus `test:triage`, and keep or return the PR to Draft. Reconcile obsolete generated full-selection labels so they do not present a conflicting result. Use GitHub metadata operations directly for this limited exercise; do not run candidate controller code, publish an executable decision, add `test:selected`/`test:all-approved`/`test:run`, or request CI. Recheck head/base before and after mutation. Report the result as a labels-only trial, not an authorized current-commit E2E decision. This exception does not activate the policy or approve any test execution.

## Execution

1. Create the PR with `--draft` and publish its decision using `pr-labeling`.
2. For a subset, run `node scripts/test-selection/request-pr-e2e.mjs --pr NUMBER`. For triage, stop E2E processing and leave the queue for an explicit triage request.
3. The request helper verifies current authorization and requests a fresh PR-associated validation run. This preserves PR check provenance. A diagnostic `workflow_dispatch` on main cannot substitute for the PR's own checks.
4. The trusted default-branch controller reads the decision and produces immutable raw/resolved artifacts for the candidate merge. The child, plan and shard entrypoints recheck the decision. The planner retains the mandatory floor and produces concrete test identities.
5. `Pipeline outcome` requires selection and all configured PR E2E stages to succeed. Report executed test evidence separately from the selected plan.

`pr-test-decision.yml` handles PR creation and updates before the app pipeline finishes, including documentation-only PRs. It uses `pull_request_target` only for metadata: it checks out default-branch code and never executes PR code. It reconciles labels, converts unresolved PRs to Draft and publishes the head's `PR test decision` check. Independent basic checks may still run while E2E is blocked.

## Activation and limits

Schema v2 supersedes category-only v1 records. A newer trusted legacy or malformed record blocks older approval. Changes to IMPACT-MAP.md (including conditions/evidence) or coverage metadata require a fresh decision. The metadata controller continues to load trusted default-branch code and catalogs; do not load candidate map code with its privileged token. A narrowed plan requires catalog agreement. Catalog-changing PRs can use an explicitly requested, current-commit manual full approval against the existing trusted catalog; full planning retains the controller fingerprints and discovers the complete candidate inventory without interpreting a new subset. This allows reviewed catalog upgrades to land. The initial absence of a trusted controller remains a bootstrap limitation.


The controller must exist on the trusted default branch before it can authorize tests. A bootstrap PR introducing this policy cannot authorize itself by executing candidate controller code with the metadata token. Validate its local policy tests and basic CI; the new test gate remains blocked until trusted tooling is available. Do not work around that restriction by using the old full override.

Old PR branches that explicitly modify workflow files may retain old workflow definitions. Bring them onto the current base and inspect those changes before relying on this policy. Historical workflow runs retain their original definitions; use a fresh PR-associated run after activation.

Draft conversion is asynchronous. Enforcing `PR test decision` and the current PR's `Pipeline outcome` as required checks in repository rules is a separate rollout action; without required checks, a check by itself does not prevent GitHub merging. This implementation does not change repository-wide branch protection. The landing skills require both a valid decision and successful matching PR E2E evidence.

This changes CI and agent tooling only. Confluence UI validation and product Mixpanel event registration do not apply.

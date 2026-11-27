---
name: validate-branch
description: Run ordered local and staging validation on the current branch before shipping. Use when the user says "validate", "check branch", "am I good", "run tests", "preflight", "is this ready", or wants to verify their branch before pushing or creating a PR. Also use as a precondition check before invoking submit-branch or land-branch.
---

# Validate Branch

Run local checks before shipping. For Confluence app UI changes, complete the visual stages in order: **Storybook → Forge Tunnel → CI-deployed Staging**. A successful earlier stage is required before starting the next. See the root `CLAUDE.md` hard rule for evidence and applicability requirements. This skill does not push branches or create PRs. When called as a precondition by `submit-branch` or `land-branch`, report local readiness after Storybook and Tunnel; the caller owns submission. Full validation can be reported only after CI deploys that candidate and its Staging UI checks pass. Do not invoke either caller skill from here.

Run from the repository root. Stop at the first failure. Do not report complete validation when only local checks have passed.

Before running checks, read `../pr-review-support-materials/SKILL.md` and plan the BEFORE/AFTER comparison. Retain the tested SHA, reproducible steps, and evidence as you go. When reporting validation on an existing PR, use that skill to publish the results at the top of its description, including blocked or failed checks. Do not leave the only screenshots or logs on the local machine.

## 1. Lint, unit tests, and build

Run these in order:

**Lint**

```bash
pnpm lint
```

This lints all of `src/`. If lint fails, report the errors and stop.

**Unit tests**

```bash
pnpm test:unit
```

If tests fail, report the failing test names and stop.

**Build**

Build at least one variant:

```bash
pnpm build:lite
```

For a variant-specific change, build that variant instead (`pnpm build:full`, `pnpm build:diagramly`, or the applicable variant build). If the build fails, report the error and stop.

## 2. Storybook

For UI changes, run the relevant story or component in Storybook before using a Forge tunnel. Start Storybook with `pnpm storybook`, then inspect the changed UI and its relevant states in the browser. Record the branch and commit tested, the Storybook story/URL, and keep screenshot or snapshot evidence for the assertions.

If the change has no relevant Storybook story, add a minimal representative story before continuing. If the UI genuinely cannot be represented in Storybook, mark this stage **BLOCKED** or **SKIPPED**, explain the reason and the smallest blocker, and stop the remaining UI validation stages. Do not substitute a later stage or another local check and continue. A pure backend or documentation change has no UI validation stages; state **N/A** with the reason.

If Storybook fails, stop, fix the issue, and repeat the affected local checks and Storybook stage before continuing.

## 3. Forge Tunnel

After Storybook passes, verify the UI against a development Confluence site using the **forge-tunnel** skill. Follow that skill for setup, app variant, environment, tunnel identity, browser profile, and connection verification. Do not use `agent-browser --session conf-app --restore=stg` for the tunnel unless it is the identity required by the forge-tunnel workflow; tunnel visibility is identity-gated.

Use the **spot-check** skill to write the behavior, target, assertions, and expected outcomes before opening the browser. Record the branch and commit tested, target site, visible build/version, and UI source. Capture actual screenshots or snapshots for the assertions; if the branch has an open PR, post them with the spot-check skill's **Post evidence to the PR** step. If the expected local code is not visible, the stage fails. Fix the issue and repeat Storybook and Tunnel before moving on.

## 4. CI-deployed Staging

After Storybook and Forge Tunnel pass and the candidate branch has been pushed through the authorized workflow, wait for its CI staging deployment to succeed. Never run `pnpm forge:deploy:*:staging` locally. Verify the successful deployment belongs to the candidate branch and commit, then test that deployed build on the relevant staging site.

Record the deployed build/commit, target site, visible version, and UI source. Capture actual screenshots or snapshots for the planned assertions and post them to the PR the same way. Green CI alone does not prove the manual UI scenarios passed. If staging deployment or UI validation fails, fix the issue and repeat the affected stage; later acceptance must use the final candidate version.

## Reporting

Report two separate statuses:

- **Local readiness:** lint, unit tests, build, and applicable Storybook and Tunnel stages passed; the branch is ready to push for staging validation.
- **Full validation:** the applicable ordered stages, including CI deployment and Staging UI checks, passed for the final candidate.

For each applicable UI stage, include the tested branch/commit or deployed build, UI source/site, outcome, and evidence path or snapshot reference. Mark blocked assertions **BLOCKED** and omitted assertions **SKIPPED** with the reason; never mark either as PASS. A blocked or skipped Storybook stage stops Forge Tunnel and Staging validation. For docs-only or no-UI changes, mark UI validation **N/A** and explain why. Do not claim full validation when Staging has not been checked.

## CI coverage

After push, CI runs lint, unit/build checks and staging deployment/E2E coverage as configured by the workflow. A green CI run is evidence for those automated checks only; it does not replace the manual UI assertions above. The forge-tunnel stage catches Confluence integration issues before staging deployment.

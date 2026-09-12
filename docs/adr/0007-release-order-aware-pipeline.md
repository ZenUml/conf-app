# 0007 — The pipeline is shaped by the release order, and tests never run twice on one tree

Date: 2026-09-11
Status: accepted — implemented in stages (see the table at the end)
Related: [ADR-0006](0006-release-pipeline-optimised-for-wall-clock.md), [docs/ops/release-pipeline-time-budget.md](../ops/release-pipeline-time-budget.md), `.github/workflows/build-test-deploy.yml`, `.github/workflows/release.yml`, `.claude/skills/release-app/SKILL.md`

ADR-0006 cut the main build from 13m26s to 7m58s by removing repeated work from
the critical path. What remained was decided in a design review on 2026-09-11
(the clock being minimised is merge-to-live, not CI alone):

1. **Full is sequenced; diagramly and lite are peers.** Full is never the first
   variant released (the release-app skill's canary order is diagramly → lite →
   full a week later; lite sometimes goes first, Full never does), so its draft
   is never what a person waits for. Its E2E therefore runs after Lite's E2E by
   default, which keeps the run's fan-out under the account's 20-concurrent-job
   cap. Diagramly and lite are not sequenced against each other: either may be
   first. Full has an escape hatch for a Full-first hotfix — `[full-first]` in
   the merge message or the repo variable `FULL_DRAFT_LANE=now` — implemented as
   two mutually exclusive call sites, not a polling gate. Drafts are not
   auto-published; a person still publishes each one.
2. **`main` does not re-run tests a PR already ran on the identical tree.** A
   `pull_request` run tests `refs/pull/N/merge`; when `main` has not moved, the
   merge commit's tree is byte-identical, and re-running Lite's E2E is pure
   repetition. `main` compares trees, verifies the PR run's E2E jobs ran and
   passed (a draft PR skips them), and cuts the draft with the reused run named
   in its body. Any doubt — tree differs, no parent run, jobs skipped — runs
   everything. "Require branches to be up to date" stays off until the hit rate
   is measured.
3. **The release run deploys; it does not build.** `main` builds the production
   bundles (with `VITE_APP_VERSION` = the draft tag) and attaches them to each
   draft; `release.yml` downloads and deploys. The Forge deploy and the
   Cloudflare Pages publish run in parallel on **staging only**; production
   keeps backend-before-frontend, because the minute saved is not worth a
   window where an upgraded install calls an unpublished backend.
4. **The release smoke is the PVT.** The `@smoke` tier the release run executes
   on the new tag proves the same thing the manual Mermaid PVT did; the
   release-app skill now reads that verdict and runs the delta spot check in
   parallel with it. Manual `/pvt` remains for AsyncAPI (its prod smoke is
   skipped) and to disambiguate a red smoke shard.
5. **Test selection on PRs is deterministic; AI only widens.** Every E2E spec
   carries closed-taxonomy tags (surface × diagram type × concern, aligned with
   CONTEXT.md's `Surface`); a checked-in path→tag map selects what a PR runs;
   `@smoke` always runs; shared or unmapped files run everything; the nightly
   full suite stays. An AI pass over the diff logs what it would add for two
   weeks before it is allowed to add tags — it can never remove one.
6. **Flakes are re-run once and ranked.** A failed E2E shard is re-run once
   automatically (never build or unit); a weekly job ranks specs by retry and
   failure count from the merged reports so root causes get fixed. A second
   failure is real.

Kept as they were, deliberately: the 7-day Full soak (revisit with a month of
data on lite hotfixes within 7 days of a release); no in-shard `workers: 2`
(the OTP/race history); no plan upgrade for runners until E2E fan-out grows.

| Decision | Landed in |
|---|---|
| 1, 4, plus the shard/serial-group changes measured in `build-test-deploy.yml` | #669 |
| 2 (`reuse-check` job; Lite at 10 shards after #669's split measured 4m06s on its tail shard) | the PR after #669 |
| 3 (`version` + `build-prod` jobs attach `dist-prod-<variant>.tgz` to each draft; `release.yml` downloads it; staging publishes Pages beside the Forge deploy) | the PR after #670 |
| 6 (`e2e-rerun.yml`: one automatic re-run when every failed job is an E2E job, attempt 1 only; `e2e-flake-ranking.yml`: Mondays, from the week's blob reports) | #673; its `resurrect` job (a `main` run cancelled while pending, commit still the tip → re-run) in the PR after #673 |
| 5, first half (closed tag taxonomy in `tests/e2e-tests/config/tags.ts`, every spec's top-level blocks tagged, `tests/unit/e2eTags.spec.ts` polices it) | the PR after #673 |
| 5, second half (`tests/e2e-tests/config/impact-map.mjs` + `scripts/e2e-select.mjs`; the `select` job feeds `grep` to the Lite E2E on PR runs, whose job names gain "(selected)"; `select-ai` logs what a model would add, only when `ANTHROPIC_API_KEY` is set) | the PR after #674 |

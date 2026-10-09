# 0007 — The pipeline is shaped by the release order

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

   *Addendum, 2026-10-09 (PR #751).* The main validation phase applies the
   shared staging D1 migrations once. After that, all four variants use the
   regular staging deployment, which publishes Pages beside Forge, with
   `skip-migrations: true`. Lite, Diagramly and AsyncAPI deployment and E2E
   lanes run independently; Full's E2E keeps its default after-Lite lane and
   the existing `now` override. At one pinned SHA, `functions/` is identical
   across variants and both staging Pages projects use the same D1/KV/R2
   bindings (`wrangler-stg.toml`), so repeated backend publication does not
   change the backend code under another lane's tests. The marker remains
   `{sha, variant}`. Parallel staging backend checks accept the pinned SHA
   with any valid variant marker; strict SHA and variant checking remains
   the default for other callers, and frontend version checks still require
   the selected variant. A migration failure blocks all four deployments
   and drafts. This change covers main staging; the daily workflow change
   is maintained separately in PR #760. Main-only runtime behavior needs
   observation after merge; a draft PR cannot exercise this main graph.
2. **Main validation uses the current main coverage policy.** The earlier
   exact-tree PR reuse job was removed by the main Jev selection change.
   PR #751 retains that behavior: each eligible main variant needs fresh
   successful main E2E coverage, and every draft still needs the existing
   daily regression gate or its verified root bypass.
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
5. **Test selection on PRs has a deterministic safety boundary and AI chooses
   business categories.** Every E2E spec carries closed-taxonomy tags (surface
   × diagram type × concern, aligned with `CONTEXT.md`'s `Surface`); `@smoke`
   and changed staged-project E2E specs always run, while Jev analyzes the public diff to add
   business categories. Shared or unmapped files run everything, and the
   nightly full suite stays. The model can only widen the smoke/direct-spec
   floor; it cannot exclude those tests.
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
| 2 (historical `reuse-check` job, removed by the main Jev selection change; Lite at 10 shards after #669's split measured 4m06s on its tail shard) | the PR after #669 |
| 3 (`version` + `build-prod` jobs attach `dist-prod-<variant>.tgz` to each draft; `release.yml` downloads it; staging publishes Pages beside the Forge deploy) | the PR after #670 |
| 6 (`e2e-rerun.yml`: one automatic re-run when every failed job is an E2E job, attempt 1 only; `e2e-flake-ranking.yml`: Mondays, from the week's blob reports) | #673; its `resurrect` job (a `main` run cancelled while pending, commit still the tip → re-run) in the PR after #673 |
| 5, first half (closed tag taxonomy in `tests/e2e-tests/config/tags.ts`, every spec's top-level blocks tagged, `tests/unit/e2eTags.spec.ts` polices it) | the PR after #673 |
| 5, second half (`tests/e2e-tests/config/impact-map.mjs` + `scripts/e2e-select.mjs`; the `select` job feeds `grep` to the Lite E2E on PR runs, whose job names gain "(selected)"; `select-ai` logs what a model would add, only when `ANTHROPIC_API_KEY` is set) | the PR after #674 |
| 1, addendum (one shared D1 migration gate, four regular staging deploys, independent Lite/Diagramly/AsyncAPI validation) | #751 |

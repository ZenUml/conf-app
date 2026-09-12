# Release pipeline time budget

What a release costs in wall-clock, where the minutes go, and which of them
were cut on 2026-09-11 (ADR-0006). Re-measure before changing anything here;
the numbers below are from named runs, not estimates, except where marked.

## The clock being minimised

A release of one variant is: **merge → main build → (human) publish draft →
release run deploy job → PVT + spot check**, and the release smoke runs beside
the last step. The canary order (diagramly, then lite, then full a week later)
serialises variants on top of that. Everything below is about the two CI
segments; the human and policy segments are listed under *Open questions*.

## Where the minutes went (before)

Main build, run [34602804979](https://github.com/ZenUml/conf-app/actions/runs/34602804979) (main, 2026-09-11, green, 13m26s):

| t (min) | Job | Note |
|---|---|---|
| 0.0 → 3.5 | Build and Unit Test | unit 115s, asyncapi build check 45s |
| 0.1 → 5.3 | Deploy: Lite | Cloudflare build+publish **198s** (Full: 80s — the difference is the AsyncAPI Studio build), Forge deploy 81s |
| 0.1 → 5.6 | Deploy: AsyncAPI | same Studio cost |
| 5.3 → 7.2 | E2E: Lite / auth bootstrap | queued 78s behind render's and DrawIO's bootstraps on the `e2e-auth` group, then 36s of work |
| 7.3 → 12.5 | E2E: Lite / shard 1/5 | byline-asyncapi ×2 + byline-create ×2 + byline-paywall — longest shard by 50s |
| 12.7 → 13.2 | E2E: Lite / merge shard reports | checkout + install + merge, on the path because `Draft: Lite` needs the whole reusable workflow |
| 13.2 → 13.4 | Draft: Lite | |

Critical path: **Deploy: Lite → auth queue → shard 1 → merge → draft**. Peak
concurrency was 17 jobs; no job waited on a runner (max queue delay outside
the auth group: 9s).

Release run, [34594289094](https://github.com/ZenUml/conf-app/actions/runs/34594289094) (v2026.09.110805-lite, 10m03s):

| t (min) | Step | Note |
|---|---|---|
| 0.0 → 5.4 | `to production` job | Cloudflare build+publish **3m34s** (Studio again), Forge deploy 1m26s — **this is the deploy gate PVT waits on** |
| 5.4 → 5.9 | smoke / auth bootstrap | |
| 5.9 → 9.9 | smoke / shard 3/5 | paywall-page-banner ×3 (serial), 3m25s — the run's tail |

## What was cut

| Change | Where | Expected saving | Evidence |
|---|---|---|---|
| Studio build cache in the deploy jobs (lite, asyncapi) | `staging-deploy.yml`, `release.yml` | **measured −1m29s**: Deploy: Lite 5m20s → 3m51s on branch run [34645121026](https://github.com/ZenUml/conf-app/actions/runs/34645121026) (Cloudflare step 198s → 101s, cache hit); the release deploy gate pays the same step | Lite vs Full Cloudflare step before: 198s vs 80s |
| Auth bootstrap at t=0 per site, handed to suites as `auth-artifact` | `e2e-auth.yml` (new), `build-test-deploy.yml`, `e2e-test.yml` | **measured**: all four site logins done by 3m30s, before the first deploy finished (3m12s); Lite shards started 5s after Deploy: Lite | run 34655187796 |
| E2E no longer `needs: build`; drafts do | `build-test-deploy.yml` | keeps the 3m30s build job off the path once Deploy: Lite is under it | |
| Lite insert suite 8 shards instead of 5 | `build-test-deploy.yml` | **measured**: heaviest shard 3m30s (shard 2/8: byline-create ×2 + byline-paywall), from 5m12s | run 34655187796; layout in the job comment |
| typed-deeplink-autoconvert: 5 live cases → 1 + a manifest unit spec | `tests/unit/typedDeeplinkRouting.spec.ts`, the E2E spec | 4 page creations gone (~4 test-minutes across two shards) | the E2E's own header: every assertion is a manifest-matcher fact |
| paywall-page-banner: 3 tests → 2 | the E2E spec | ~1 test-minute plus two 6s waits off the tail shard | taper/snooze/CSAT ranking already in `warningBanner.spec.ts`, `pageBanner.spec.ts` |
| Merged HTML report only when a shard did not pass | `e2e-test.yml` | **measured**: Draft: Lite started 6s after the last E2E shard finished, from 42s | run 34655187796 |
| Release smoke runs `@smoke` only (7 tests) | `release.yml`, `tests/insert/*.spec.ts` | release tail 3m25s → ~2m (est.) | shard 3 above |
| AsyncAPI suite 3 shards, not 5 | `build-test-deploy.yml` | none on the path; two empty runners gone | `--list --shard=N/5` gave 4/0/2/3/0 |

## Where the minutes go now (after)

Main build, run [34655187796](https://github.com/ZenUml/conf-app/actions/runs/34655187796) (main, the merge of #667, 2026-09-11, green, **7m58s** — from 13m26s):

| t (min) | Job | Note |
|---|---|---|
| 0.0 → 3.6 | Build and Unit Test | unit 119s; no longer on the path (E2E does not wait for it) |
| 0.1 → 3.8 | Deploy: Lite | Cloudflare build+publish **94s** (was 198s), Forge deploy 86s |
| 0.1 → 3.8 | Deploy: AsyncAPI | Cloudflare step 100s (was ~3m) |
| 0.6 → 3.5 | E2E auth: AsyncAPI, Diagramly, Full, Lite | the four logins, serialised on the `e2e-auth` group, all finished before any deploy did |
| 3.8 → 7.3 | E2E: Lite / shard 2/8 | byline-create ×2 + byline-paywall — the heaviest Lite shard, 3m30s |
| 5.3 → 7.8 | E2E: Lite DrawIO Publish / shard 3/5 | **queued 96s for a runner**, then 2m30s of work — the actual tail of the run |
| 7.8 → 7.9 | Draft: Lite | 6s after the last shard |

Critical path: **Deploy: Lite → DrawIO Publish shard 3 (runner queue) → draft**.
Diagramly's draft was cut at 6m06s, Full's at 6m18s, AsyncAPI's at 7m00s.

The PR's own `pull_request` run ([34654501459](https://github.com/ZenUml/conf-app/actions/runs/34654501459), Lite only) took 7m20s with no runner queueing at all.

**Runner concurrency is now the binding constraint.** The run peaked at exactly
20 concurrent jobs, and the five shards created last — DrawIO Publish 3/5 and
4/5 and all three AsyncAPI shards — waited 92–96s to start (every other
job's `started_at − created_at` was under 30s). Twenty is GitHub's concurrent-job
limit for the Free and Pro plans, so treat it as the account's cap unless the
plan changes. The full-fan-out moment (27 shards: Lite 8, DrawIO 5, render 1,
Full 5, Diagramly 5, AsyncAPI 3) exceeds it by 7. Without that queue the tail
would have been Lite shard 2/8 at 7m18s.

### Run 34659544917 — first run with the Full lanes (8m48s, green): a measurement of the wrong lane

Main run [34659544917](https://github.com/ZenUml/conf-app/actions/runs/34659544917) (the merge of #669, 2026-09-11) took **8m48s**, 50s slower than run 34655187796. Two causes, both visible in the job list:

| t (min) | Job | Note |
|---|---|---|
| 0.1 → 4.2 | Deploy: Lite | 4m06s this time (3m36s the run before — the Forge deploy step varies by ~30s) |
| 3.0 → 6.8 | E2E: Full (now) / shard 4/4 | **the `now` lane ran**: #669's own title quoted the `[full-first]` token, and the merge commit carries the PR title. Peak hit 20 again; Lite shard 3/8 queued 57s, DrawIO Publish shard 1/5 93s |
| 4.3 → 8.6 | E2E: Lite / shard 2/8 | **4m18s** — byline-create #2 + byline-paywall + edit-graph, three page-creating tests on one shard: unpinning byline-create at 8 shards moved the boundary the wrong way (PR run 34658978233 showed the same shard at 4m06s) |
| 8.6 → 8.8 | Draft: Lite, Draft: Full | Draft: Full waited for Lite's E2E even in the `now` lane — a skipped job still waits for its `needs` before its `if` is evaluated. Harmless (Full's draft is never waited for), but the `now` lane does not make Full's draft any earlier |

So this run measures the parallel lane plus a shard regression, not the default. What it does show: the `now` lane and its selection work; the 4-shard Full/Diagramly split keeps their heaviest shard under 4m; and the lesson that **the token must not appear in a PR title unless it is meant** — PR titles become merge-commit messages.

The 10-shard Lite split in the next PR separates byline-create's two tests from byline-paywall and edit-graph (measured layout in the job comment; no shard with more than two page-creating tests, expected tail ~3m). The first `main` run after it, with the default Full lane, is the one to compare against 7m58s.

### Run 34660754910 — first run with `reuse-check` (7m47s, green): Lite draft at 4m42s

Main run [34660754910](https://github.com/ZenUml/conf-app/actions/runs/34660754910) (the merge of #670, 2026-09-12), default Full lane, reuse hit:

| t (min) | Job | Note |
|---|---|---|
| 0.0 → 0.2 | Reuse PR E2E? | 12s: merge tree == PR-head tree, PR run 34660307453 had all three Lite suites green → `reuse=true` |
| 0.7 → 4.5 | Deploy: Lite | 3m48s |
| 4.5 | E2E: Lite, DrawIO Publish, render | all **skipped** (reused) |
| 4.5 → 4.7 | **Draft: Lite** | **4m42s** from push, body: `E2E: reused from a PR run on the identical tree — …/runs/34660307453` |
| 4.5 → 7.6 | E2E: Full (default lane) | started the moment Lite's E2E resolved; heaviest shard 3m00s |
| 5.4 / 6.3 / 7.8 | Draft: AsyncAPI / Diagramly / Full | |

Peak 10 concurrent jobs; no shard queued for a runner. The PR run that was reused ([34660307453](https://github.com/ZenUml/conf-app/actions/runs/34660307453), 6m54s) measured the 10-shard Lite layout: heaviest shard **2m54s** (byline-paywall + edit-graph), byline-create ×2 at 2m42s — the 4m18s regression from the 8-shard split is gone.

Merge-to-Lite-draft, by run:

| Run | Draft: Lite | What changed |
|---|---|---|
| 34602804979 | 13m26s | baseline |
| 34655187796 | 7m58s | ADR-0006 |
| 34659544917 | 8m48s | `now` lane by accident + 8-shard regression |
| **34660754910** | **4m42s** | reuse hit + 10 shards (ADR-0007 §2) |
| 34661075623 | 10m12s (12m20s from push) | another author's merge: reuse miss, pending 2m10s behind the previous main run, runner queues up to 172s while a PR run overlapped, one flake retry on the tail shard |
| 34661804793 | 8m30s (10m49s from push) | reuse miss with `build-prod` (ADR-0007 §3), pending 2m19s behind the previous main run, Lite shards queued 46–97s for runners |
| **34662255935** (attempt 2) | **3m42s** | reuse hit after a queue cancellation and a hand re-run — no overlapping run, no runner queue |
| 34665226448 | 4m18s | #674 merge, reuse hit, quiet main (Deploy: Lite 3m54s — the deploy step's ±30s is now the whole variance on a hit) |
| 34666114785 | 4m00s | #675 merge (selection landed; `select` skipped on main as designed), reuse hit, quiet main; Full's draft at 6m48s |

Times in the first column are from the run's first job; the bracketed figure
adds the time the run sat **pending behind the previous main run** on the
workflow's concurrency group (see below) — that wait is real merge-to-live
time, but it is not this pipeline's to shorten.

### Run 34661804793 — first run with `build-prod`, a reuse miss (Lite draft 8m30s)

Main run [34661804793](https://github.com/ZenUml/conf-app/actions/runs/34661804793) (the merge of #672, 2026-09-12): `main` had moved between #672's PR run and its merge (#671 landed in between — PR-head tree ≠ merge tree), so this is the reuse-miss case predicted above at ~7m. It measured 8m30s from the first job, and the run had also waited 2m19s pending behind #671's run before its first job was created.

| t (min) | Job | Note |
|---|---|---|
| 0.1 → 1.8 | Build prod: lite / full / diagramly / asyncapi | 1.2–1.6m each at t=0, all done before any deploy finished; drafts carry `dist-prod-<variant>.tgz` (verified on the four `v2026.09.120031-*` drafts) |
| 0.1 → 3.4 | Deploy: Lite | 3m18s (Pages publish beside the Forge deploy) |
| 3.4 → 5.0 | E2E: Lite shards created → started | **queued 46–97s for runners**: Lite 10 + DrawIO 5 + render 1 + Diagramly 4 + AsyncAPI 3 = 23 shards against the cap of 20 (peak 19 concurrent) |
| 5.0 → 8.2 | E2E: Lite / shard 9/10 | 3m12s of work after its 97s queue — the tail; shard 3/10 2m42s, 2/10 2m48s |
| 8.3 → 8.5 | Draft: Lite | **8m30s** from first job, 10m49s from push |
| 8.3 → 11.2 | E2E: Full (default lane) | heaviest shard 2m54s |
| 11.2 → 11.4 | Draft: Full | AsyncAPI's at 5m24s, Diagramly's at 6m48s |

The runner queue on the Lite shards is the difference between this and the ~7m prediction. The next lever for a miss is not more shards but fewer: Diagramly's and AsyncAPI's shards are created at the same moment as Lite's and compete for the same 20 slots (ADR-0007 §5's selection will cut that fan-out on PR runs; on `main` the four apps still fan out together).

### Run 34661075623 — another author's merge under load (Lite draft 10m12s) and an unexplained `Draft: Full` 403

Main run [34661075623](https://github.com/ZenUml/conf-app/actions/runs/34661075623) (the merge of #671, not part of this series) is the first measurement of the pipeline as other people meet it: reuse miss (their PR run predated #670's merge), pending 2m10s behind #670's run, and #672's PR run overlapping from t≈2.5m, which pushed runner queues on the Lite shards to 99–172s. Its tail shard (3/10, 4m41s) also carried the first flake-ranking data point: `edit-graph.spec.ts`'s DrawIO publish modal stayed open past 60s once and passed on retry. Lite draft at 10m12s from the first job.

`Draft: Full` then failed **twice** (attempt 1 at 00:31:49Z, and the human re-run at 00:43:29Z) with `Error 403: Resource not accessible by integration` from `ncipollo/release-action` on *create a release*. Same action SHA (`339a818`), same job-level `contents: write` (the job header prints it), same actor, same tag pattern as the `Draft: Full` of run 34661804793 that succeeded at 00:43:14Z — fifteen seconds earlier — and the three other drafts of the same run had been created fine at 00:24–00:28Z. None of the 60 previous `main` runs had this failure. The only variable left is the target commit (`c1315673`, then no longer the tip of `main`), and a direct probe of that from the agent container is refused by its GitHub proxy ("Creating, editing, or deleting releases is not permitted for this session type"), so the cause is **not established**. No fix was made; the tree's Full draft was superseded by the next merge's. If it recurs, capture the exact `target_commitish` and whether it was still the branch tip.

### Run 34662255935 — cancelled while pending, then resurrected

Main run [34662255935](https://github.com/ZenUml/conf-app/actions/runs/34662255935) (the merge of #673) entered the workflow's concurrency group at 00:37:31Z, pending behind #672's run. At 00:38:59Z the human re-run of #671's run (attempt 2) entered the same group, and GitHub — which keeps at most **one** pending run per group — cancelled #673's run at 00:39:01Z with **zero jobs started**. The tip of `main` then had no staging deploy and no drafts, and nothing would have produced them until the next merge. The GitHub docs describe exactly this (`queue: single`, the default: "any existing pending job or workflow run in the same group is canceled and replaced"); `queue: max` would keep every pending run, but it is not allowed next to `cancel-in-progress: true`, which the same block needs on PR branches.

The fix is `e2e-rerun.yml`'s `resurrect` job (the workflow is now named **Run recovery**): on a `main` push run that ended `cancelled` with no job started, whose commit is still the branch tip and has no other pending, running or green run, it re-runs the run. A burst of merges still collapses to the newest pending run — that is the desirable case, its tree contains the older ones — and only the re-run-of-an-older-run case is undone. Re-run by hand at 01:19Z to validate the mechanism (`POST …/runs/34662255935/rerun` → 201 on a never-started run) and to get the tip its drafts. Attempt 2, with nothing else running:

| t (min) | Job | Note |
|---|---|---|
| 0.0 → 0.2 | Reuse PR E2E? | merge tree == PR-head tree of run 34661845980 → `reuse=true` |
| 0.1 → 1.8 | Build prod ×4 | all done before any deploy |
| 0.1 → 3.5 | Deploy: Lite | 3m24s |
| 3.5 → 3.7 | **Draft: Lite** | **3m42s** from first job — the fastest Lite draft so far (4m42s on the first reuse hit; the difference is Deploy: Lite, 3m48s there) |
| 3.5 → 6.4 | E2E: Full (default lane) | started the moment Lite's skipped suites resolved; heaviest shard 2m54s |
| 5.2 / 6.7 / 6.8 | Draft: AsyncAPI / Full / Diagramly | Full's draft at **6m42s** |

Peak 13 concurrent jobs, no shard queued (`started_at − created_at` ≤ 3s on every shard). All four drafts (`v2026.09.120119-*`) carry `dist-prod-<variant>.tgz`; Lite's body names the reused PR run. This is what a quiet-hour merge of a rebased branch now costs from first job to a releasable Lite draft: under four minutes.

## PR test selection (ADR-0007 §5)

On a pull request the `select` job maps the PR's changed files (from the
`pulls/N/files` API) through `tests/e2e-tests/config/impact-map.mjs` and hands
the three Lite E2E jobs a `--grep` of tags; `@smoke` is always in it, and the
job names gain "(selected)". A file in `RUN_EVERYTHING` (the Forge entry,
`src/model/**`, the manifest, dependencies, the workflows, anything under
`tests/e2e-tests/` — the specs included), or a file the map does not mention,
makes the run unselective. Unit specs, stories and docs select nothing. The
map is conservative on purpose: a miss costs a full run, never a missed spec.
`main` never selects — `reuse-check` also refuses a selected PR run, so a
draft is always backed by the whole suite.

Replayed over the last 40 merged PRs (2026-09-06 → 09-12) the map would have
narrowed **18** of them; the rest hit `package.json`/`pnpm-lock.yaml`,
`src/model/**`, `src/forgeIndex.ts` or the workflows. `src/utils/analytics/catalog.ts`
and `types.ts` were in 17 of the 40 (every feature registers its events there)
and are mapped to `@analytics`, not to everything — a new event name changes
nothing another surface can observe. Empty shards still cost their setup
(~40s each; the DrawIO Publish suite is one spec, so a selection without
`@graph`/`@fullscreen` leaves all five of its shards empty) — the next lever is
to shrink the shard matrix from the selection, which needs the selected test
count. The first selected PR runs will say what a narrowed run actually costs;
the expected shape is auth + deploy (~3.5m) + the heaviest selected spec.
At landing (2026-09-12) every open, non-draft PR would be narrowed on its
next push — #664 and #663 to seven and nine tags, #636 to `@export|@modal|@smoke`,
#637 to five tags — so the measurement comes from whichever is pushed first
(the two `fix/export-*` PRs could not be brought up to date for a
measurement run: both conflict with `main`). #675's own run was unselective
(it touches `.github/**`): `select` cost 12s at t=0, off the critical path.

`select-ai` runs beside it and only writes to its job summary what a model
would add to the selection (never remove) — evidence for widening the map
after two weeks. It needs the `ANTHROPIC_API_KEY` repository secret; without
it the step exits with a notice and the deterministic selection is unaffected.

## How to re-measure

```bash
# Jobs of a run with start/end offsets from run creation (needs the github MCP or gh):
gh api repos/ZenUml/conf-app/actions/runs/<run-id>/jobs --paginate --jq '.jobs[] | [.created_at, .started_at, .completed_at, .conclusion, .name] | @tsv'
```

Sort by `started_at`; the critical path is the chain of jobs where each starts
right after the previous one ends. Measure from the first job's `created_at`,
not the run's `run_started_at`: `main` runs are serialised on the workflow's
concurrency group, and a run queued behind another sits pending for the whole
of the previous run (2m10s and 2m19s on the two measured cases) before its
first job exists. Report both figures when they differ. `started_at − created_at` above ~20s on a
non-auth job means the account's runner concurrency cap is queueing jobs — the
first sign that more shards would stop paying.

```bash
# Shard layout for a suite, before and after changing spec files:
cd tests/e2e-tests && CI=true APP=zenuml-lite@stg ATLASSIAN_OTP=x pnpm exec playwright test --list \
  --project=auth --project=insert --project=feedback --shard=1/8
```

## Equivalent lower-cost tests: what was moved and what must stay live

The question for each E2E test on the critical path was: *what in this test
can only a real Confluence page prove?* Anything else has a cheaper home —
vitest for logic, the `preview` Playwright project (viewer-preview.html /
editor-preview.html against a local Vite dev server, no Confluence, no auth)
for UI behaviour.

| Spec | Only Confluence can prove | Moved to a cheaper equivalent |
|---|---|---|
| typed-deeplink-autoconvert | a matcher's `*` is one segment; a matching paste becomes an extension node — kept as **one** case | which macro claims which URL, exclusivity, minted host/shape, embed 3- vs 4-segment split → `tests/unit/typedDeeplinkRouting.spec.ts` |
| paywall-page-banner | pageBanner module mounts with the count; CTA navigates; Dismiss reaches the marker; host closes the iframe — kept as **two** tests | snooze window, impression taper, paywall > CSAT → already in `src/utils/paywall/warningBanner.spec.ts`, `src/routes/pageBanner.spec.ts` |
| byline-asyncapi, byline-create, byline-paywall | the Forge byline module, a real save, the id diffed out of the page | nothing — the spec headers say why the component tests cannot supply `extension.location` truthfully |
| graph-edit (DrawIO Publish) | the nested Forge → DrawIO iframe chain and the real autosave/publish | nothing today; a preview harness for the fullscreen bridge would be the next candidate |
| feedback-report | a real page for each surface, a real backend write | nothing today; off the critical path (its own shard) |

## Decided next steps (ADR-0007, 2026-09-11)

Answers to the open questions below and to the design review that followed.
Each row lands as its own PR and gets its measurement added here.

| Decision | Status | Expected |
|---|---|---|
| Full's E2E runs after Lite's by default (`[full-first]` / `FULL_DRAFT_LANE=now` for the parallel lane); Full/Diagramly 4 shards; byline-create tests independent; env-gated byline-activation spec not collected in CI | landed (#669); the first main run took the `now` lane by accident, see below | peak 21 jobs instead of 27; Lite tail ~3m30s → ~3m (regressed to 4m18s at 8 shards; fixed by 10 shards in the next PR) |
| `main` reuses a green PR run's E2E when the merge tree is identical (`reuse-check` job); Lite 10 shards | landed (#670); **measured: Lite draft 4m42s** on run 34660754910, heaviest Lite shard 2m54s | Lite draft ~8m → ~4m on a hit |
| `main` attaches production bundles to drafts (`build-prod` matrix at t=0, one shared version string per run); `release.yml` downloads and deploys them, building only when a draft has no asset; Forge/Pages parallel on staging | landed; staging parallel publish measured on branch run 34660908646: Deploy: Lite 3m26s (Cloudflare step 75s, was 94–101s) | release deploy gate ~3.5m → ~2.5m (build skipped; install, secrets, D1, publish and the Forge deploy remain) |
| Failed E2E shard re-run once (`e2e-rerun.yml`, `workflow_run` on attempt 1, only when every failed job is an E2E shard/bootstrap/merge/preview); weekly flake ranking (`e2e-flake-ranking.yml`, merges the week's blob reports and ranks tests by passed-on-retry and failed) | landed (#673); `resurrect` job added after run 34662255935 was cancelled while pending (see above) | fewer red re-runs; a target list for flake fixes; no tip of `main` left without drafts |
| Tag taxonomy (`tests/e2e-tests/config/tags.ts`: surface × diagram type × concern) on all 53 top-level blocks of the 52 specs, policed by `tests/unit/e2eTags.spec.ts` | landed (the PR after #673) | no timing change by itself — `--grep @smoke` still selects the same 7 tests |
| Path→tag map (`impact-map.mjs`) + `scripts/e2e-select.mjs`; the `select` job narrows the Lite E2E on PR runs; `select-ai` logs only | landed (the PR after #674); see *PR test selection* below | 18 of the last 40 merged PRs would have run a selection instead of the full suite |
| Release `@smoke` counts as PVT (release-app skill) | landed | one browser session fewer per release |
| 7-day Full soak | unchanged | revisit with data |

## Open questions (not decided by ADR-0006)

Each was raised while working the design tree; the recommendation is what the
pipeline would do next, not what it does now.

1. **Forge deploy concurrent with the Cloudflare publish in `release.yml`.**
   Today the Forge production deploy (1m26s) starts only after the Pages
   publish completes, so the backend is live before any install can pick up
   the frontend. Running the two side by side (one build, two deploys) saves
   ~1 minute on the deploy gate at the cost of a ~60s window where a freshly
   upgraded install could call a not-yet-published backend endpoint.
   Recommendation: keep the ordering; the minute is not worth a release-day
   incident class that does not exist today.
2. **Diagramly and Lite drafts released in one session, sequentially.** The
   release-app skill finishes diagramly's publish, PVT and spot check before
   starting lite. Publishing both drafts together and running both PVTs
   would halve that session, but removes the canary's value entirely.
   Recommendation: keep the order; shorten each cycle instead (done above).
3. **`retries: 2` on staging.** A wedged test costs three attempts before the
   shard reports; `retries: 1` would halve the worst case but turn every
   single-retry flake into a red run and a human re-run of the whole build.
   Recommendation: leave it until the flake rate is measured from the merged
   reports.
4. **Unit tests: 254 spec files in 115s.** Off the critical path now. Sharding
   vitest across two jobs would take it to ~60s if it ever comes back onto the
   path. Recommendation: nothing until it does.
5. **Runner concurrency — answered; acted on in ADR-0007** (Full sequenced,
   Full/Diagramly 4 shards). Original note kept for the reasoning: The cap is 20 (see
   *Where the minutes go now*), and the first main run hit it: five shards
   queued ~95s and one of them became the tail. Next lever, in order of
   evidence: Full and Diagramly run the same `insert` list as Lite but skip
   the byline, paywall and typed-deeplink specs at runtime, so under 5 shards
   their shard 1 finishes in ~40s having run nothing — 3 shards each would
   free four runners at the peak (27 → 23) while their heaviest shard stays
   under Lite's 3m30s. Measure with `--list --shard=N/3` and the Full/Diagramly
   job timings before changing the matrices; the gain is bounded at ~30s
   because the queue only delayed the DrawIO tail by that much past Lite
   shard 2/8.

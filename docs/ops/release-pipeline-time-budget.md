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

## How to re-measure
## How to re-measure

```bash
# Jobs of a run with start/end offsets from run creation (needs the github MCP or gh):
gh api repos/ZenUml/conf-app/actions/runs/<run-id>/jobs --paginate --jq '.jobs[] | [.created_at, .started_at, .completed_at, .conclusion, .name] | @tsv'
```

Sort by `started_at`; the critical path is the chain of jobs where each starts
right after the previous one ends. `started_at − created_at` above ~20s on a
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
| Full's E2E runs after Lite's by default (`[full-first]` / `FULL_DRAFT_LANE=now` for the parallel lane); Full/Diagramly 4 shards; byline-create tests independent; env-gated byline-activation spec not collected in CI | landed | peak 21 jobs instead of 27; Lite tail ~3m30s → ~3m |
| `main` reuses a green PR run's E2E when the merge tree is identical | next | Lite draft ~8m → ~4m on a hit |
| `main` attaches production bundles to drafts; `release.yml` only deploys; Forge/Pages parallel on staging | after | release deploy gate ~3.5m → <2m |
| Failed E2E shard re-run once; weekly flake ranking | after | fewer red re-runs |
| Tag taxonomy + path→tag map; deterministic PR test selection; AI pass logs only | last | PR E2E runs related specs only |
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

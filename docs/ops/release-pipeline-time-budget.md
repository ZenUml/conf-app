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
| Studio build cache in the deploy jobs (lite, asyncapi) | `staging-deploy.yml`, `release.yml` | ~2m off Deploy: Lite and off the release deploy gate | Lite vs Full Cloudflare step: 198s vs 80s |
| Auth bootstrap at t=0 per site, handed to suites as `auth-artifact` | `e2e-auth.yml` (new), `build-test-deploy.yml`, `e2e-test.yml` | ~1m50s (78s queue + 36s job) | job timings above |
| E2E no longer `needs: build`; drafts do | `build-test-deploy.yml` | keeps the 3m30s build job off the path once Deploy: Lite is under it | |
| Lite insert suite 10 shards instead of 5 | `build-test-deploy.yml` | shard 1 5m12s → heaviest shard ~3m30s (est.) | `--list --shard=N/10`, layout in the job comment |
| Merged HTML report only when a shard did not pass | `e2e-test.yml` | ~30s | merge 12.7→13.2 above |
| Release smoke runs `@smoke` only (7 tests) | `release.yml`, `tests/insert/*.spec.ts` | release tail 3m25s → ~2m (est.) | shard 3 above |
| AsyncAPI suite 3 shards, not 5 | `build-test-deploy.yml` | none on the path; two empty runners gone | `--list --shard=N/5` gave 4/0/2/3/0 |

Expected main build after all of the above, if the estimates hold: Deploy:
Lite ~3m20s → shards start at once → heaviest shard ~3m30s → draft ≈ **7–8
min**, from 13m26s. Release deploy gate ≈ **3m30s**, from 5m24s. Confirm on the
first green main run after merge and replace the estimates above with the
measured figures.

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
  --project=auth --project=insert --project=feedback --shard=1/10
```

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
5. **Runner concurrency.** The plan's cap is unknown from inside the repo. The
   main run now peaks at roughly 30 jobs when Full, Diagramly and Lite E2E
   overlap. If shards start showing runner queue delay (see *How to
   re-measure*), drop Full and Diagramly to 4 shards before touching Lite.

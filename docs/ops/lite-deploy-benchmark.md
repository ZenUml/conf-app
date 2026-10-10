# Lite staging deployment experiment

`lite-deploy-benchmark.yml` measures the actual reusable Lite staging deployment,
using one immutable application source commit and one immutable tooling commit.
Dispatch one or three pairs manually on the feature branch; after merge, it can
be dispatched from `main`. An initial feature-push trigger registered the workflow
before it existed on `main`. Branch dispatch was then verified, and the bootstrap
push trigger was removed. The current workflow has only `workflow_dispatch`, so
pushing the branch does not start another benchmark. The source SHA must be an
ancestor of `main`, and both arms use that pinned source. For example:

```sh
gh workflow run lite-deploy-benchmark.yml --repo ZenUml/conf-app \
  --ref ci/lite-deploy-20pct \
  -f source-sha=1a7e4a0bf19eade1e24e440e248c87f4f061b3ee \
  -f pairs=3
```

The initial feature-push trial (run 38009251073) was canceled before starting
when it was superseded by the later three-pair dispatch (run 38009757697). That
pending dispatch was also canceled before starting, to apply the requested
deploy-only scope. No performance target is established until a complete
experiment meets the acceptance criteria below.

The experiment runs deployments and source-identity probes only. It owns
`conf-app-staging` through shared D1 migrations, all samples, and the timing report.
It does not invoke E2E, Playwright, or smoke workflows. It does not cancel another staging owner. D1
migrations run once before samples, matching the normal main staging workflow;
each deploy receives `skip-migrations: true`. There is no local staging deployment.

The six-sample order is baseline, candidate, candidate, baseline, baseline,
candidate. Every sample starts a fresh runner, installs with the frozen lockfile,
builds Lite, applies the same variant manifest edits, synchronizes runtime
configuration, runs Forge lint/deploy and Pages publish, and retains the existing
install/upgrade commands. Each benchmark sample requires install or upgrade to
succeed; the ordinary staging caller retains its existing tolerated outcome.

The candidate restores installed dependencies with an exact cache key covering
Linux architecture, Ubuntu release, Node version and ABI, pnpm version, lockfile,
package manifests, pnpm configuration, and patches. The frozen install still runs.
Its separate Studio cache holds static output only. On a lean cache miss, a
separate restore action requests the existing aggregate cache with the exact
original paths and key. Cache versions include path metadata, so an aggregate
archive cannot be restored through the lean cache's restore-key list. The lean
cache's successful post step then saves only static output. The first candidate
can therefore pay the larger legacy restore once; both hit states are recorded.
Cache hits and misses remain in the evidence. Neither cache contains the app's
`dist/`; every candidate builds the application afresh, including a new app SHA.
The candidate also restores only the installed Forge CLI's dedicated public API
specification cache. The helper obtains
`CachedConf.getCache('PERMISSIONS_LINTER').conf.path` and requires the file name
`config.json` and parent directory `PERMISSIONS_LINTER-nodejs`; other stores and
folders are rejected. The key covers OS, installed CLI and linter versions,
lockfile digest, and a UTC 12-hour window, with only the immediately prior window
as a fallback. Each specification keeps its original expiry. The installed CLI
refetches an expired entry during ordinary lint, so every client and server lint
still runs. General Forge configuration and authentication stores are excluded.
Only cache-hit booleans are added to experiment metadata. The runtime benefit is
unmeasured until another complete experiment finishes.

The first deploy-only experiment (run 38010919902, tooling commit `22c36130`)
uses the cache and parallel-preparation candidate without the parser change
below. Its first candidate had cold caches and took 206 seconds versus the first
baseline's 186 seconds. The second candidate hit all three caches and took
177 seconds versus its paired baseline's 201 seconds: an 11.9% reduction,
below the target. These are preliminary observations; all six samples remain
part of that immutable experiment's report.

After install, candidate build, Pages configuration/migrations, and Forge variable
synchronization run concurrently. Writes within each remote configuration lane
remain sequential. All lanes join on success or failure. `PAGE_CAPTURE_SECRET`
keeps its existing post-deploy Forge synchronization step. Other variants and
production retain their existing preparation path. Vite already disables
compressed-size reporting; this experiment does not change that setting.

The next opt-in candidate additionally sets `TSESTREE_SINGLE_RUN=true` only
inside each Forge deployment invocation, after source and manifest preparation.
The installed Forge linter uses type-aware TypeScript parsing, but does not
enable automatic single-run inference. With its current parser, `CI=true` alone
therefore creates watch programs; the explicit setting selects a single immutable
TypeScript Program. Typed parsing, the existing syntactic/semantic diagnostic
policy, and Forge's pre- and post-deployment checks remain enabled. Build,
configuration commands, baseline, other variants, and production retain their
existing parser mode. The setting is recorded as a boolean on each Forge attempt.
Its deployment-time benefit has not been measured.

The acceptance metric is the median GitHub deploy-job `started_at` through
`completed_at`, including checkout, cache restore/save, frozen install, build,
configuration, lint, both deploys, install/upgrade, identity probe, metadata upload,
and action post steps. Queue wait is excluded for both arms. Deployment completion time is reported separately. Parent shared
migration duration is outside the deployment job, as it is in normal main CI.

Three complete matched pairs, successful backend source markers, identical
manifest and asset hashes, and no Forge retries are required before a reduction
of at least 20% qualifies. A one-pair run is preliminary. Retry-contaminated
samples remain visible and cannot establish the target. In particular, the
historical 230-second Lite deploy in run 37926049252 retried after an environment
was blocked by another deployment; that observation is not a clean comparator.
Cold-cache costs stay in the whole-job metric; warming a cache is not counted as
an independent performance improvement. Normal Lite staging stays on baseline
until the measured candidate is selected explicitly.

Artifacts contain source/tooling SHAs, manifest and asset digests, cache-hit
booleans, fixed phase names and durations, exit codes, and aggregate job timing.
They contain no environment values, command arguments, raw deployment logs,
resource paths, or signed upload URLs. The Forge phase observer retains the
existing CLI output in the job log and stores only fixed phase transitions.

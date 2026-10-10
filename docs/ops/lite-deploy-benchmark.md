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
The candidate now tries Lite upgrade first, with install as the fallback for a
new site. Both original CLI commands and their scope checks are retained. An
already-current installation is a successful upgrade; if both commands fail,
the benchmark still fails. Baseline and other products retain install first.
In ARM run 38013660810, the three candidates' initial install commands failed
because the app was already installed. From the CLI command marker to its
failure marker, those attempts took 2.989, 3.030, and 2.684 seconds, followed by
successful already-current upgrades. Avoiding that expected failure may save
roughly three seconds on an existing site; its effect on complete deployment
time is unmeasured and alone does not establish the 20% target. A new site may
instead pay the failed upgrade lookup before its successful install.

The candidate restores installed dependencies with an exact cache key covering
Linux architecture, Ubuntu release, Node version and ABI, pnpm version, lockfile,
package manifests, pnpm configuration, and patches. The frozen install still runs.
The candidate now sets up Node without setup-node's pnpm store cache, then
restores the installed dependency tree first. On an exact installed-tree hit,
it skips the redundant store download and store post-save. On a miss, it resolves
`pnpm store path --silent` and uses a conditional `actions/cache@v5` invocation
with that single path and the existing setup-node v5 key:
`node-cache-${RUNNER_OS}-${os.arch()}-pnpm-${hashFiles('pnpm-lock.yaml')}`.
Node's architecture spelling is lowercase (`arm64`), unlike `runner.arch`
(`ARM64`). The identical path and default compression/cross-OS settings preserve
the legacy store cache version, including an existing default-branch cache.
No broad restore keys are supplied. This matches the
[setup-node v5 restore implementation](https://github.com/actions/setup-node/blob/v5/src/cache-restore.ts)
and [pnpm store-path selection](https://github.com/actions/setup-node/blob/v5/src/cache-utils.ts).
Baseline retains its original setup-node pnpm cache. Both arms always run the
same frozen, script-disabled workspace install. The installed tree contains
package contents; the store is a download cache, not an omitted installation
step. A local isolated diagnostic confirmed the restored tree could complete
that install offline with an empty store; the actual CI path still requires
the next measured deployment to succeed. Store-requested and store-hit booleans
are recorded separately. Store restore/save costs stay inside the full job
timer. Both cache actions save only after successful jobs and skip save on an
exact hit. Unlike setup-node's save wrapper, actions/cache warns on cache-upload
errors; that optional cache outcome does not relax any install/deployment gate.
The complete-job benefit of this change is not yet measured.
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
Only cache-hit booleans are added to experiment metadata.

The first complete deploy-only experiment
([run 38010919902](https://github.com/ZenUml/conf-app/actions/runs/38010919902),
tooling commit `22c36130`) used the cache and parallel-preparation candidate
without the parser change below. All six samples succeeded with one Forge
attempt each, identical source/manifest/asset hashes, and verified backend markers.

| Pair | Baseline job, seconds | Candidate job, seconds |
| --- | ---: | ---: |
| 1 | 186 | 206 |
| 2 | 201 | 177 |
| 3 | 207 | 191 |
| Median | 201 | 191 |

The median reduction was 4.98%, so this iteration did not meet the 20% target.
The first candidate had cold caches and was 20 seconds slower than its paired
baseline; that cost remains in the report. The second candidate hit all three
caches and improved its paired baseline by 11.9%. Warm caches alone did not
establish the required whole-job improvement.

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
The second complete three-pair experiment
([run 38012524883](https://github.com/ZenUml/conf-app/actions/runs/38012524883),
tooling commit `cf6c65a8`) measured this parser-mode addition against the same
immutable application source. All six deployment jobs succeeded with identical
source/manifest/asset hashes and verified backend markers.

| Pair | Baseline job, seconds | Candidate job, seconds |
| --- | ---: | ---: |
| 1 | 212 | 191 |
| 2 | 213 | 236 |
| 3 | 214 | 165 |
| Median | 213 | 191 |

The median reduction was 10.33%, below the target. Candidate 2 required two Forge
attempts: the first exited unsuccessfully after 39.787 seconds, with upload as
its last observed phase; the existing 20-second wait preceded a successful
72.550-second retry. The report therefore has `retries_present: true` and
`target_met: false`. That sample remains in the median and also prevents this
run from providing three clean matched pairs.

The third clean pair improved from 214 to 165 seconds (22.9%), but one pair
does not establish a stable 20% reduction. Its candidate build took 39.235
seconds, the Forge attempt took 66.193 seconds, and the broad pre-deployment
interval labeled `lint` took 20.742 seconds, with all three caches hit.
Differences in runner or network performance have not been isolated. This run
does not establish a causal performance benefit from single-run parser mode.

An additional opt-in hardware comparison is available through the
`candidate-runner` dispatch choice. `ubuntu-latest` remains the default for both
arms and every ordinary caller. Selecting `ubuntu-24.04-arm` changes only the
candidate deploy jobs, and the reusable resolver rejects that choice unless the
mode, variant, license, project, and environment are exactly Lite staging.
[GitHub's standard runner specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
list both Linux x64 and ARM64 runners as four CPUs and 16 GB RAM, free for public
repositories. The complete ARM comparison below measures the combined candidate;
it does not isolate architecture from preparation and cache changes.
The lean Studio cache contains static browser assets and can be shared. On an
ARM lean-cache miss, a separate legacy restore requests the original four paths
and exact pin/script key, without broad restore keys. Immediately afterward, a
helper removes every restored Studio `node_modules` directory or symlink and
verifies none remain before any install or build can use them. Symlink targets
are not traversed or deleted. Static output is retained only for an exact cache
hit, matching repository gitlink and submodule HEAD, a matching regular
`.studio-commit`, a regular `index.html`, and an output tree without symlinks.
Partial hits and invalid output are discarded and take the complete native
Studio install/build path; inconsistent Git source fails before deployment.
This allows a first `main` run to seed its lean cache from an existing `main`
aggregate archive, since `main` cannot access feature-branch caches. The full
legacy download, cleanup, validation and lean-cache save remain in the job timer.
Evidence records only exact-hit/valid-output booleans and removal/residual counts.
The x64 legacy fallback and baseline are unchanged. Installed app dependencies
already have architecture in their cache key. Evidence records the selected
runner label and actual Node platform, architecture, and version. Every deploy,
validation, full timer, and output-equivalence requirement remains in place.

### Third complete experiment: ARM candidate

[Run 38013660810](https://github.com/ZenUml/conf-app/actions/runs/38013660810)
completed all six deployments successfully with no Forge retries. It used the
same application source as the first two experiments and tooling `4b619005`.
All manifest and asset hashes matched, and every backend marker was verified.
Runtime evidence confirms Linux x64 baselines and Linux ARM64 candidates, all
on Node 24.21.0.

| Pair | Baseline seconds | Candidate seconds |
|---|---:|---:|
| 1 | 190 | 187 |
| 2 | 208 | 173 |
| 3 | 210 | 165 |
| Median | 208 | 173 |

The median reduction was **16.83%**, so `target_met` is false. Candidate 1 had
a cold installed-dependency cache; candidates 2 and 3 hit that cache. All three
hit the lean Studio and public permission-spec caches. Those cold costs remain
in the result. The candidate Forge attempts took 77.046, 77.367, and 76.521
seconds, respectively; ARM has not established a faster Forge deployment.
The first-main legacy Studio seed added after this tooling revision was not
exercised by this run and still requires runtime verification. Ordinary Lite
staging remains on baseline while further optimization is measured.

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

Artifacts contain source/tooling SHAs, runner/runtime metadata, manifest and asset digests, cache-hit
booleans, fixed phase names and durations, exit codes, and aggregate job timing.
They contain no environment values, command arguments, raw deployment logs,
resource paths, or signed upload URLs. The Forge phase observer retains the
existing CLI output in the job log and stores only fixed phase transitions.

Phase names describe visible CLI markers, not isolated functions. In particular,
the interval from `lint` ("Running forge lint...") to `packaging` includes Forge
lint plus the remaining pre-deployment work. In the installed Forge CLI 13.5.0,
`out/command-line/controller/deploy-controller.js` lines 223–264 run
`verifyPreDeployment`, then migration-key/Connect-key checks, handler and resource
loading, an installation lookup, and configuration loading before packaging.
The interval therefore includes validation and remote-call time as well as
TypeScript parsing. A 25-second interval is not evidence of 25 seconds spent in
the typed parser. These phase clocks can locate a broad bottleneck; attributing
time to one operation requires a separate profile or more precise instrumentation.

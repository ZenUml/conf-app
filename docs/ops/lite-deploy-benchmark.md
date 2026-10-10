# Lite staging deployment experiment

`lite-deploy-benchmark.yml` measures the actual reusable Lite staging deployment,
using one immutable application source commit and one immutable tooling commit.
The branch push trigger runs one preliminary pair. After the workflow is available
on the default branch, manual dispatch selects one or three pairs.

The experiment owns `conf-app-staging` through shared D1 migrations, all samples,
and the final staging smoke. It does not cancel another staging owner. D1
migrations run once before samples, matching the normal main staging workflow;
each deploy receives `skip-migrations: true`. There is no local staging deployment.

The six-sample order is baseline, candidate, candidate, baseline, baseline,
candidate. Every sample starts a fresh runner, installs with the frozen lockfile,
builds Lite, applies the same variant manifest edits, synchronizes runtime
configuration, runs Forge lint/deploy and Pages publish, and retains the existing
install/upgrade behavior. The final deploy must pass the existing `@smoke` tier.

The candidate restores installed dependencies with an exact cache key covering
Linux architecture, Ubuntu release, Node version and ABI, pnpm version, lockfile,
package manifests, pnpm configuration, and patches. The frozen install still runs.
Its separate Studio cache holds static output only. The existing Studio cache is
a first-run fallback; a miss can therefore restore the larger archive once.
Cache hits and misses remain in the evidence. Neither cache contains the app's
`dist/`; every candidate builds the application afresh, including a new app SHA.
After install, candidate build, Pages configuration/migrations, and Forge variable
synchronization run concurrently. Writes within each remote configuration lane
remain sequential. All lanes join on success or failure. `PAGE_CAPTURE_SECRET`
keeps its existing post-deploy Forge synchronization step. Other variants and
production retain their existing preparation path. Vite already disables
compressed-size reporting; this experiment does not change that setting.

The acceptance metric is the median GitHub deploy-job `started_at` through
`completed_at`, including checkout, cache restore/save, frozen install, build,
configuration, lint, both deploys, install/upgrade, identity probe, metadata upload,
and action post steps. Queue wait and separate smoke validation are excluded for
both arms. Deployment completion time is reported separately. Parent shared
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

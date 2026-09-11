# 0006 — The release pipeline is optimised for wall-clock, not runner minutes or coverage-per-run

Date: 2026-09-11
Status: accepted
Related: [docs/ops/release-pipeline-time-budget.md](../ops/release-pipeline-time-budget.md), `.github/workflows/build-test-deploy.yml`, `.github/workflows/e2e-test.yml`, `.github/workflows/e2e-auth.yml`, `.github/workflows/release.yml`

The repository is public, so GitHub-hosted runners cost nothing, while every
minute between a merge and a validated production deploy is paid by a human (or
an agent session) waiting. Where the two trade off, the pipeline spends runners
to save wall-clock. Three choices follow from that and each one reads as a
mistake without this context:

1. **The staging E2E suites do not wait for the unit tests.** `E2E: *` jobs
   `need` only their deploy and their site's auth bootstrap; `build` (unit
   tests + the asyncapi build check) gates the *draft releases* instead. A
   draft is still never cut from a commit whose unit tests failed. What changed
   is that on a red-unit-test commit the E2E now runs anyway and its result is
   noise. The gain: once the Studio build cache took Deploy: Lite under the
   ~3m30s the build job takes, the unit tests would otherwise have become the
   head of the critical path on every green run.

2. **Atlassian logins happen at t=0, per site, before any deploy is done.** The
   auth bootstrap was extracted into `e2e-auth.yml`; `build-test-deploy.yml`
   runs it once per staging site the moment the run starts and hands the
   artifact to every suite (`auth-artifact`), so no suite queues for a login
   after its deploy is live. The session does not depend on which build is on
   the site. `e2e-test.yml` keeps its own bootstrap for callers that pass
   nothing (the production smoke). The repo-wide `e2e-auth` concurrency group
   still serialises every login so two bootstraps never contend for one TOTP
   code.

3. **The production release smoke runs only the `@smoke` tier.** Seven tests
   — one insert-and-render per macro type, one edit, one embed paste — tagged
   in `tests/e2e-tests/tests/insert/`. The Lite-only paywall-banner, byline and
   typed-deeplink flows it leaves out were run against lite-stg by the
   build-test-deploy run of the same commit, and the nightly `smoke-test.yml`
   still runs the whole insert suite on production, so daily production
   coverage is unchanged; only the per-release check is narrower. The
   alternative — keep the full suite and add shards — did not help: the slowest
   shard was a three-test `describe.serial` group that no shard count can
   split.

Also accepted, less surprising: the merged Playwright HTML report is only
built when a shard did not pass (a `needs` on a reusable workflow waits for its
last job, and this one delayed every draft by ~30s for a report nobody opens on
green), and the Lite insert suite is split 10 ways because at 5 and 8 the
contiguous split left the two two-test byline serial groups on one shard.

Not decided here, deliberately: the diagramly → lite → full canary order and
the one-week Full soak (release-app skill), and running the Forge production
deploy concurrently with the Cloudflare Pages publish inside `release.yml`
(backend-before-frontend ordering is a product-risk call, ~1 minute at stake).
Both are listed as open questions in the time-budget doc.

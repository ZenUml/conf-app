# GCP runner pool for E2E shards

The org is on GitHub's free plan, which runs at most 20 GitHub-hosted jobs at once ([limits](https://docs.github.com/en/actions/reference/limits)). The daily regression needs more than that. Daily run 45072127650 (2026-11-22) had 91 jobs and spent 361 s at the cap. Some shards waited up to 536 s for a runner. Adding hosted shards only moves that wait to another variant. Self-hosted runners are outside that table, so the pool adds capacity beyond the 20 hosted jobs. GitHub's docs do not say this outright: it is inferred from the limits page.

The pool is the conf-app copy of the design diagramly.ai has run since 2026-10-30 (`diagramly.ai` `docs/testing/self-hosted-runner.md`).

```
job queued (runs-on: gcp-conf)
   │ workflow_job webhook (HMAC)
   ▼
Cloud Run function conf-e2e-waker ── start VM + stamp gha-last-queued ──► conf-ci-c4n48
   ▲                                                                       ├ 48 runner services (user gha)
Cloud Scheduler conf-e2e-waker-sweep (5 min): starts the VM                │   each shard = Playwright container
if a job was queued < 15 min ago                                           └ e2e-idle-stop.timer: off after 10 idle min
```

| Piece | Value |
|---|---|
| VM | `conf-ci-c4n48`, `c4n-standard-48` SPOT, `us-central1-a`, project `staging-zenuml-27954`, 200 GB Hyperdisk |
| Runners | `/opt/gha/runner-1..48`, names `conf-ci-<n>`, label `gcp-conf` only (no default `self-hosted` label) |
| Job container | `mcr.microsoft.com/playwright:v1.59.1-noble`, pulled at setup |
| Waker | Cloud Run function `conf-e2e-waker` (`australia-southeast1`), service account `e2e-waker` (shared with diagramly, custom role `e2eWaker` on this VM only), secret `conf-gha-webhook-secret` |
| Webhook | repo `workflow_job` webhook to the function URL |
| Scripts | `scripts/gcp-runner/` (`install.sh`, `setup.sh`, `waker-deploy.sh`, `idle-stop.sh`, `runner-job-hook.sh`, `waker/`) |

## Which jobs use it

Only the `test` (shard) job of `e2e-test.yml`, and only when the caller passes `runner: gcp-conf`. Today that is the daily regression (`staging-transaction.yml`), which runs 16 shards per variant on the pool. Every other job stays on GitHub-hosted runners.

Never route PR code to the pool. A PR's E2E checks out the PR head, and the VM is persistent. conf-app is public, and fork PR workflows need approval only from first-time contributors (the owner kept that setting on 2026-11-23). So a returning outside contributor could change a workflow to `runs-on: gcp-conf` and run code on the VM without review. The defences are:

- the `gcp-conf` label is not used by any `pull_request` job;
- job containers cannot reach the metadata server, so they cannot get the VM service account token;
- the VM holds no repo secrets on disk.

## Switch back to hosted runners

```bash
gh variable set E2E_POOL_RUNNER --body hosted -R ZenUml/conf-app
gh variable delete E2E_POOL_RUNNER -R ZenUml/conf-app
```

The first command sends the daily regression back to 8 hosted shards per variant. The second returns it to the pool.

## Setup (idempotent)

```bash
RUNNERS=48 bash scripts/gcp-runner/install.sh
bash scripts/gcp-runner/waker-deploy.sh
```

## Cost

Charged against the Google for Startups credit (valid to 2027-10-27). The rates below are estimates from public prices, not charges:

- the VM is about $3.80/h on demand while it runs; SPOT is lower;
- the disk costs about $16 a month even when the VM is stopped;
- a daily run plus the 10-minute idle tail is about 30 minutes of VM time.

A SPOT preemption stops the VM mid-run. The shards then fail, and the regression must be run again.

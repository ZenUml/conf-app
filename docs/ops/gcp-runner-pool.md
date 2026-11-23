# GCP runner pool for E2E shards

The org is on GitHub's free plan, which runs at most 20 GitHub-hosted jobs at once ([limits](https://docs.github.com/en/actions/reference/limits)). The daily regression needs more than that. Daily run 45072127650 (2026-11-22) had 91 jobs and spent 361 s at the cap. Some shards waited up to 536 s for a runner. Adding hosted shards only moves that wait to another variant. Self-hosted runners are outside that table, so the pool adds capacity beyond the 20 hosted jobs. GitHub's docs do not say this outright: it is inferred from the limits page.

The pool is the conf-app copy of the design diagramly.ai has run since 2026-10-30 (`diagramly.ai` `docs/testing/self-hosted-runner.md`).

```
job queued (runs-on: gcp-conf)
   │ workflow_job webhook (HMAC)
   ▼
Cloud Run functions conf-e2e-waker(-b) ── start VM + stamp ──► conf-ci-c4n48, conf-ci-c4n48-b
   ▲                                                                       ├ 24 runner services each (user gha)
Cloud Scheduler conf-e2e-waker-sweep (5 min): starts the VM                │   each shard = Playwright container
if a job was queued < 15 min ago                                           └ e2e-idle-stop.timer: off after 10 idle min
```

| Piece | Value |
|---|---|
| VMs | `conf-ci-c4n48` (`us-central1-a`) and `conf-ci-c4n48-b` (`us-central1-b`), `c4n-standard-48` SPOT, project `staging-zenuml-27954`, 200 GB Hyperdisk each |
| Runners | `/opt/gha/runner-1..24` on each VM, names `conf-ci-<n>` and `conf-ci-b-<n>`, label `gcp-conf` only (no default `self-hosted` label) |
| Job container | `mcr.microsoft.com/playwright:v1.59.1-noble`, pulled at setup |
| Waker | Cloud Run functions `conf-e2e-waker` and `conf-e2e-waker-b` (`australia-southeast1`), one per VM, service account `e2e-waker` (shared with diagramly, custom role `e2eWaker` on this VM only), secret `conf-gha-webhook-secret` |
| Webhooks | one repo `workflow_job` webhook per function URL |
| Scripts | `scripts/gcp-runner/` (`install.sh`, `setup.sh`, `waker-deploy.sh`, `idle-stop.sh`, `runner-job-hook.sh`, `waker/`) |

## Density

Run 45110223186 put 48 shards on one 48-vCPU VM. The CPU stayed at 91-99 % and the tests ran at about 2 minutes each. On hosted runners each shard has 4 vCPUs. A shard needs about 2 vCPU, so each VM runs 24 runners.

| Run | Runners on one VM | Result |
|---|---|---|
| 45107657015 | 48 | 24 of 56 shards failed: Docker ran out of address pools (fixed in `setup.sh`) |
| 45110223186 | 48 | CPU 91-99 %, test steps 700-1,340 s, 18 shards failed on timeouts |

## Which jobs use it

Only the `test` (shard) job of `e2e-test.yml`, and only when the caller passes `runner: gcp-conf`. Today that is the daily regression (`staging-transaction.yml`): Lite, Full and Diagramly run 16 shards each on the pool; AsyncAPI keeps 8 hosted shards. Every other job stays on GitHub-hosted runners.

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
bash scripts/gcp-runner/install.sh
GCP_RUNNER_VM=conf-ci-c4n48-b GCP_RUNNER_ZONE=us-central1-b RUNNER_PREFIX=conf-ci-b bash scripts/gcp-runner/install.sh
bash scripts/gcp-runner/waker-deploy.sh
GCP_RUNNER_VM=conf-ci-c4n48-b GCP_RUNNER_ZONE=us-central1-b GCP_WAKER_NAME=conf-e2e-waker-b bash scripts/gcp-runner/waker-deploy.sh
```

## Cost

Charged against the Google for Startups credit (valid to 2027-10-27). The rates below are estimates from public prices, not charges:

- the VM is about $3.80/h on demand while it runs; SPOT is lower;
- the disk costs about $16 a month even when the VM is stopped;
- a daily run plus the 10-minute idle tail is about 30 minutes of VM time.

A SPOT preemption stops the VM mid-run. The shards then fail, and the regression must be run again.

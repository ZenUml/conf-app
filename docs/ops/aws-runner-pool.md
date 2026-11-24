# AWS runner pool for E2E shards

The AWS copy of the [GCP runner pool](gcp-runner-pool.md), built on 2026-11-24 to spend the AWS Activate credit (AWS account `Diagramly`, $9,000, valid to 2028-11-30; EC2 is an eligible service). It serves the same jobs as the GCP pool: the `test` shards of `e2e-test.yml` in the daily regression. PR jobs never use it (see the GCP doc for why).

```
job queued (runs-on: aws-conf)
   │ workflow_job webhook (HMAC)
   ▼
Lambda conf-ci-waker (function URL, ap-southeast-2) ── start + tag gha-last-queued ──►  3 × m6i.8xlarge Spot
   ▲                                                                                      us-east-1, us-west-2, ap-southeast-2
EventBridge Scheduler conf-ci-waker-sweep (5 min): starts an instance                     ├ 16 runner services each (user gha)
if a job was queued < 15 min ago                                                          │   each shard = Playwright container
                                                                                          └ e2e-idle-stop.timer: power off (= stop) after 10 idle min
```

| Piece | Value |
|---|---|
| Instances | one `m6i.8xlarge` (32 vCPU, 128 GB) per region in `scripts/aws-runner/pool.sh`, persistent Spot with `InstanceInterruptionBehavior=stop`, shutdown behaviour `stop`, Ubuntu 24.04, 200 GB gp3, tag `conf-ci-pool=aws-conf` |
| Why three regions | the account's standard Spot quota is 32 vCPU per region (On-Demand 16), so one 32-vCPU instance per region is the most a region allows; three regions give the 48 runners the daily regression uses |
| Runners | `/opt/gha/runner-1..16` per instance, names `conf-aws-use1-<n>`, `conf-aws-usw2-<n>`, `conf-aws-apse2-<n>`, label `aws-conf` only |
| Access | no SSH and no inbound rules; scripts go over SSM Run Command (instance role `conf-ci-runner`: SSM core + read of `/conf-ci/runner-token`) |
| Metadata | IMDSv2 only, hop limit 1, instance tags in metadata; iptables drops 169.254.169.254 for job containers (`DOCKER-USER`) and for the `gha` user on the host (`OUTPUT`) |
| Waker | Lambda `conf-ci-waker` (`ap-southeast-2`, role `conf-ci-waker`: describe, start and tag only instances with the pool tag), secret `/conf-ci/gha-webhook-secret` (SSM SecureString) |
| Scripts | `scripts/aws-runner/` (`pool.sh`, `provision.sh`, `install.sh`, `setup.sh`, `idle-stop.sh`, `waker-deploy.sh`, `waker/`); the job hook is shared with `scripts/gcp-runner/runner-job-hook.sh` |

## Switch pools

```bash
gh variable set E2E_POOL_RUNNER --body aws -R ZenUml/conf-app     # AWS pool
gh variable delete E2E_POOL_RUNNER -R ZenUml/conf-app             # GCP pool (default)
gh variable set E2E_POOL_RUNNER --body hosted -R ZenUml/conf-app  # 8 hosted shards per variant
```

## Setup (idempotent)

Needs AWS credentials for the account (`aws login --profile diagramly-bedrock`) and `gh` as a repo admin.

```bash
bash scripts/aws-runner/provision.sh    # IAM, security groups, instances
bash scripts/aws-runner/install.sh      # runners (all regions; or pass one region)
bash scripts/aws-runner/waker-deploy.sh # Lambda, URL, sweep, webhook
```

`install.sh` puts a fresh registration token in an SSM SecureString for the run and deletes it afterwards. Package upgrades happen only when `setup.sh` runs (apt timers off, needrestart list-only, as on GCP).

## Teardown

A persistent Spot request relaunches a terminated instance. Cancel the request first:

```bash
aws ec2 describe-instances --region <r> --instance-ids <id> --query 'Reservations[0].Instances[0].SpotInstanceRequestId'
aws ec2 cancel-spot-instance-requests --region <r> --spot-instance-request-ids <sir-id>
aws ec2 terminate-instances --region <r> --instance-ids <id>
```

Then remove the runner registrations (`gh api repos/ZenUml/conf-app/actions/runners`), the webhook, the Lambda, the schedule and the roles.

## Cost

Charged against the Activate credit. Estimates from Spot prices on 2026-11-24, not charges:

- `m6i.8xlarge` Spot: about $0.37 (us-east-1), $0.52 (us-west-2) and $0.86 (ap-southeast-2) an hour while running, about $1.75/h for the pool;
- 3 × 200 GB gp3: about $50 a month in all, even when stopped;
- a daily run plus the 10-minute idle tail is about 30 minutes of instance time.

A Spot interruption stops an instance mid-run; its shards fail and the regression must be run again. The waker starts it again when capacity returns.

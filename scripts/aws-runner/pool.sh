# Sourced by the scripts in scripts/aws-runner. One line per instance: region, instance
# type, runner-name prefix. Each instance is a persistent Spot instance with 32 vCPU, the
# whole standard Spot vCPU quota of its region on the Diagramly AWS account (2026-11-24:
# 32 Spot, 16 On-Demand per region). 16 runners per instance = 2 vCPU and 8 GB per shard,
# the density the GCP pool settled on (docs/ops/gcp-runner-pool.md#density).
# Docs: docs/ops/aws-runner-pool.md
AWS_PROFILE=${AWS_PROFILE:-diagramly-bedrock}
export AWS_PROFILE
POOL_LABEL=aws-conf
POOL_TAG=conf-ci-pool
TOKEN_PARAM=/conf-ci/runner-token
WEBHOOK_SECRET_PARAM=/conf-ci/gha-webhook-secret
INSTANCE_ROLE=conf-ci-runner
WAKER_REGION=${WAKER_REGION:-ap-southeast-2}
WAKER_NAME=conf-ci-waker
REPO=${GITHUB_REPO:-ZenUml/conf-app}
RUNNERS_PER_INSTANCE=${RUNNERS:-16}
POOL_INSTANCES=(
	"us-east-1 m6i.8xlarge conf-aws-use1"
	"us-west-2 m6i.8xlarge conf-aws-usw2"
	"ap-southeast-2 m6i.8xlarge conf-aws-apse2"
)

# Instance ID of the pool instance in a region (empty if none). Terminated ones are ignored.
pool_instance_id() {
	aws ec2 describe-instances --region "$1" \
		--filters "Name=tag:$POOL_TAG,Values=$POOL_LABEL" \
		"Name=instance-state-name,Values=pending,running,stopping,stopped" \
		--query 'Reservations[].Instances[].InstanceId' --output text
}

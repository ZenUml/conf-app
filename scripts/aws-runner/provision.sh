#!/usr/bin/env bash
# Create the AWS pieces the runner pool needs, once (idempotent; existing pieces are kept):
#   bash scripts/aws-runner/provision.sh
# - IAM role + instance profile conf-ci-runner: SSM agent access, and read access to the one
#   registration-token parameter. Nothing else, so a job that escaped its container still
#   holds no useful AWS permission (and the gha user cannot reach IMDS anyway, setup.sh).
# - per region in pool.sh: security group conf-ci-runner (no inbound rules; SSM needs none),
#   and one persistent Spot instance, Ubuntu 24.04, 200 GB gp3, IMDSv2 only with hop limit 1
#   and instance tags in metadata, shutdown behaviour `stop`.
# Then run install.sh (runners) and waker-deploy.sh (start on demand).
# Docs: docs/ops/aws-runner-pool.md
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=pool.sh
. "$HERE/pool.sh"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

if ! aws iam get-role --role-name "$INSTANCE_ROLE" >/dev/null 2>&1; then
	aws iam create-role --role-name "$INSTANCE_ROLE" --description "conf-app CI runner pool instances" \
		--assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
	echo "role $INSTANCE_ROLE created"
fi
aws iam attach-role-policy --role-name "$INSTANCE_ROLE" \
	--policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam put-role-policy --role-name "$INSTANCE_ROLE" --policy-name read-runner-token \
	--policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"ssm:GetParameter\",\"Resource\":\"arn:aws:ssm:*:$ACCOUNT:parameter$TOKEN_PARAM\"}]}"
if ! aws iam get-instance-profile --instance-profile-name "$INSTANCE_ROLE" >/dev/null 2>&1; then
	aws iam create-instance-profile --instance-profile-name "$INSTANCE_ROLE" >/dev/null
	aws iam add-role-to-instance-profile --instance-profile-name "$INSTANCE_ROLE" --role-name "$INSTANCE_ROLE"
	echo "instance profile $INSTANCE_ROLE created; waiting for IAM to propagate"
	sleep 15
fi

for entry in "${POOL_INSTANCES[@]}"; do
	read -r region type prefix <<<"$entry"
	id=$(pool_instance_id "$region")
	if [ -n "$id" ]; then
		echo "$region: $id already exists"
		continue
	fi
	vpc=$(aws ec2 describe-vpcs --region "$region" --filters Name=is-default,Values=true \
		--query 'Vpcs[0].VpcId' --output text)
	sg=$(aws ec2 describe-security-groups --region "$region" \
		--filters "Name=group-name,Values=$INSTANCE_ROLE" "Name=vpc-id,Values=$vpc" \
		--query 'SecurityGroups[0].GroupId' --output text)
	if [ "$sg" = None ]; then
		sg=$(aws ec2 create-security-group --region "$region" --vpc-id "$vpc" --group-name "$INSTANCE_ROLE" \
			--description "conf-app CI runners: no inbound" --query GroupId --output text)
	fi
	ami=$(aws ssm get-parameter --region "$region" \
		--name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
		--query Parameter.Value --output text)
	# Try each subnet (one per AZ), cheapest Spot AZ first: a zone can be out of Spot capacity.
	subnets=$(aws ec2 describe-spot-price-history --region "$region" --instance-types "$type" \
		--product-descriptions Linux/UNIX --start-time "$(date -u +%Y-%m-%dT%H:%M:%S)" \
		--query 'SpotPriceHistory[].[SpotPrice,AvailabilityZone]' --output text | sort -n | awk '!seen[$2]++' |
		while read -r _ az; do
			aws ec2 describe-subnets --region "$region" \
				--filters "Name=vpc-id,Values=$vpc" "Name=availability-zone,Values=$az" "Name=default-for-az,Values=true" \
				--query 'Subnets[0].SubnetId' --output text
		done | grep -v None)
	for subnet in $subnets; do
		if id=$(aws ec2 run-instances --region "$region" --image-id "$ami" --instance-type "$type" \
			--subnet-id "$subnet" --security-group-ids "$sg" --associate-public-ip-address \
			--iam-instance-profile "Name=$INSTANCE_ROLE" \
			--instance-market-options 'MarketType=spot,SpotOptions={SpotInstanceType=persistent,InstanceInterruptionBehavior=stop}' \
			--instance-initiated-shutdown-behavior stop \
			--metadata-options HttpTokens=required,HttpPutResponseHopLimit=1,InstanceMetadataTags=enabled \
			--block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=200,VolumeType=gp3,DeleteOnTermination=true}' \
			--tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$prefix},{Key=$POOL_TAG,Value=$POOL_LABEL},{Key=runner-prefix,Value=$prefix}]" \
			"ResourceType=volume,Tags=[{Key=Name,Value=$prefix},{Key=$POOL_TAG,Value=$POOL_LABEL}]" \
			--query 'Instances[0].InstanceId' --output text 2>"${TMPDIR:-/tmp}/run-$region.err"); then
			echo "$region: launched $id ($type, $subnet)"
			break
		fi
		echo "$region: $subnet failed: $(tail -1 "${TMPDIR:-/tmp}/run-$region.err")"
		id=""
	done
	[ -n "$id" ] || { echo "$region: no subnet had capacity" >&2; exit 1; }
done

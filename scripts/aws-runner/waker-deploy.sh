#!/usr/bin/env bash
# Deploy (or redeploy) conf-ci-waker: a Lambda that starts the pool instances when GitHub
# queues an `aws-conf` job, its public function URL, a 5-minute EventBridge sweep, and the
# repo's workflow_job webhook. Idempotent; run from a laptop:
#   bash scripts/aws-runner/waker-deploy.sh
# The AWS copy of scripts/gcp-runner/waker-deploy.sh. Docs: docs/ops/aws-runner-pool.md
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=pool.sh
. "$HERE/pool.sh"
R=$WAKER_REGION
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGIONS=$(for e in "${POOL_INSTANCES[@]}"; do echo "${e%% *}"; done | paste -sd, -)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Webhook secret: generated once, kept in SSM, read by the Lambda at cold start.
if ! aws ssm get-parameter --region "$R" --name "$WEBHOOK_SECRET_PARAM" >/dev/null 2>&1; then
	(umask 077 && openssl rand -hex 32 | tr -d '\n' |
		jq -Rn --arg n "$WEBHOOK_SECRET_PARAM" 'input as $s | {Name: $n, Value: $s, Type: "SecureString"}' >"$tmp/secret.json")
	aws ssm put-parameter --region "$R" --cli-input-json "file://$tmp/secret.json" >/dev/null
	rm -f "$tmp/secret.json"
	echo "webhook secret created"
fi

ensure_role() { # name, service principal
	aws iam get-role --role-name "$1" >/dev/null 2>&1 ||
		aws iam create-role --role-name "$1" --assume-role-policy-document \
			"{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"$2\"},\"Action\":\"sts:AssumeRole\"}]}" >/dev/null
}
ensure_role "$WAKER_NAME" lambda.amazonaws.com
aws iam attach-role-policy --role-name "$WAKER_NAME" \
	--policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
# Start and tag only instances that carry the pool tag.
aws iam put-role-policy --role-name "$WAKER_NAME" --policy-name wake-pool --policy-document "$(jq -n \
	--arg inst "arn:aws:ec2:*:$ACCOUNT:instance/*" --arg tag "$POOL_TAG" --arg lbl "$POOL_LABEL" \
	--arg param "arn:aws:ssm:$R:$ACCOUNT:parameter$WEBHOOK_SECRET_PARAM" '{Version: "2012-10-17", Statement: [
		{Effect: "Allow", Action: "ec2:DescribeInstances", Resource: "*"},
		{Effect: "Allow", Action: ["ec2:StartInstances", "ec2:CreateTags"], Resource: $inst,
			Condition: {StringEquals: {("aws:ResourceTag/" + $tag): $lbl}}},
		{Effect: "Allow", Action: "ssm:GetParameter", Resource: $param}]}')"
ROLE_ARN=$(aws iam get-role --role-name "$WAKER_NAME" --query Role.Arn --output text)

(cd "$HERE/waker" && zip -q -j "$tmp/waker.zip" index.mjs)
jq -n --arg regions "$REGIONS" --arg lbl "$POOL_LABEL" --arg tag "$POOL_TAG" --arg p "$WEBHOOK_SECRET_PARAM" \
	'{Variables: {RUNNER_LABEL: $lbl, POOL_TAG: $tag, POOL_REGIONS: $regions, WEBHOOK_SECRET_PARAM: $p}}' >"$tmp/env.json"
if aws lambda get-function --region "$R" --function-name "$WAKER_NAME" >/dev/null 2>&1; then
	aws lambda update-function-code --region "$R" --function-name "$WAKER_NAME" \
		--zip-file "fileb://$tmp/waker.zip" >/dev/null
	aws lambda wait function-updated-v2 --region "$R" --function-name "$WAKER_NAME"
	aws lambda update-function-configuration --region "$R" --function-name "$WAKER_NAME" \
		--environment "file://$tmp/env.json" >/dev/null
else
	# A new role takes a few seconds before Lambda may assume it.
	for _ in 1 2 3 4 5 6; do
		aws lambda create-function --region "$R" --function-name "$WAKER_NAME" --runtime nodejs22.x \
			--handler index.handler --role "$ROLE_ARN" --zip-file "fileb://$tmp/waker.zip" \
			--timeout 10 --memory-size 256 --environment "file://$tmp/env.json" >/dev/null && break
		sleep 10
	done
fi
aws lambda wait function-updated-v2 --region "$R" --function-name "$WAKER_NAME"
FN_ARN=$(aws lambda get-function --region "$R" --function-name "$WAKER_NAME" --query Configuration.FunctionArn --output text)

# Public URL: GitHub cannot sign AWS requests; the handler checks the webhook HMAC instead.
URL=$(aws lambda get-function-url-config --region "$R" --function-name "$WAKER_NAME" --query FunctionUrl --output text 2>/dev/null ||
	aws lambda create-function-url-config --region "$R" --function-name "$WAKER_NAME" --auth-type NONE --query FunctionUrl --output text)
aws lambda add-permission --region "$R" --function-name "$WAKER_NAME" --statement-id public-url \
	--action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE >/dev/null 2>&1 || true
aws lambda add-permission --region "$R" --function-name "$WAKER_NAME" --statement-id public-url-invoke \
	--action lambda:InvokeFunction --principal '*' --invoked-via-function-url >/dev/null 2>&1 || true

# Sweep: EventBridge Scheduler invokes the function directly, every 5 minutes.
ensure_role "$WAKER_NAME-scheduler" scheduler.amazonaws.com
aws iam put-role-policy --role-name "$WAKER_NAME-scheduler" --policy-name invoke-waker \
	--policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"lambda:InvokeFunction\",\"Resource\":\"$FN_ARN\"}]}"
SCHED_ROLE=$(aws iam get-role --role-name "$WAKER_NAME-scheduler" --query Role.Arn --output text)
jq -n --arg arn "$FN_ARN" --arg role "$SCHED_ROLE" '{Arn: $arn, RoleArn: $role, Input: "{\"sweep\":true}"}' >"$tmp/target.json"
if aws scheduler get-schedule --region "$R" --name "$WAKER_NAME-sweep" >/dev/null 2>&1; then verb=update; else verb=create; fi
for _ in 1 2 3 4 5 6; do
	aws scheduler "$verb-schedule" --region "$R" --name "$WAKER_NAME-sweep" \
		--schedule-expression 'rate(5 minutes)' --flexible-time-window Mode=OFF \
		--target "file://$tmp/target.json" >/dev/null && break
	sleep 10
done

HOOK_ID=$(gh api "repos/$REPO/hooks" --jq ".[] | select(.config.url == \"$URL\") | .id")
if [ -z "$HOOK_ID" ]; then
	# The secret goes to GitHub over stdin, never on a command line.
	aws ssm get-parameter --region "$R" --name "$WEBHOOK_SECRET_PARAM" --with-decryption \
		--query Parameter.Value --output text |
		jq -Rn --arg url "$URL" 'input as $s | {name: "web", active: true, events: ["workflow_job"],
			config: {url: $url, content_type: "json", insecure_ssl: "0", secret: $s}}' |
		gh api -X POST "repos/$REPO/hooks" --input - --jq '"webhook \(.id) created"'
else
	echo "webhook $HOOK_ID already points at $URL"
fi
echo "$WAKER_NAME: $URL"

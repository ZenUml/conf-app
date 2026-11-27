#!/usr/bin/env bash
# Install or update the runners on every pool instance, from a laptop:
#   bash scripts/aws-runner/install.sh            # all regions in pool.sh
#   bash scripts/aws-runner/install.sh us-west-2  # one region
# Needs AWS credentials for the pool account (profile in pool.sh) and `gh` logged in as a
# repo admin. No SSH: the scripts go over SSM Run Command. The registration token (valid for
# one hour) is put in an SSM SecureString for the run and deleted afterwards, so it is never
# on a command line or in the Run Command history.
# Docs: docs/ops/aws-runner-pool.md
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=pool.sh
. "$HERE/pool.sh"
ONLY=${1:-}

# The scripts setup.sh needs, as one shell snippet that recreates them on the instance.
payload() {
	local f
	echo 'set -e; d=/opt/conf-ci-setup; mkdir -p $d'
	for f in "$HERE/setup.sh" "$HERE/idle-stop.sh" "$HERE/../gcp-runner/runner-job-hook.sh"; do
		echo "echo $(base64 <"$f" | tr -d '\n') | base64 -d > \$d/$(basename "$f")"
	done
}

for entry in "${POOL_INSTANCES[@]}"; do
	read -r region _ prefix <<<"$entry"
	[ -z "$ONLY" ] || [ "$ONLY" = "$region" ] || continue
	id=$(pool_instance_id "$region")
	[ -n "$id" ] || { echo "$region: no pool instance; run provision.sh" >&2; exit 1; }

	state=$(aws ec2 describe-instances --region "$region" --instance-ids "$id" \
		--query 'Reservations[0].Instances[0].State.Name' --output text)
	if [ "$state" = stopped ]; then
		aws ec2 start-instances --region "$region" --instance-ids "$id" >/dev/null
	fi
	aws ec2 wait instance-running --region "$region" --instance-ids "$id"
	for _ in $(seq 60); do
		ping=$(aws ssm describe-instance-information --region "$region" \
			--filters "Key=InstanceIds,Values=$id" --query 'InstanceInformationList[0].PingStatus' --output text)
		[ "$ping" = Online ] && break
		sleep 5
	done
	[ "$ping" = Online ] || { echo "$region: SSM agent on $id not online" >&2; exit 1; }

	# The token goes through a 0600 temp file, never argv (the aws CLI does not read /dev/stdin).
	tmp=$(mktemp -d)
	trap 'rm -rf "$tmp"; aws ssm delete-parameter --region "$region" --name "$TOKEN_PARAM" 2>/dev/null || true' EXIT
	(umask 077 && gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token |
		jq -Rn --arg name "$TOKEN_PARAM" 'input as $t | {Name: $name, Value: $t, Type: "SecureString", Overwrite: true}' >"$tmp/param.json")
	aws ssm put-parameter --region "$region" --cli-input-json "file://$tmp/param.json" >/dev/null
	rm -f "$tmp/param.json"

	commands=$(
		payload
		echo "cd /opt/conf-ci-setup && TOKEN_PARAM=$TOKEN_PARAM AWS_REGION=$region RUNNERS=$RUNNERS_PER_INSTANCE RUNNER_PREFIX=$prefix bash setup.sh"
	)
	jq -n --arg c "$commands" '{commands: [$c], executionTimeout: ["3600"]}' >"$tmp/cmd.json"
	cmd=$(aws ssm send-command --region "$region" --instance-ids "$id" --document-name AWS-RunShellScript \
			--comment "conf-ci runner setup" --timeout-seconds 600 --parameters "file://$tmp/cmd.json" \
			--query Command.CommandId --output text)
	echo "$region: setup running on $id (command $cmd)"
	while :; do
		status=$(aws ssm get-command-invocation --region "$region" --command-id "$cmd" --instance-id "$id" \
			--query Status --output text 2>/dev/null || echo Pending)
		case "$status" in Pending | InProgress | Delayed) sleep 15 ;; *) break ;; esac
	done
	aws ssm get-command-invocation --region "$region" --command-id "$cmd" --instance-id "$id" \
		--query '[StandardOutputContent,StandardErrorContent]' --output text | tail -5
	aws ssm delete-parameter --region "$region" --name "$TOKEN_PARAM"
	rm -rf "$tmp"
	trap - EXIT
	echo "$region: $status"
	[ "$status" = Success ] || exit 1
done

gh api --paginate "repos/$REPO/actions/runners" \
	--jq ".runners[] | select(.labels | any(.name == \"$POOL_LABEL\")) | \"\(.name) \(.status)\"" |
	awk '{split($1,a,"-"); p=a[1]"-"a[2]"-"a[3]; c[p" "$2]++} END {for (k in c) print c[k], k}' | sort

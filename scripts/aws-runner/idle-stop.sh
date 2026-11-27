#!/usr/bin/env bash
# Runs on the EC2 instance from e2e-idle-stop.timer (as root). Powers the instance off when
# nothing has happened for IDLE_MINUTES. The instance is launched with
# --instance-initiated-shutdown-behavior stop and a persistent Spot request with
# InstanceInterruptionBehavior=stop, so power-off means `stopped` (compute billing stops,
# the EBS volume stays) and the waker can start it again.
#
# "Something happened" = a job is running (a dir in $E2E_ROOT/active whose PID is alive),
# someone is logged in, $E2E_ROOT/last-activity was touched recently, or the waker tagged
# the instance `gha-last-queued` in the last 15 minutes. Copy of scripts/gcp-runner/idle-stop.sh
# with the tag read from IMDSv2 (instance metadata tags enabled) instead of GCE metadata.
set -euo pipefail

E2E_ROOT=${E2E_ROOT:-/srv/e2e}
IDLE_MINUTES=${IDLE_MINUTES:-30}

for d in "$E2E_ROOT"/active/*; do
	[ -e "$d" ] || continue
	pid=$(cat "$d/pid" 2>/dev/null || true)
	if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
		touch "$E2E_ROOT/last-activity"
		exit 0
	fi
	rm -rf "$d" # stale lock from a killed run
done

if [ -n "$(who)" ]; then
	touch "$E2E_ROOT/last-activity"
	exit 0
fi

# A job for this pool was queued in the last 15 minutes (the waker tags the instance).
# Stay up so it is picked up; powering off now would leave it queued.
imds_token=$(curl -fs -m 5 -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' \
	http://169.254.169.254/latest/api/token || true)
queued=$(curl -fs -m 5 -H "X-aws-ec2-metadata-token: $imds_token" \
	http://169.254.169.254/latest/meta-data/tags/instance/gha-last-queued || echo 0)
case "$queued" in '' | *[!0-9]*) queued=0 ;; esac
if [ $(($(date +%s) - queued)) -lt 900 ]; then
	exit 0
fi

last=$(stat -c %Y "$E2E_ROOT/last-activity" 2>/dev/null || echo 0)
idle=$(($(date +%s) - last))
if [ "$idle" -ge $((IDLE_MINUTES * 60)) ]; then
	logger -t e2e-idle-stop "idle ${idle}s >= ${IDLE_MINUTES}m, powering off"
	systemctl poweroff
fi

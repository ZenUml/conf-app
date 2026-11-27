#!/usr/bin/env bash
# Runs on the VM from e2e-idle-stop.timer. Powers the VM off (GCE: instance -> TERMINATED,
# compute billing stops; the disk stays) when nothing has happened for IDLE_MINUTES.
#
# "Something happened" = a run is active (a dir in $E2E_ROOT/active whose PID is alive),
# someone is logged in over SSH, or $E2E_ROOT/last-activity was touched recently.
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

# A GitHub Actions job was queued for this VM's runners in the last 15 minutes (e2e-waker
# stamps the instance metadata; docs/testing/self-hosted-runner.md). Stay up so it is
# picked up; powering off now would leave it queued.
queued=$(curl -fs -m 5 -H 'Metadata-Flavor: Google' \
	http://metadata.google.internal/computeMetadata/v1/instance/attributes/gha-last-queued || echo 0)
if [ $(($(date +%s) - queued)) -lt 900 ]; then
	exit 0
fi

last=$(stat -c %Y "$E2E_ROOT/last-activity" 2>/dev/null || echo 0)
idle=$(($(date +%s) - last))
if [ "$idle" -ge $((IDLE_MINUTES * 60)) ]; then
	logger -t e2e-idle-stop "idle ${idle}s >= ${IDLE_MINUTES}m, powering off"
	systemctl poweroff
fi

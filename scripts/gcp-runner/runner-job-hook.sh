#!/usr/bin/env bash
# GitHub Actions runner job hook on the E2E VM, installed by runner-setup.sh as
#   /usr/local/bin/gha-job-started.sh    (ACTIONS_RUNNER_HOOK_JOB_STARTED)
#   /usr/local/bin/gha-job-completed.sh  (ACTIONS_RUNNER_HOOK_JOB_COMPLETED)
# Runs as the runner user (gha) before and after every job.
#
# 1. Keeps the VM up while a job runs. idle-stop.sh treats /srv/e2e/active/<id>/pid with a
#    live PID as "busy" (the same lock remote-run.sh uses), so the started hook writes the
#    job's Runner.Worker PID there. Runner.Worker exists only while a job runs; the
#    always-on Runner.Listener would pin the VM on forever.
# 2. Gives the runner's _work/_temp back to gha. Jobs run in containers as root, so they
#    leave root-owned files in the bind-mounted workspace, and the next job's cleanup of
#    them fails with "Permission denied". gha is in the docker group, so a throwaway
#    container can chown them without sudo.
set -euo pipefail

E2E_ROOT=${E2E_ROOT:-/srv/e2e}

# Walk up from this hook to the Runner.Worker that is running it.
worker_pid() {
	local pid=$$
	while [ "$pid" -gt 1 ]; do
		[ "$(cat "/proc/$pid/comm" 2>/dev/null)" = Runner.Worker ] && { echo "$pid"; return 0; }
		pid=$(awk '{print $4}' "/proc/$pid/stat")
	done
	return 1
}

WORKER=$(worker_pid) || { echo "gha hook: no Runner.Worker ancestor" >&2; exit 0; }
# /opt/gha/runner-N/bin/Runner.Worker -> /opt/gha/runner-N
RUNNER_DIR=$(dirname "$(dirname "$(readlink -f "/proc/$WORKER/exe")")")
LOCK="$E2E_ROOT/active/gha-$(basename "$RUNNER_DIR")"

# Only _temp: it is the one directory the runner itself (as gha) empties between jobs. The
# checkout, node_modules and the pnpm store under _work are only ever touched from inside
# job containers (as root), so they may stay root-owned. A chown -R of the whole tree took
# 88s per hook (run 41052658467), more than the shard's tests.
if [ -d "$RUNNER_DIR/_work/_temp" ]; then
	docker run --rm -v "$RUNNER_DIR/_work/_temp:/w" busybox:1.36 chown -R "$(id -u):$(id -g)" /w ||
		echo "gha hook: chown of $RUNNER_DIR/_work/_temp failed" >&2
fi

case "$(basename "$0")" in
gha-job-started.sh)
	mkdir -p "$LOCK"
	echo "$WORKER" >"$LOCK/pid"
	echo "gha hook: VM marked busy ($LOCK, Runner.Worker $WORKER)"
	;;
gha-job-completed.sh)
	rm -rf "$LOCK"
	# Start the idle clock at the end of the job, not at idle-stop's last 5-minute tick.
	touch "$E2E_ROOT/last-activity" 2>/dev/null || true
	;;
*)
	echo "gha hook: unknown name $0" >&2
	exit 1
	;;
esac

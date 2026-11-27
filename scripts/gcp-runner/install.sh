#!/usr/bin/env bash
# Install or update the conf-app runner pool on the GCP VM, from a laptop:
#   bash scripts/gcp-runner/install.sh
# RUNNERS=<n> (default 24, about 2 vCPU per shard; 48 saturated the CPU in run 45110223186)
# sets the runner count; raising it adds runners, lowering it does not remove registrations.
# Second VM:
#   GCP_RUNNER_VM=conf-ci-c4n48-b GCP_RUNNER_ZONE=us-central1-b RUNNER_PREFIX=conf-ci-b bash scripts/gcp-runner/install.sh
# Needs gcloud access to the project and `gh` logged in as a repo admin (the registration token is minted for this run and expires in an hour).
# Docs: docs/ops/gcp-runner-pool.md
set -euo pipefail

PROJECT=${GCP_PROJECT:-staging-zenuml-27954}
VM=${GCP_RUNNER_VM:-conf-ci-c4n48}
ZONE=${GCP_RUNNER_ZONE:-us-central1-a}
REPO=${GITHUB_REPO:-ZenUml/conf-app}
HERE=$(cd "$(dirname "$0")" && pwd)
gc() { gcloud --project="$PROJECT" --quiet "$@"; }

[ "$(gc compute instances describe "$VM" --zone="$ZONE" --format='value(status)')" = RUNNING ] ||
	gc compute instances start "$VM" --zone="$ZONE" >/dev/null
gc compute ssh "$VM" --zone="$ZONE" --command='mkdir -p ~/gcp-runner' >/dev/null
gc compute scp --zone="$ZONE" "$HERE/setup.sh" "$HERE/idle-stop.sh" "$HERE/runner-job-hook.sh" "$VM:gcp-runner/" >/dev/null
TOKEN=$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token)
# The token goes over SSH stdin, never on a command line.
printf '%s\n' "RUNNER_TOKEN=$(printf %q "$TOKEN")" "RUNNERS=$(printf %q "${RUNNERS:-24}")" \
	"RUNNER_PREFIX=$(printf %q "${RUNNER_PREFIX:-conf-ci}")" |
	gc compute ssh "$VM" --zone="$ZONE" \
		--command='for _ in 1 2 3; do read -r line; eval "export $line"; done; bash ~/gcp-runner/setup.sh'
gh api --paginate "repos/$REPO/actions/runners" --jq '.runners[] | select(.labels | any(.name == "gcp-conf")) | "\(.name) \(.status)"' | sort -V | uniq -c -f1 | head -3

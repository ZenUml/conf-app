#!/usr/bin/env bash
# Idempotent setup of the conf-app E2E runner pool on the GCP VM. install.sh copies this
# directory to the VM and runs it with a fresh registration token on stdin-fed env:
#   RUNNER_TOKEN=<token> RUNNERS=<n> bash setup.sh
#
# Adapted from diagramly.ai scripts/gcp-e2e (runner-setup.sh, vm-setup.sh), which run the
# same design in production. Docs: docs/ops/gcp-runner-pool.md
#
# Installs Docker, a `gha` user (docker group, no sudo), $RUNNERS repo-scoped runners with
# ONLY the label `gcp-conf` (no default `self-hosted` label, so no other workflow lands
# here), job hooks that keep the VM up while a job runs, an idle power-off timer, an hourly
# Docker prune, and an iptables rule that keeps job containers away from the metadata
# server (the VM service account token).
set -euo pipefail

: "${RUNNER_TOKEN:?RUNNER_TOKEN (repo registration token) is required}"
REPO_URL=${REPO_URL:-https://github.com/ZenUml/conf-app}
RUNNER_VERSION=${RUNNER_VERSION:-2.338.2}
RUNNERS=${RUNNERS:-48}
LABELS=${RUNNER_LABELS:-gcp-conf}
PREFIX=${RUNNER_PREFIX:-conf-ci}
IDLE_MINUTES=${IDLE_MINUTES:-10}
PLAYWRIGHT_IMAGE=${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.59.1-noble}
GHA_ROOT=/opt/gha
E2E_ROOT=/srv/e2e
HERE=$(cd "$(dirname "$0")" && pwd)

sudo apt-get update -y
sudo apt-get install -y docker.io jq curl
# Every container job creates its own bridge network. Docker's default pools hold about 31
# networks, so with 48 runners busy the rest failed with "all predefined address pools have
# been fully subnetted" (run 45107657015: 24 of 56 shards). 10.200.0.0/16 cut into /24s
# gives 256 networks.
POOLS='{"default-address-pools":[{"base":"10.200.0.0/16","size":24}]}'
if [ "$(sudo jq -c '."default-address-pools"' /etc/docker/daemon.json 2>/dev/null)" != "$(jq -c '."default-address-pools"' <<<"$POOLS")" ]; then
	sudo mkdir -p /etc/docker
	echo "$POOLS" | sudo tee /etc/docker/daemon.json >/dev/null
	# Restarting Docker kills running job containers; this branch runs only when the file changes.
	sudo systemctl restart docker
fi
sudo systemctl enable --now docker

id gha >/dev/null 2>&1 || sudo useradd --create-home --shell /bin/bash gha
sudo usermod -aG docker gha

# Busy locks (job hooks) and the idle clock, read by idle-stop.sh.
sudo mkdir -p "$E2E_ROOT/active"
sudo chmod 1777 "$E2E_ROOT/active"
sudo touch "$E2E_ROOT/last-activity"
sudo chmod 666 "$E2E_ROOT/last-activity"

sudo install -m 0755 "$HERE/idle-stop.sh" /usr/local/bin/e2e-idle-stop
sudo tee /etc/systemd/system/e2e-idle-stop.service >/dev/null <<EOF
[Unit]
Description=Power off the CI VM when idle

[Service]
Type=oneshot
Environment=E2E_ROOT=$E2E_ROOT
Environment=IDLE_MINUTES=$IDLE_MINUTES
ExecStart=/usr/local/bin/e2e-idle-stop
EOF
sudo tee /etc/systemd/system/e2e-idle-stop.timer >/dev/null <<'EOF'
[Unit]
Description=Check every 5 minutes whether the CI VM is idle

[Timer]
OnBootSec=10min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
EOF

sudo install -m 0755 "$HERE/runner-job-hook.sh" /usr/local/bin/gha-job-hook
sudo ln -sf /usr/local/bin/gha-job-hook /usr/local/bin/gha-job-started.sh
sudo ln -sf /usr/local/bin/gha-job-hook /usr/local/bin/gha-job-completed.sh
sudo docker pull -q busybox:1.36 >/dev/null
# Pulled once here, so 48 shards do not each pull ~2 GB at job start.
sudo docker pull -q "$PLAYWRIGHT_IMAGE" >/dev/null

TARBALL="$GHA_ROOT/actions-runner-linux-x64-$RUNNER_VERSION.tar.gz"
sudo mkdir -p "$GHA_ROOT"
sudo chown gha:gha "$GHA_ROOT"
if [ ! -f "$TARBALL" ]; then
	sudo -u gha curl -fsSL -o "$TARBALL" \
		"https://github.com/actions/runner/releases/download/v$RUNNER_VERSION/actions-runner-linux-x64-$RUNNER_VERSION.tar.gz"
fi

for n in $(seq 1 "$RUNNERS"); do
	dir="$GHA_ROOT/runner-$n"
	if [ ! -f "$dir/.runner" ]; then
		sudo -u gha mkdir -p "$dir"
		sudo -u gha tar -xzf "$TARBALL" -C "$dir"
		sudo -u gha bash -c "cd '$dir' && ./config.sh --unattended --replace \
			--url '$REPO_URL' --token '$RUNNER_TOKEN' \
			--name '$PREFIX-$n' --labels '$LABELS' --no-default-labels --work _work" >/dev/null
	fi
	# The runner accepts a hook path only if it ends in .sh, .ps1 or .js.
	before=$(sudo cat "$dir/.env" 2>/dev/null || true)
	sudo -u gha sed -i '/^ACTIONS_RUNNER_HOOK_JOB_/d' "$dir/.env"
	printf '%s\n' ACTIONS_RUNNER_HOOK_JOB_STARTED=/usr/local/bin/gha-job-started.sh \
		ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/usr/local/bin/gha-job-completed.sh |
		sudo -u gha tee -a "$dir/.env" >/dev/null
	(
		cd "$dir"
		[ -f .service ] || sudo ./svc.sh install gha >/dev/null
		# Restart only when .env changed: a restart kills the job the runner is running.
		if [ "$before" != "$(sudo cat .env)" ] || ! systemctl is-active -q "$(cat .service)"; then
			sudo ./svc.sh stop >/dev/null 2>&1 || true
			sudo ./svc.sh start >/dev/null
		fi
	)
done

sudo "$GHA_ROOT/runner-1/bin/installdependencies.sh" >/dev/null

# Stopped containers, dangling images and anonymous volumes pile up on the persistent disk.
# Not `image prune --all`: it would delete the Playwright image the shards rely on.
sudo tee /etc/systemd/system/gha-docker-prune.service >/dev/null <<'EOF'
[Unit]
Description=Prune stopped containers, dangling images and unused anonymous volumes
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/docker container prune --force --filter until=24h
ExecStart=/usr/bin/docker volume prune --force
ExecStart=/usr/bin/docker image prune --force
EOF
sudo tee /etc/systemd/system/gha-docker-prune.timer >/dev/null <<'EOF'
[Unit]
Description=Docker prune for the CI runners

[Timer]
OnBootSec=15min
OnUnitActiveSec=1h

[Install]
WantedBy=timers.target
EOF
# Job containers run with the repo's secrets; keep them away from the GCE metadata server.
# TCP only and not port 53: 169.254.169.254 is also the VM's DNS server.
sudo tee /etc/systemd/system/gha-block-metadata.service >/dev/null <<'EOF'
[Unit]
Description=Block the GCE metadata server from Docker containers
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'iptables -C DOCKER-USER -d 169.254.169.254 -p tcp ! --dport 53 -j DROP 2>/dev/null || iptables -I DOCKER-USER -d 169.254.169.254 -p tcp ! --dport 53 -j DROP'

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now e2e-idle-stop.timer
sudo systemctl enable --now gha-docker-prune.timer
sudo systemctl restart gha-docker-prune.timer
sudo systemctl enable gha-block-metadata.service
sudo systemctl restart gha-block-metadata.service

echo "runners active: $(systemctl list-units --no-legend 'actions.runner.*' | grep -c running)"
echo "setup done: $(docker --version)"

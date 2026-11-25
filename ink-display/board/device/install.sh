#!/bin/sh
# Install (or remove) the reMarkable board on the tablet. Run on the Mac.
# Usage: install.sh [host]          default: the ssh alias "remarkable" from ~/.ssh/config
#        install.sh --uninstall [host]
# Logs in with the key ~/.ssh/remarkable_ed25519 (no password). The URL (it holds the token) is built from
# ~/.local/share/remarkable-board/config.json and the Mac's current Wi-Fi IP, and is never printed.
set -eu
umask 077
HERE=$(cd "$(dirname "$0")" && pwd)
UNINSTALL=0
if [ "${1:-}" = "--uninstall" ]; then UNINSTALL=1; shift; fi
if [ -n "${1:-}" ]; then
	HOST="root@$1"
	OPTS="-i $HOME/.ssh/remarkable_ed25519 -o IdentitiesOnly=yes -o UserKnownHostsFile=$HOME/.ssh/remarkable-dashboard-known-hosts -o HostKeyAlias=10.11.99.1 -o StrictHostKeyChecking=yes -o ConnectTimeout=10"
else
	HOST=remarkable
	OPTS=""
fi
RT=/home/root/.local/share/remarkable-dashboard-runtime
SOCKET=$(mktemp -u /tmp/rm-board.XXXXXX)
TMPCONF=""
cleanup() {
	ssh -S "$SOCKET" -O exit "$HOST" >/dev/null 2>&1 || true
	[ -z "$TMPCONF" ] || rm -f "$TMPCONF"
}
trap cleanup EXIT

if [ "$UNINSTALL" = 0 ]; then
	CONFIG=${BOARD_CONFIG:-$HOME/.local/share/remarkable-board/config.json}
	[ -f "$CONFIG" ] || { echo "missing $CONFIG" >&2; exit 1; }
	IP=${MAC_IP:-$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)}
	[ -n "$IP" ] || { echo "no Wi-Fi IP on this Mac" >&2; exit 1; }
	TMPCONF=$(mktemp /tmp/board.conf.XXXXXX)
	IP="$IP" CONFIG="$CONFIG" OUT="$TMPCONF" python3 -c '
import json, os
c = json.load(open(os.environ["CONFIG"]))
url = "http://%s:%s/r/%s.png" % (os.environ["IP"], c.get("port", 8766), c["token"])
open(os.environ["OUT"], "w").write("URL=%s\nINTERVAL=300\nNIGHT_INTERVAL=3600\nSLEEP=1\nTZ=AEST-10AEDT,M10.1.0,M4.1.0/3\n" % url)
'
fi

# shellcheck disable=SC2086
ssh $OPTS -M -S "$SOCKET" -fN -o ControlPersist=120 "$HOST"

if [ "$UNINSTALL" = 1 ]; then
	ssh -S "$SOCKET" "$HOST" "
		set -u
		systemctl stop remarkable-board.service 2>/dev/null || true
		systemctl disable remarkable-board.service 2>/dev/null || true
		rm -f /etc/systemd/system/remarkable-board.service $RT/board_pull.sh $RT/board.conf
		systemctl daemon-reload
		# Back to the subscription dashboard: stop the display server the board left running,
		# then let the old boot helper start the direct dashboard again.
		sh /tmp/remarkable-dashboard/display_compat_311.sh stop || true
		systemctl enable remarkable-dashboard-boot.service
		sh $RT/tablet_boot.sh
		systemctl is-active remarkable-dashboard-live remarkable-dashboard-direct || true"
	echo "board removed; subscription dashboard restored"
	exit 0
fi

scp -q -o "ControlPath=$SOCKET" "$HERE/board_pull.sh" "$HOST:$RT/board_pull.sh"
scp -q -o "ControlPath=$SOCKET" "$HERE/remarkable-board.service" "$HOST:/etc/systemd/system/remarkable-board.service"
scp -q -o "ControlPath=$SOCKET" "$TMPCONF" "$HOST:$RT/board.conf"
ssh -S "$SOCKET" "$HOST" "
	set -eu
	chmod 700 $RT/board_pull.sh; chmod 600 $RT/board.conf
	systemctl daemon-reload
	# The board brings up the display server itself, so the old boot helper must not race it.
	systemctl disable remarkable-dashboard-boot.service 2>/dev/null || true
	systemctl enable remarkable-board.service
	systemctl restart remarkable-board.service
	sleep 5
	systemctl is-active remarkable-board.service
	tail -n 5 /tmp/remarkable-dashboard/board.log"
echo "board installed on $HOST"

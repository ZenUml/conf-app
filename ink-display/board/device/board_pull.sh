#!/bin/sh
# reMarkable board: pull the Mac-rendered PNG and draw it when it changed.
# Runs as remarkable-board.service. Config: $BOARD_DIR/board.conf with URL= (it holds the token:
# the URL is never printed or logged). Optional INTERVAL= (seconds between pulls, default 300),
# NIGHT_INTERVAL= (seconds between pulls from 00:00 to 06:59 local, default 3600) and TZ= (POSIX
# TZ string, default Sydney: the tablet itself runs in UTC).
# SLEEP=1 suspends the tablet to RAM between polls while it runs on battery (Wi-Fi driver unloaded
# first, RTC alarm wakes it); while charging it keeps the awake loop so ssh keeps working.
# When a fetch fails, the tablet looks for the board server on its own /24 (GET /board-id, no token)
# at most every SCAN_EVERY seconds (default 1800), rewrites the URL host in board.conf, and fetches again.
# After a good fetch it asks the server (.full instead of .png) whether a full refresh was requested on the Mac.
# Otherwise it does a full refresh on the first good pull at least six hours after the last full draw.
# A failed fetch is retried FETCH_RETRIES times (default 2), FETCH_RETRY_WAIT seconds apart (default 5), in the same poll.
# BOARD_ONCE=1 runs a single iteration, BOARD_LOOPS=n runs n (tests).
umask 077
SOURCE="${BOARD_DIR:-/home/root/.local/share/remarkable-dashboard-runtime}"
B="${BOARD_BASE:-/tmp/remarkable-dashboard}"
CONF="${BOARD_CONF:-$SOURCE/board.conf}"
LOG="$B/board.log"
LOG_MAX="${BOARD_LOG_MAX:-100000}"
TICK="${BOARD_TICK:-60}"
BATTERY="${BOARD_BATTERY:-/sys/class/power_supply/max77818_battery/capacity}"
OLD_LIB="$SOURCE/old-display-3.3.2.1666/usr/lib"
NEW="$B/board.new"
SHOWN="$B/board.png"
LAST_FULL="$B/board.lastfull"
FULL_REFRESH_INTERVAL=21600
SYSFS="${BOARD_SYSFS:-}"
RMMOD="${BOARD_RMMOD:-/sbin/rmmod}"
MODPROBE="${BOARD_MODPROBE:-/sbin/modprobe}"
CHARGE_STATUS="$SYSFS/sys/class/power_supply/max77818_battery/status"
WAKEALARM="$SYSFS/sys/class/rtc/rtc0/wakealarm"
POWER_STATE="$SYSFS/sys/power/state"
OPERSTATE="$SYSFS/sys/class/net/wlan0/operstate"
FIRST=1
last_full_epoch=0

conf_value() { sed -n "s/^$1=//p" "$CONF" 2>/dev/null | head -n 1; }

TZ="$(conf_value TZ)"
[ -n "$TZ" ] || TZ="AEST-10AEDT,M10.1.0,M4.1.0/3"
export TZ

log() {
	if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt "$LOG_MAX" ]; then
		tail -n 200 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
	fi
	echo "$(date '+%F %T') $*" >> "$LOG"
}

# /tmp is wiped on reboot: restore the display files from the persistent copy, then start the old
# display server the same way tablet_boot.sh does. Returns 0 when the display server is up.
ensure_display() {
	mkdir -p "$B" && chmod 700 "$B"
	for n in device_display.sh display_compat_311.sh tablet_quota.sh fbink librm2fb_client.so.1.0.1 librm2fb_server.so.1.0.1; do
		[ -f "$B/$n" ] || cp "$SOURCE/$n" "$B/$n" 2>/dev/null
	done
	chmod 700 "$B"/*.sh "$B/fbink" 2>/dev/null
	chmod 600 "$B"/*.so.1.0.1 2>/dev/null
	systemctl is-active --quiet remarkable-dashboard-live.service && return 0
	log "display server is down, starting it"
	if sh "$B/display_compat_311.sh" start >/dev/null 2>&1; then
		FIRST=1
		return 0
	fi
	log "display server failed to start"
	return 1
}

# draw <full|partial>
draw() {
	touch "$B/heartbeat"
	if [ "$1" = full ]; then
		set -- -q -c -f -W GC16 -i "$NEW"
	else
		set -- -q -W GC16 -i "$NEW"
	fi
	LD_LIBRARY_PATH="$OLD_LIB" LD_PRELOAD="$B/librm2fb_client.so.1.0.1" "$B/fbink" "$@"
}

# find_mac: scan the wlan0 /24 for the board server's /board-id answer. Returns 0 when it moved and the
# URL host in board.conf now points at it. The token is never sent to a scanned host.
find_mac() {
	now_s="$(date +%s)"
	last="$(cat "$B/board.lastscan" 2>/dev/null)"
	case "$last" in "" | *[!0-9]*) last=-999999 ;; esac
	[ $((now_s - last)) -ge "${SCAN_EVERY:-1800}" ] || return 1
	mine="$(busybox ip -4 addr show wlan0 2>/dev/null | sed -n 's#.*inet \([0-9.]*\)/.*#\1#p' | head -n 1)"
	[ -n "$mine" ] || return 1
	echo "$now_s" > "$B/board.lastscan"
	hostport="$(conf_value URL | sed -n 's#^http://\([^/]*\)/.*#\1#p')"
	host="${hostport%:*}"
	port="${hostport##*:}"
	[ -n "$host" ] && [ -n "$port" ] || return 1
	net="${mine%.*}"
	rm -rf "$B/scan" && mkdir -p "$B/scan"
	i=1
	while [ "$i" -le 254 ]; do
		ip="$net.$i"
		if [ "$ip" != "$mine" ]; then
			( [ "$(wget -q -T 3 -O - "http://$ip:$port/board-id" 2>/dev/null)" = remarkable-board ] && : > "$B/scan/$ip" ) &
		fi
		i=$((i + 1))
		[ $((i % 32)) -eq 0 ] && wait  # at most 32 probes at once
	done
	wait
	found="$(ls "$B/scan" 2>/dev/null | head -n 1)"
	rm -rf "$B/scan"
	if [ -z "$found" ] || [ "$found" = "$host" ]; then
		log "no board server found on $net.0/24"
		return 1
	fi
	pattern="$(echo "$host" | sed 's/\./\\./g')"
	sed "s#^URL=http://$pattern:$port/#URL=http://$found:$port/#" "$CONF" > "$CONF.tmp" && mv "$CONF.tmp" "$CONF"
	log "board server moved to $found"
	return 0
}

# poll: fetch, compare, draw. Any failure keeps the picture on screen.
poll() {
	url="$(conf_value URL)"
	[ -n "$url" ] || { log "no URL in board.conf"; return 1; }
	level="$(cat "$BATTERY" 2>/dev/null)"
	case "$level" in
	"" | *[!0-9]*) ;;
	*) case "$url" in *\?*) url="$url&b=$level" ;; *) url="$url?b=$level" ;; esac ;;
	esac
	attempt=0
	while :; do
		rm -f "$NEW"
		wget -q -T 20 -O "$NEW" "$url" 2>/dev/null
		rc=$?
		if [ "$rc" -eq 0 ] || [ "$attempt" -ge "${FETCH_RETRIES:-2}" ]; then break; fi
		attempt=$((attempt + 1))
		log "fetch failed (wget exit $rc), retry $attempt"
		sleep "${FETCH_RETRY_WAIT:-5}"
	done
	unset url
	if [ "$rc" -ne 0 ]; then
		log "fetch failed (wget exit $rc), keeping the picture"
		rm -f "$NEW"
		if [ -z "$RETRIED" ] && find_mac; then
			RETRIED=1
			poll
			rc=$?
			RETRIED=
			return "$rc"
		fi
		return 1
	fi
	if [ "$(dd if="$NEW" bs=1 skip=1 count=3 2>/dev/null)" != "PNG" ]; then
		log "download is not a PNG, keeping the picture"
		rm -f "$NEW"
		return 1
	fi
	# Ask after a good PNG, so a forced refresh is not used up by a failed fetch. FORCE stays set until a draw works.
	[ "$(wget -q -T 5 -O - "$(conf_value URL | sed 's/\.png$/.full/')" 2>/dev/null)" = 1 ] && FORCE=1
	ensure_display || return 1
	now="$(date +%s)"
	mode=partial
	reason=changed
	if [ "$FIRST" = 1 ]; then
		mode=full
		reason="first draw"
	elif [ "$FORCE" = 1 ]; then
		mode=full
		reason=forced
	elif [ "$((now - last_full_epoch))" -ge "$FULL_REFRESH_INTERVAL" ]; then
		mode=full
		reason="scheduled refresh"
	elif [ -f "$SHOWN" ] && cmp -s "$NEW" "$SHOWN"; then
		log "unchanged, not drawn"
		rm -f "$NEW"
		return 0
	fi
	if draw "$mode"; then
		mv "$NEW" "$SHOWN"
		FIRST=0
		FORCE=0
		if [ "$mode" = full ]; then
			last_full_epoch="$(date +%s)"
			printf '%s\n' "$last_full_epoch" > "$LAST_FULL"
		fi
		log "drawn $mode ($reason), battery ${level:-unknown}"
	else
		log "fbink failed, will retry"
		rm -f "$NEW"
		return 1
	fi
}

# wait_network: up to 30 s for wlan0 to be up with a default route. Sets NET_MSG for the log.
wait_network() {
	waited=0
	while [ "$waited" -lt 30 ]; do
		if [ "$(cat "$OPERSTATE" 2>/dev/null)" = up ] && busybox ip route 2>/dev/null | grep -q default; then
			NET_MSG="network ready in ${waited}s"
			return 0
		fi
		sleep 1
		waited=$((waited + 1))
	done
	NET_MSG="network not ready after 30s"
	return 1
}

# deep_sleep <seconds>: suspend to RAM until the RTC alarm fires. Returns 1 (Wi-Fi restored) when the
# suspend could not be started, so the caller can wait awake instead.
deep_sleep() {
	secs="$1"
	t0="$(date +%s)"
	# The old watchdog restores the native UI when the heartbeat is older than 180 s: date it ahead.
	touch -d "@$((t0 + secs + 120))" "$B/heartbeat"
	log "sleeping ${secs}s"
	"$RMMOD" brcmfmac 2>/dev/null
	if { echo 0 > "$WAKEALARM" && echo "+$secs" > "$WAKEALARM" && sync && echo mem > "$POWER_STATE"; } 2>/dev/null; then
		"$MODPROBE" brcmfmac 2>/dev/null
		t1="$(date +%s)"
		wait_network
		log "woke after $((t1 - t0))s, $NET_MSG"
		return 0
	fi
	log "suspend failed, staying awake this cycle"
	"$MODPROBE" brcmfmac 2>/dev/null
	wait_network
	log "$NET_MSG"
	return 1
}

mkdir -p "$B" && chmod 700 "$B"
sleep_mode="$(conf_value SLEEP)"
interval="$(conf_value INTERVAL)"
case "$interval" in "" | *[!0-9]*) interval=300 ;; esac
night_interval="$(conf_value NIGHT_INTERVAL)"
case "$night_interval" in "" | *[!0-9]*) night_interval=3600 ;; esac
log "started, interval ${interval}s, night interval ${night_interval}s, full refresh interval ${FULL_REFRESH_INTERVAL}s, TZ $TZ, sleep ${sleep_mode:-0}"
next=0
loops=0
while :; do
	touch "$B/heartbeat"
	slept=0
	now_s="$(date +%s)"
	if [ "$now_s" -ge "$next" ]; then
		poll
		hour="$(date '+%Y-%m-%d %H')"
		hour="${hour#* }"
		hour="${hour#0}"
		wait=$interval
		if [ "${hour:-0}" -lt 7 ]; then wait=$night_interval; fi
		case "$(cat "$CHARGE_STATUS" 2>/dev/null)" in Charging | Full) on_power=1 ;; *) on_power=0 ;; esac
		if [ "$sleep_mode" = 1 ] && [ "$on_power" = 0 ] && deep_sleep "$wait"; then
			slept=1
			next=0
		else
			log "next poll in ${wait}s"
			next=$((now_s + wait))
		fi
	fi
	loops=$((loops + 1))
	[ -n "$BOARD_ONCE" ] && break
	[ -n "$BOARD_LOOPS" ] && [ "$loops" -ge "$BOARD_LOOPS" ] && break
	[ "$slept" = 1 ] && continue
	sleep "$TICK"
done

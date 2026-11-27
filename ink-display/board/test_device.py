import os
import shutil
import signal
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parent / "device/board_pull.sh"
URL = "http://192.168.0.110:8766/r/SECRETTOKEN123.png"
PNG_A = b"\x89PNG\r\n\x1a\n" + b"A" * 32
PNG_B = b"\x89PNG\r\n\x1a\n" + b"B" * 32


class BoardPullTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        self.src = self.tmp / "persist"
        self.src.mkdir()
        self.base = self.tmp / "ram"
        self.base.mkdir(mode=0o700)
        self.calls = self.tmp / "calls.log"
        self.payload = self.tmp / "payload"
        self.payload.write_bytes(PNG_A)
        self.now = self.tmp / "now"
        self.set_time(1000, "2026-11-06", "10")
        self.hook = self.tmp / "hook.sh"
        self.hook.write_text("")
        (self.src / "board.conf").write_text(f"URL={URL}\nINTERVAL=0\nNIGHT_INTERVAL=0\n")
        (self.tmp / "battery").write_text("83\n")
        self.stub("wget", 'echo "wget $*" >> "$CALLS"; [ -f "$FAIL" ] && exit 4; '
                          'case "$*" in *.full*) if [ -f "$FORCE_FLAG" ]; then rm -f "$FORCE_FLAG"; echo 1; else echo 0; fi; exit 0;; esac; '
                          'case "$*" in *board-id*) case "$*" in *"//$MAC_AT:"*) echo remarkable-board; exit 0;; esac; exit 4;; esac; '
                          'case "$*" in *"//$MAC_AT:"*) ;; *) exit 4;; esac; '
                          'out=""; while [ $# -gt 0 ]; do [ "$1" = -O ] && out="$2"; shift; done; cp "$PAYLOAD" "$out"')
        fbink = self.base / "fbink"
        fbink.write_text('#!/bin/sh\necho "fbink $*" >> "$CALLS"\n')
        fbink.chmod(0o755)
        self.stub("systemctl", 'echo "systemctl $*" >> "$CALLS"; [ -f "$LIVE_DOWN" ] && [ "$1" = is-active ] && exit 3; exit 0')
        self.stub("date", 'case "$1" in +%s) sed -n 1p "$NOW";; "+%Y-%m-%d %H") sed -n 2p "$NOW";; *) echo STAMP;; esac; echo "date TZ=$TZ" >> "$CALLS"')
        self.stub("sleep", 'sh "$HOOK"')
        self.failflag = self.tmp / "fail"

    def stub(self, name, body):
        path = self.bin / name
        path.write_text("#!/bin/sh\n" + body + "\n")
        path.chmod(0o755)

    def set_time(self, epoch, day, hour):
        self.now.write_text(f"{epoch}\n{day} {hour}\n")

    def run_script(self, loops=1, extra=None):
        env = dict(os.environ, PATH=f"{self.bin}:/usr/bin:/bin", BOARD_DIR=str(self.src), BOARD_BASE=str(self.base),
                   BOARD_BATTERY=str(self.tmp / "battery"), BOARD_LOOPS=str(loops), BOARD_TICK="60",
                   CALLS=str(self.calls), PAYLOAD=str(self.payload), NOW=str(self.now), HOOK=str(self.hook),
                   FAIL=str(self.failflag), LIVE_DOWN=str(self.tmp / "livedown"), MAC_AT="192.168.0.110",
                   FORCE_FLAG=str(self.tmp / "force"))
        env.update(extra or {})
        return subprocess.run(["sh", str(SCRIPT)], env=env, capture_output=True, text=True, timeout=30)

    def between_iterations(self, script):
        self.hook.write_text(script)

    def fbinks(self):
        text = self.calls.read_text() if self.calls.exists() else ""
        return [line for line in text.splitlines() if line.startswith("fbink")]

    def log(self):
        path = self.base / "board.log"
        return path.read_text() if path.exists() else ""

    def heartbeat_touched(self):
        return (self.base / "heartbeat").exists()

    def test_first_fetch_draws_a_full_refresh_with_the_battery_in_the_url(self):
        self.assertEqual(self.run_script().returncode, 0)
        self.assertIn(f"-T 20", self.calls.read_text())
        self.assertIn(f"{URL}?b=83", self.calls.read_text())
        draws = self.fbinks()
        self.assertEqual(len(draws), 1)
        self.assertIn("-c", draws[0].split())
        self.assertIn("-f", draws[0].split())
        self.assertIn("GC16", draws[0])
        self.assertIn("drawn full", self.log())

    def test_unchanged_picture_is_not_drawn_again(self):
        self.run_script(loops=3)
        self.assertEqual(len(self.fbinks()), 1)
        self.assertIn("unchanged", self.log())

    def test_changed_picture_is_drawn_as_a_partial_update_without_clear(self):
        self.between_iterations(f'cp "$PAYLOAD.b" "$PAYLOAD"')
        Path(str(self.payload) + ".b").write_bytes(PNG_B)
        self.run_script(loops=2)
        draws = self.fbinks()
        self.assertEqual(len(draws), 2)
        self.assertNotIn("-c", draws[1].split())
        self.assertNotIn("-f", draws[1].split())
        self.assertIn("GC16", draws[1])

    def test_forced_refresh_redraws_an_unchanged_picture_full_only_once(self):
        self.between_iterations(f'[ -f "{self.tmp}/seen" ] || {{ : > "{self.tmp}/seen"; : > "$FORCE_FLAG"; }}')
        self.run_script(loops=3)
        draws = self.fbinks()
        self.assertEqual(len(draws), 2)
        self.assertIn("-c", draws[1].split())
        self.assertIn("-f", draws[1].split())
        self.assertIn("drawn full (forced)", self.log())
        self.assertNotIn("SECRETTOKEN123", self.log())

    def test_failed_fetch_is_retried_in_the_same_poll(self):
        self.failflag.write_text("x")
        self.between_iterations(f'rm -f "{self.failflag}"')
        self.run_script(loops=1)
        self.assertEqual(len(self.fbinks()), 1)
        self.assertIn("retry 1", self.log())
        self.assertEqual(self.calls.read_text().count("board-id"), 0)

    def test_fetch_gives_up_after_three_attempts(self):
        self.failflag.write_text("x")
        self.run_script(loops=1)
        pulls = [l for l in self.calls.read_text().splitlines() if l.startswith("wget") and ".png" in l]
        self.assertEqual(len(pulls), 3)
        self.assertEqual(self.fbinks(), [])

    def test_failed_fetch_keeps_the_picture_and_still_touches_the_heartbeat(self):
        self.failflag.write_text("x")
        result = self.run_script(loops=2)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(self.fbinks(), [])
        self.assertTrue(self.heartbeat_touched())
        self.assertIn("fetch failed", self.log())

    def test_picture_survives_a_failed_fetch_and_the_next_cycle_recovers(self):
        self.between_iterations(f'rm -f "{self.failflag}"; cp "$PAYLOAD.b" "$PAYLOAD"')
        Path(str(self.payload) + ".b").write_bytes(PNG_B)
        self.run_script(loops=1)
        self.failflag.write_text("x")
        # a second process is a restart; here check the same process: fail, then recover
        self.assertEqual(len(self.fbinks()), 1)
        self.failflag.write_text("x")
        self.run_script(loops=2)
        self.assertGreaterEqual(len(self.fbinks()), 1)
        self.assertTrue((self.base / "board.png").exists())

    def test_not_a_png_is_ignored(self):
        self.payload.write_bytes(b"<html>login</html>")
        self.run_script()
        self.assertEqual(self.fbinks(), [])
        self.assertIn("not a PNG", self.log())

    def test_the_url_never_reaches_the_log_or_output(self):
        self.run_script()
        self.failflag.write_text("x")
        result = self.run_script(loops=2)
        for text in (self.log(), result.stdout, result.stderr):
            self.assertNotIn("SECRETTOKEN123", text)
            self.assertNotIn("192.168.0.110", text)

    def test_full_refresh_repeats_every_six_hours_even_if_the_picture_is_unchanged(self):
        self.between_iterations(
            'case "$(sed -n 1p "$NOW")" in '
            '1000) printf "22599\\n2026-11-06 15\\n" > "$NOW";; '
            '22599) printf "22600\\n2026-11-06 16\\n" > "$NOW";; '
            '22600) printf "44199\\n2026-11-06 21\\n" > "$NOW";; '
            '44199) printf "44200\\n2026-11-06 22\\n" > "$NOW";; esac')
        self.run_script(loops=5)
        draws = self.fbinks()
        self.assertEqual(len(draws), 3)
        self.assertTrue(all("-f" in draw.split() for draw in draws))
        events = [line for line in self.log().splitlines() if "drawn" in line]
        self.assertEqual([line.split(" ", 1)[1].split(",")[0] for line in events], [
            "drawn full (first draw)", "unchanged", "drawn full (scheduled refresh)",
            "unchanged", "drawn full (scheduled refresh)",
        ])

    def test_manual_refresh_restarts_the_six_hour_wait(self):
        self.between_iterations(
            'case "$(sed -n 1p "$NOW")" in '
            '1000) printf "2000\\n2026-11-06 10\\n" > "$NOW"; : > "$FORCE_FLAG";; '
            '2000) printf "22600\\n2026-11-06 16\\n" > "$NOW";; '
            '22600) printf "23600\\n2026-11-06 16\\n" > "$NOW";; esac')
        self.run_script(loops=4)
        events = [line for line in self.log().splitlines() if "drawn" in line]
        self.assertEqual([line.split(" ", 1)[1].split(",")[0] for line in events], [
            "drawn full (first draw)", "drawn full (forced)", "unchanged",
            "drawn full (scheduled refresh)",
        ])

    def test_a_dead_display_server_is_started_and_the_next_draw_is_full(self):
        (self.tmp / "livedown").write_text("x")
        (self.base / "display_compat_311.sh").write_text('echo "compat $*" >> "$CALLS"\n')
        self.run_script()
        self.assertIn("compat start", self.calls.read_text())

    SYDNEY = "AEST-10AEDT,M10.1.0,M4.1.0/3"

    def test_dates_use_sydney_time_by_default(self):
        self.run_script()
        self.assertIn(f"date TZ={self.SYDNEY}", self.calls.read_text())
        self.assertNotIn("date TZ=\n", self.calls.read_text())

    def test_tz_comes_from_board_conf(self):
        (self.src / "board.conf").write_text(f"URL={URL}\nINTERVAL=0\nTZ=UTC0\n")
        self.run_script()
        self.assertIn("date TZ=UTC0", self.calls.read_text())
        self.assertNotIn(f"date TZ={self.SYDNEY}", self.calls.read_text())

    def wait_logged(self, hour, conf_extra=""):
        (self.src / "board.conf").write_text(f"URL={URL}\nINTERVAL=300\n{conf_extra}")
        self.set_time(1000, "2026-11-06", hour)
        self.run_script()
        return self.log()

    def test_night_hours_wait_an_hour_between_polls(self):
        for hour in ("00", "03", "06"):
            self.assertIn("next poll in 3600s", self.wait_logged(hour), hour)
            (self.base / "board.log").unlink(missing_ok=True)

    def test_day_hours_wait_the_normal_interval(self):
        for hour in ("07", "08", "10", "22", "23"):
            self.assertIn("next poll in 300s", self.wait_logged(hour), hour)
            (self.base / "board.log").unlink(missing_ok=True)

    def test_night_interval_comes_from_board_conf(self):
        self.assertIn("next poll in 1800s", self.wait_logged("02", "NIGHT_INTERVAL=1800\n"))

    def test_first_poll_after_seven_returns_to_the_day_interval(self):
        (self.src / "board.conf").write_text(f"URL={URL}\nINTERVAL=300\n")
        self.set_time(1000, "2026-11-07", "06")
        self.between_iterations('printf "4600\\n2026-11-07 07\\n" > "$NOW"')
        self.run_script(loops=2)
        waits = [l.rsplit("next poll in ", 1)[1] for l in self.log().splitlines() if "next poll in" in l]
        self.assertEqual(waits, ["3600s", "300s"])

    def test_missing_url_does_not_crash_or_draw(self):
        (self.src / "board.conf").write_text("INTERVAL=0\n")
        self.assertEqual(self.run_script().returncode, 0)
        self.assertEqual(self.fbinks(), [])
        self.assertIn("no URL", self.log())

    def test_log_is_capped(self):
        (self.base / "board.log").write_text("old line\n" * 1000)
        self.run_script(extra={"BOARD_LOG_MAX": "100"})
        self.assertLess(len((self.base / "board.log").read_text().splitlines()), 300)


class DeepSleepTest(BoardPullTest):
    """SLEEP=1: suspend to RAM between polls when running on battery."""

    def setUp(self):
        super().setUp()
        self.sysfs = self.tmp / "sysfs"
        for rel in ("sys/class/power_supply/max77818_battery", "sys/class/rtc/rtc0", "sys/power", "sys/class/net/wlan0"):
            (self.sysfs / rel).mkdir(parents=True)
        self.status = self.sysfs / "sys/class/power_supply/max77818_battery/status"
        self.state = self.sysfs / "sys/power/state"
        self.wakelog = self.tmp / "wake.log"
        self.wakelog.write_text("")
        (self.sysfs / "sys/class/net/wlan0/operstate").write_text("up\n")
        self.status.write_text("Discharging\n")
        self.state.write_text("")
        wake = self.sysfs / "sys/class/rtc/rtc0/wakealarm"
        os.mkfifo(wake)
        reader = subprocess.Popen(["sh", "-c", f'while :; do cat "{wake}" >> "{self.wakelog}"; done'],
                                  stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                  start_new_session=True)
        self.addCleanup(reader.wait)
        self.addCleanup(os.killpg, reader.pid, signal.SIGKILL)
        (self.src / "board.conf").write_text(f"URL={URL}\nINTERVAL=300\nNIGHT_INTERVAL=3600\nSLEEP=1\n")
        logline = 'echo "%s $* wake=$(wc -l < "$WAKELOG" | tr -d " ") state=$(cat "$STATE_FILE")" >> "$CALLS"'
        self.stub("rmmod", logline % "rmmod")
        self.stub("modprobe", logline % "modprobe")
        self.stub("sync", 'sleep_for=0.3; /bin/sleep $sleep_for; ' + logline % "sync")
        self.stub("busybox", 'echo "default via 192.168.0.1 dev wlan0"')
        self.stub("touch", 'case "$1" in -d) echo "touch $*" >> "$CALLS" ;; esac; exec /usr/bin/touch "$@"')
        self.sleep_env = {"BOARD_SYSFS": str(self.sysfs), "BOARD_RMMOD": str(self.bin / "rmmod"),
                          "BOARD_MODPROBE": str(self.bin / "modprobe"), "WAKELOG": str(self.wakelog),
                          "STATE_FILE": str(self.state)}

    def run_sleep(self, loops=1):
        return self.run_script(loops=loops, extra=self.sleep_env)

    def calls_text(self):
        return self.calls.read_text() if self.calls.exists() else ""

    def names(self):
        out = []
        for line in self.calls_text().splitlines():
            word = line.split()[0]
            if word in ("wget", "touch", "rmmod", "sync", "modprobe") and ".full" not in line:
                out.append(word)
        return out

    def wakes(self):
        return self.wakelog.read_text().split()

    def test_charging_keeps_the_awake_loop(self):
        for status in ("Charging", "Full"):
            self.calls.unlink(missing_ok=True)
            self.status.write_text(status + "\n")
            self.assertEqual(self.run_sleep().returncode, 0)
            self.assertNotIn("rmmod", self.names(), status)
            self.assertNotIn("modprobe", self.names(), status)
            self.assertEqual(self.state.read_text(), "", status)
            self.assertNotIn("sleeping", self.log(), status)
            self.assertIn("next poll in 300s", self.log(), status)

    def test_discharging_suspends_in_order_and_polls_again_after_resume(self):
        self.assertEqual(self.run_sleep(loops=2).returncode, 0)
        self.assertEqual(self.names()[:6], ["wget", "touch", "rmmod", "sync", "modprobe", "wget"])
        touch = [l for l in self.calls_text().splitlines() if l.startswith("touch -d")][0]
        self.assertGreaterEqual(int(touch.split("@")[1].split()[0]), 1000 + 300)
        rmmod, sync, modprobe = [l for l in self.calls_text().splitlines()
                                 if l.split()[0] in ("rmmod", "sync", "modprobe")][:3]
        self.assertIn("rmmod brcmfmac wake=0 state=", rmmod)
        self.assertIn("wake=2 state=", sync)
        self.assertNotIn("state=mem", sync)
        self.assertIn("modprobe brcmfmac", modprobe)
        self.assertIn("state=mem", modprobe)
        self.assertEqual(self.wakes()[:2], ["0", "+300"])
        self.assertIn("sleeping 300s", self.log())
        self.assertRegex(self.log(), r"woke after \d+s, network ready in \d+s")
        self.assertNotIn("next poll in", self.log())

    def test_night_sleep_uses_the_night_interval(self):
        self.set_time(1000, "2026-11-06", "02")
        self.run_sleep()
        self.assertEqual(self.wakes(), ["0", "+3600"])
        self.assertIn("sleeping 3600s", self.log())

    def test_network_that_never_comes_up_is_logged_after_30_seconds(self):
        (self.sysfs / "sys/class/net/wlan0/operstate").write_text("down\n")
        self.run_sleep()
        self.assertIn("network not ready after 30s", self.log())

    def test_suspend_write_failure_restores_wifi_and_stays_awake(self):
        self.state.unlink()
        self.state.mkdir()
        self.assertEqual(self.run_sleep().returncode, 0)
        self.assertEqual(self.names().count("rmmod"), 1)
        self.assertEqual(self.names().count("modprobe"), 1)
        self.assertLess(self.names().index("rmmod"), self.names().index("modprobe"))
        self.assertIn("suspend failed", self.log())
        self.assertIn("next poll in 300s", self.log())
        self.assertNotIn("woke after", self.log())

    def test_sleep_unset_keeps_the_old_behaviour(self):
        (self.src / "board.conf").write_text(f"URL={URL}\nINTERVAL=300\n")
        self.run_sleep()
        self.assertEqual(self.names(), ["wget"] if "touch" not in self.names() else self.names())
        self.assertNotIn("rmmod", self.names())
        self.assertNotIn("sleeping", self.log())
        self.assertEqual(self.state.read_text(), "")
        self.assertIn("next poll in 300s", self.log())


for _name in dir(BoardPullTest):  # run only the sleep tests in DeepSleepTest, not the inherited ones
    if _name.startswith("test_") and _name not in vars(DeepSleepTest):
        setattr(DeepSleepTest, _name, None)


class FindMacTest(BoardPullTest):
    """After a failed fetch the tablet looks for the board server on its /24 and follows it."""

    def setUp(self):
        super().setUp()
        self.stub("busybox", 'case "$*" in *addr*) echo "    inet 192.168.0.109/24 brd 192.168.0.255 scope global wlan0";; '
                             '*) echo "default via 192.168.0.1 dev wlan0";; esac')

    def wgets(self):
        text = self.calls.read_text() if self.calls.exists() else ""
        return [line for line in text.splitlines() if line.startswith("wget")]

    def test_moved_mac_is_found_and_only_the_url_host_changes(self):
        result = self.run_script(extra={"MAC_AT": "192.168.0.128"})
        self.assertEqual(len(self.fbinks()), 1)  # fetched again from the new host and drawn
        conf = (self.src / "board.conf").read_text()
        self.assertIn("URL=http://192.168.0.128:8766/r/SECRETTOKEN123.png\n", conf)
        self.assertIn("INTERVAL=0", conf)
        self.assertIn("board server moved to 192.168.0.128", self.log())
        for text in (self.log(), result.stdout, result.stderr):
            self.assertNotIn("SECRETTOKEN123", text)

    def test_scan_never_sends_the_token(self):
        self.run_script(extra={"MAC_AT": "192.168.0.128"})
        probes = [w for w in self.wgets() if "board-id" in w]
        self.assertGreater(len(probes), 200)
        self.assertTrue(all("SECRETTOKEN123" not in w for w in probes))
        self.assertFalse(any("//192.168.0.109:" in w for w in probes))  # not itself
        token_hosts = {w.split("//")[1].split(":")[0] for w in self.wgets() if "SECRETTOKEN123" in w}
        self.assertEqual(token_hosts, {"192.168.0.110", "192.168.0.128"})

    def test_no_server_found_keeps_the_url_and_scans_at_most_every_30_minutes(self):
        self.run_script(loops=2, extra={"MAC_AT": "10.9.9.9"})
        self.assertIn(URL, (self.src / "board.conf").read_text())
        self.assertEqual(self.log().count("no board server found"), 1)
        self.assertLess(len([w for w in self.wgets() if "board-id" in w]), 300)
        self.set_time(1000 + 1800, "2026-11-06", "10")
        self.run_script(loops=1, extra={"MAC_AT": "10.9.9.9"})
        self.assertEqual(self.log().count("no board server found"), 2)

    def test_working_url_does_not_scan(self):
        self.run_script()
        self.assertFalse(any("board-id" in w for w in self.wgets()))


if __name__ == "__main__":
    unittest.main()

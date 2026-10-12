#!/usr/bin/env python3
"""Tests for the Kindle client scripts, run on a computer.

    python3 kindle/test/test_client.py

1. The UK-time and schedule maths in lib.sh are checked against Python's
   zoneinfo for thousands of timestamps, including every clock change.
2. The real scripts are driven through sleep, timer wake, a failed fetch and
   waking to read, with fake versions of the Kindle's lipc tools, curl and
   FBInk.

Scripts run under BusyBox ash (the Kindle's shell) when a busybox binary is
on PATH or in $BUSYBOX, and always under /bin/sh.
"""

import os
import random
import shutil
import subprocess
import tempfile
import textwrap
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
CLIENT = HERE.parent
BIN = CLIENT / "dashboard" / "bin"
LONDON = ZoneInfo("Europe/London")
SCHEDULE = [("06:00", "10:00", 10), ("10:00", "22:00", 30), ("22:00", "06:00", 120)]
TOKEN = "secret123abc"
FIXTURE_PNG = CLIENT.parent / "worker" / "preview" / "normal.png"


def find_busybox():
    path = os.environ.get("BUSYBOX") or shutil.which("busybox")
    return path if path and os.access(path, os.X_OK) else None


SHELLS = [("sh", ["/bin/sh"])]
if find_busybox():
    SHELLS.insert(0, ("busybox", [find_busybox(), "ash"]))


# ---------------------------------------------------------------- reference


def minutes(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def is_slot(mod):
    for start, end, iv in SCHEDULE:
        s, e = minutes(start), minutes(end)
        off = (mod - s) % 1440
        length = (e - s) % 1440 or 1440
        if off < length:
            return off % iv == 0
    return False


def ref_next_slot(now):
    t = (now + 119) // 60 * 60
    for _ in range(1440):
        local = datetime.fromtimestamp(t, LONDON)
        if is_slot(local.hour * 60 + local.minute):
            return t, local.strftime("%H:%M")
        t += 60
    raise AssertionError("no slot")


def clock_changes(year_from, year_to):
    """UTC instants where Europe/London changes offset."""
    out = []
    t = datetime(year_from, 1, 1, tzinfo=timezone.utc)
    end = datetime(year_to, 12, 31, tzinfo=timezone.utc)
    prev = t.astimezone(LONDON).utcoffset()
    while t < end:
        t += timedelta(hours=1)
        off = t.astimezone(LONDON).utcoffset()
        if off != prev:
            out.append(int(t.timestamp()))
            prev = off
    return out


class TimeMaths(unittest.TestCase):
    """lib.sh's London time and next refresh, against zoneinfo."""

    @classmethod
    def setUpClass(cls):
        rng = random.Random(42)
        lo = int(datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp())
        hi = int(datetime(2037, 12, 31, tzinfo=timezone.utc).timestamp())
        epochs = [rng.randrange(lo, hi) for _ in range(1500)]
        for change in clock_changes(2025, 2037):
            for delta in (-7260, -3601, -3600, -61, -1, 0, 1, 59, 60, 3599, 3600, 7200):
                epochs.append(change + delta)
        cls.epochs = epochs

    def run_driver(self, shell):
        driver = textwrap.dedent(
            f"""
            DASH_RUN=/nonexistent
            . "{BIN}/lib.sh"
            SCHEDULE="06:00-10:00=10 10:00-22:00=30 22:00-06:00=120"
            while read -r t; do
                london "$t"
                parts="$L_Y $L_M $L_D $L_H $L_MI $L_S"
                next_slot "$t"
                echo "$t $parts $NEXT_EPOCH $NEXT_HHMM"
            done
            """
        )
        with tempfile.NamedTemporaryFile("w", suffix=".sh", delete=False) as f:
            f.write(driver)
        try:
            out = subprocess.run(
                shell + [f.name],
                input="\n".join(map(str, self.epochs)) + "\n",
                capture_output=True,
                text=True,
                check=True,
                timeout=600,
            ).stdout
        finally:
            os.unlink(f.name)
        return out.strip().splitlines()

    def test_against_zoneinfo(self):
        for name, shell in SHELLS:
            with self.subTest(shell=name):
                lines = self.run_driver(shell)
                self.assertEqual(len(lines), len(self.epochs))
                for line in lines:
                    t, y, mo, d, h, mi, s, nxt, nxt_hhmm = line.split()
                    local = datetime.fromtimestamp(int(t), LONDON)
                    self.assertEqual(
                        (int(y), int(mo), int(d), int(h), int(mi), int(s)),
                        (local.year, local.month, local.day, local.hour, local.minute, local.second),
                        f"london({t})",
                    )
                    self.assertEqual((int(nxt), nxt_hhmm), ref_next_slot(int(t)), f"next_slot({t})")

    def test_known_points(self):
        # 06:44 BST on Fri 9 Oct 2026 -> next refresh 06:50.
        t = int(datetime(2026, 10, 9, 5, 44, tzinfo=timezone.utc).timestamp())
        self.assertEqual(ref_next_slot(t)[1], "06:50")
        # 10:05 -> 10:30; 21:59:30 -> 22:00 is less than a minute away -> 00:00.
        t = int(datetime(2026, 10, 9, 9, 5, tzinfo=timezone.utc).timestamp())
        self.assertEqual(ref_next_slot(t)[1], "10:30")
        t = int(datetime(2026, 10, 9, 20, 59, 30, tzinfo=timezone.utc).timestamp())
        self.assertEqual(ref_next_slot(t)[1], "00:00")


# ---------------------------------------------------------------- simulation

FAKE_GET = """#!/bin/sh
[ "$1" = -i ] || [ "$1" = -s ] && shift
f="$FAKE/props/$1.$2"
[ -f "$f" ] && cat "$f" && exit 0
exit 1
"""

FAKE_SET = """#!/bin/sh
[ "$1" = -i ] || [ "$1" = -s ] && shift
echo "set $1 $2 $3" >> "$FAKE/calls.log"
printf '%s' "$3" > "$FAKE/props/$1.$2"
if [ "$1.$2" = com.lab126.cmd.wirelessEnable ]; then
    if [ "$3" = 1 ]; then echo CONNECTED; else echo NA; fi > "$FAKE/props/com.lab126.wifid.cmState"
fi
"""

FAKE_WAIT = """#!/bin/sh
exec cat "$FAKE/events.fifo"
"""

FAKE_CURL = """#!/bin/sh
[ "$1" = -V ] && echo "curl 8.22.0 (fake)" && exit 0
echo "$WHICH_CURL" >> "$FAKE/which.log"
out=""; url=""
while [ $# -gt 0 ]; do
    case "$1" in
        -o) out=$2; shift ;;
        --connect-timeout|--max-time|--retry|--cacert) shift ;;
        -*) ;;
        *) url=$1 ;;
    esac
    shift
done
echo "$url" >> "$FAKE/urls.log"
echo "curl" >> "$FAKE/calls.log"
[ -f "$FAKE/curl_delay" ] && sleep "$(cat "$FAKE/curl_delay")"
if [ -f "$FAKE/curl_fail" ]; then
    echo "curl: (22) The requested URL returned error: 503 for $url" >&2
    exit 22
fi
cp "$FAKE/fixture.png" "$out"
"""

FAKE_FBINK = """#!/bin/sh
for a in "$@"; do
    case "$a" in file=*) img=${a#file=} ;; esac
done
echo "draw $(md5sum "$img" | cut -c1-8)" >> "$FAKE/calls.log"
"""

BUSYBOX_APPLETS = "cat cp cut date dd head mkdir mv rm rmdir sed setsid sleep tail tr wc md5sum".split()


class Simulation(unittest.TestCase):
    """The real scripts against a fake Kindle."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="kdash-"))
        self.home = self.tmp / "us" / "dashboard"
        self.run_dir = self.tmp / "run"
        self.fake = self.tmp / "fake"
        self.fakebin = self.tmp / "fakebin"
        for d in (self.home, self.fake / "props", self.fakebin):
            d.mkdir(parents=True)
        shutil.copytree(BIN, self.home / "bin")
        (self.home / "certs").mkdir()
        (self.home / "certs" / "cacert.pem").write_text("dummy")
        (self.home / "config.sh").write_text(
            f'DASHBOARD_URL="https://example.test/"\r\nDASHBOARD_TOKEN="{TOKEN}"\r\n'
            "DRAW_DELAY=0\r\nWIFI_TIMEOUT=5\r\nFETCH_TIMEOUT=10\r\n"
        )
        shutil.copy(FIXTURE_PNG, self.fake / "fixture.png")
        self.props(
            {
                "com.lab126.powerd.state": "active",
                "com.lab126.powerd.battLevel": "80",
                "com.lab126.cmd.wirelessEnable": "0",
                "com.lab126.wifid.cmState": "NA",
                "com.lab126.volumd.userstoreIsAvailable": "1",
            }
        )
        for name, body in (
            ("lipc-get-prop", FAKE_GET),
            ("lipc-set-prop", FAKE_SET),
            ("lipc-wait-event", FAKE_WAIT),
            ("curl", FAKE_CURL.replace("$WHICH_CURL", "system")),
            ("fbink", FAKE_FBINK),
        ):
            p = self.fakebin / name
            p.write_text(body)
            p.chmod(0o755)
        # Stand-in for the bundled ARM curl.
        (self.home / "bin" / "curl").write_text(FAKE_CURL.replace("$WHICH_CURL", "bundled"))
        os.mkfifo(self.fake / "events.fifo")
        self.fifo = os.open(self.fake / "events.fifo", os.O_RDWR)

    def tearDown(self):
        try:
            self.ctl("stop")
        finally:
            os.close(self.fifo)
            if os.environ.get("KDASH_KEEP"):
                print(f"\nkept {self.tmp}")
            else:
                shutil.rmtree(self.tmp, ignore_errors=True)

    # helpers

    def use_shell(self, name, shell):
        if name == "busybox":
            sh = self.fakebin / "sh"
            sh.write_text(f'#!/bin/sh\nexec "{shell[0]}" ash "$@"\n')
            sh.chmod(0o755)
            for applet in BUSYBOX_APPLETS:
                link = self.fakebin / applet
                if not link.exists():
                    link.symlink_to(shell[0])

    def env(self):
        return {
            **os.environ,
            "PATH": f"{self.fakebin}:{os.environ['PATH']}",
            "FAKE": str(self.fake),
            "DASH_HOME": str(self.home),
            "DASH_RUN": str(self.run_dir),
            "FBINK": str(self.fakebin / "fbink"),
        }

    def ctl(self, cmd):
        sh = str(self.fakebin / "sh") if (self.fakebin / "sh").exists() else "/bin/sh"
        return subprocess.run(
            [sh, str(self.home / "bin" / "ctl.sh"), cmd], env=self.env(), capture_output=True, text=True, timeout=60
        )

    def props(self, values):
        for k, v in values.items():
            (self.fake / "props" / k).write_text(v)

    def event(self, line):
        os.write(self.fifo, (line + "\n").encode())

    def calls(self):
        p = self.fake / "calls.log"
        return p.read_text().splitlines() if p.exists() else []

    def clear_calls(self):
        (self.fake / "calls.log").write_text("")

    def wait_for(self, predicate, timeout=15, what="condition"):
        end = time.time() + timeout
        while time.time() < end:
            if predicate():
                return
            time.sleep(0.1)
        self.fail(f"timed out waiting for {what}; calls: {self.calls()}; log: {self.log_text()}")

    def update_idle(self):
        return not (self.run_dir / "lock").exists() and not (self.run_dir / "pending").exists()

    def log_text(self):
        text = ""
        for p in (self.home / "log.txt", self.run_dir / "log.txt"):
            if p.exists():
                text += p.read_text()
        return text

    # the scenario

    def test_sleep_wake_cycle(self):
        for name, shell in SHELLS:
            with self.subTest(shell=name):
                if name != SHELLS[0][0]:
                    self.tearDown()
                    self.setUp()
                self.use_shell(name, shell)
                self.scenario()

    def scenario(self):
        # Start while awake with Wi-Fi off: fetch once, then Wi-Fi back off.
        out = self.ctl("start")
        self.assertIn("Dashboard started.", out.stdout, out.stderr)
        self.wait_for(lambda: "curl" in self.calls() and self.update_idle(), what="first fetch")
        calls = self.calls()
        self.assertEqual(calls[0], "set com.lab126.cmd wirelessEnable 1")
        self.assertEqual(calls[-1], "set com.lab126.cmd wirelessEnable 0")
        self.assertFalse(any(c.startswith("draw") for c in calls), "must not draw while awake")
        url = (self.fake / "urls.log").read_text().splitlines()[-1]
        self.assertRegex(url, rf"^https://example.test/\?k={TOKEN}&batt=80&next=\d\d:\d\d$")
        self.assertTrue((self.home / "cache" / "dashboard.png").exists())
        self.assertIn("OK at", (self.run_dir / "last_result").read_text())
        self.assertEqual(set((self.fake / "which.log").read_text().split()), {"bundled"})

        # Go to sleep with Wi-Fi on: not due, so draw the cached image and turn Wi-Fi off.
        self.clear_calls()
        self.props({"com.lab126.cmd.wirelessEnable": "1", "com.lab126.powerd.state": "screenSaver"})
        self.event("goingToScreenSaver 1")
        self.wait_for(lambda: any(c.startswith("draw") for c in self.calls()), what="draw on sleep")
        self.assertIn("set com.lab126.cmd wirelessEnable 0", self.calls())
        self.assertNotIn("curl", self.calls())
        self.assertEqual((self.run_dir / "wifi_was").read_text().strip(), "1")

        # A repeated sleep event must not overwrite the remembered setting with our own "off".
        self.event("goingToScreenSaver 1")
        time.sleep(0.5)
        self.assertEqual((self.run_dir / "wifi_was").read_text().strip(), "1")

        # About to suspend: arm the wake timer for the next refresh.
        self.clear_calls()
        self.props({"com.lab126.powerd.state": "readyToSuspend"})
        self.event("readyToSuspend 5")
        self.wait_for(lambda: any("rtcWakeup" in c for c in self.calls()), what="wake timer")
        secs = int([c for c in self.calls() if "rtcWakeup" in c][-1].split()[-1])
        self.assertTrue(60 <= secs <= 7200, secs)

        # Timer wake with a slow download; readyToSuspend arrives mid-fetch.
        self.clear_calls()
        (self.run_dir / "next_epoch").write_text(str(int(time.time())))
        (self.fake / "curl_delay").write_text("3")
        self.props({"com.lab126.powerd.state": "screenSaver"})
        self.event("wakeupFromSuspend 0")
        self.props({"com.lab126.powerd.state": "readyToSuspend"})
        self.event("readyToSuspend 5")
        self.wait_for(lambda: "curl" in self.calls() and self.update_idle(), what="timer refresh")
        calls = self.calls()
        self.assertIn("set com.lab126.powerd deferSuspend 25", calls)  # 5 + 10 + 10
        self.assertEqual(calls[-1], "set com.lab126.powerd deferSuspend 2", calls)
        order = [c for c in calls if "wirelessEnable" in c or c == "curl" or c.startswith("draw")]
        self.assertEqual(order[:2], ["set com.lab126.cmd wirelessEnable 1", "curl"])
        self.assertIn("set com.lab126.cmd wirelessEnable 0", order[2:])
        self.assertTrue(any(c.startswith("draw") for c in order[2:]))
        self.assertTrue(any("rtcWakeup" in c for c in calls))
        (self.fake / "curl_delay").unlink()

        # A failed fetch while asleep keeps (and redraws) the last image.
        self.clear_calls()
        before = (self.run_dir / "dashboard.png").read_bytes()
        (self.fake / "curl_fail").write_text("")
        (self.run_dir / "next_epoch").write_text(str(int(time.time())))
        self.props({"com.lab126.powerd.state": "screenSaver"})
        self.event("wakeupFromSuspend 0")
        self.wait_for(lambda: "curl" in self.calls() and self.update_idle(), what="failed refresh")
        self.assertEqual((self.run_dir / "dashboard.png").read_bytes(), before)
        self.assertTrue(any(c.startswith("draw") for c in self.calls()))
        self.assertIn("FAILED", (self.run_dir / "last_result").read_text())
        (self.fake / "curl_fail").unlink()

        # Power-button wake when no refresh is due: no fetch.
        self.clear_calls()
        self.event("wakeupFromSuspend 0")
        time.sleep(2.5)
        self.assertNotIn("curl", self.calls())

        # Woken to read: Wi-Fi goes back to how it was before sleep (on).
        self.props({"com.lab126.powerd.state": "active"})
        self.event("outOfScreenSaver 1")
        self.wait_for(lambda: "set com.lab126.cmd wirelessEnable 1" in self.calls(), what="Wi-Fi restore")

        # Update Now from the library.
        self.clear_calls()
        out = self.ctl("update")
        self.assertIn("Done.", out.stdout, out.stderr)
        self.assertIn("Background refresh: running", out.stdout)

        # Stop: the whole process group goes.
        pgid = int((self.run_dir / "daemon.pgid").read_text())
        out = self.ctl("stop")
        self.assertIn("Dashboard stopped.", out.stdout)
        time.sleep(0.5)
        with self.assertRaises(ProcessLookupError):
            os.killpg(pgid, 0)

        # The token never reaches the log.
        log = self.log_text()
        self.assertIn("fetch failed (curl exit 22) from example.test:", log)
        self.assertIn("dashboard address: example.test", log)
        self.assertNotIn(TOKEN, log)

    def test_falls_back_to_kindle_curl(self):
        # A bundled binary that can't run (e.g. wrong CPU) means using the Kindle's curl.
        (self.home / "bin" / "curl").write_text("not a binary\n")
        out = self.ctl("start")
        self.assertIn("Dashboard started.", out.stdout, out.stderr)
        self.wait_for(lambda: "curl" in self.calls() and self.update_idle(), what="first fetch")
        self.assertEqual(set((self.fake / "which.log").read_text().split()), {"system"})
        self.assertIn("bundled curl could not run here", self.log_text())

    def test_start_survives_hanging_curl(self):
        # A bundled curl that hangs at startup (as /dev/random did on the device)
        # must not hang Start: it is given 5 s, then the Kindle's curl is used.
        (self.home / "bin" / "curl").write_text("#!/bin/sh\nsleep 60\n")
        began = time.time()
        out = self.ctl("start")
        self.assertIn("Dashboard started.", out.stdout, out.stderr)
        self.assertLess(time.time() - began, 20)
        self.assertIn("bundled curl could not run here", self.log_text())

    def test_watchdog_stops_stuck_fetch(self):
        # curl stuck past its own time limit: the watchdog kills it (limit + 10 s).
        (self.home / "config.sh").write_text(
            f'DASHBOARD_URL="https://example.test/"\nDASHBOARD_TOKEN="{TOKEN}"\nFETCH_TIMEOUT=1\nWIFI_TIMEOUT=5\n'
        )
        (self.fake / "curl_delay").write_text("60")
        self.ctl("start")
        self.wait_for(lambda: "fetch failed" in self.log_text(), timeout=30, what="watchdog")
        self.wait_for(self.update_idle, timeout=10, what="update to finish")
        self.assertIn("FAILED", (self.run_dir / "last_result").read_text())

    def test_start_clears_stuck_copies(self):
        # A copy of ctl.sh stuck from an earlier Start is stopped by the next Start.
        stray = self.tmp / "old" / "dashboard" / "bin" / "ctl.sh"
        stray.parent.mkdir(parents=True)
        stray.write_text("sleep 300\n")
        proc = subprocess.Popen(["/bin/sh", str(stray)])
        try:
            time.sleep(0.3)
            self.ctl("start")
            proc.wait(timeout=10)
            self.assertIsNotNone(proc.returncode)
        finally:
            if proc.poll() is None:
                proc.kill()

    def test_start_rejects_placeholder_url(self):
        (self.home / "config.sh").write_text(
            f'DASHBOARD_URL="https://kindle-dashboard.YOUR-SUBDOMAIN.workers.dev/"\nDASHBOARD_TOKEN="{TOKEN}"\n'
        )
        out = self.ctl("start")
        self.assertIn("still says YOUR-SUBDOMAIN", out.stdout)
        self.assertNotEqual(out.returncode, 0)

    def test_start_without_config(self):
        (self.home / "config.sh").unlink()
        out = self.ctl("start")
        self.assertIn("No settings file found.", out.stdout)
        self.assertNotEqual(out.returncode, 0)


class BundledCurl(unittest.TestCase):
    """The real ARM curl, under qemu-arm if it is installed."""

    def setUp(self):
        self.qemu = os.environ.get("QEMU_ARM") or shutil.which("qemu-arm-static") or shutil.which("qemu-arm")
        if not self.qemu:
            self.skipTest("qemu-arm not available")
        self.curl = BIN / "curl"

    def test_runs_and_reports_version(self):
        out = subprocess.run([self.qemu, "-cpu", "cortex-a9", str(self.curl), "-V"], capture_output=True, text=True, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertRegex(out.stdout, r"^curl 8\.\d+\.\d+ .*mbedTLS/3\.")
        self.assertIn("https", out.stdout)

    def test_never_reads_blocking_dev_random(self):
        # /dev/random blocks on the Kindle's kernel; only /dev/urandom is safe.
        out = subprocess.run(
            [self.qemu, "-cpu", "cortex-a9", "-strace", str(self.curl), "-V"], capture_output=True, text=True, timeout=60
        )
        trace = out.stdout + out.stderr
        self.assertIn('open("/dev/urandom"', trace)
        self.assertNotIn('open("/dev/random"', trace)


if __name__ == "__main__":
    print("shells:", ", ".join(name for name, _ in SHELLS))
    unittest.main(verbosity=2)

# Kindle dashboard: Kindle client

Shows the dashboard from [`worker/`](../worker/README.md) as the sleep screen of
a jailbroken Kindle Paperwhite (10th gen, firmware 5.15.1, WinterBreak / hdnext).
The Kindle still works normally as a reader: press the power button to read;
let it sleep and the dashboard comes back.

## How it works

Three scriptlets in the library (`Dashboard: Start`, `Dashboard: Stop`,
`Dashboard: Update Now`) control a small background script. That script waits
for the Kindle's power events and does nothing in between:

- **Kindle goes to sleep:** the script remembers whether Wi-Fi was on, then
  turns it off. It draws the latest dashboard over the normal sleep screen
  with FBInk, and fetches a new one if a refresh is due.
- **About to enter deep sleep:** it sets the Kindle's wake-up timer for the
  next refresh. If a fetch is still running, it holds off deep sleep until the
  fetch finishes, at most 60 seconds.
- **Woken by the timer:** it turns Wi-Fi on and fetches the image, sending
  battery % and the next refresh time. It draws the image, turns Wi-Fi off,
  sets the next wake-up, and lets the Kindle sleep again.
- **Woken by you to read:** it stops any fetch and puts Wi-Fi back the way
  you had it.
- **On the sleep screen without deep sleep:** while plugged into a computer,
  the Kindle stays on the sleep screen instead of entering deep sleep, so the
  wake-up timer never fires. A light check every 30 seconds (and at the start
  of each minute, for the clock) refreshes on time in that case. In deep sleep
  the check is frozen and costs nothing.

### The clock

The time in the top right is kept current between fetches, without Wi-Fi.
Between refreshes the wake-up timer is set for the start of the next minute.
When it fires, the script pastes in the digits that changed (usually just the
last one), and the Kindle goes back to sleep. Wi-Fi stays off throughout.

The digits are small images in `dashboard/clock/`, cut from the dashboard by
the Worker (`npm run clock`), so they match the rest of the screen pixel for
pixel. If the Kindle is about to sleep with under 20 seconds left in the
minute, it shows the next minute straight away rather than waking again that
soon. There is always a refresh at midnight, so the date changes with the
clock. The footer's `UPDATED` time shows when the rest of the screen was
fetched.

Waking every minute uses more battery than waking only to refresh, though
much less than Wi-Fi does. How much more hasn't been measured on a real Kindle
yet. Set `CLOCK=0` to turn it off. The top right then shows the time of the
last update.

Refreshes run every 10 minutes from 06:00 to 10:00, every 30 minutes from 10:00
to 22:00, and every 2 hours from 22:00 to 06:00. Times are UK time; the script
works out BST itself, because the Kindle's clock runs on UTC.

Downloads use a bundled, modern `curl` (`dashboard/bin/curl`). The Kindle's
own `curl` uses an encryption library too old for Cloudflare, which refuses
the connection (`curl exit 35`). The bundled one is a self-contained static
build of curl 8.22.0 with Mbed TLS 3.6.7, made from source with
`tools/build-curl.sh` (see `third_party/`). It reads randomness from
`/dev/urandom`, because `/dev/random` blocks on the Kindle's kernel.

If a fetch fails, the last image stays on screen, and `OFFLINE SINCE 07:30`
(the time of the first failure) replaces the `TIME` label above the clock, in
a white box. Otherwise the ticking clock would make an old screen look
current. The next successful update redraws the whole screen without it. Like
the clock digits, the note's images are made by the Worker.

After a failed update, the next one restarts Wi-Fi from scratch before
connecting: it switches off the Kindle's Wi-Fi service as well as the setting,
then asks for the network it last connected to. That clears a brief hiccup,
but not the stuck state seen on 13 and 14 Oct, when Wi-Fi stayed down for
ten hours or more while the Kindle slept (`cmState NA` in the log), restart
after restart. Waking the Kindle by hand cleared it every time, within
seconds.

So if Wi-Fi has failed twice in a row while asleep (the second time despite
the restart), the next update wakes the Kindle itself, as if the power button
had been pressed. It restarts Wi-Fi and fetches while awake, then puts the
Kindle back to sleep and draws the new dashboard. The home screen shows for
up to about a minute meanwhile, and the front light comes on if you have it
set above zero. It does this at most once an hour, so a real outage (the
router off, say) doesn't keep waking it. Set `WAKE_TO_RECONNECT=0` to turn it
off. This hasn't yet been seen working on a real Kindle; the log will show
it (see Checking it works).

The front light is never touched; it is already off while the Kindle sleeps.

## Install

Things to do by hand, on your Mac, with the Kindle plugged in by USB:

1. Get the latest code: in Terminal, `cd ~/kindle_dashboard && git pull`.
2. Copy the files onto the Kindle:
   ```sh
   cd ~/kindle_dashboard/kindle
   ./install.sh
   ```
   This copies a `dashboard` folder to the Kindle and three scriptlets into its
   `documents` folder, and creates `dashboard/config.sh` if it doesn't exist.
3. Add your Worker address and token to the settings file:
   ```sh
   nano /Volumes/Kindle/dashboard/config.sh
   ```
   Set `DASHBOARD_URL` to your `https://kindle-dashboard.….workers.dev/` address
   and `DASHBOARD_TOKEN` to your access token, both inside the quotes. Save with
   Ctrl+O, Enter, then exit with Ctrl+X. Use nano or another plain-text editor:
   TextEdit can silently swap in curly quotes, which breaks the file.
4. Eject the Kindle in Finder and unplug it.
5. On the Kindle, open the library and tap **Dashboard: Start**. After a moment
   it says "Dashboard started." and returns to the library.
6. Press the power button. The normal sleep screen appears, then the
   dashboard replaces it about 2 seconds later.

After a reboot, tap **Dashboard: Start** again. Nothing restarts it
automatically, so the system partition is never modified.

## Day to day

| Scriptlet | What it does |
| --- | --- |
| Dashboard: Start | Starts the background script, or restarts it, which picks up changes to `config.sh`. It also fetches a first image straight away. |
| Dashboard: Stop | Stops it. The Kindle goes back to its normal sleep screen. |
| Dashboard: Update Now | Fetches a fresh image now and shows it for a few seconds, then returns to the library. Handy for checking the settings. |

## Settings (`dashboard/config.sh`)

| Setting | Default | |
| --- | --- | --- |
| `DASHBOARD_URL` | | Your Worker address. |
| `DASHBOARD_TOKEN` | | Your `ACCESS_TOKEN`. |
| `SCHEDULE` | `06:00-10:00=10 10:00-22:00=30 22:00-06:00=120` | Refresh bands, `START-END=MINUTES`, in UK time. |
| `CLOCK` | `1` | `1` keeps the time in the top right current (a short wake each minute, no Wi-Fi). `0` turns that off. |
| `DRAW_DELAY` | `2` | Seconds to wait after the Kindle goes to sleep before drawing. |
| `WAKE_TO_RECONNECT` | `1` | `1` wakes the Kindle briefly to reconnect when Wi-Fi is stuck while asleep (at most once an hour). `0` turns that off. |
| `WIFI_TIMEOUT` | `60` | Give up on Wi-Fi after this many seconds. Installs from before 13 Oct 2026 may still have `30` in `config.sh` (`install.sh` never overwrites it); use 60. |
| `FETCH_TIMEOUT` | `20` | Give up on the download after this many seconds. |

Tap **Dashboard: Start** after changing anything.

## Checking it works

The script keeps a log at `dashboard/log.txt` on the Kindle. You can read it
over USB at `/Volumes/Kindle/dashboard/log.txt`. It never contains your token.
A healthy cycle looks like this:

```
2026-10-12 08:49:03 wake timer set for 08:50 (57s)
2026-10-12 08:50:00 timer wake: refresh due
2026-10-12 08:50:02 update (scheduled): starting (state screenSaver, wifi 0)
2026-10-12 08:50:02 clock: redrawn 10 times since the last update
2026-10-12 08:50:09 fetched new image (104012 bytes, next 09:00, battery 81%)
```

The clock's wakes each minute aren't logged one by one, only counted in the
`clock: redrawn` line. That count should be about the number of minutes since
the previous update. With `CLOCK=0` the log also shows each
`readyToSuspend` and `wakeupFromSuspend` event, and a `wake timer set` line
after every update.

When Wi-Fi fails, the log says what state it was in, and the next update
restarts it. If the restart works, the `fetched` line follows it:

```
2026-10-13 07:40:44 Wi-Fi did not connect within 60s (cmState NA, wirelessEnable 1, wifid enable 1)
2026-10-13 07:49:46 update (scheduled): starting (state screenSaver, wifi 0)
2026-10-13 07:49:46 clock: redrawn 9 times since the last update
2026-10-13 07:49:46 restarting Wi-Fi, as the last update failed
2026-10-13 07:49:58 fetched new image (122344 bytes, next 08:00, battery 80%)
```

If the restart fails too, the next update wakes the Kindle to reconnect.
When that works, it looks like this:

```
2026-10-15 09:41:03 update (scheduled): starting (state screenSaver, wifi 0)
2026-10-15 09:41:03 waking the Kindle to reconnect, as Wi-Fi has failed 2 times in a row
2026-10-15 09:41:04 event outOfScreenSaver (state active)
2026-10-15 09:41:04 restarting Wi-Fi, as the last update failed
2026-10-15 09:41:19 fetched new image (123106 bytes, next 09:50, battery 60%)
2026-10-15 09:41:20 event goingToScreenSaver (state screenSaver)
2026-10-15 09:41:21 back to sleep after waking to reconnect
```

The `Wi-Fi did not connect` line also gives `wpa_state`: what the Kindle's
Wi-Fi driver was doing (`?` if it couldn't tell).

The client has run on a Paperwhite 10 since 12 Oct 2026. If something's off,
send me the log; just check it first for anything you'd rather not share.

## Troubleshooting

| What you see | Likely cause and fix |
| --- | --- |
| Normal sleep screen, never the dashboard | Check the log for `event goingToScreenSaver`. If it's missing, the background script isn't running: tap Dashboard: Start. If it's there, see the next rows. |
| Dashboard flashes up, then the normal sleep screen covers it | The sleep screen finished drawing after us. Raise `DRAW_DELAY` to 4 or 5. |
| `fetch failed (curl exit 60)` or `(77)` | Certificate problem. Make sure `dashboard/certs/cacert.pem` exists (run `./install.sh` again). |
| `fetch failed (curl exit 35)` | A secure connection couldn't be set up. Check the log near `started from scriptlet` for `using bundled curl 8.22.0`. If it's missing, run `./install.sh` again and tap Dashboard: Start. |
| Start leaves a blank screen and no `start requested` line appears in the log | Start didn't run. Tap the top of the screen, then Home, and tap Dashboard: Start again. |
| `bundled curl could not run here` | The bundled curl didn't run on this Kindle, so the client fell back to the Kindle's own, which Cloudflare refuses. Tell me what the log says. |
| `fetch failed (curl exit 22)` with `403` | The token in `config.sh` doesn't match the Worker's `ACCESS_TOKEN`. |
| `OFFLINE SINCE` above the clock | Updates have failed since that time; the log says why. The trains and weather are as of the footer's `UPDATED` time. |
| `Wi-Fi did not connect within 60s` once or twice | The saved Wi-Fi network wasn't reachable. Check Wi-Fi works normally on the Kindle. |
| `Wi-Fi did not connect` again and again, each after `restarting Wi-Fi` | Restarting Wi-Fi didn't clear it. Look for `waking the Kindle to reconnect` within the hour. If it's there and still fails, check your Wi-Fi works. Send me the log. |
| `could not wake the Kindle` | The Kindle ignored the request to wake up, so it can't reconnect that way on this firmware. Tell me. Waking it by hand fixes it for now. |
| `could not put the Kindle back to sleep` | It was left on the home screen after reconnecting. It goes to sleep by itself after a few minutes. Tell me. |
| The home screen appears briefly while nobody is using the Kindle | That's the wake to reconnect stuck Wi-Fi. Set `WAKE_TO_RECONNECT=0` if you'd rather it didn't. |
| Footer `NEXT` time is in the past | The last refresh failed; the log says why. |
| The screen doesn't change overnight or between refreshes | Look for `wake timer set` before each refresh. If it's there but no `timer wake: refresh due` follows, the wake timer isn't working on this firmware. Tell me. |
| The clock stops between refreshes | Check the `clock: redrawn` count in the log. If it stays at 0 or 1, the Kindle isn't waking each minute. Tell me, and set `CLOCK=0` meanwhile. |
| The clock is a few minutes out | The clock uses the Kindle's own time. Check the time on the Kindle's home screen. |
| Smudges around the clock digits | Small screen updates leave faint traces on e-ink. They clear at the next refresh, which redraws the whole screen. |
| Battery drains faster than expected | Look for many `holding off deep sleep` lines without a matching `fetched` line soon after, or Wi-Fi left on. Waking for the clock each minute also costs some battery: try `CLOCK=0` to compare. |

## Uninstall

Tap **Dashboard: Stop**. Then, over USB, delete the `dashboard` folder and the
three `dashboard-*.sh` files in `documents`.

## Files

```
install.sh                         copies everything onto the Kindle
documents/dashboard-*.sh           the three scriptlets (library items)
dashboard/config.example.sh        settings template
dashboard/bin/ctl.sh               start / stop / update, called by the scriptlets
dashboard/bin/daemon.sh            background script: reacts to power events
dashboard/bin/update.sh            one refresh: Wi-Fi, fetch, draw, wake timer
dashboard/bin/lib.sh               shared helpers, UK time and schedule maths
dashboard/bin/curl                 modern static curl for ARM (the Kindle's is too old)
dashboard/clock/                   clock digit and offline note images, and their positions (made by the Worker)
dashboard/certs/cacert.pem         trusted certificate list for curl
tools/build-curl.sh                rebuilds dashboard/bin/curl from source
third_party/                       licences and versions for the bundled curl
test/test_client.py                tests (run on a computer)
```

When running, the scripts and settings are copied into RAM
(`/tmp/kindle-dashboard`). That keeps them working while the Kindle is plugged
into a computer and its storage is unavailable.

## Tests

```sh
python3 kindle/test/test_client.py
```

- **Time maths:** checks the UK-time and schedule maths against Python's time
  zone database, for thousands of times including every clock change to 2037.
- **Simulated Kindle:** runs the real scripts against fake versions of the
  Kindle's power and Wi-Fi controls, `curl` and FBInk. It goes through
  starting, sleeping, a timer wake with a slow fetch, a failed fetch, waking to
  read, Update Now and Stop. Also Wi-Fi that won't connect until restarted:
  the failed update shows `OFFLINE SINCE`, the next one restarts Wi-Fi and
  fetches. And Wi-Fi that only reconnects while awake: after two failures the
  update wakes the Kindle, fetches, puts it back to sleep and redraws, and
  doesn't wake it again within the hour.
- **Clock:** which digits are redrawn and where, the wake-up each minute (and
  the early draw when under 20 seconds are left), a refresh that falls due as
  the Kindle goes to sleep (kept, not skipped), the midnight refresh, and a
  simulated sleep with clock wakes, with and without deep sleep, checking
  that Wi-Fi stays off.
- **Failure handling:** a bundled curl that hangs at startup, a download stuck
  past its time limit, and a leftover stuck copy from an earlier Start.
- **Bundled curl:** if `qemu-arm-static` is installed, runs the real ARM
  binary and checks it never reads the blocking `/dev/random`.

Tests run under BusyBox ash (the Kindle's shell) if `busybox` is installed,
and under `/bin/sh` in any case.

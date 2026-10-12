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

Refreshes run every 10 minutes from 06:00 to 10:00, every 30 minutes from 10:00
to 22:00, and every 2 hours from 22:00 to 06:00. Times are UK time; the script
works out BST itself, because the Kindle's clock runs on UTC.

Downloads use a bundled, modern `curl` (`dashboard/bin/curl`). The Kindle's
own `curl` uses an encryption library too old for Cloudflare, which refuses
the connection (`curl exit 35`). The bundled one is a self-contained static
build of curl 8.22.0 with Mbed TLS 3.6.7, made from source with
`tools/build-curl.sh` (see `third_party/`).

If a fetch fails, the last image stays on screen. The footer's `NEXT` time is
then in the past, which tells you a refresh was missed. The front light is
never touched; it is already off while the Kindle sleeps.

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
| `DRAW_DELAY` | `2` | Seconds to wait after the Kindle goes to sleep before drawing. |
| `WIFI_TIMEOUT` | `30` | Give up on Wi-Fi after this many seconds. |
| `FETCH_TIMEOUT` | `20` | Give up on the download after this many seconds. |

Tap **Dashboard: Start** after changing anything.

## Checking it works

The script keeps a log at `dashboard/log.txt` on the Kindle. You can read it
over USB at `/Volumes/Kindle/dashboard/log.txt`. It never contains your token.
A healthy cycle looks like this:

```
2026-10-12 08:39:58 event readyToSuspend (state readyToSuspend)
2026-10-12 08:39:58 wake timer set for 08:50 (602s)
2026-10-12 08:50:00 event wakeupFromSuspend (state screenSaver)
2026-10-12 08:50:02 update (scheduled): starting (state screenSaver, wifi 0)
2026-10-12 08:50:09 fetched new image (104012 bytes, next 09:00, battery 81%)
2026-10-12 08:50:09 wake timer set for 09:00 (591s)
```

This client hasn't been run on a real Kindle yet, only against a simulated one
(see Tests). If something's off, send me the log; just check it first for
anything you'd rather not share.

## Troubleshooting

| What you see | Likely cause and fix |
| --- | --- |
| Normal sleep screen, never the dashboard | Check the log for `event goingToScreenSaver`. If it's missing, the background script isn't running: tap Dashboard: Start. If it's there, see the next rows. |
| Dashboard flashes up, then the normal sleep screen covers it | The sleep screen finished drawing after us. Raise `DRAW_DELAY` to 4 or 5. |
| `fetch failed (curl exit 60)` or `(77)` | Certificate problem. Make sure `dashboard/certs/cacert.pem` exists (run `./install.sh` again). |
| `fetch failed (curl exit 35)` | A secure connection couldn't be set up. Check the log near `started from scriptlet` for `using bundled curl 8.22.0`. If it's missing, run `./install.sh` again and tap Dashboard: Start. |
| `bundled curl could not run here` | The bundled curl didn't run on this Kindle, so the client fell back to the Kindle's own, which Cloudflare refuses. Tell me what the log says. |
| `fetch failed (curl exit 22)` with `403` | The token in `config.sh` doesn't match the Worker's `ACCESS_TOKEN`. |
| `Wi-Fi did not connect within 30s` | The saved Wi-Fi network wasn't reachable. Check Wi-Fi works normally on the Kindle. |
| Footer `NEXT` time is in the past | The last refresh failed; the log says why. |
| The screen doesn't change overnight or between refreshes | Look for `wake timer set` before each sleep. If it's there but no `wakeupFromSuspend` follows, the wake timer isn't working on this firmware. Tell me. |
| Battery drains faster than expected | Look for many `holding off deep sleep` lines without a matching `fetched` line soon after, or Wi-Fi left on. |

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
  read, Update Now and Stop.

Tests run under BusyBox ash (the Kindle's shell) if `busybox` is installed,
and under `/bin/sh` in any case.

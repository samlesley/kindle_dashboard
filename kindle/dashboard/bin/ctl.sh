#!/bin/sh
# Entry point for the scriptlets in the Kindle's documents folder.
#
#   ctl.sh start    (re)start the dashboard in the background
#   ctl.sh stop     stop it
#   ctl.sh update   fetch now and show the result for a few seconds
#
# Scriptlets show this script's output on screen, so messages are short.

BIN=$(cd "$(dirname "$0")" && pwd)
DASH_HOME=${DASH_HOME:-$(dirname "$BIN")}
. "$BIN/lib.sh"

check_config() {
    if [ ! -f "$DASH_HOME/config.sh" ]; then
        echo "No settings file found."
        echo "Copy dashboard/config.example.sh to dashboard/config.sh"
        echo "and fill in your Worker URL and token (see README)."
        return 1
    fi
    load_config
    case "$DASHBOARD_URL" in
        *YOUR-SUBDOMAIN*)
            echo "DASHBOARD_URL in config.sh still says YOUR-SUBDOMAIN."
            echo "Put your own workers.dev address there."
            return 1
            ;;
        https://*) ;;
        *)
            echo "DASHBOARD_URL in config.sh must start with https://"
            return 1
            ;;
    esac
    if [ -z "$DASHBOARD_TOKEN" ]; then
        echo "DASHBOARD_TOKEN in config.sh is empty."
        return 1
    fi
}

# Copy everything needed into RAM, so the dashboard keeps working while the
# USB storage is lent to a computer.
prepare_run() {
    mkdir -p "$DASH_RUN"
    cp "$BIN/lib.sh" "$BIN/daemon.sh" "$BIN/update.sh" "$DASH_RUN/"
    tr -d '\r' < "$DASH_HOME/config.sh" > "$DASH_RUN/config.sh"
    cp "$DASH_HOME/certs/cacert.pem" "$DASH_RUN/cacert.pem"
    rm -rf "$DASH_RUN/clock"
    [ -d "$DASH_HOME/clock" ] && cp -r "$DASH_HOME/clock" "$DASH_RUN/clock"
    # Bundled modern curl: the Kindle's own can't negotiate TLS with Cloudflare.
    # Checked with a time limit, so a curl that can't start never hangs Start.
    rm -f "$DASH_RUN/curl"
    if [ -f "$BIN/curl" ] && cp "$BIN/curl" "$DASH_RUN/curl" && chmod 755 "$DASH_RUN/curl" &&
        run_with_timeout 5 "$DASH_RUN/curl" -V > "$DASH_RUN/curl.version" 2>&1; then
        log "using bundled $(head -n 1 "$DASH_RUN/curl.version" | cut -d' ' -f1-2)"
    else
        rm -f "$DASH_RUN/curl"
        log "bundled curl could not run here; using the Kindle's own (may fail TLS)"
    fi
    if [ ! -s "$DASH_RUN/dashboard.png" ] && [ -s "$DASH_HOME/cache/dashboard.png" ]; then
        cp "$DASH_HOME/cache/dashboard.png" "$DASH_RUN/dashboard.png"
    fi
    load_config
}

cmdline() { # pid -> CMD, its command line with spaces
    CMD=$(tr '\000' ' ' 2>/dev/null < "/proc/$1/cmdline") || CMD=""
}

# The saved process group is only trusted if its leader is still our daemon:
# after a crash the number could have been reused by something else.
daemon_pgid() { # -> PG, or empty
    PG=$(cat "$DASH_RUN/daemon.pgid" 2>/dev/null)
    case "$PG" in '' | *[!0-9]*) PG=""; return 1 ;; esac
    cmdline "$PG"
    case "$CMD" in
        *"$DASH_RUN/daemon.sh"*) return 0 ;;
        *) PG=""; return 1 ;;
    esac
}

daemon_running() {
    daemon_pgid
}

# Anything of ours still running from an earlier Start, Stop or Update Now
# (for example one that got stuck): stop it so only one copy runs.
kill_strays() {
    local d pid
    for d in /proc/[0-9]*; do
        pid=${d#/proc/}
        [ "$pid" = "$$" ] && continue
        cmdline "$pid"
        case "$CMD" in
            *"$DASH_RUN/daemon.sh"* | *"$DASH_RUN/update.sh"* | *"$DASH_RUN/curl "* | *"dashboard/bin/ctl.sh"*)
                kill -KILL "$pid" 2>/dev/null
                ;;
        esac
    done
}

stop_daemon() {
    if daemon_pgid; then
        # The daemon leads its own process group: this stops it, its event
        # listener and any fetch in progress.
        kill -TERM -"$PG" 2>/dev/null
        sleep 1
        kill -KILL -"$PG" 2>/dev/null
    fi
    kill_strays
    rm -f "$DASH_RUN/daemon.pgid" "$DASH_RUN/pending" "$DASH_RUN/deferred" "$DASH_RUN/lock/pid" "$DASH_RUN/clock_shown"
    rmdir "$DASH_RUN/lock" 2>/dev/null
}

case "$1" in
    start)
        mkdir -p "$DASH_RUN"
        log "start requested"
        flush_log
        check_config || exit 1
        stop_daemon
        prepare_run
        host=${DASHBOARD_URL#https://}
        log "dashboard address: ${host%%[/?]*}"
        if command -v setsid > /dev/null 2>&1; then
            setsid sh "$DASH_RUN/daemon.sh" < /dev/null > /dev/null 2>&1 &
        else
            sh "$DASH_RUN/daemon.sh" < /dev/null > /dev/null 2>&1 &
        fi
        sleep 1
        if daemon_running; then
            echo "Dashboard started."
            echo "Put the Kindle to sleep to see it."
            log "started from scriptlet"
        else
            echo "Dashboard did not start. See dashboard/log.txt."
        fi
        flush_log
        sleep 3
        ;;
    stop)
        stop_daemon
        mkdir -p "$DASH_RUN"
        log "stopped from scriptlet"
        flush_log
        echo "Dashboard stopped."
        sleep 2
        ;;
    update)
        check_config || exit 1
        daemon_running || prepare_run
        echo "Fetching the dashboard..."
        if sh "$DASH_RUN/update.sh" manual; then
            echo "Done."
        else
            echo "Fetch failed: $(cat "$DASH_RUN/last_result" 2>/dev/null)"
            echo "Showing the last image, if any. See dashboard/log.txt."
        fi
        if daemon_running; then echo "Background refresh: running"; else echo "Background refresh: stopped (tap Dashboard: Start)"; fi
        sleep 2
        draw_image
        sleep 6
        ;;
    *)
        echo "usage: ctl.sh start|stop|update"
        exit 2
        ;;
esac

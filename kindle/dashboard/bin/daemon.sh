#!/bin/sh
# Background part of the dashboard. Started by ctl.sh in its own process
# group, it waits for the Kindle's power events:
#
#   goingToScreenSaver  the Kindle went to sleep: remember the Wi-Fi setting,
#                       turn Wi-Fi off, draw the latest image over the sleep
#                       screen, and fetch a new one if a refresh is due
#   readyToSuspend      about to enter deep sleep: arm the wake-up timer for
#                       the next refresh (and hold off sleep mid-fetch)
#   wakeupFromSuspend   woken from deep sleep: if it was the timer, refresh
#   outOfScreenSaver    woken to read: stop any fetch, restore Wi-Fi
#
# The Kindle doesn't always enter deep sleep (for example while plugged into
# a computer it stays on the sleep screen), so a light check every TICK
# seconds also refreshes when one is due. In deep sleep that check is frozen
# with everything else and costs nothing.

. "$(dirname "$0")/lib.sh"
load_config

read -r _pid _comm _state _ppid PGID _rest < /proc/$$/stat
echo "$PGID" > "$DASH_RUN/daemon.pgid"
rm -f "$DASH_RUN/wifi_was" "$DASH_RUN/pending" "$DASH_RUN/deferred"
log "daemon started (pid $$)"

# "pending" covers the gap between deciding to refresh and update.sh
# taking its lock, so a readyToSuspend in between still holds off sleep.
start_update() {
    : > "$DASH_RUN/pending"
    sh "$DASH_RUN/update.sh" "$1" < /dev/null > /dev/null 2>&1 &
}

busy() {
    update_running || [ -f "$DASH_RUN/pending" ]
}

stop_update() {
    local i=0
    if update_running; then
        kill "$(cat "$DASH_RUN/lock/pid")" 2>/dev/null
        while update_running && [ "$i" -lt 3 ]; do
            sleep 1
            i=$((i + 1))
        done
        log "stopped the running update"
    fi
}

on_sleep() {
    # Remember the Wi-Fi setting once per sleep (until woken to read), so a
    # repeated event doesn't record the "off" we set ourselves.
    if [ ! -f "$DASH_RUN/wifi_was" ]; then
        wifi_enabled
        echo "$WIFI" > "$DASH_RUN/wifi_was"
    fi
    log "power: $(prop com.lab126.powerd status | tr '\n' ' ' | cut -c1-200)"
    if due 60 || [ ! -s "$DASH_RUN/dashboard.png" ]; then
        start_update scheduled
    else
        wifi_set 0
        set_wake_timer
    fi
    # Give the stock sleep screen a moment to finish drawing, then cover it.
    (
        sleep "$DRAW_DELAY"
        asleep && draw_image
    ) &
}

on_ready_to_suspend() {
    if busy; then
        # update.sh arms the wake timer itself when it finishes.
        : > "$DASH_RUN/deferred"
        lipc-set-prop -i com.lab126.powerd deferSuspend $((WIFI_TIMEOUT + FETCH_TIMEOUT + 10)) 2>/dev/null
        log "holding off deep sleep while fetching"
    else
        set_wake_timer
    fi
}

on_wake() {
    # Woken by the timer (a refresh is due), or by the power button
    # (outOfScreenSaver follows). Decide now, before anything moves the
    # next refresh time, then wait a moment to see whether it stays asleep.
    due 90 || return 0
    : > "$DASH_RUN/pending"
    (
        sleep 2
        if asleep; then
            sh "$DASH_RUN/update.sh" scheduled < /dev/null > /dev/null 2>&1
        fi
        rm -f "$DASH_RUN/pending"
    ) &
}

on_read() {
    stop_update
    rm -f "$DASH_RUN/deferred" "$DASH_RUN/pending"
    if [ -f "$DASH_RUN/wifi_was" ]; then
        wifi_set "$(cat "$DASH_RUN/wifi_was")"
        rm -f "$DASH_RUN/wifi_was"
    fi
}

# Refresh on time even when the Kindle stays on the sleep screen without
# entering deep sleep (no readyToSuspend / wakeupFromSuspend then).
ticker() {
    while :; do
        sleep "$TICK"
        if due 0 && ! busy && asleep; then
            log "refresh due while on the sleep screen (not in deep sleep)"
            start_update scheduled
        fi
    done
}

start_update start
ticker &

while :; do
    lipc-wait-event -m com.lab126.powerd goingToScreenSaver,outOfScreenSaver,readyToSuspend,wakeupFromSuspend 2> /dev/null |
        while read -r ev arg _rest; do
            [ "$ev" = com.lab126.powerd ] && ev=$arg
            power_state
            log "event $ev (state $PSTATE)"
            case "$ev" in
                goingToScreenSaver) on_sleep ;;
                readyToSuspend) on_ready_to_suspend ;;
                wakeupFromSuspend) on_wake ;;
                outOfScreenSaver) on_read ;;
            esac
            flush_log
        done
    log "event listener stopped; restarting in 5s"
    sleep 5
done

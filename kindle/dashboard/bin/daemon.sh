#!/bin/sh
# Background part of the dashboard. Started by ctl.sh in its own process
# group, it waits for the Kindle's power events:
#
#   goingToScreenSaver  the Kindle went to sleep: remember the Wi-Fi setting,
#                       turn Wi-Fi off, draw the latest image over the sleep
#                       screen, and fetch a new one if a refresh is due
#   readyToSuspend      about to enter deep sleep: arm the wake-up timer for
#                       the next refresh, or the next minute if the clock is
#                       on (and hold off sleep mid-fetch)
#   wakeupFromSuspend   woken from deep sleep: if it was the timer, refresh,
#                       or just update the clock (no Wi-Fi)
#   outOfScreenSaver    woken to read: stop any fetch, restore Wi-Fi
#
# The Kindle doesn't always enter deep sleep (for example while plugged into
# a computer it stays on the sleep screen), so a light check every TICK
# seconds (and on each minute, for the clock) also does both. In deep sleep
# that check is frozen with everything else and costs nothing.

. "$(dirname "$0")/lib.sh"
load_config

read -r _pid _comm _state _ppid PGID _rest < /proc/$$/stat
echo "$PGID" > "$DASH_RUN/daemon.pgid"
rm -f "$DASH_RUN/wifi_was" "$DASH_RUN/pending" "$DASH_RUN/deferred" "$DASH_RUN/clock_shown"
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
    rm -f "$DASH_RUN/clock_shown" # the stock sleep screen is about to cover the dashboard
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
        asleep && show_dashboard
    ) &
}

on_ready_to_suspend() {
    if busy; then
        # Whatever is running arms the wake timer itself when it finishes.
        : > "$DASH_RUN/deferred"
        if ! update_running && [ "$(cat "$DASH_RUN/pending" 2>/dev/null)" = clock ]; then
            lipc-set-prop -i com.lab126.powerd deferSuspend 10 2>/dev/null
        else
            lipc-set-prop -i com.lab126.powerd deferSuspend $((WIFI_TIMEOUT + FETCH_TIMEOUT + 10)) 2>/dev/null
            log "holding off deep sleep while fetching"
        fi
    else
        set_wake_timer
    fi
}

on_wake() {
    # Woken by the timer (a refresh or a clock minute is due), or by the
    # power button (outOfScreenSaver follows). Decide now, before anything
    # moves the next refresh time, then wait a moment to see whether it
    # stays asleep.
    local job
    if clock_on; then
        # The clock wakes the Kindle every minute, so only refresh when due.
        if due 30; then job=update; else job=clock; fi
    elif due 90; then
        job=update
    else
        return 0
    fi
    [ "$job" = update ] && log "timer wake: refresh due"
    echo "$job" > "$DASH_RUN/pending"
    (
        sleep 2
        if ! asleep; then
            :
        elif [ "$job" = update ]; then
            sh "$DASH_RUN/update.sh" scheduled < /dev/null > /dev/null 2>&1
        elif [ -f "$DASH_RUN/clock_shown" ]; then
            draw_clock
        else
            show_dashboard # not showing yet (e.g. slept before it was drawn)
        fi
        rm -f "$DASH_RUN/pending"
        # If deep sleep was held off for us, arm the timer and let it go now.
        if [ "$job" = clock ] && [ -f "$DASH_RUN/deferred" ]; then
            rm -f "$DASH_RUN/deferred"
            set_wake_timer
            lipc-set-prop -i com.lab126.powerd deferSuspend 2 2>/dev/null
        fi
    ) &
}

on_read() {
    stop_update
    rm -f "$DASH_RUN/deferred" "$DASH_RUN/pending" "$DASH_RUN/clock_shown"
    if [ -f "$DASH_RUN/wifi_was" ]; then
        wifi_set "$(cat "$DASH_RUN/wifi_was")"
        rm -f "$DASH_RUN/wifi_was"
    fi
}

# Refresh and keep the clock on time even when the Kindle stays on the sleep
# screen without entering deep sleep (no readyToSuspend / wakeupFromSuspend
# then).
ticker() {
    local s
    while :; do
        s=$TICK
        if clock_on; then
            # Just after the next minute starts, if that comes sooner.
            s=$((61 - $(date +%s) % 60))
            [ "$s" -gt "$TICK" ] && s=$TICK
        fi
        sleep "$s"
        busy && continue
        if due 0; then
            asleep || continue
            log "refresh due while on the sleep screen (not in deep sleep)"
            start_update scheduled
        elif [ -f "$DASH_RUN/clock_shown" ] && asleep; then
            draw_clock
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
            # With the clock on these come every minute: too many to log.
            case "$ev" in
                readyToSuspend | wakeupFromSuspend) clock_on || log "event $ev (state $PSTATE)" ;;
                *) log "event $ev (state $PSTATE)" ;;
            esac
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

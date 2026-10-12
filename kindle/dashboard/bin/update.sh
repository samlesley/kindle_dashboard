#!/bin/sh
# Fetch a fresh dashboard image and, if the Kindle is asleep, show it.
#
#   update.sh scheduled   woken by the timer (or just went to sleep)
#   update.sh manual      "Dashboard: Update Now"
#   update.sh start       first fetch after "Dashboard: Start"
#
# When asleep, Wi-Fi is switched off afterwards. Otherwise Wi-Fi is left as
# it was found. On any failure the previous image stays.

. "$(dirname "$0")/lib.sh"
load_config
MODE=${1:-scheduled}
CURL_PID=""
# The bundled curl (copied in by ctl.sh) if it runs here, else the Kindle's.
if [ -x "$DASH_RUN/curl" ]; then CURL="$DASH_RUN/curl"; else CURL=curl; fi

# One update at a time.
if ! mkdir "$DASH_RUN/lock" 2>/dev/null; then
    if update_running; then
        log "update ($MODE): another update is running"
        rm -f "$DASH_RUN/pending"
        exit 0
    fi
    rm -f "$DASH_RUN/lock/pid"
    rmdir "$DASH_RUN/lock" 2>/dev/null
    mkdir "$DASH_RUN/lock" || exit 0
fi
echo $$ > "$DASH_RUN/lock/pid"
rm -f "$DASH_RUN/pending"
release() {
    rm -f "$DASH_RUN/lock/pid" "$DASH_RUN/fetch.png"
    rmdir "$DASH_RUN/lock" 2>/dev/null
}
trap release EXIT
trap 'log "update ($MODE): interrupted"; [ -n "$CURL_PID" ] && kill "$CURL_PID" 2>/dev/null; exit 1' TERM INT

wifi_enabled
WIFI_BEFORE=$WIFI

# The next refresh time goes into the request so it can be shown on screen.
next_slot "$(date +%s)"
echo "$NEXT_EPOCH" > "$DASH_RUN/next_epoch"
battery

redact() { # keep the token out of logs
    if [ -n "$DASHBOARD_TOKEN" ]; then sed "s/$DASHBOARD_TOKEN/<token>/g"; else cat; fi
}

fetch() {
    local sep='?' url rc size sig
    case "$DASHBOARD_URL" in *\?*) sep='&' ;; esac
    url="$DASHBOARD_URL${sep}k=$DASHBOARD_TOKEN&batt=$BATT&next=$NEXT_HHMM"
    rm -f "$DASH_RUN/fetch.png"
    "$CURL" -sS --fail --connect-timeout 10 --max-time "$FETCH_TIMEOUT" --retry 1 \
        --cacert "$CA_BUNDLE" -o "$DASH_RUN/fetch.png" "$url" 2> "$DASH_RUN/curl.err" &
    CURL_PID=$!
    # Watchdog in case curl gets stuck where its own --max-time can't act.
    (sleep $((FETCH_TIMEOUT + 10)) && kill -KILL "$CURL_PID") 2> /dev/null &
    WATCHDOG=$!
    wait "$CURL_PID"
    rc=$?
    kill "$WATCHDOG" 2> /dev/null
    CURL_PID=""
    if [ "$rc" -ne 0 ]; then
        log "fetch failed (curl exit $rc): $(head -c 300 "$DASH_RUN/curl.err" | tr '\n' ' ' | redact)"
        return 1
    fi
    size=$(wc -c < "$DASH_RUN/fetch.png")
    sig=$(dd if="$DASH_RUN/fetch.png" bs=1 skip=1 count=3 2>/dev/null)
    if [ "$sig" != PNG ] || [ "$size" -lt 1000 ]; then
        log "fetch returned something that is not a dashboard image ($size bytes)"
        return 1
    fi
    mv "$DASH_RUN/fetch.png" "$DASH_RUN/dashboard.png"
    log "fetched new image ($size bytes, next $NEXT_HHMM, battery ${BATT:-?}%)"
    # Keep a copy on the USB storage so it survives a restart.
    if userstore_ok; then
        mkdir -p "$DASH_HOME/cache" && cp "$DASH_RUN/dashboard.png" "$DASH_HOME/cache/dashboard.png"
    fi
    return 0
}

power_state
log "update ($MODE): starting (state $PSTATE, wifi $WIFI_BEFORE)"
OK=0
if [ -z "$DASHBOARD_URL" ] || [ -z "$DASHBOARD_TOKEN" ]; then
    log "update ($MODE): DASHBOARD_URL or DASHBOARD_TOKEN missing from config.sh"
elif wifi_connect; then
    fetch && OK=1
else
    log "Wi-Fi did not connect within ${WIFI_TIMEOUT}s"
fi

if asleep; then
    wifi_set 0
    draw_image
    set_wake_timer
    # The daemon holds off sleep while we work; let the Kindle sleep again now.
    if [ -f "$DASH_RUN/deferred" ]; then
        rm -f "$DASH_RUN/deferred"
        lipc-set-prop -i com.lab126.powerd deferSuspend 2 2>/dev/null
    fi
else
    [ "$WIFI_BEFORE" = 1 ] || wifi_set 0
fi

if [ "$OK" = 1 ]; then
    hhmm "$(date +%s)"
    echo "OK at $HHMM" > "$DASH_RUN/last_result"
else
    hhmm "$(date +%s)"
    echo "FAILED at $HHMM (see log.txt)" > "$DASH_RUN/last_result"
fi
log "update ($MODE): done"
flush_log
[ "$OK" = 1 ]

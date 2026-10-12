# Shared helpers for the Kindle dashboard client. Sourced by daemon.sh,
# update.sh and ctl.sh. Written for the Kindle's BusyBox ash: no bashisms,
# and helpers set global variables instead of echoing, to avoid forking.
# shellcheck disable=SC2034  # those globals are read by the sourcing scripts

DASH_HOME=${DASH_HOME:-/mnt/us/dashboard}   # install folder on the USB storage
DASH_RUN=${DASH_RUN:-/tmp/kindle-dashboard} # working copy and state, in RAM
FBINK=${FBINK:-/mnt/us/libkh/bin/fbink}     # installed by the jailbreak hotfix

# ---------------------------------------------------------------- config

load_config() {
    DASHBOARD_URL=""
    DASHBOARD_TOKEN=""
    SCHEDULE="06:00-10:00=10 10:00-22:00=30 22:00-06:00=120"
    DRAW_DELAY=2
    WIFI_TIMEOUT=30
    FETCH_TIMEOUT=20
    TICK=30 # seconds between checks while on the sleep screen without deep sleep
    # The working copy is used once running, so the USB storage can be
    # unavailable (e.g. plugged into a computer) without breaking anything.
    if [ -f "$DASH_RUN/config.sh" ]; then
        . "$DASH_RUN/config.sh"
    elif [ -f "$DASH_HOME/config.sh" ]; then
        . "$DASH_HOME/config.sh"
    fi
    CA_BUNDLE="$DASH_RUN/cacert.pem"
}

# ---------------------------------------------------------------- logging

log() {
    london "$(date +%s)"
    fmt2 "$L_H"; _h=$P2
    fmt2 "$L_MI"; _m=$P2
    fmt2 "$L_S"; _s=$P2
    fmt2 "$L_M"; _mo=$P2
    fmt2 "$L_D"; _d=$P2
    printf '%s-%s-%s %s:%s:%s %s\n' "$L_Y" "$_mo" "$_d" "$_h" "$_m" "$_s" "$*" >> "$DASH_RUN/log.txt"
}

# Move the RAM log onto the USB storage when it is safe to write there.
flush_log() {
    [ -s "$DASH_RUN/log.txt" ] || return 0
    userstore_ok || return 0
    cat "$DASH_RUN/log.txt" >> "$DASH_HOME/log.txt" 2>/dev/null && : > "$DASH_RUN/log.txt"
    # Keep the log to roughly the last 1000 lines.
    if [ "$(wc -l < "$DASH_HOME/log.txt")" -gt 1500 ]; then
        tail -n 1000 "$DASH_HOME/log.txt" > "$DASH_HOME/log.tmp" && mv "$DASH_HOME/log.tmp" "$DASH_HOME/log.txt"
    fi
}

# ---------------------------------------------------------------- time
# All schedule times are Europe/London. The Kindle's clock runs on UTC, so
# the UK offset is worked out here: BST runs from 01:00 UTC on the last
# Sunday in March to 01:00 UTC on the last Sunday in October.

fmt2() { # number -> P2, zero-padded to two digits
    if [ "$1" -lt 10 ]; then P2="0$1"; else P2="$1"; fi
}

days_from_civil() { # year month day -> R, days since 1970-01-01
    local y=$1 m=$2 d=$3 era yoe mp doy doe
    [ "$m" -le 2 ] && y=$((y - 1))
    era=$((y / 400))
    yoe=$((y - era * 400))
    if [ "$m" -gt 2 ]; then mp=$((m - 3)); else mp=$((m + 9)); fi
    doy=$(((153 * mp + 2) / 5 + d - 1))
    doe=$((yoe * 365 + yoe / 4 - yoe / 100 + doy))
    R=$((era * 146097 + doe - 719468))
}

civil_from_days() { # days since 1970-01-01 -> CY CM CD
    local z era doe yoe doy mp
    z=$(($1 + 719468))
    era=$((z / 146097))
    doe=$((z - era * 146097))
    yoe=$(((doe - doe / 1460 + doe / 36524 - doe / 146096) / 365))
    CY=$((yoe + era * 400))
    doy=$((doe - (365 * yoe + yoe / 4 - yoe / 100)))
    mp=$(((5 * doy + 2) / 153))
    CD=$((doy - (153 * mp + 2) / 5 + 1))
    if [ "$mp" -lt 10 ]; then CM=$((mp + 3)); else CM=$((mp - 9)); fi
    [ "$CM" -le 2 ] && CY=$((CY + 1))
}

uk_offset() { # epoch -> OFF, seconds ahead of UTC (0 or 3600)
    local start end
    civil_from_days $(($1 / 86400))
    days_from_civil "$CY" 3 31
    start=$(((R - (R + 4) % 7) * 86400 + 3600))
    days_from_civil "$CY" 10 31
    end=$(((R - (R + 4) % 7) * 86400 + 3600))
    if [ "$1" -ge "$start" ] && [ "$1" -lt "$end" ]; then OFF=3600; else OFF=0; fi
}

london() { # epoch -> L_Y L_M L_D L_H L_MI L_S, and L_MOD (minute of day)
    local t s
    uk_offset "$1"
    t=$(($1 + OFF))
    civil_from_days $((t / 86400))
    L_Y=$CY
    L_M=$CM
    L_D=$CD
    s=$((t % 86400))
    L_H=$((s / 3600))
    L_MI=$((s % 3600 / 60))
    L_S=$((s % 60))
    L_MOD=$((s / 60))
}

hhmm() { # epoch -> HHMM, London time as HH:MM
    london "$1"
    fmt2 "$L_H"; HHMM=$P2
    fmt2 "$L_MI"; HHMM="$HHMM:$P2"
}

# ---------------------------------------------------------------- schedule
# SCHEDULE is a list of "HH:MM-HH:MM=MINUTES" bands. Refreshes happen at
# the start of each band and every MINUTES after, until the band ends.

clock_minutes() { # HH:MM -> R, minutes since midnight
    local h=${1%:*} m=${1#*:}
    case "$h" in ?) h="0$h" ;; esac
    R=$(((1$h - 100) * 60 + (1$m - 100)))
}

is_slot() { # minute-of-day -> success if a refresh is due then
    local band iv start end off len
    for band in $SCHEDULE; do
        iv=${band#*=}
        band=${band%%=*}
        clock_minutes "${band%-*}"; start=$R
        clock_minutes "${band#*-}"; end=$R
        off=$((($1 - start + 1440) % 1440))
        len=$(((end - start + 1440) % 1440))
        [ "$len" -eq 0 ] && len=1440
        if [ "$off" -lt "$len" ]; then
            [ $((off % iv)) -eq 0 ]
            return
        fi
    done
    return 1
}

next_slot() { # epoch -> NEXT_EPOCH and NEXT_HHMM, the next refresh at least a minute away
    local t i=0
    t=$((($1 + 119) / 60 * 60))
    while [ "$i" -lt 1440 ]; do
        london "$t"
        if is_slot "$L_MOD"; then
            NEXT_EPOCH=$t
            hhmm "$t"
            NEXT_HHMM=$HHMM
            return 0
        fi
        t=$((t + 60))
        i=$((i + 1))
    done
    NEXT_EPOCH=$(($1 + 3600))
    hhmm "$NEXT_EPOCH"
    NEXT_HHMM=$HHMM
}

# ---------------------------------------------------------------- device

prop() { # service property -> value on stdout (empty if unavailable)
    lipc-get-prop "$1" "$2" 2>/dev/null
}

userstore_ok() { # the USB storage is mounted on the Kindle (not lent to a computer)
    [ "$(prop com.lab126.volumd userstoreIsAvailable)" = 1 ]
}

power_state() { # -> PSTATE, e.g. active, screenSaver, readyToSuspend
    PSTATE=$(prop com.lab126.powerd state)
    if [ -z "$PSTATE" ]; then
        case "$(prop com.lab126.powerd status)" in
            *"Screen Saver"*) PSTATE=screenSaver ;;
            *"Ready to suspend"*) PSTATE=readyToSuspend ;;
            *Active*) PSTATE=active ;;
            *) PSTATE=unknown ;;
        esac
    fi
}

asleep() { # the sleep screen is showing
    power_state
    case "$PSTATE" in
        active | unknown) return 1 ;;
        *) return 0 ;;
    esac
}

wifi_enabled() { # -> WIFI (1 on, 0 off)
    WIFI=$(prop com.lab126.cmd wirelessEnable)
    [ "$WIFI" = 1 ] || WIFI=0
}

wifi_set() { # 1 or 0
    lipc-set-prop com.lab126.cmd wirelessEnable "$1" 2>/dev/null
}

wifi_connect() { # switch Wi-Fi on and wait for a connection; success if connected
    local i=0
    wifi_set 1
    while [ "$i" -lt "$WIFI_TIMEOUT" ]; do
        [ "$(prop com.lab126.wifid cmState)" = CONNECTED ] && return 0
        sleep 1
        i=$((i + 1))
    done
    return 1
}

battery() { # -> BATT, percent
    BATT=$(prop com.lab126.powerd battLevel)
    case "$BATT" in
        '' | *[!0-9]*) BATT="" ;;
    esac
}

set_wake_timer() { # arm the RTC wake for the stored next refresh
    local now next secs
    now=$(date +%s)
    next=$(cat "$DASH_RUN/next_epoch" 2>/dev/null)
    case "$next" in '' | *[!0-9]*) next=0 ;; esac
    if [ "$next" -le $((now + 30)) ]; then
        next_slot "$now"
        next=$NEXT_EPOCH
        echo "$next" > "$DASH_RUN/next_epoch"
    fi
    secs=$((next - now))
    [ "$secs" -lt 60 ] && secs=60
    lipc-set-prop -i com.lab126.powerd rtcWakeup "$secs" 2>/dev/null
    hhmm "$next"
    log "wake timer set for $HHMM (${secs}s)"
}

draw_image() { # show the latest dashboard image full screen
    local img="$DASH_RUN/dashboard.png"
    [ -s "$img" ] || return 0
    if [ -x "$FBINK" ] && "$FBINK" -q -c -f -g file="$img" >/dev/null 2>&1; then
        return 0
    fi
    eips -f -g "$img" >/dev/null 2>&1
}

run_with_timeout() { # seconds command... -> the command's status, or 124 if it overran
    local limit=$1 i=0 pid
    shift
    "$@" &
    pid=$!
    while kill -0 "$pid" 2>/dev/null; do
        if [ "$i" -ge "$limit" ]; then
            kill -KILL "$pid" 2>/dev/null
            wait "$pid" 2>/dev/null
            return 124
        fi
        sleep 1
        i=$((i + 1))
    done
    wait "$pid"
}

update_running() {
    [ -d "$DASH_RUN/lock" ] && kill -0 "$(cat "$DASH_RUN/lock/pid" 2>/dev/null)" 2>/dev/null
}

due() { # [early-seconds] -> success if the next refresh time has (nearly) arrived
    local now next
    now=$(date +%s)
    next=$(cat "$DASH_RUN/next_epoch" 2>/dev/null)
    case "$next" in '' | *[!0-9]*) return 0 ;; esac
    [ "$now" -ge $((next - ${1:-60})) ]
}

# shellcheck disable=SC2034  # read by lib.sh
# Kindle dashboard settings. Copy this file to config.sh in the same folder
# and fill in the two values below. After changing config.sh, tap
# "Dashboard: Start" again so the change takes effect.

# Your Worker's address, as printed by `npx wrangler deploy`. Nothing after it.
DASHBOARD_URL="https://kindle-dashboard.YOUR-SUBDOMAIN.workers.dev/"

# The ACCESS_TOKEN you stored with `npx wrangler secret put ACCESS_TOKEN`.
DASHBOARD_TOKEN=""

# Refresh times (UK time, clock changes handled): "START-END=MINUTES" bands.
# Default: every 10 min 06:00-10:00, every 30 min 10:00-22:00, every 2 h overnight.
SCHEDULE="06:00-10:00=10 10:00-22:00=30 22:00-06:00=120"

# Seconds to wait after the Kindle goes to sleep before drawing the dashboard,
# so the normal sleep screen has finished. Raise it if the normal sleep screen
# ends up on top.
DRAW_DELAY=2

# Give up on Wi-Fi or the download after this many seconds (keeps wakes short).
WIFI_TIMEOUT=30
FETCH_TIMEOUT=20

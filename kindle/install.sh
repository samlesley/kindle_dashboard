#!/bin/sh
# Copy the dashboard client onto a Kindle connected over USB.
#
#   ./install.sh                  Kindle mounted at /Volumes/Kindle (macOS)
#   ./install.sh /media/me/Kindle  any other mount point
#
# Your config.sh on the Kindle is never overwritten.

set -e
KINDLE=${1:-/Volumes/Kindle}
HERE=$(cd "$(dirname "$0")" && pwd)

if [ ! -d "$KINDLE/documents" ]; then
    echo "No Kindle found at $KINDLE (expected a documents folder there)."
    echo "Plug the Kindle in, or pass its mount point: ./install.sh /path/to/Kindle"
    exit 1
fi

# macOS's cp -X skips the "._" metadata files that FAT drives otherwise get;
# stray ._*.sh files would show up as broken scriptlets in the library.
CP="cp"
if cp -X /dev/null "${TMPDIR:-/tmp}/kdash-cp-test" 2>/dev/null; then CP="cp -X"; fi
rm -f "${TMPDIR:-/tmp}/kdash-cp-test"

mkdir -p "$KINDLE/dashboard/bin" "$KINDLE/dashboard/certs" "$KINDLE/dashboard/clock"
$CP "$HERE"/dashboard/bin/*.sh "$HERE/dashboard/bin/curl" "$KINDLE/dashboard/bin/"
$CP "$HERE/dashboard/certs/cacert.pem" "$KINDLE/dashboard/certs/"
$CP "$HERE"/dashboard/clock/* "$KINDLE/dashboard/clock/"
$CP "$HERE/dashboard/config.example.sh" "$KINDLE/dashboard/"
$CP "$HERE"/documents/dashboard-*.sh "$KINDLE/documents/"

NEW_CONFIG=0
if [ ! -f "$KINDLE/dashboard/config.sh" ]; then
    $CP "$HERE/dashboard/config.example.sh" "$KINDLE/dashboard/config.sh"
    NEW_CONFIG=1
fi

find "$KINDLE/dashboard" "$KINDLE/documents" -name '._*' -type f -delete 2>/dev/null || true

echo "Copied the dashboard to $KINDLE."
if [ "$NEW_CONFIG" = 1 ]; then
    echo
    echo "Next: put your Worker URL and token into the settings file:"
    echo "  nano \"$KINDLE/dashboard/config.sh\""
fi
echo
echo "Then eject the Kindle and tap \"Dashboard: Start\" in its library."

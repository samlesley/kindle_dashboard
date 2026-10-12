#!/bin/sh
# Rebuilds dashboard/bin/curl: a static ARMv7 curl with Mbed TLS.
#
# The Kindle's own curl uses an encryption library too old for Cloudflare
# (handshake failure, curl exit 35), so the client ships this one instead.
# It is fully static, so it doesn't depend on the firmware's libraries.
#
# Needs python3 (with venv/pip) and git. Uses Zig as the cross-compiler.
#
#   kindle/tools/build-curl.sh

set -eu
CURL_TAG=curl-8_22_0
MBEDTLS_TAG=v3.6.7
TARGET="-target arm-linux-musleabi -mcpu=cortex_a9" # Paperwhite 2 and later

HERE=$(cd "$(dirname "$0")" && pwd)
OUT="$HERE/../dashboard/bin/curl"
WORK=${WORK:-$(mktemp -d)}
echo "building in $WORK"

python3 -m venv "$WORK/venv"
"$WORK/venv/bin/pip" install -q ziglang cmake
PY="$WORK/venv/bin/python"
CMAKE="$WORK/venv/bin/cmake"

mkdir -p "$WORK/tc" "$WORK/prefix"
printf '#!/bin/sh\nexec "%s" -m ziglang cc %s "$@"\n' "$PY" "$TARGET" > "$WORK/tc/cc"
printf '#!/bin/sh\nexec "%s" -m ziglang ar "$@"\n' "$PY" > "$WORK/tc/ar"
printf '#!/bin/sh\nexec "%s" -m ziglang ranlib "$@"\n' "$PY" > "$WORK/tc/ranlib"
chmod +x "$WORK/tc/cc" "$WORK/tc/ar" "$WORK/tc/ranlib"
cat > "$WORK/tc/toolchain.cmake" << EOF
set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR arm)
set(CMAKE_C_COMPILER $WORK/tc/cc)
set(CMAKE_AR $WORK/tc/ar)
set(CMAKE_RANLIB $WORK/tc/ranlib)
set(CMAKE_FIND_ROOT_PATH $WORK/prefix)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
EOF

git clone -q --depth 1 --recurse-submodules --shallow-submodules -b "$MBEDTLS_TAG" \
    https://github.com/Mbed-TLS/mbedtls "$WORK/mbedtls"
"$CMAKE" -S "$WORK/mbedtls" -B "$WORK/mbedtls/build" -DCMAKE_TOOLCHAIN_FILE="$WORK/tc/toolchain.cmake" \
    -DCMAKE_BUILD_TYPE=MinSizeRel -DENABLE_TESTING=OFF -DENABLE_PROGRAMS=OFF \
    -DUSE_SHARED_MBEDTLS_LIBRARY=OFF -DUSE_STATIC_MBEDTLS_LIBRARY=ON -DCMAKE_INSTALL_PREFIX="$WORK/prefix" > /dev/null
"$CMAKE" --build "$WORK/mbedtls/build" -j 8 > /dev/null
"$CMAKE" --install "$WORK/mbedtls/build" > /dev/null

git clone -q --depth 1 -b "$CURL_TAG" https://github.com/curl/curl "$WORK/curl"
# Mark it as the release, as curl's release tarballs do.
DATE=$(git -C "$WORK/curl" log -1 --format=%cd --date=format:%Y-%m-%d)
sed -i.bak -e 's/\(#define LIBCURL_VERSION "[0-9.]*\)-DEV"/\1"/' \
    -e "s/#define LIBCURL_TIMESTAMP \".*\"/#define LIBCURL_TIMESTAMP \"$DATE\"/" \
    "$WORK/curl/include/curl/curlver.h"
"$CMAKE" -S "$WORK/curl" -B "$WORK/curl/build" -DCMAKE_TOOLCHAIN_FILE="$WORK/tc/toolchain.cmake" \
    -DCMAKE_BUILD_TYPE=MinSizeRel -DCMAKE_EXE_LINKER_FLAGS=-static \
    -DBUILD_SHARED_LIBS=OFF -DBUILD_STATIC_LIBS=ON -DBUILD_STATIC_CURL=ON -DBUILD_CURL_EXE=ON \
    -DBUILD_TESTING=OFF -DBUILD_LIBCURL_DOCS=OFF -DBUILD_MISC_DOCS=OFF -DENABLE_CURL_MANUAL=OFF \
    -DCURL_USE_MBEDTLS=ON -DCURL_USE_OPENSSL=OFF -DCURL_USE_LIBPSL=OFF -DCURL_USE_LIBSSH2=OFF \
    -DCURL_USE_LIBSSH=OFF -DUSE_NGHTTP2=OFF -DUSE_LIBIDN2=OFF -DCURL_ZLIB=OFF -DCURL_BROTLI=OFF \
    -DCURL_ZSTD=OFF -DHTTP_ONLY=ON -DCURL_DISABLE_LDAP=ON \
    -DCURL_CA_BUNDLE=none -DCURL_CA_PATH=none -DCURL_CA_FALLBACK=OFF > /dev/null
"$CMAKE" --build "$WORK/curl/build" -j 8 --target curl > /dev/null

cp "$WORK/curl/build/src/curl" "$OUT"
chmod 755 "$OUT"
echo "wrote $OUT"
if command -v sha256sum > /dev/null; then sha256sum "$OUT"; else shasum -a 256 "$OUT"; fi

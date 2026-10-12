# Third-party software

`dashboard/bin/curl` is a static ARMv7 build of:

| Component | Version | Licence |
| --- | --- | --- |
| [curl](https://curl.se/) | 8.22.0 | curl licence (MIT-style), see `curl-COPYING.txt` |
| [Mbed TLS](https://www.trustedfirmware.org/projects/mbed-tls/) | 3.6.7 (LTS) | Apache-2.0 OR GPL-2.0-or-later, see `mbedtls-LICENSE.txt` |
| [musl libc](https://musl.libc.org/), via Zig 0.17.0 | | MIT, see `musl-COPYRIGHT.txt` |

It was built from the upstream release tags with
[`tools/build-curl.sh`](../tools/build-curl.sh), targeting
`arm-linux-musleabi`, Cortex-A9 (Kindle Paperwhite 2 and later), with Mbed TLS
set to read `/dev/urandom` (the default `/dev/random` blocks on the Kindle).

SHA-256: `dc93a1f6e87bbedd85b131762eeaa6346a86799a8954ffbb9d3d54c5ab20fdaf`

`dashboard/certs/cacert.pem` is Mozilla's CA list from certifi, under the
Mozilla Public License 2.0 (see `dashboard/certs/README.md`).

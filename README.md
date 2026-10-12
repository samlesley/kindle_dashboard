# Kindle train and weather display

A live departures and weather screen for a jailbroken Kindle Paperwhite (10th gen), in the teletext style of [`docs/mockup.png`](docs/mockup.png).

| Part | Folder | Status |
| --- | --- | --- |
| 1. Cloudflare Worker that draws the screen as a PNG | [`worker/`](worker/README.md) | Deployed |
| 2. Kindle client that shows it as the sleep screen | [`kindle/`](kindle/README.md) | Ready for testing on the device |

![Sample render](worker/preview/normal.png)

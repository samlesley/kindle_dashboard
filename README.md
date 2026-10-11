# Kindle train and weather display

A live departures and weather screen for a jailbroken Kindle Paperwhite (10th gen), in the teletext style of [`docs/mockup.png`](docs/mockup.png).

| Part | Folder | Status |
| --- | --- | --- |
| 1. Cloudflare Worker that draws the screen as a PNG | [`worker/`](worker/README.md) | Ready for review |
| 2. Kindle client that fetches and shows it | `kindle/` | Not started |

![Sample render](worker/preview/normal.png)

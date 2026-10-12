import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clockFiles } from "../src/clock";
import { loadConfig } from "../src/config";
import { gatherDashboard, type DashboardModel } from "../src/dashboard";
import { clockCells, drawClockDigit, drawDashboard, WIDTH } from "../src/layout";
import { loadFont } from "../src/render";
import { londonTime } from "../src/time";
import { fixtureFetch, SAMPLE_TIME } from "../scripts/fixtures";

const font = loadFont(readFileSync(new URL("../fonts/VT323-Regular.ttf", import.meta.url)));
const FOOTER_RULE = 1398; // the footer below it also shows the update time

async function model(): Promise<DashboardModel> {
  return gatherDashboard(loadConfig({}), { fetch: fixtureFetch() }, SAMPLE_TIME, { battery: "82", next: "06:54" });
}

function render(m: DashboardModel, hhmm: string): Uint8Array {
  const [h, mi] = hhmm.split(":").map(Number);
  const now = { ...londonTime(SAMPLE_TIME), hour: h, minute: mi, minutes: h * 60 + mi, hhmm };
  return drawDashboard(font, { ...m, now }).data.slice(); // the frame buffer is reused, so copy it
}

/** What the Kindle does: paste one digit image per cell of HH:MM. */
function pasteClock(px: Uint8Array, hhmm: string): void {
  const cells = clockCells(font);
  hhmm.replace(":", "").split("").forEach((ch, i) => {
    const digit = drawClockDigit(font, Number(ch)).data;
    for (let y = 0; y < cells.height; y++) {
      const row = (cells.top + y) * WIDTH + cells.xs[i];
      px.set(digit.subarray(y * cells.width, (y + 1) * cells.width), row);
    }
  });
}

describe("clock digits for the Kindle", () => {
  it("pasting them gives exactly the dashboard the Worker would draw at that time", async () => {
    const m = await model();
    const shown = render(m, "06:44");
    for (const later of ["06:45", "13:57", "20:08", "09:59", "00:00", "23:11"]) {
      const pasted = shown.slice();
      pasteClock(pasted, later);
      const expected = render(m, later);
      const end = FOOTER_RULE * WIDTH;
      expect(Buffer.from(pasted.subarray(0, end)).equals(Buffer.from(expected.subarray(0, end))), later).toBe(true);
    }
  });

  it("are up to date in kindle/dashboard/clock (run `npm run clock` if not)", () => {
    for (const [name, data] of clockFiles(font)) {
      const committed = readFileSync(new URL(`../../kindle/dashboard/clock/${name}`, import.meta.url));
      const fresh = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
      expect(committed.equals(fresh), name).toBe(true);
    }
  });
});

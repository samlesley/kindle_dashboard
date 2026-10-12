// One-off work done when the Worker starts, before any request arrives.
// Startup has its own time allowance, separate from the per-request CPU
// limit, so rasterising glyphs and getting the hot drawing and encoding
// code compiled here keeps each request's CPU time down.

import type { DashboardModel } from "../dashboard";
import { FONT_SIZES } from "../layout";
import { londonTime } from "../time";
import { renderDashboardPng } from ".";
import type { Font } from "./text";

const CHARS = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`{|}~°";
// Sizes above this only show times, the date and weather figures.
const LARGE = 55;
const LARGE_CHARS = " 0123456789:-.\u00b0ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function sampleModel(): DashboardModel {
  return {
    now: londonTime(new Date(Date.UTC(2026, 9, 9, 5, 44))),
    stationName: "ALEXANDRA PARADE",
    headingTo: "QUEEN ST / PARTICK",
    walkMinutes: 4,
    trainSource: "mock",
    trains: {
      ok: true,
      data: {
        departures: [
          { scheduled: "06:56", status: "late", statusText: "EXP 07:03", leaveBy: "06:59", destination: "MILNGAVIE" },
          { scheduled: "07:26", status: "cancelled", statusText: "CANCELLED", leaveBy: null, destination: "MILNGAVIE" },
          { scheduled: "07:56", status: "on-time", statusText: "ON TIME", leaveBy: "07:52", destination: "MILNGAVIE" },
        ],
        message: "TRAINS BETWEEN GLASGOW QUEEN STREET AND PARTICK MAY BE DELAYED BY UP TO 15 MINUTES.",
      },
    },
    weather: {
      ok: true,
      data: {
        summary: "CLOUDY. RAIN FROM 15:00.",
        high: { temp: 13, at: "15:00" },
        low: { temp: 7, at: "06:00" },
        rain: { totalMm: 6, window: "15:00-23:00" },
        gusts: { mph: 35, dir: "SW" },
        hours: [0, 9, 12, 15, 18, 21].map((h, i) => ({ label: i ? `${String(h).padStart(2, "0")}:00` : "NOW", temp: 7 + i, chance: i * 20 })),
        notices: ["RAIN FROM 15:00, PEAK 18:00. TAKE AN UMBRELLA."],
        sunrise: "07:31",
        sunset: "18:28",
      },
    },
    headline: { ok: true, data: "[TOP STORY HEADLINE FROM THE BBC NEWS FEED]" },
    battery: 82,
    nextRefresh: "06:54",
  };
}

export function warmUp(font: Font): void {
  font.prepare(CHARS, FONT_SIZES.filter((s) => s <= LARGE));
  font.prepare(LARGE_CHARS, FONT_SIZES.filter((s) => s > LARGE));
  const model = sampleModel();
  for (let i = 0; i < 3; i++) renderDashboardPng(font, model);
}

// Draws the dashboard. The layout follows docs/mockup.png (which is drawn at
// 2x; everything here is in device pixels for a 1072x1448 Paperwhite), with
// the departures a little tighter and the weather, headline and footer text
// larger so they read comfortably on the device.
//
// Font sizes are multiples of 2.5 px so VT323's 0.4 em advance lands on
// whole pixels and columns of digits line up.

import type { DashboardModel, TrainsData } from "./dashboard";
import { BLACK, Canvas, WHITE } from "./render/canvas";
import type { Align, Font } from "./render/text";
import type { Departure } from "./trains/ldb";
import { formatRain, type WeatherView } from "./weather";

export const WIDTH = 1072;
export const HEIGHT = 1448;

/** Every text size used below, so glyphs can be prepared at startup. */
export const FONT_SIZES = [30, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5, 55, 57.5, 62.5, 67.5, 75, 100] as const;

const L = 44; // left margin
const R = 1028; // right margin
const CW = R - L;
const INSET = 12; // column inset inside the departures table
const STATUS_X = 521; // EXPECTED column

// Vertical positions, top to bottom.
const TOP_LINE = 52; // baseline of "P140 TRAINS+WX"
const BAND_TOP = 64; // reversed-out date/time band
const BAND_H = 126;
const TRAINS_HEADING = 236;
const COLUMN_HEADS = 276;
const ROWS_TOP = 289;
const ROWS_BOTTOM = 634; // three rows of 115 px
const WEATHER_HEADING = 684;
const SUMMARY = 737;
const BOXES_TOP = 751;
const BOXES_H = 140;
const STRIP_TOP = 903;
const STRIP_BOTTOM = 1153;
const NOTICE_TOP = 1168;
const FOOTER_RULE = 1398;
const FOOTER_BASE = 1432;

// The time in the top right. The Kindle keeps it current between fetches by
// pasting one small image per digit over it (see clockCells below and
// kindle/dashboard/clock/), so its size and position are shared with the Kindle.
const CLOCK_SIZE = 100;
const CLOCK_RIGHT = R - 24;
const CLOCK_BASE = BAND_TOP + BAND_H - 16;

// The TIME label above it. While the Kindle's updates fail, it pastes
// "OFFLINE SINCE HH:MM" over the label (see offlineNote below).
const LABEL_SIZE = 37.5;
const LABEL_RIGHT = R - 24;
const LABEL_BASE = BAND_TOP + 37;
const OFFLINE_TEXT = "OFFLINE SINCE ";

/** Nearest multiple of 2.5 px (keeps character advances on whole pixels). */
const snap = (size: number) => Math.round(size / 2.5) * 2.5;

class Painter {
  constructor(readonly c: Canvas, readonly font: Font) {}

  text(s: string, x: number, y: number, size: number, color = BLACK, align: Align = "left", maxWidth?: number): number {
    let t = this.font.clean(s.toUpperCase());
    if (maxWidth !== undefined) t = this.font.fit(t, size, maxWidth);
    return this.font.draw(this.c, t, x, y, size, color, align);
  }

  width(s: string, size: number): number {
    return this.font.measure(this.font.clean(s.toUpperCase()), size);
  }

  wrap(s: string, size: number, maxWidth: number, maxLines: number): string[] {
    return this.font.wrap(this.font.clean(s.toUpperCase()), size, maxWidth, maxLines);
  }

  cap(size: number): number {
    return this.font.capHeight(size);
  }

  /** Section heading "[ TITLE ] ------ RIGHT". */
  heading(title: string, right: string | null, baseline: number, rightSize = 37.5): void {
    const size = 37.5;
    const rightW = right ? this.width(right, rightSize) : 0;
    const maxTitle = CW - (right ? rightW + 60 : 0);
    const titleW = this.text(title, L, baseline, size, BLACK, "left", maxTitle);
    if (right) this.text(right, R, baseline, rightSize, BLACK, "right");
    const x0 = L + titleW + 18;
    const x1 = right ? R - rightW - 18 : R;
    if (x1 - x0 > 20) this.c.hLine(x0, x1, baseline - Math.round(this.cap(size) / 2) - 1, 2, BLACK);
  }

  /** Reversed-out label such as the BBC badge. Returns its width. */
  badge(label: string, x: number, baseline: number, size: number): number {
    const w = this.width(label, size) + 16;
    const top = baseline - this.cap(size) - 9;
    this.c.fillRect(x, top, w, this.cap(size) + 17, BLACK);
    this.text(label, x + 8, baseline, size, WHITE);
    return w;
  }

  /** Dashed panel used where a section's data is missing. */
  unavailable(top: number, bottom: number, title: string, reason: string): void {
    this.c.dashedRect(L, top, CW, bottom - top, 2, 6, 4, BLACK);
    const mid = Math.round((top + bottom) / 2);
    this.text(`[ ${title} ]`, L + CW / 2, mid, 37.5, BLACK, "center", CW - 40);
    this.text(reason, L + CW / 2, mid + 40, 30, BLACK, "center", CW - 40);
  }
}

// Frame buffer reused between requests; each frame is encoded before the next starts.
let frame: Uint8Array | undefined;

export function drawDashboard(font: Font, m: DashboardModel): Canvas {
  const c = new Canvas(WIDTH, HEIGHT, WHITE, frame);
  frame = c.data;
  const p = new Painter(c, font);

  drawHeader(p, m);
  drawTrains(p, m);
  const noticeBottom = drawWeather(p, m);
  drawFooter(p, m, noticeBottom);
  return c;
}

function drawHeader(p: Painter, m: DashboardModel): void {
  p.text("P140 TRAINS+WX", L, TOP_LINE, 30);
  p.text(m.trainSource === "live" ? "NRE DARWIN / OPEN-METEO" : "MOCK TRAINS / OPEN-METEO", R, TOP_LINE, 30, BLACK, "right");

  p.c.fillRect(L, BAND_TOP, CW, BAND_H, BLACK);
  p.text(m.now.weekday, L + 24, BAND_TOP + 37, 37.5, WHITE);
  p.text(m.now.dayMonth, L + 24, BAND_TOP + BAND_H - 16, 100, WHITE);
  if (m.offlineSince) {
    const note = offlineNote(p.font);
    p.c.fillRect(note.left, note.top, note.width, note.height, WHITE);
    p.text(`${OFFLINE_TEXT}${m.offlineSince}`, LABEL_RIGHT, LABEL_BASE, LABEL_SIZE, BLACK, "right");
  } else {
    p.text("TIME", LABEL_RIGHT, LABEL_BASE, LABEL_SIZE, WHITE, "right");
  }
  p.text(m.now.hhmm, CLOCK_RIGHT, CLOCK_BASE, CLOCK_SIZE, WHITE, "right");
}

/** Where the Kindle pastes the clock digits: one cell per digit of HH:MM. */
export interface ClockCells {
  /** Left edge of each digit's cell, in HH:MM order (the colon is skipped). */
  xs: number[];
  top: number;
  width: number;
  height: number;
}

export function clockCells(font: Font): ClockCells {
  const advance = font.measure("0", CLOCK_SIZE);
  const left = CLOCK_RIGHT - font.measure("00:00", CLOCK_SIZE);
  const top = CLOCK_BASE - font.capHeight(CLOCK_SIZE) - 6;
  return { xs: [0, 1, 3, 4].map((i) => left + i * advance), top, width: advance, height: CLOCK_BASE + 6 - top };
}

/** One clock digit exactly as drawDashboard draws it, cut to its cell. */
export function drawClockDigit(font: Font, digit: number): Canvas {
  const cells = clockCells(font);
  const c = new Canvas(cells.width, cells.height, BLACK);
  font.draw(c, String(digit), 0, CLOCK_BASE - cells.top, CLOCK_SIZE, WHITE);
  return c;
}

/**
 * Where the Kindle pastes the "OFFLINE SINCE HH:MM" note: the whole note at
 * left/top (covering the TIME label), then one digit per cell of HH:MM.
 */
export interface OfflineNote {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Left edge of each digit's cell, in HH:MM order (the colon is skipped). */
  xs: number[];
  digitWidth: number;
}

export function offlineNote(font: Font): OfflineNote {
  const advance = font.measure("0", LABEL_SIZE);
  const textLeft = LABEL_RIGHT - font.measure(`${OFFLINE_TEXT}00:00`, LABEL_SIZE);
  const left = textLeft - 8;
  const top = LABEL_BASE - font.capHeight(LABEL_SIZE) - 6;
  const n = OFFLINE_TEXT.length;
  return {
    left,
    top,
    width: LABEL_RIGHT + 8 - left,
    height: LABEL_BASE + 6 - top,
    xs: [n, n + 1, n + 3, n + 4].map((i) => textLeft + i * advance),
    digitWidth: advance,
  };
}

/** The note (black on a white box) as drawDashboard draws it, with the digits of its time left blank. */
export function drawOfflineNote(font: Font): Canvas {
  const note = offlineNote(font);
  const c = new Canvas(note.width, note.height, WHITE);
  font.draw(c, `${OFFLINE_TEXT}  :  `, LABEL_RIGHT - note.left, LABEL_BASE - note.top, LABEL_SIZE, BLACK, "right");
  return c;
}

/** One digit of the note's time, cut to its cell. */
export function drawOfflineDigit(font: Font, digit: number): Canvas {
  const note = offlineNote(font);
  const c = new Canvas(note.digitWidth, note.height, WHITE);
  font.draw(c, String(digit), 0, LABEL_BASE - note.top, LABEL_SIZE, BLACK);
  return c;
}

function drawTrains(p: Painter, m: DashboardModel): void {
  p.heading(`[ ${m.stationName} > ${m.headingTo} ]`, `WALK ${m.walkMinutes} MIN`, TRAINS_HEADING);

  p.text("DUE", L + INSET, COLUMN_HEADS, 30);
  p.text("EXPECTED", STATUS_X, COLUMN_HEADS, 30);
  p.text("LEAVE BY", R - INSET, COLUMN_HEADS, 30, BLACK, "right");
  p.c.hLine(L, R, ROWS_TOP - 3, 3, BLACK);
  p.c.hLine(L, R, ROWS_BOTTOM, 3, BLACK);

  if (!m.trains.ok) {
    p.unavailable(ROWS_TOP + 14, ROWS_BOTTOM - 14, "TRAIN TIMES UNAVAILABLE", m.trains.error);
    return;
  }
  drawDepartures(p, m.trains.data);
}

function drawDepartures(p: Painter, data: TrainsData): void {
  // Service message (only when the feed has one) takes space from the rows.
  const msgSize = 30;
  let msgLines: string[] = [];
  let badgeW = 0;
  if (data.message) {
    badgeW = p.width("INFO", msgSize) + 16;
    msgLines = p.wrap(data.message, msgSize, CW - badgeW - 16, 2);
  }
  const msgH = msgLines.length ? 12 + 34 + (msgLines.length - 1) * 28 + 12 : 0;
  const rowsBottom = ROWS_BOTTOM - msgH;
  const rowH = (rowsBottom - ROWS_TOP) / 3;

  for (let i = 0; i < 3; i++) {
    const top = Math.round(ROWS_TOP + i * rowH);
    const dep = data.departures[i];
    if (dep) drawRow(p, dep, top, rowH, i === 0);
    else if (i === data.departures.length) {
      const hours = Math.round(data.horizon / 60);
      const text = `NO ${i === 0 ? "" : "MORE "}TRAINS IN THE NEXT ${hours} HOURS`;
      p.text(text, L + INSET, top + Math.round(rowH * 0.58), 37.5);
    }
    if (i < 2 || msgH) p.c.hLine(L, R, Math.round(ROWS_TOP + (i + 1) * rowH) - 1, 2, BLACK);
  }

  if (msgLines.length) {
    const firstBase = rowsBottom + 12 + 25;
    p.badge("INFO", L, firstBase, msgSize);
    msgLines.forEach((line, i) => p.text(line, L + badgeW + 16, firstBase + i * 28, msgSize));
  }
}

function drawRow(p: Painter, d: Departure, top: number, rowH: number, first: boolean): void {
  // Rows squeezed by a service message get slightly smaller text.
  const k = rowH < 110 ? 0.85 : 1;
  const timeSize = snap((first ? 75 : 67.5) * k);
  const statusSize = snap((first ? 50 : 47.5) * k);
  const leaveSize = snap((first ? 55 : 50) * k);
  const destSize = snap(37.5 * k);
  const base = top + Math.round(rowH * 0.52);
  const destBase = top + Math.round(rowH * 0.85);

  p.text(d.scheduled, L + INSET, base, timeSize);

  const leave = d.leaveBy ?? "--:--";
  const leaveW = p.text(leave, R - INSET, base, leaveSize, BLACK, "right");

  const maxStatus = R - INSET - leaveW - 40 - STATUS_X;
  const cap = p.cap(statusSize);
  if (d.status === "cancelled") {
    const w = p.width(d.statusText, statusSize);
    p.c.fillRect(STATUS_X - 10, base - cap - 9, w + 20, cap + 18, BLACK);
    p.text(d.statusText, STATUS_X, base, statusSize, WHITE, "left", maxStatus);
  } else {
    const w = p.text(d.statusText, STATUS_X, base, statusSize, BLACK, "left", maxStatus);
    if (d.status === "late" || d.status === "delayed") p.c.strokeRect(STATUS_X - 10, base - cap - 9, w + 20, cap + 18, 3, BLACK);
  }

  p.text(d.destination, L + INSET, destBase, destSize, BLACK, "left", CW - 2 * INSET);
}

/** Returns the y just below the last thing drawn (for footer spacing). */
function drawWeather(p: Painter, m: DashboardModel): number {
  const asOf = m.weather.ok && m.weather.asOf ? `AS OF ${m.weather.asOf}` : null;
  p.heading("[ WEATHER ]", asOf, WEATHER_HEADING, 30);

  if (!m.weather.ok) {
    p.text("WEATHER UNAVAILABLE", L, SUMMARY, 52.5);
    p.unavailable(BOXES_TOP, STRIP_BOTTOM, "FORECAST UNAVAILABLE", m.weather.error);
    return STRIP_BOTTOM;
  }
  const w = m.weather.data;
  p.text(w.summary, L, SUMMARY, 52.5, BLACK, "left", CW);
  drawBoxes(p, w);
  drawStrip(p, w);
  return drawOutlook(p, w.outlook);
}

function drawBoxes(p: Painter, w: WeatherView): void {
  const top = BOXES_TOP;
  const h = BOXES_H;
  const bw = CW / 4;
  p.c.strokeRect(L, top, CW, h, 2, BLACK);
  for (let k = 1; k < 4; k++) p.c.vLine(Math.round(L + k * bw) - 1, top, top + h, 2, BLACK);

  const boxes: [string, string, string][] = [
    ["HIGH", `${w.high.temp}°`, `AT ${w.high.at}`],
    ["LOW", `${w.low.temp}°`, `AT ${w.low.at}`],
    ["RAIN", formatRain(w.rain.totalMm), w.rain.window ?? "DRY"],
    ["GUSTS", `${w.gusts.mph}`, `MPH ${w.gusts.dir}`],
  ];
  boxes.forEach(([label, value, sub], k) => {
    const x = Math.round(L + k * bw) + 16;
    const max = Math.round(bw) - 28;
    p.text(label, x, top + 36, 32.5, BLACK, "left", max);
    p.text(value, x, top + 88, 62.5, BLACK, "left", max);
    p.text(sub, x, top + 124, 32.5, BLACK, "left", max);
  });
}

function drawStrip(p: Painter, w: WeatherView): void {
  const top = STRIP_TOP;
  const colW = CW / 6;
  p.c.hLine(L, R, STRIP_BOTTOM - 2, 2, BLACK);
  w.hours.forEach((slot, k) => {
    const x0 = Math.round(L + k * colW);
    const x1 = Math.round(L + (k + 1) * colW);
    const color = k === 0 ? WHITE : BLACK;
    if (k === 0) p.c.fillRect(x0, top, x1 - x0, STRIP_BOTTOM - top, BLACK);
    if (k > 1) p.c.vLine(x0, top, STRIP_BOTTOM, 1, BLACK);
    const cx = Math.round((x0 + x1) / 2);
    p.text(slot.label, cx, top + 40, 35, color, "center");
    p.text(`${slot.temp}°`, cx, top + 94, 57.5, color, "center");

    // Rain-chance gauge: five segments, filled from the bottom, 20% each.
    const filled = Math.min(5, Math.max(0, Math.round(slot.chance / 20)));
    for (let s = 0; s < 5; s++) {
      const y = top + 110 + s * 17;
      if (4 - s < filled) p.c.fillRect(cx - 22, y, 44, 13, color);
      else p.c.strokeRect(cx - 22, y, 44, 13, 2, color);
    }
    p.text(`${slot.chance}%`, cx, top + 233, 35, color, "center");
  });
}

function drawOutlook(p: Painter, outlook: string | null): number {
  if (!outlook) return STRIP_BOTTOM;
  const size = 40;
  const lineH = 34;
  const maxW = CW - 46;
  const lines = p.wrap(`> ${outlook}`, size, maxW, 2);
  const h = 62 + (lines.length - 1) * lineH;
  p.c.dashedRect(L, NOTICE_TOP, CW, h, 2, 6, 4, BLACK);
  lines.forEach((line, i) => p.text(line, L + 23, NOTICE_TOP + 42 + i * lineH, size, BLACK, "left", maxW));
  return NOTICE_TOP + h;
}

function drawFooter(p: Painter, m: DashboardModel, contentBottom: number): void {
  const sun = m.weather.ok ? m.weather.data : null;
  p.text(`SUNRISE ${sun?.sunrise ?? "--:--"} SUNSET ${sun?.sunset ?? "--:--"}`, L, FOOTER_BASE, 32.5);
  p.text(`UPDATED ${m.now.hhmm} NEXT ${m.nextRefresh ?? "--:--"} BATT ${m.battery ?? "--"}%`, R, FOOTER_BASE, 32.5, BLACK, "right");
  p.c.hLine(L, R, FOOTER_RULE, 2, BLACK);

  if (!m.headline) return;
  const size = 40;
  const lineH = 40;
  const badgeSize = 37.5;
  const badgeW = p.width("BBC", badgeSize) + 16;
  const textX = L + badgeW + 16;
  const lastBase = FOOTER_RULE - 24;
  const ruleFor = (lines: number) => lastBase - (lines - 1) * lineH - 46;

  const story = m.headline.ok ? m.headline.data : `[HEADLINE UNAVAILABLE: ${m.headline.error}]`;
  const maxLines = ruleFor(2) >= contentBottom + 14 ? 2 : 1;
  const lines = p.wrap(story, size, R - textX, maxLines);
  const firstBase = lastBase - (lines.length - 1) * lineH;
  p.c.hLine(L, R, ruleFor(lines.length), 2, BLACK);
  p.badge("BBC", L, firstBase, badgeSize);
  lines.forEach((line, i) => p.text(line, textX, firstBase + i * lineH, size));
}

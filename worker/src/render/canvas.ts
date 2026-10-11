// 8-bit greyscale framebuffer (0 = black, 255 = white) with the handful of
// drawing operations the dashboard needs.

import type { Mask } from "./raster";

export const BLACK = 0;
export const WHITE = 255;

export class Canvas {
  readonly data: Uint8Array;

  constructor(readonly width: number, readonly height: number, background = WHITE, buffer?: Uint8Array) {
    this.data = buffer && buffer.length === width * height ? buffer : new Uint8Array(width * height);
    this.data.fill(background);
  }

  fillRect(x: number, y: number, w: number, h: number, value: number): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + w));
    const y1 = Math.min(this.height, Math.round(y + h));
    if (x1 <= x0) return;
    for (let yy = y0; yy < y1; yy++) this.data.fill(value, yy * this.width + x0, yy * this.width + x1);
  }

  /** Rectangle outline drawn inside the given bounds. */
  strokeRect(x: number, y: number, w: number, h: number, thickness: number, value: number): void {
    this.fillRect(x, y, w, thickness, value);
    this.fillRect(x, y + h - thickness, w, thickness, value);
    this.fillRect(x, y, thickness, h, value);
    this.fillRect(x + w - thickness, y, thickness, h, value);
  }

  hLine(x0: number, x1: number, y: number, thickness: number, value: number): void {
    this.fillRect(x0, y, x1 - x0, thickness, value);
  }

  vLine(x: number, y0: number, y1: number, thickness: number, value: number): void {
    this.fillRect(x, y0, thickness, y1 - y0, value);
  }

  dashedHLine(x0: number, x1: number, y: number, thickness: number, dash: number, gap: number, value: number): void {
    for (let x = x0; x < x1; x += dash + gap) this.fillRect(x, y, Math.min(dash, x1 - x), thickness, value);
  }

  dashedVLine(x: number, y0: number, y1: number, thickness: number, dash: number, gap: number, value: number): void {
    for (let y = y0; y < y1; y += dash + gap) this.fillRect(x, y, thickness, Math.min(dash, y1 - y), value);
  }

  dashedRect(x: number, y: number, w: number, h: number, thickness: number, dash: number, gap: number, value: number): void {
    this.dashedHLine(x, x + w, y, thickness, dash, gap, value);
    this.dashedHLine(x, x + w, y + h - thickness, thickness, dash, gap, value);
    this.dashedVLine(x, y, y + h, thickness, dash, gap, value);
    this.dashedVLine(x + w - thickness, y, y + h, thickness, dash, gap, value);
  }

  /** Composite a coverage mask in the given grey value. */
  blit(mask: Mask, x: number, y: number, value: number): void {
    const { width: mw, height: mh, data: m } = mask;
    const d = this.data;
    for (let my = 0; my < mh; my++) {
      const cy = y + my;
      if (cy < 0 || cy >= this.height) continue;
      const rowD = cy * this.width;
      const rowM = my * mw;
      for (let mx = 0; mx < mw; mx++) {
        const a = m[rowM + mx];
        if (a === 0) continue;
        const cx = x + mx;
        if (cx < 0 || cx >= this.width) continue;
        const i = rowD + cx;
        d[i] = a === 255 ? value : ((d[i] * (255 - a) + value * a + 127) / 255) | 0;
      }
    }
  }
}

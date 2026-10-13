// Text measuring and drawing on top of the TrueType reader and rasteriser.
// Rasterised glyphs are cached per size for the life of the isolate.

import type { Canvas } from "./canvas";
import { Rasteriser, type Mask } from "./raster";
import { TrueTypeFont, type Contour } from "./ttf";

interface Glyph {
  mask: Mask;
  left: number;
  top: number;
}

export type Align = "left" | "right" | "center";

const SUBSTITUTES: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  "…": "...",
  " ": " ",
};

export class Font {
  private glyphs = new Map<string, Glyph>();

  constructor(readonly ttf: TrueTypeFont) {}

  /** Replace characters the font lacks with close ASCII equivalents. */
  clean(text: string): string {
    let out = "";
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (this.ttf.hasGlyph(cp) || ch === " ") out += ch;
      else out += SUBSTITUTES[ch] ?? (this.ttf.hasGlyph(63) ? "?" : "");
    }
    return out;
  }

  measure(text: string, size: number): number {
    const scale = size / this.ttf.unitsPerEm;
    let w = 0;
    for (const ch of text) w += this.ttf.advanceWidth(this.ttf.glyphIndex(ch.codePointAt(0)!)) * scale;
    return Math.round(w);
  }

  /** Cap height in pixels (VT323 capitals are 0.56 em). */
  capHeight(size: number): number {
    return Math.round(size * 0.56);
  }

  /**
   * Draw text with its baseline at y. Returns the drawn width.
   */
  draw(canvas: Canvas, text: string, x: number, y: number, size: number, value: number, align: Align = "left"): number {
    const width = this.measure(text, size);
    let pen = align === "right" ? x - width : align === "center" ? x - width / 2 : x;
    const scale = size / this.ttf.unitsPerEm;
    const baseline = Math.round(y);
    for (const ch of text) {
      const gid = this.ttf.glyphIndex(ch.codePointAt(0)!);
      const g = this.glyph(gid, size);
      if (g) canvas.blit(g.mask, Math.round(pen) + g.left, baseline + g.top, value);
      pen += this.ttf.advanceWidth(gid) * scale;
    }
    return width;
  }

  /** Cut text to fit maxWidth, ending with "..." when shortened. */
  fit(text: string, size: number, maxWidth: number): string {
    if (this.measure(text, size) <= maxWidth) return text;
    const chars = Array.from(text);
    while (chars.length > 0 && this.measure(chars.join("").trimEnd() + "...", size) > maxWidth) chars.pop();
    return chars.join("").trimEnd() + "...";
  }

  /** Word-wrap into at most maxLines lines; the last line is shortened with "..." if needed. */
  wrap(text: string, size: number, maxWidth: number, maxLines: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";
    for (let i = 0; i < words.length; i++) {
      const candidate = current ? `${current} ${words[i]}` : words[i];
      if (this.measure(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (lines.length === maxLines - 1) {
        // Last allowed line: take everything left and shorten it.
        lines.push(this.fit([current, ...words.slice(i)].filter(Boolean).join(" "), size, maxWidth));
        return lines;
      }
      if (current) lines.push(current);
      current = this.fit(words[i], size, maxWidth);
    }
    if (current) lines.push(current);
    return lines;
  }

  /** Rasterise glyphs ahead of time (used at Worker startup). */
  prepare(chars: string, sizes: readonly number[]): void {
    for (const size of sizes) for (const ch of chars) this.glyph(this.ttf.glyphIndex(ch.codePointAt(0)!), size);
  }

  private glyph(gid: number, size: number): Glyph | null {
    const key = `${gid}@${size}`;
    const hit = this.glyphs.get(key);
    if (hit !== undefined) return hit;
    const g = rasterise(this.ttf.outline(gid), size / this.ttf.unitsPerEm);
    if (g) this.glyphs.set(key, g);
    return g;
  }
}

function rasterise(contours: Contour[], scale: number): Glyph | null {
  if (contours.length === 0) return null;
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const c of contours) {
    for (const p of c) {
      xMin = Math.min(xMin, p.x);
      xMax = Math.max(xMax, p.x);
      yMin = Math.min(yMin, p.y);
      yMax = Math.max(yMax, p.y);
    }
  }
  const left = Math.floor(xMin * scale) - 1;
  const top = Math.floor(-yMax * scale) - 1;
  const width = Math.ceil(xMax * scale) - left + 2;
  const height = Math.ceil(-yMin * scale) - top + 2;
  const r = new Rasteriser(width, height);
  const tx = (x: number) => x * scale - left;
  const ty = (y: number) => -y * scale - top;

  for (const contour of contours) {
    const n = contour.length;
    if (n < 2) continue;
    // Insert the implied on-curve midpoints between consecutive off-curve points.
    const pts: { x: number; y: number; on: boolean }[] = [];
    for (let i = 0; i < n; i++) {
      const p = contour[i];
      const q = contour[(i + 1) % n];
      pts.push(p);
      if (!p.on && !q.on) pts.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, on: true });
    }
    const k = pts.findIndex((p) => p.on);
    if (k < 0) continue;
    const ring = pts.slice(k).concat(pts.slice(0, k));
    const m = ring.length;
    let cur = ring[0];
    for (let i = 1; i <= m; ) {
      const p = ring[i % m];
      if (p.on) {
        r.line(tx(cur.x), ty(cur.y), tx(p.x), ty(p.y));
        cur = p;
        i++;
      } else {
        const q = ring[(i + 1) % m];
        r.quad(tx(cur.x), ty(cur.y), tx(p.x), ty(p.y), tx(q.x), ty(q.y));
        cur = q;
        i += 2;
      }
    }
  }
  return { mask: r.toMask(), left, top };
}

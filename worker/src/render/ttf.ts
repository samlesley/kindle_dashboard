// Minimal TrueType reader: just enough of cmap, hmtx, loca and glyf to get
// glyph outlines for drawing text. Handles simple and composite glyphs.

export interface Point {
  x: number;
  y: number;
  on: boolean;
}

export type Contour = Point[];

export class TrueTypeFont {
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;

  private view: DataView;
  private tables = new Map<string, { offset: number; length: number }>();
  private numGlyphs: number;
  private numHMetrics: number;
  private longLoca: boolean;
  private cmap = new Map<number, number>();
  private outlineCache = new Map<number, Contour[]>();

  constructor(data: ArrayBuffer | Uint8Array) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    const numTables = this.view.getUint16(4);
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      const tag = String.fromCharCode(
        this.view.getUint8(rec),
        this.view.getUint8(rec + 1),
        this.view.getUint8(rec + 2),
        this.view.getUint8(rec + 3),
      );
      this.tables.set(tag, { offset: this.view.getUint32(rec + 8), length: this.view.getUint32(rec + 12) });
    }

    const head = this.table("head");
    this.unitsPerEm = this.view.getUint16(head + 18);
    this.longLoca = this.view.getInt16(head + 50) === 1;

    const hhea = this.table("hhea");
    this.ascender = this.view.getInt16(hhea + 4);
    this.descender = this.view.getInt16(hhea + 6);
    this.numHMetrics = this.view.getUint16(hhea + 34);

    this.numGlyphs = this.view.getUint16(this.table("maxp") + 4);
    this.readCmap();
  }

  private table(tag: string): number {
    const t = this.tables.get(tag);
    if (!t) throw new Error(`font is missing the ${tag} table`);
    return t.offset;
  }

  private readCmap(): void {
    const v = this.view;
    const base = this.table("cmap");
    const count = v.getUint16(base + 2);
    let best = -1;
    let bestFormat = 0;
    for (let i = 0; i < count; i++) {
      const platform = v.getUint16(base + 4 + i * 8);
      const encoding = v.getUint16(base + 6 + i * 8);
      const offset = base + v.getUint32(base + 8 + i * 8);
      const format = v.getUint16(offset);
      const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
      if (!unicode) continue;
      if (format === 12 || (format === 4 && bestFormat !== 12)) {
        best = offset;
        bestFormat = format;
      }
    }
    if (best < 0) throw new Error("font has no Unicode cmap");

    if (bestFormat === 4) {
      const segX2 = v.getUint16(best + 6);
      const ends = best + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const rangeOffsets = deltas + segX2;
      for (let s = 0; s < segX2; s += 2) {
        const end = v.getUint16(ends + s);
        const start = v.getUint16(starts + s);
        const delta = v.getInt16(deltas + s);
        const ro = v.getUint16(rangeOffsets + s);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let g: number;
          if (ro === 0) {
            g = (c + delta) & 0xffff;
          } else {
            const at = rangeOffsets + s + ro + (c - start) * 2;
            g = v.getUint16(at);
            if (g !== 0) g = (g + delta) & 0xffff;
          }
          if (g !== 0) this.cmap.set(c, g);
        }
      }
    } else {
      const groups = v.getUint32(best + 12);
      for (let i = 0; i < groups; i++) {
        const rec = best + 16 + i * 12;
        const start = v.getUint32(rec);
        const end = v.getUint32(rec + 4);
        const startGlyph = v.getUint32(rec + 8);
        for (let c = start; c <= end; c++) this.cmap.set(c, startGlyph + (c - start));
      }
    }
  }

  glyphIndex(codePoint: number): number {
    return this.cmap.get(codePoint) ?? 0;
  }

  hasGlyph(codePoint: number): boolean {
    return this.cmap.has(codePoint);
  }

  advanceWidth(glyph: number): number {
    const hmtx = this.table("hmtx");
    const i = Math.min(glyph, this.numHMetrics - 1);
    return this.view.getUint16(hmtx + i * 4);
  }

  private glyphRange(glyph: number): { start: number; end: number } {
    const loca = this.table("loca");
    const glyf = this.table("glyf");
    if (this.longLoca) {
      return {
        start: glyf + this.view.getUint32(loca + glyph * 4),
        end: glyf + this.view.getUint32(loca + glyph * 4 + 4),
      };
    }
    return {
      start: glyf + this.view.getUint16(loca + glyph * 2) * 2,
      end: glyf + this.view.getUint16(loca + glyph * 2 + 2) * 2,
    };
  }

  /** Outline in font units, y pointing up. */
  outline(glyph: number, depth = 0): Contour[] {
    const cached = this.outlineCache.get(glyph);
    if (cached) return cached;
    if (glyph < 0 || glyph >= this.numGlyphs || depth > 8) return [];
    const { start, end } = this.glyphRange(glyph);
    if (end <= start) return [];
    const contourCount = this.view.getInt16(start);
    const result = contourCount >= 0 ? this.simpleOutline(start, contourCount) : this.compositeOutline(start, depth);
    this.outlineCache.set(glyph, result);
    return result;
  }

  private simpleOutline(start: number, contourCount: number): Contour[] {
    const v = this.view;
    let p = start + 10;
    const endPts: number[] = [];
    for (let i = 0; i < contourCount; i++, p += 2) endPts.push(v.getUint16(p));
    const pointCount = contourCount ? endPts[contourCount - 1] + 1 : 0;
    const instructionLength = v.getUint16(p);
    p += 2 + instructionLength;

    const flags = new Uint8Array(pointCount);
    for (let i = 0; i < pointCount; ) {
      const f = v.getUint8(p++);
      flags[i++] = f;
      if (f & 8) {
        let repeat = v.getUint8(p++);
        while (repeat-- > 0 && i < pointCount) flags[i++] = f;
      }
    }

    const xs = new Int32Array(pointCount);
    let x = 0;
    for (let i = 0; i < pointCount; i++) {
      const f = flags[i];
      if (f & 2) {
        const dx = v.getUint8(p++);
        x += f & 16 ? dx : -dx;
      } else if (!(f & 16)) {
        x += v.getInt16(p);
        p += 2;
      }
      xs[i] = x;
    }
    const ys = new Int32Array(pointCount);
    let y = 0;
    for (let i = 0; i < pointCount; i++) {
      const f = flags[i];
      if (f & 4) {
        const dy = v.getUint8(p++);
        y += f & 32 ? dy : -dy;
      } else if (!(f & 32)) {
        y += v.getInt16(p);
        p += 2;
      }
      ys[i] = y;
    }

    const contours: Contour[] = [];
    let first = 0;
    for (const last of endPts) {
      const c: Contour = [];
      for (let i = first; i <= last; i++) c.push({ x: xs[i], y: ys[i], on: (flags[i] & 1) === 1 });
      contours.push(c);
      first = last + 1;
    }
    return contours;
  }

  private compositeOutline(start: number, depth: number): Contour[] {
    const v = this.view;
    let p = start + 10;
    const out: Contour[] = [];
    for (;;) {
      const flags = v.getUint16(p);
      const component = v.getUint16(p + 2);
      p += 4;
      let dx = 0;
      let dy = 0;
      if (flags & 1) {
        dx = flags & 2 ? v.getInt16(p) : 0;
        dy = flags & 2 ? v.getInt16(p + 2) : 0;
        p += 4;
      } else {
        dx = flags & 2 ? v.getInt8(p) : 0;
        dy = flags & 2 ? v.getInt8(p + 1) : 0;
        p += 2;
      }
      let a = 1, b = 0, c = 0, d = 1;
      const f2dot14 = (o: number) => v.getInt16(o) / 16384;
      if (flags & 8) {
        a = d = f2dot14(p);
        p += 2;
      } else if (flags & 0x40) {
        a = f2dot14(p);
        d = f2dot14(p + 2);
        p += 4;
      } else if (flags & 0x80) {
        a = f2dot14(p);
        b = f2dot14(p + 2);
        c = f2dot14(p + 4);
        d = f2dot14(p + 6);
        p += 8;
      }
      for (const contour of this.outline(component, depth + 1)) {
        out.push(contour.map((pt) => ({ x: a * pt.x + c * pt.y + dx, y: b * pt.x + d * pt.y + dy, on: pt.on })));
      }
      if (!(flags & 0x20)) break;
    }
    return out;
  }
}

// Anti-aliased polygon rasteriser using signed-area accumulation (the
// approach used by font-rs). Lines add coverage deltas to an accumulation
// buffer; a running sum then gives exact per-pixel coverage.

export interface Mask {
  width: number;
  height: number;
  /** Coverage 0..255, row-major. */
  data: Uint8Array;
}

export class Rasteriser {
  private acc: Float32Array;

  constructor(readonly width: number, readonly height: number) {
    this.acc = new Float32Array(width * height + 4);
  }

  line(x0: number, y0: number, x1: number, y1: number): void {
    if (Math.abs(y0 - y1) <= 1e-6) return;
    let dir = 1;
    if (y0 > y1) {
      dir = -1;
      [x0, y0, x1, y1] = [x1, y1, x0, y0];
    }
    const w = this.width;
    const a = this.acc;
    const dxdy = (x1 - x0) / (y1 - y0);
    let x = x0;
    if (y0 < 0) x -= y0 * dxdy;
    const yStart = Math.max(0, Math.floor(y0));
    const yEnd = Math.min(this.height, Math.ceil(y1));
    for (let y = yStart; y < yEnd; y++) {
      const rowStart = y * w;
      const dy = Math.min(y + 1, y1) - Math.max(y, y0);
      const xNext = x + dxdy * dy;
      const d = dy * dir;
      const xa = Math.min(x, xNext);
      const xb = Math.max(x, xNext);
      const xaFloor = Math.floor(xa);
      const xai = xaFloor;
      const xbi = Math.ceil(xb);
      const i0 = rowStart + xai;
      if (i0 < 0) {
        x = xNext;
        continue;
      }
      if (xbi <= xai + 1) {
        const xmf = 0.5 * (x + xNext) - xaFloor;
        a[i0] += d - d * xmf;
        a[i0 + 1] += d * xmf;
      } else {
        const s = 1 / (xb - xa);
        const xaf = xa - xaFloor;
        const a0 = 0.5 * s * (1 - xaf) * (1 - xaf);
        const xbf = xb - xbi + 1;
        const am = 0.5 * s * xbf * xbf;
        a[i0] += d * a0;
        if (xbi === xai + 2) {
          a[i0 + 1] += d * (1 - a0 - am);
        } else {
          const a1 = s * (1.5 - xaf);
          a[i0 + 1] += d * (a1 - a0);
          for (let xi = xai + 2; xi < xbi - 1; xi++) a[rowStart + xi] += d * s;
          const a2 = a1 + (xbi - xai - 3) * s;
          a[rowStart + xbi - 1] += d * (1 - a2 - am);
        }
        a[rowStart + xbi] += d * am;
      }
      x = xNext;
    }
  }

  quad(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number): void {
    const ddx = x0 - 2 * cx + x1;
    const ddy = y0 - 2 * cy + y1;
    const devsq = ddx * ddx + ddy * ddy;
    if (devsq < 0.333) {
      this.line(x0, y0, x1, y1);
      return;
    }
    const n = 1 + Math.floor(Math.sqrt(Math.sqrt(3 * devsq)));
    let px = x0;
    let py = y0;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const mt = 1 - t;
      const nx = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
      const ny = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
      this.line(px, py, nx, ny);
      px = nx;
      py = ny;
    }
  }

  toMask(): Mask {
    const n = this.width * this.height;
    const out = new Uint8Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += this.acc[i];
      const c = Math.min(1, Math.abs(sum));
      out[i] = Math.round(c * 255);
    }
    return { width: this.width, height: this.height, data: out };
  }
}

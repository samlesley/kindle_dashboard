import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { deflateImage, encodeGreyscalePng } from "../src/render/png";

function decode(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let off = 8;
  const chunks: { type: string; data: Uint8Array }[] = [];
  while (off < png.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(...png.subarray(off + 4, off + 8));
    chunks.push({ type, data: png.subarray(off + 8, off + 8 + len) });
    off += 12 + len;
  }
  return chunks;
}

function scanlines(width: number, height: number, px: Uint8Array): Buffer {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) raw.set(px.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  return raw;
}

describe("PNG encoder", () => {
  it("writes an 8-bit greyscale PNG whose pixels round-trip", () => {
    const w = 64;
    const h = 40;
    const px = new Uint8Array(w * h).fill(255);
    for (let y = 10; y < 20; y++) for (let x = 5; x < 50; x++) px[y * w + x] = 0;
    for (let x = 0; x < w; x++) px[30 * w + x] = (x * 7) & 0xff;
    const chunks = decode(encodeGreyscalePng(w, h, px));
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    const ihdr = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset, 13);
    expect(ihdr.getUint32(0)).toBe(w);
    expect(ihdr.getUint32(4)).toBe(h);
    expect(ihdr.getUint8(8)).toBe(8); // bit depth
    expect(ihdr.getUint8(9)).toBe(0); // greyscale
    expect(inflateSync(chunks[1].data).equals(scanlines(w, h, px))).toBe(true);
  });

  it("round-trips noise, solid, repeated rows and odd widths", () => {
    let seed = 1;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 0xff;
    for (const [w, h] of [
      [1072, 30],
      [33, 17],
      [4, 1],
    ]) {
      const px = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (y % 5 === 0) px[i] = rand();
          else if (y % 5 === 1) px[i] = px[i - w];
          else if (y % 5 === 2) px[i] = 0;
          else px[i] = x % 9 < 3 ? rand() : 255;
        }
      }
      expect(inflateSync(deflateImage(w, h, px)).equals(scanlines(w, h, px))).toBe(true);
    }
  });
});

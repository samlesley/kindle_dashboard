// PNG encoder for 8-bit greyscale images (colour type 0).
//
// Compression uses a small purpose-built deflate encoder rather than
// CompressionStream: zlib's general-purpose matcher costs 20-40 ms of CPU
// on a 1072x1448 frame, which would blow the Workers free-plan budget of
// 10 ms. This layout is mostly blank rows, solid rows and rows that repeat
// the row above (VT323's pixels are several device pixels tall), so the
// encoder deals with those a whole row at a time and only scans the rest
// byte by byte, looking for runs (distance 1) and matches with the row
// above (distance = one scanline). Output uses the fixed Huffman table.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function reverseBits(code: number, len: number): number {
  let r = 0;
  for (let i = 0; i < len; i++) {
    r = (r << 1) | (code & 1);
    code >>= 1;
  }
  return r;
}

// Fixed Huffman literal/length codes (RFC 1951 section 3.2.6), bit-reversed
// for the LSB-first deflate bit stream.
const LIT_BITS = new Uint16Array(288);
const LIT_LEN = new Uint8Array(288);
for (let s = 0; s < 288; s++) {
  let code: number, len: number;
  if (s < 144) [code, len] = [0x30 + s, 8];
  else if (s < 256) [code, len] = [0x190 + s - 144, 9];
  else if (s < 280) [code, len] = [s - 256, 7];
  else [code, len] = [0xc0 + s - 280, 8];
  LIT_BITS[s] = reverseBits(code, len);
  LIT_LEN[s] = len;
}

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

// Length code + extra bits for every match length 3..258, ready to write.
const MATCH_BITS = new Uint32Array(259);
const MATCH_LEN = new Uint8Array(259);
for (let len = 3; len <= 258; len++) {
  let i = LEN_BASE.length - 1;
  while (LEN_BASE[i] > len) i--;
  const sym = 257 + i;
  MATCH_BITS[len] = LIT_BITS[sym] | ((len - LEN_BASE[i]) << LIT_LEN[sym]);
  MATCH_LEN[len] = LIT_LEN[sym] + LEN_EXTRA[i];
}

function distanceCode(dist: number): { bits: number; len: number } {
  let i = DIST_BASE.length - 1;
  while (DIST_BASE[i] > dist) i--;
  return { bits: reverseBits(i, 5) | ((dist - DIST_BASE[i]) << 5), len: 5 + DIST_EXTRA[i] };
}

const ADLER_MOD = 65521;

// Output buffer reused between requests (the result is copied out), which
// saves allocating and zeroing ~1.8 MB per frame.
let scratchBuf: Uint8Array<ArrayBuffer> | null = null;
function scratch(size: number): Uint8Array<ArrayBuffer> {
  if (!scratchBuf || scratchBuf.length < size) scratchBuf = new Uint8Array(size);
  return scratchBuf;
}
const RUN = distanceCode(1);

/**
 * Deflate bit writer. Kept as a class (rather than closures made per call)
 * so V8's optimised code stays valid from one request to the next.
 */
class BitWriter {
  pos = 0;
  private buf = 0;
  private cnt = 0;

  constructor(readonly out: Uint8Array<ArrayBuffer>) {}

  put(bits: number, count: number): void {
    this.buf |= bits << this.cnt;
    this.cnt += count;
    while (this.cnt >= 8) {
      this.out[this.pos++] = this.buf & 0xff;
      this.buf >>>= 8;
      this.cnt -= 8;
    }
  }

  literal(v: number): void {
    this.put(LIT_BITS[v], LIT_LEN[v]);
  }

  /** A match of any length >= 3, split into deflate-sized pieces. */
  match(len: number, distBits: number, distLen: number): void {
    while (len > 0) {
      let take = len > 258 ? 258 : len;
      if (len - take > 0 && len - take < 3) take = len - 3;
      this.put(MATCH_BITS[take], MATCH_LEN[take]);
      this.put(distBits, distLen);
      len -= take;
    }
  }

  flush(): void {
    if (this.cnt > 0) this.out[this.pos++] = this.buf & 0xff;
    this.buf = 0;
    this.cnt = 0;
  }

  byte(v: number): void {
    this.out[this.pos++] = v & 0xff;
  }
}

function sameAsAbove(px: Uint8Array, words: Uint32Array | null, width: number, y: number): boolean {
  if (words) {
    const wpr = width >> 2;
    for (let k = y * wpr, e = k + wpr; k < e; k++) if (words[k] !== words[k - wpr]) return false;
    return true;
  }
  for (let k = y * width, e = k + width; k < e; k++) if (px[k] !== px[k - width]) return false;
  return true;
}

function uniformRow(px: Uint8Array, words: Uint32Array | null, width: number, y: number, v: number): boolean {
  if (words) {
    const wpr = width >> 2;
    const w = (v * 0x01010101) >>> 0;
    for (let k = y * wpr, e = k + wpr; k < e; k++) if (words[k] !== w) return false;
    return true;
  }
  for (let k = y * width, e = k + width; k < e; k++) if (px[k] !== v) return false;
  return true;
}

function rowSum(px: Uint8Array, row: number, width: number): number {
  let s = 0;
  for (let x = 0; x < width; x++) s += px[row + x];
  return s;
}

/** Sum of (width - x) * pixel, the row's contribution to Adler-32's b. */
function rowWeightedSum(px: Uint8Array, row: number, width: number): number {
  let s = 0;
  for (let x = 0; x < width; x++) s += (width - x) * px[row + x];
  return s;
}

/**
 * Pixels of one scanline (after its filter byte): greedy choice between a
 * run of the previous byte and a copy of the row above, else a literal.
 */
function encodeRow(w: BitWriter, px: Uint8Array, row: number, width: number, hasAbove: boolean, upBits: number, upLen: number): void {
  let x = 0;
  while (x < width) {
    const limit = Math.min(width, x + 258);
    // The byte before the first pixel is the filter byte, 0.
    const prev = x > 0 ? px[row + x - 1] : 0;
    let j = x;
    while (j < limit && px[row + j] === prev) j++;
    let best = j - x;
    let fromAbove = false;
    if (hasAbove && best < 258) {
      j = x;
      while (j < limit && px[row + j] === px[row - width + j]) j++;
      if (j - x > best) {
        best = j - x;
        fromAbove = true;
      }
    }
    if (best >= 3) {
      w.put(MATCH_BITS[best], MATCH_LEN[best]);
      if (fromAbove) w.put(upBits, upLen);
      else w.put(RUN.bits, RUN.len);
      x += best;
    } else {
      w.literal(px[row + x]);
      x++;
    }
  }
}

/**
 * zlib stream (RFC 1950) holding one fixed-Huffman deflate block of the
 * PNG scanlines (filter byte 0 + pixels for each row).
 */
export function deflateImage(width: number, height: number, px: Uint8Array): Uint8Array<ArrayBuffer> {
  if (width < 4 || height < 1) throw new Error("image too small");
  const stride = width + 1;
  const up = distanceCode(stride);
  const w = new BitWriter(scratch(Math.ceil(stride * height * 1.15) + 64));
  w.byte(0x78); // deflate, 32K window
  w.byte(0x01); // fastest-compression flag; header checksum is valid
  w.put(1, 1); // BFINAL
  w.put(1, 2); // BTYPE = fixed Huffman

  // Whole-row comparisons four pixels at a time where alignment allows.
  const words =
    width % 4 === 0 && px.byteOffset % 4 === 0 ? new Uint32Array(px.buffer, px.byteOffset, (width * height) / 4) : null;

  // Adler-32 is built per row: appending a row with byte sum s1 and
  // position-weighted sum s2 takes (a, b) to (a + s1, b + stride*a + s2).
  let a = 1;
  let b = 0;
  let s1 = 0;
  let s2 = 0;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    if (y > 0 && sameAsAbove(px, words, width, y)) {
      // Filter byte and pixels all repeat the previous scanline; s1/s2 carry over.
      w.match(stride, up.bits, up.len);
    } else {
      w.literal(0); // filter type None
      const first = px[row];
      if (uniformRow(px, words, width, y, first)) {
        w.literal(first);
        w.match(width - 1, RUN.bits, RUN.len);
        s1 = first * width;
        s2 = (first * width * (width + 1)) / 2;
      } else {
        s1 = rowSum(px, row, width);
        s2 = rowWeightedSum(px, row, width);
        encodeRow(w, px, row, width, y > 0, up.bits, up.len);
      }
    }
    b = (b + stride * a + s2) % ADLER_MOD;
    a = (a + s1) % ADLER_MOD;
  }

  w.literal(256); // end of block
  w.flush();
  const sum = ((b << 16) | a) >>> 0;
  w.byte(sum >>> 24);
  w.byte(sum >>> 16);
  w.byte(sum >>> 8);
  w.byte(sum);
  return w.out.slice(0, w.pos);
}

function chunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + payload.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, payload.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  v.setUint32(8 + payload.length, crc32(out, 4, 8 + payload.length));
  return out;
}

export function encodeGreyscalePng(width: number, height: number, pixels: Uint8Array): Uint8Array<ArrayBuffer> {
  if (pixels.length !== width * height) throw new Error("pixel buffer size does not match dimensions");

  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colour type: greyscale
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // no interlace

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateImage(width, height, pixels)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((total, p) => total + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

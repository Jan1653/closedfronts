// Appends the ClosedFronts ship-overhaul sprites to resources/atlases/
// unit-atlas.png (13px cells): Fishing Boat, Patrol Boat, Submarine, Atomic
// Submarine, and the three warship hull classes (small/large/ultra).
//
// Idempotent: keeps only the 12 original columns and re-appends every new
// glyph, so re-running never duplicates columns. Order must match UNIT_ORDER
// in src/client/render/gl/passes/UnitPass.ts.
//
// Sprites are grayscale (colorized on the GPU via the 3-band gray replacement
// 180/130/70): 180 = fill, 130 = accent, 70 = border/dark detail.
//
// Dependency-free (same tiny PNG codec as gen-icon-atlas.mjs).
// Run: node scripts/gen-unit-atlas.mjs
import fs from "fs";
import zlib from "zlib";

const ATLAS = "resources/atlases/unit-atlas.png";
const CELL = 13;

// ── minimal PNG codec (8-bit RGBA only) ────────────────────────────────────
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a png");
  let o = 8,
    w = 0,
    h = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString("ascii", o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6)
        throw new Error("expected 8-bit RGBA");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4,
    stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    for (let x = 0; x < stride; x++) {
      const rawv = raw[p++];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v;
      switch (filter) {
        case 0:
          v = rawv;
          break;
        case 1:
          v = rawv + a;
          break;
        case 2:
          v = rawv + b;
          break;
        case 3:
          v = rawv + ((a + b) >> 1);
          break;
        case 4:
          v = rawv + paeth(a, b, c);
          break;
        default:
          throw new Error("bad filter " + filter);
      }
      out[y * stride + x] = v & 0xff;
    }
  }
  return { w, h, data: out };
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, data) {
  const bpp = 4,
    stride = w * bpp;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── cell rasteriser (grayscale value + alpha) ──────────────────────────────
function cell() {
  return Buffer.alloc(CELL * CELL * 4);
}
function set(c, x, y, v) {
  if (x < 0 || y < 0 || x >= CELL || y >= CELL) return;
  const i = (y * CELL + x) * 4;
  c[i] = v;
  c[i + 1] = v;
  c[i + 2] = v;
  c[i + 3] = 255;
}
// Filled ellipse centered at (cx, cy) with radii rx/ry, fill 180, 1px border 70.
function ellipse(c, cx, cy, rx, ry) {
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d <= 1) {
        const dIn =
          ((x - cx) / Math.max(0.5, rx - 1)) ** 2 +
          ((y - cy) / Math.max(0.5, ry - 1)) ** 2;
        set(c, x, y, dIn <= 1 ? 180 : 70);
      }
    }
  }
}
function rect(c, x0, y0, w, h, v) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) set(c, x, y, v);
}

const C = (CELL - 1) / 2; // 6 — cell center

// Fishing boat: tiny round hull + mast dot.
function drawFishingBoat() {
  const c = cell();
  ellipse(c, C, C + 1, 2.5, 1.8);
  set(c, C, C - 1, 70); // mast
  set(c, C, C - 2, 130); // flag
  return c;
}
// Patrol boat: slim hull + antenna.
function drawPatrolBoat() {
  const c = cell();
  ellipse(c, C, C + 1, 3.4, 1.6);
  rect(c, C, C - 2, 1, 3, 70); // antenna mast
  set(c, C, C - 3, 130); // radar tip
  return c;
}
// Submarine: elongated capsule + conning tower.
function drawSubmarine() {
  const c = cell();
  ellipse(c, C, C + 1, 4, 1.6);
  rect(c, C - 1, C - 1, 3, 2, 70); // tower
  return c;
}
// Atomic submarine: longer capsule, accent stripe + tower.
function drawAtomicSubmarine() {
  const c = cell();
  ellipse(c, C, C + 1, 5, 1.9);
  rect(c, C - 4, C + 1, 9, 1, 130); // accent stripe
  rect(c, C - 1, C - 2, 3, 3, 70); // tower
  return c;
}
// Warship hulls: pointed-oval silhouettes of increasing size; the ultra gets
// an accent core so it reads as the flagship.
function drawWarshipSmall() {
  const c = cell();
  ellipse(c, C, C, 3, 2.3);
  set(c, C, C, 70);
  return c;
}
function drawWarshipLarge() {
  const c = cell();
  ellipse(c, C, C, 5, 3.4);
  rect(c, C - 1, C - 1, 3, 3, 70);
  return c;
}
function drawWarshipUltra() {
  const c = cell();
  ellipse(c, C, C, 6, 4.4);
  rect(c, C - 2, C - 1, 5, 3, 70);
  rect(c, C - 1, C, 3, 1, 130); // accent core
  return c;
}

// ── compose ────────────────────────────────────────────────────────────────
const BASE_COLS = 12;
const old = decodePng(fs.readFileSync(ATLAS));
// order must match UNIT_ORDER in UnitPass.ts
const glyphs = [
  drawFishingBoat(),
  drawPatrolBoat(),
  drawSubmarine(),
  drawAtomicSubmarine(),
  drawWarshipSmall(),
  drawWarshipLarge(),
  drawWarshipUltra(),
];
const newCols = BASE_COLS + glyphs.length;
const W = newCols * CELL,
  H = CELL;
const out = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) {
  old.data.copy(
    out,
    y * W * 4,
    y * old.w * 4,
    y * old.w * 4 + BASE_COLS * CELL * 4,
  );
}
glyphs.forEach((g, gi) => {
  const colX = (BASE_COLS + gi) * CELL;
  for (let y = 0; y < CELL; y++)
    g.copy(out, (y * W + colX) * 4, y * CELL * 4, y * CELL * 4 + CELL * 4);
});

fs.writeFileSync(ATLAS, encodePng(W, H, out));

// validate + ASCII preview of the new columns
const check = decodePng(fs.readFileSync(ATLAS));
if (check.w !== W || check.h !== H) throw new Error("size mismatch");
console.log(`wrote ${ATLAS}: ${W}x${H} (${newCols} columns)`);
for (let col = BASE_COLS; col < newCols; col++) {
  let s = `col ${col}:\n`;
  for (let y = 0; y < CELL; y++) {
    let line = "";
    for (let x = 0; x < CELL; x++) {
      const a = check.data[(y * check.w + col * CELL + x) * 4 + 3];
      const v = check.data[(y * check.w + col * CELL + x) * 4];
      line += a > 128 ? (v > 150 ? "#" : v > 100 ? "+" : ".") : " ";
    }
    s += line + "\n";
  }
  console.log(s);
}

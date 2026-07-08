// Regenerates resources/atlases/icon-atlas.png, appending dedicated columns for
// the ClosedFronts structures (Oil Pump, Wall, Water Toll Station) so they get
// their own map icons instead of borrowing City/Port/Factory/DefensePost — which
// also fixes the build-button hover highlighting the wrong structure (highlight
// is keyed by atlas column, so shared columns cross-highlight).
//
// Dependency-free on purpose: node-canvas's native binary isn't built here
// (deps install with --ignore-scripts), so this does its own tiny PNG
// decode/encode (Node zlib) and rasterises the simple white glyphs by hand.
//
// Icons are white (255,255,255) with alpha as the mask, matching the existing
// atlas; the dark SVG detail cuts are punched as transparent holes so the
// player-colour circle shows through as separators.
//
// Run: node scripts/gen-icon-atlas.mjs
import fs from "fs";
import zlib from "zlib";

const ATLAS = "resources/atlases/icon-atlas.png";
const CELL = 64; // px per column (matches the existing 384/6)
const SVG = 24; // icon SVG viewBox is 24x24
const S = CELL / SVG;

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
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a png");
  let o = 8, w = 0, h = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString("ascii", o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6) throw new Error("expected 8-bit RGBA");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp;
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
        case 0: v = rawv; break;
        case 1: v = rawv + a; break;
        case 2: v = rawv + b; break;
        case 3: v = rawv + ((a + b) >> 1); break;
        case 4: v = rawv + paeth(a, b, c); break;
        default: throw new Error("bad filter " + filter);
      }
      out[y * stride + x] = v & 0xff;
    }
  }
  return { w, h, data: out };
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, data) {
  const bpp = 4, stride = w * bpp;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    data.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── tiny rasteriser into one 64x64 RGBA cell ───────────────────────────────
function cell() {
  return { data: Buffer.alloc(CELL * CELL * 4) }; // transparent
}
function set(c, x, y, on) {
  if (x < 0 || y < 0 || x >= CELL || y >= CELL) return;
  const i = (y * CELL + x) * 4;
  if (on) { c.data[i] = 255; c.data[i + 1] = 255; c.data[i + 2] = 255; c.data[i + 3] = 255; }
  else { c.data[i + 3] = 0; } // punch hole
}
// SVG-space rect (x,y,w,h) -> fill/hole
function rect(c, x, y, w, h, on) {
  const x0 = Math.round(x * S), y0 = Math.round(y * S);
  const x1 = Math.round((x + w) * S), y1 = Math.round((y + h) * S);
  for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) set(c, px, py, on);
}
function pointInTri(px, py, ax, ay, bx, by, cx, cy) {
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  const a = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
  const b = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
  const g = 1 - a - b;
  return a >= 0 && b >= 0 && g >= 0;
}

function drawWall() {
  const c = cell();
  for (const y of [4, 10, 16]) rect(c, 2, y, 20, 4, true);
  // dark brick separators -> holes
  for (const [x, y] of [[9, 4], [15, 4], [6, 10], [12, 10], [18, 10], [9, 16], [15, 16]])
    rect(c, x, y, 1.2, 4, false);
  return c;
}
function drawToll() {
  const c = cell();
  rect(c, 3, 3, 3, 18, true); // post
  rect(c, 6, 5.5, 15, 4, true); // gate arm
  rect(c, 2, 20.5, 20, 1.5, true); // base bar
  for (const x of [8.5, 13, 17.5]) rect(c, x, 5.5, 1.5, 4, false); // gate bars (holes)
  return c;
}
function drawOilPump() {
  const c = cell();
  const cxr = 12, cyr = 14.5, r = 6.5;
  for (let py = 0; py < CELL; py++) {
    for (let px = 0; px < CELL; px++) {
      const sx = (px + 0.5) / S, sy = (py + 0.5) / S; // back to SVG space
      const inCircle = (sx - cxr) ** 2 + (sy - cyr) ** 2 <= r * r;
      const inTri = pointInTri(sx, sy, 12, 2, 5.5, cyr, 18.5, cyr);
      if (inCircle || inTri) set(c, px, py, true);
    }
  }
  return c;
}

function asciiPreview(img, cols) {
  const step = 4; // downsample 64 -> 16
  for (let col = 0; col < cols; col++) {
    let out = `col ${col}:\n`;
    for (let y = 0; y < CELL; y += step) {
      let line = "";
      for (let x = 0; x < CELL; x += step) {
        const gx = col * CELL + x;
        const a = img.data[(y * img.w + gx) * 4 + 3];
        line += a > 128 ? "#" : a > 32 ? "." : " ";
      }
      out += line + "\n";
    }
    console.log(out);
  }
}

// ── compose ────────────────────────────────────────────────────────────────
const old = decodePng(fs.readFileSync(ATLAS));
const oldCols = old.w / CELL; // 6
const newCols = oldCols + 3;
const W = newCols * CELL, H = CELL;
const out = Buffer.alloc(W * H * 4);
// copy existing columns row by row
for (let y = 0; y < H; y++) {
  old.data.copy(out, y * W * 4, y * old.w * 4, y * old.w * 4 + old.w * 4);
}
const glyphs = [drawOilPump(), drawWall(), drawToll()]; // order matters (see below)
glyphs.forEach((g, gi) => {
  const colX = (oldCols + gi) * CELL;
  for (let y = 0; y < CELL; y++)
    g.data.copy(out, (y * W + colX) * 4, y * CELL * 4, y * CELL * 4 + CELL * 4);
});

const png = encodePng(W, H, out);
fs.writeFileSync(ATLAS, png);

// validate: decode back + preview the 3 new columns
const check = decodePng(fs.readFileSync(ATLAS));
if (check.w !== W || check.h !== H) throw new Error("size mismatch after write");
console.log(`wrote ${ATLAS}: ${W}x${H} (${newCols} columns)`);
asciiPreview(check, newCols);

// Regenerates resources/atlases/icon-atlas.png with dedicated columns for the
// ClosedFronts structures (Oil Pump, Wall, Water Toll Station, Oil Storage) so
// they get their own map icons instead of borrowing City/Port/Factory/DefensePost
// — which also fixes the build-button hover highlighting the wrong structure
// (highlight is keyed by atlas column, so shared columns cross-highlight).
//
// Idempotent: keeps only the 6 original OpenFront columns and re-appends every
// ClosedFronts glyph, so re-running never duplicates columns.
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
    raw[y * (stride + 1)] = 0; // filter: none
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

// ── tiny rasteriser into one 64x64 RGBA cell ───────────────────────────────
function cell() {
  return { data: Buffer.alloc(CELL * CELL * 4) }; // transparent
}
function set(c, x, y, on) {
  if (x < 0 || y < 0 || x >= CELL || y >= CELL) return;
  const i = (y * CELL + x) * 4;
  if (on) {
    c.data[i] = 255;
    c.data[i + 1] = 255;
    c.data[i + 2] = 255;
    c.data[i + 3] = 255;
  } else {
    c.data[i + 3] = 0;
  } // punch hole
}
// SVG-space rect (x,y,w,h) -> fill/hole
function rect(c, x, y, w, h, on) {
  const x0 = Math.round(x * S),
    y0 = Math.round(y * S);
  const x1 = Math.round((x + w) * S),
    y1 = Math.round((y + h) * S);
  for (let py = y0; py < y1; py++)
    for (let px = x0; px < x1; px++) set(c, px, py, on);
}

function drawWall() {
  const c = cell();
  for (const y of [4, 10, 16]) rect(c, 2, y, 20, 4, true);
  // dark brick separators -> holes
  for (const [x, y] of [
    [9, 4],
    [15, 4],
    [6, 10],
    [12, 10],
    [18, 10],
    [9, 16],
    [15, 16],
  ])
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
  // A smooth teardrop (matches resources/images/OilPumpIconWhite.svg): a round
  // bulb at the bottom whose sides curve up to a point, so it reads as an oil
  // drop rather than a cone. A tiny hole punches the SVG's inner "shine" detail.
  const c = cell();
  const cx = 12,
    apexY = 2.5,
    cyr = 15,
    r = 6.2;
  for (let py = 0; py < CELL; py++) {
    for (let px = 0; px < CELL; px++) {
      const sx = (px + 0.5) / S,
        sy = (py + 0.5) / S; // back to SVG space
      let on = false;
      if ((sx - cx) ** 2 + (sy - cyr) ** 2 <= r * r) {
        on = true; // bottom bulb
      } else if (sy >= apexY && sy <= cyr) {
        // Curved taper from the apex down to the bulb (bulging shoulders).
        const t = (sy - apexY) / (cyr - apexY); // 0 at apex … 1 at bulb centre
        const halfW = r * Math.pow(t, 0.62);
        if (Math.abs(sx - cx) <= halfW) on = true;
      }
      if (on) set(c, px, py, true);
    }
  }
  // Inner "shine" cut (like the SVG's curved highlight) — a small hole.
  for (let py = 0; py < CELL; py++) {
    for (let px = 0; px < CELL; px++) {
      const sx = (px + 0.5) / S,
        sy = (py + 0.5) / S;
      if ((sx - 10) ** 2 + (sy - 15.5) ** 2 <= 1.3 * 1.3) set(c, px, py, false);
    }
  }
  return c;
}
// A storage tank: rounded body with two band separators and a lid nub on top
// (mirrors resources/images/OilStorageIconWhite.svg) — deliberately unlike the
// oil pump's teardrop so the two read differently on the map.
function drawOilStorage() {
  const c = cell();
  rect(c, 5, 6, 14, 14, true); // tank body
  rect(c, 9, 3.5, 6, 3, true); // lid / handle nub on top
  rect(c, 5, 9.4, 14, 1.2, false); // upper band separator (hole)
  rect(c, 5, 13.4, 14, 1.2, false); // lower band separator (hole)
  return c;
}
// A first-aid cross (mirrors resources/images/EmergencyStationIconWhite.svg):
// filled rounded square with a dark plus punched through.
function drawEmergencyStation() {
  const c = cell();
  rect(c, 4, 4, 16, 16, true); // square body
  rect(c, 10.5, 6.5, 3, 11, false); // vertical bar of the plus (hole)
  rect(c, 6.5, 10.5, 11, 3, false); // horizontal bar of the plus (hole)
  return c;
}
// A lighthouse: tapered tower with stripe cuts, lamp on top, base bar.
function drawLighthouse() {
  const c = cell();
  // Tapered tower: widens toward the base.
  for (let sy = 8; sy <= 20; sy++) {
    const halfW = 2 + ((sy - 8) / 12) * 2.2;
    rect(c, 12 - halfW, sy, halfW * 2, 1, true);
  }
  rect(c, 9.5, 5.5, 5, 2.5, true); // lamp house
  rect(c, 7, 20.5, 10, 1.5, true); // base bar
  rect(c, 8.6, 12, 6.8, 1.2, false); // stripe (hole)
  rect(c, 8.2, 16, 7.6, 1.2, false); // stripe (hole)
  // Light rays left + right of the lamp.
  rect(c, 4.5, 6, 3.5, 1.2, true);
  rect(c, 16, 6, 3.5, 1.2, true);
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
// Idempotent: keep only the BASE_COLS original OpenFront columns (City, Port,
// Factory, DefensePost, SAM, Silo) and re-append every ClosedFronts glyph, so
// re-running on an already-extended atlas doesn't duplicate columns.
const BASE_COLS = 6;
const old = decodePng(fs.readFileSync(ATLAS));
// order must match STRUCTURE_ORDER in StructurePass.ts
const glyphs = [
  drawOilPump(),
  drawWall(),
  drawToll(),
  drawOilStorage(),
  drawEmergencyStation(),
  drawLighthouse(),
];
const newCols = BASE_COLS + glyphs.length;
const W = newCols * CELL,
  H = CELL;
const out = Buffer.alloc(W * H * 4);
// copy the first BASE_COLS columns row by row (ignoring any previously appended)
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
    g.data.copy(out, (y * W + colX) * 4, y * CELL * 4, y * CELL * 4 + CELL * 4);
});

const png = encodePng(W, H, out);
fs.writeFileSync(ATLAS, png);

// validate: decode back + preview the 3 new columns
const check = decodePng(fs.readFileSync(ATLAS));
if (check.w !== W || check.h !== H)
  throw new Error("size mismatch after write");
console.log(`wrote ${ATLAS}: ${W}x${H} (${newCols} columns)`);
asciiPreview(check, newCols);

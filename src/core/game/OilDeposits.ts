/**
 * Shared, deterministic oil-deposit map.
 *
 * Deposits are a fixed, seed-independent property of map coordinates (an
 * integer hash — no accumulated floating point) so the simulation and the
 * client's overlay always agree on exactly which tiles are deposits.
 *
 * Instead of scattered single pixels, deposits form a FEW, LARGE, irregular
 * blobs, like real underground oil fields. The map is diced into coarse cells,
 * a sparse subset of which anchor a field. Each field is not a plain circle but
 * the UNION of two overlapping lobes (a big main lobe plus an offset smaller
 * one), giving a lopsided "peanut"/nut silhouette. A lumpy per-block edge wobble
 * makes the outline ragged rather than smooth. Scanning the 3×3 block of
 * neighbouring cells lets a field spill across cell boundaries and merge with
 * its neighbours. Everything is integer math so it stays cross-platform
 * deterministic.
 */

// Eight integer offset directions for the second ("nut") lobe. Diagonals are
// √2 longer, which is fine — it just adds shape variety.
const LOBE_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

export function isOilDepositAt(x: number, y: number): boolean {
  // Bigger cells + a rarer anchor => far fewer fields than before.
  const CELL = 64;
  const cx0 = Math.floor(x / CELL);
  const cy0 = Math.floor(y / CELL);
  for (let gy = cy0 - 1; gy <= cy0 + 1; gy++) {
    for (let gx = cx0 - 1; gx <= cx0 + 1; gx++) {
      let h = (Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663)) >>> 0;
      h = (h ^ (h >>> 13)) >>> 0;
      h = Math.imul(h, 0x5bd1e995) >>> 0;
      // Only ~1 in 4 cells actually anchor a field → sparse, spread-out fields.
      if (h % 4 !== 0) continue;

      // Field centre, jittered inside its cell.
      const centerX = gx * CELL + (h % CELL);
      const centerY = gy * CELL + ((h >>> 8) % CELL);

      // Big main lobe: base radius 8–17 varies per field.
      const baseR = 8 + ((h >>> 16) % 10);

      // A lumpy edge shared across 3×3 tile blocks (so it isn't grainy) makes
      // the outline ragged, not a clean circle.
      let e =
        (Math.imul(Math.floor(x / 3), 668265263) ^
          Math.imul(Math.floor(y / 3), 2246822519)) >>>
        0;
      e = (e ^ (e >>> 15)) >>> 0;
      const wobble = (e % 7) - 3; // −3..+3

      // Main lobe.
      const dx = x - centerX;
      const dy = y - centerY;
      const r = baseR + wobble;
      if (r > 0 && dx * dx + dy * dy <= r * r) return true;

      // Second, smaller lobe offset from the centre → a lopsided nut/peanut
      // shape instead of a plain circle. Present on ~half the fields.
      if ((h >>> 5) & 1) {
        const dir = LOBE_DIRS[(h >>> 24) & 7];
        // Offset the lobe by ~¾ of the main radius so the two circles overlap
        // into one blob rather than splitting into two separate dots.
        const step = Math.floor((baseR * 3) / 4);
        const ox = centerX + dir[0] * step;
        const oy = centerY + dir[1] * step;
        const r2 = Math.floor((baseR * 3) / 4) + wobble;
        const dx2 = x - ox;
        const dy2 = y - oy;
        if (r2 > 0 && dx2 * dx2 + dy2 * dy2 <= r2 * r2) return true;
      }
    }
  }
  return false;
}

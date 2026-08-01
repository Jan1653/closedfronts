/**
 * Shared, deterministic oil-deposit map.
 *
 * Deposits are a fixed, seed-independent property of map coordinates (an
 * integer hash — no accumulated floating point) so the simulation and the
 * client's overlay always agree on exactly which tiles are deposits.
 *
 * Fields are FEW but VERY LARGE, like real underground oil basins: the map is
 * diced into coarse cells, a sparse subset of which anchor a field. A field is
 * the UNION of two overlapping lobes (a big main lobe plus an offset smaller
 * one), giving a lopsided "peanut" silhouette, with a lumpy per-block edge
 * wobble so the outline is ragged rather than smooth.
 *
 * Every deposit tile also carries a GRADE from 1 to 5: a field is richest at
 * its core and thins out toward the rim until it stops entirely. Grade 3 is the
 * baseline yield; grade 5 pumps twice as much as grade 3 (see
 * OIL_GRADE_PERCENT). The client's overlay paints darker tiles for higher
 * grades, so the map reads like a heat map of the underground.
 *
 * Everything is integer math (squared-distance ring tests, no sqrt) so it stays
 * cross-platform deterministic.
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

/** Number of deposit strength levels (1 = thin rim … MAX = black core). */
export const OIL_GRADE_MAX = 5;

/**
 * Yield per grade, as an integer percent of the baseline. Grade 3 is the
 * baseline (100 %) and grade 5 is exactly twice that. Integer percentages keep
 * the production math free of floating point.
 */
export const OIL_GRADE_PERCENT: readonly number[] = [
  0, // grade 0 — no deposit
  50, // grade 1
  75, // grade 2
  100, // grade 3 — baseline
  150, // grade 4
  200, // grade 5
];

/** Grid size of the field anchors. Bigger cell => fewer, further-apart fields. */
const CELL = 160;

/**
 * Strength of the oil deposit at (x, y): 0 when there is none, otherwise 1..5
 * with 5 at the heart of a field. Overlapping fields/lobes keep the best grade.
 */
export function oilDepositGradeAt(x: number, y: number): number {
  const cx0 = Math.floor(x / CELL);
  const cy0 = Math.floor(y / CELL);

  // A lumpy edge shared across 3×3 tile blocks (so it isn't grainy) makes the
  // outline ragged, not a clean circle. Computed once — it only depends on the
  // tile, not on which field we are testing.
  let e =
    (Math.imul(Math.floor(x / 3), 668265263) ^
      Math.imul(Math.floor(y / 3), 2246822519)) >>>
    0;
  e = (e ^ (e >>> 15)) >>> 0;
  const wobble = (e % 13) - 6; // −6..+6

  let best = 0;
  for (let gy = cy0 - 1; gy <= cy0 + 1; gy++) {
    for (let gx = cx0 - 1; gx <= cx0 + 1; gx++) {
      let h = (Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663)) >>> 0;
      h = (h ^ (h >>> 13)) >>> 0;
      h = Math.imul(h, 0x5bd1e995) >>> 0;
      // Only ~1 in 3 cells actually anchor a field → few, spread-out basins.
      if (h % 3 !== 0) continue;

      // Field centre, jittered inside its cell.
      const centerX = gx * CELL + (h % CELL);
      const centerY = gy * CELL + ((h >>> 8) % CELL);

      // Main lobe: base radius 55–99 varies per field. Several times the old
      // size, so a single basin covers a serious chunk of a continent.
      const baseR = 55 + ((h >>> 16) % 45);

      const r = baseR + wobble;
      const g = gradeInLobe(x - centerX, y - centerY, r);
      if (g > best) best = g;
      if (best === OIL_GRADE_MAX) return best;

      // Second, smaller lobe offset from the centre → a lopsided nut/peanut
      // shape instead of a plain circle. Present on ~half the fields.
      if ((h >>> 5) & 1) {
        const dir = LOBE_DIRS[(h >>> 24) & 7];
        // Offset the lobe by ~¾ of the main radius so the two circles overlap
        // into one blob rather than splitting into two separate dots.
        const step = Math.floor((baseR * 3) / 4);
        const r2 = Math.floor((baseR * 3) / 4) + wobble;
        const g2 = gradeInLobe(
          x - (centerX + dir[0] * step),
          y - (centerY + dir[1] * step),
          r2,
        );
        if (g2 > best) best = g2;
        if (best === OIL_GRADE_MAX) return best;
      }
    }
  }
  return best;
}

/**
 * Grade of the point (dx, dy) relative to a lobe of radius `r`: 5 inside the
 * innermost fifth, dropping one level per fifth of the radius, 0 outside.
 * Pure squared-distance comparisons — no sqrt, no floats.
 */
function gradeInLobe(dx: number, dy: number, r: number): number {
  if (r <= 0) return 0;
  const d2 = dx * dx + dy * dy;
  const r2 = r * r;
  // Ring k (k = 1..5) ends at radius r·k/5 ⟺ d²·25 ≤ r²·k².
  const scaled = d2 * 25;
  if (scaled > r2 * 25) return 0;
  if (scaled <= r2) return 5;
  if (scaled <= r2 * 4) return 4;
  if (scaled <= r2 * 9) return 3;
  if (scaled <= r2 * 16) return 2;
  return 1;
}

export function isOilDepositAt(x: number, y: number): boolean {
  return oilDepositGradeAt(x, y) > 0;
}

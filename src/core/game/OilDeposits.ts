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
 * one), giving a lopsided "peanut" silhouette. Each lobe is an ELLIPSE, not a
 * disc — squashed along one axis by a per-field amount — and its radius is
 * bent by three scales of smooth noise, so the outline waves in and out in
 * bays and headlands the way a real basin does instead of reading as a circle.
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
 * How much oil a game holds, as SIXTEENTHS of the normal field radius. The host
 * picks one of these when creating the game (GameConfig.oilDeposits); the size
 * of the fields is what moves, so the five grade rings inside each field stay
 * exactly as they are — a scarce map has the same rich cores, just less of
 * everything around them. Area goes with the square of these, so `abundant`
 * holds roughly two and a half times the oil of `normal`.
 */
export const OIL_DEPOSIT_SCALES = {
  scarce: 11,
  normal: 16,
  rich: 21,
  abundant: 26,
} as const;

export type OilDepositAmount = keyof typeof OIL_DEPOSIT_SCALES;

export const DEFAULT_OIL_DEPOSIT_SCALE = OIL_DEPOSIT_SCALES.normal;

/**
 * Strength of the oil deposit at (x, y): 0 when there is none, otherwise 1..5
 * with 5 at the heart of a field. Overlapping fields/lobes keep the best grade.
 *
 * `scale` is the per-game field size in sixteenths (see OIL_DEPOSIT_SCALES).
 * Every caller — simulation and the client's overlay alike — has to pass the
 * same one, or they disagree about where the oil is.
 */
export function oilDepositGradeAt(
  x: number,
  y: number,
  scale: number = DEFAULT_OIL_DEPOSIT_SCALE,
): number {
  const cx0 = Math.floor(x / CELL);
  const cy0 = Math.floor(y / CELL);

  // Edge wobble, three scales added together: the coarse one bends the outline
  // into bays and headlands over ~40 tiles, the middle one ripples it, the fine
  // one keeps it from looking machined. It shifts the RADIUS, so every grade
  // ring moves with it and the five-step gradient stays exactly as it was.
  // Depends only on the tile, not on which field we are testing.
  const wobble =
    smoothNoise(x, y, 57, 30, 0x9e3779b1) +
    smoothNoise(x, y, 19, 13, 0x85ebca6b) +
    smoothNoise(x, y, 3, 3, 0xc2b2ae35);

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

      // Main lobe: base radius 69–125 varies per field. Several times the old
      // size, so a single basin covers a serious chunk of a continent. The
      // range is ~1.26x what a round field used the squash below costs an
      // ellipse roughly a third of a disc's area, and the map should hold as
      // much oil as it did when fields were circles.
      const baseR = Math.floor(((69 + ((h >>> 16) % 57)) * scale) / 16);

      // Squash the lobe along one axis (sixteenths) so the field is an
      // elongated basin rather than a disc. Which axis, and how much, is fixed
      // per field.
      const squash = 16 + ((h >>> 10) % 20); // 16..35 => up to ~2.2:1
      const alongX = ((h >>> 9) & 1) === 1;
      const sx = alongX ? 16 : squash;
      const sy = alongX ? squash : 16;

      const r = baseR + wobble;
      const g = gradeInLobe(x - centerX, y - centerY, r, sx, sy);
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
          sx,
          sy,
        );
        if (g2 > best) best = g2;
        if (best === OIL_GRADE_MAX) return best;
      }
    }
  }
  return best;
}

/**
 * Smooth integer value noise in −amp..+amp.
 *
 * Hashed values on a lattice of `cell`-sized squares, bilinearly interpolated
 * between the four corners, so it varies gradually across a field instead of
 * stepping from block to block. Everything is integer arithmetic on exact
 * values, so it stays cross-platform deterministic.
 */
function smoothNoise(
  x: number,
  y: number,
  cell: number,
  amp: number,
  seed: number,
): number {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const fx = x - gx * cell; // 0..cell-1
  const fy = y - gy * cell;
  const n00 = latticeValue(gx, gy, seed);
  const n10 = latticeValue(gx + 1, gy, seed);
  const n01 = latticeValue(gx, gy + 1, seed);
  const n11 = latticeValue(gx + 1, gy + 1, seed);
  // Bilinear blend, kept in integer space by scaling with `cell`.
  const top = n00 * (cell - fx) + n10 * fx;
  const bottom = n01 * (cell - fx) + n11 * fx;
  const blended = top * (cell - fy) + bottom * fy; // 0..255*cell*cell
  const unit = Math.floor(blended / (cell * cell)); // 0..255
  return Math.floor(((unit - 128) * amp) / 128);
}

/** Hashed lattice corner value, 0..255. */
function latticeValue(gx: number, gy: number, seed: number): number {
  let h = (Math.imul(gx, 374761393) ^ Math.imul(gy, 668265263) ^ seed) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h ^ (h >>> 16)) & 255;
}

/**
 * Grade of the point (dx, dy) relative to a lobe of radius `r`: 5 inside the
 * innermost fifth, dropping one level per fifth of the radius, 0 outside.
 * `stretchX`/`stretchY` are sixteenths applied to the offsets before the
 * distance test, which turns the lobe into an ellipse — 16 leaves that axis at
 * full length, larger values pull it in. Pure squared-distance comparisons —
 * no sqrt, no floats.
 */
function gradeInLobe(
  dx: number,
  dy: number,
  r: number,
  stretchX: number = 16,
  stretchY: number = 16,
): number {
  if (r <= 0) return 0;
  const ex = Math.floor((dx * stretchX) / 16);
  const ey = Math.floor((dy * stretchY) / 16);
  const d2 = ex * ex + ey * ey;
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

export function isOilDepositAt(
  x: number,
  y: number,
  scale: number = DEFAULT_OIL_DEPOSIT_SCALE,
): boolean {
  return oilDepositGradeAt(x, y, scale) > 0;
}

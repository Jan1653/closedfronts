/**
 * Shared, deterministic map of MINEABLE resources: coal, ore and diamond.
 *
 * Like OilDeposits this is a pure function — no stored state, no accumulated
 * floating point — so the simulation and the client's overlay always agree on
 * exactly which tile holds what. Unlike oil it reads the TERRAIN BYTE as well
 * as the coordinates, because where a resource sits is largely a question of
 * what the ground is:
 *
 *  - Coal is the workhorse. It is common, scattered in many small seams rather
 *    than a few huge basins, and it favours high ground — mountains are thick
 *    with it, plains hold the odd thin seam.
 *  - Ore is rare and clings to mountains almost exclusively.
 *  - Diamond is rarer still, and both it and ore keep APPEARING as the game
 *    runs: each field carries a birth epoch, so new pockets surface over time
 *    (diamond faster than ore). Everything already on the map stays put.
 *
 * The terrain byte is the same one GameMap stores and the client uploads to the
 * GPU, so both sides can evaluate this without a GameMap instance.
 */

/** What a tile holds. 0 = nothing; the values are also the overlay's codes. */
export enum ResourceType {
  Coal = 1,
  Ore = 2,
  Diamond = 3,
}

/** Grades run 1 (a thin seam) to 5 (a seam worth building on). */
export const RESOURCE_GRADE_MAX = 5;

/**
 * Yield per grade as an integer percent of the baseline, mirroring oil's
 * OIL_GRADE_PERCENT so the two economies read the same way.
 */
export const RESOURCE_GRADE_PERCENT: readonly number[] = [
  0, // grade 0 — nothing
  50, // grade 1
  75, // grade 2
  100, // grade 3 — baseline
  150, // grade 4
  200, // grade 5
];

// ── Terrain byte layout (mirrors GameMapImpl) ──────────────────────────────
const IS_LAND_BIT = 7;
const MAGNITUDE_MASK = 0x1f;
const IMPASSABLE_MAGNITUDE = 31;
// GameMap.terrainType: < 10 plains, < 20 highland, else mountain.
const HIGHLAND_MAGNITUDE = 10;
const MOUNTAIN_MAGNITUDE = 20;

function isLand(terrainByte: number): boolean {
  return (terrainByte & (1 << IS_LAND_BIT)) !== 0;
}

function isMineable(terrainByte: number): boolean {
  if (!isLand(terrainByte)) return false;
  return (terrainByte & MAGNITUDE_MASK) !== IMPASSABLE_MAGNITUDE;
}

// ── Field layout per resource ──────────────────────────────────────────────
//
// Small cells and small radii on purpose: coal should read as many scattered
// seams across a continent, not as the handful of continent-sized basins oil
// forms. Ore and diamond use much bigger cells (so fields are far apart) with
// tiny radii (so each one is a pocket).

interface FieldSpec {
  /** Grid size of the field anchors. Bigger => fewer, further-apart fields. */
  cell: number;
  /** 1 in `oneIn` cells anchors a field. */
  oneIn: number;
  /** Field radius: base + up to `spread` more, per field. */
  baseRadius: number;
  spread: number;
  /** Hash seed, keeps the three resources from landing on top of each other. */
  seed: number;
  /**
   * Epochs over which a resource keeps surfacing. 0 = everything is there from
   * the first tick (coal). Larger => new fields appear more slowly.
   */
  birthEpochs: number;
  /**
   * Percent of fields that are there from tick zero. The rest are spread over
   * `birthEpochs`. Without this a resource that surfaces over time would start
   * the game with essentially none of itself on the map.
   */
  presentAtStartPercent: number;
}

const COAL: FieldSpec = {
  cell: 44,
  oneIn: 2,
  baseRadius: 8,
  spread: 12,
  seed: 0x00c0a1,
  birthEpochs: 0,
  presentAtStartPercent: 100,
};

const ORE: FieldSpec = {
  cell: 78,
  oneIn: 3,
  baseRadius: 3,
  spread: 4,
  seed: 0x0e3ee1,
  birthEpochs: 30,
  presentAtStartPercent: 45,
};

const DIAMOND: FieldSpec = {
  cell: 118,
  oneIn: 5,
  baseRadius: 2,
  spread: 3,
  seed: 0x0d1a30,
  birthEpochs: 12,
  presentAtStartPercent: 35,
};

/**
 * How many ticks one "epoch" of new ore/diamond fields lasts. At 10 ticks per
 * second this is two minutes, so a diamond field surfaces somewhere every few
 * minutes and the map is still filling in late in a long game.
 */
export const RESOURCE_EPOCH_TICKS = 1200;

export function resourceEpoch(ticks: number): number {
  return Math.floor(Math.max(0, ticks) / RESOURCE_EPOCH_TICKS);
}

/**
 * Grade of `spec`'s field at (x, y), 0 when there is none. `epoch` gates fields
 * that have not surfaced yet.
 */
function fieldGrade(
  spec: FieldSpec,
  x: number,
  y: number,
  epoch: number,
): number {
  const cx0 = Math.floor(x / spec.cell);
  const cy0 = Math.floor(y / spec.cell);

  // A single scale of wobble is enough here — these fields are small, and a
  // ragged edge on a 10-tile seam reads as scattered rock rather than a disc.
  const wobble = smoothNoise(x, y, 11, 4, spec.seed ^ 0x5f356495);

  let best = 0;
  for (let gy = cy0 - 1; gy <= cy0 + 1; gy++) {
    for (let gx = cx0 - 1; gx <= cx0 + 1; gx++) {
      let h = (Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663)) >>> 0;
      h = (h ^ (h >>> 13)) >>> 0;
      h = Math.imul(h, 0x5bd1e995) >>> 0;
      h = (h ^ spec.seed) >>> 0;
      h = (h ^ (h >>> 15)) >>> 0;
      if (h % spec.oneIn !== 0) continue;

      // Fields that surface later in the game (ore, diamond). A share of them
      // is there from the start; the rest is dealt evenly over the epochs.
      if (spec.birthEpochs > 0) {
        const roll = (h >>> 3) % 100;
        if (roll >= spec.presentAtStartPercent) {
          const span = 100 - spec.presentAtStartPercent;
          const birth =
            1 +
            Math.floor(
              ((roll - spec.presentAtStartPercent) * spec.birthEpochs) / span,
            );
          if (epoch < birth) continue;
        }
      }

      const centerX = gx * spec.cell + (h % spec.cell);
      const centerY = gy * spec.cell + ((h >>> 8) % spec.cell);
      const r = spec.baseRadius + ((h >>> 16) % (spec.spread + 1)) + wobble;
      const g = gradeInField(x - centerX, y - centerY, r);
      if (g > best) best = g;
      if (best === RESOURCE_GRADE_MAX) return best;
    }
  }
  return best;
}

/**
 * Grade of a point `dx`,`dy` from a field centre of radius `r`: 5 in the
 * innermost fifth, one level less per fifth outward, 0 beyond. Squared-distance
 * only — no sqrt, no floats.
 */
function gradeInField(dx: number, dy: number, r: number): number {
  if (r <= 0) return 0;
  const d2 = dx * dx + dy * dy;
  const r2 = r * r;
  const scaled = d2 * 25;
  if (scaled > r2 * 25) return 0;
  if (scaled <= r2) return 5;
  if (scaled <= r2 * 4) return 4;
  if (scaled <= r2 * 9) return 3;
  if (scaled <= r2 * 16) return 2;
  return 1;
}

/**
 * Terrain adjustment for coal: mountains are rich, highland normal, plains
 * thin. Applied to the GRADE, so high ground both holds more coal and holds
 * better coal — while a plains seam is still perfectly possible, just poor.
 */
function coalTerrainBonus(terrainByte: number): number {
  const mag = terrainByte & MAGNITUDE_MASK;
  if (mag >= MOUNTAIN_MAGNITUDE) return 2;
  if (mag >= HIGHLAND_MAGNITUDE) return 1;
  return -1;
}

/**
 * What (if anything) can be mined at this tile, and how rich it is.
 *
 * `ticks` is the current game tick — it only matters for ore and diamond, whose
 * fields surface over time. Pass the same value on both sides or the overlay
 * will disagree with the simulation about a freshly surfaced pocket.
 *
 * Diamond wins over ore, ore over coal, so a rare find is never hidden under a
 * common one.
 */
export function resourceAt(
  terrainByte: number,
  x: number,
  y: number,
  ticks: number,
): { type: ResourceType; grade: number } | null {
  if (!isMineable(terrainByte)) return null;

  const mag = terrainByte & MAGNITUDE_MASK;
  const epoch = resourceEpoch(ticks);

  // Diamond and ore are mountain business, but not exclusively: on flat ground
  // a pocket is simply one grade poorer, which can wipe out a thin one. A hard
  // height gate would leave a flat map with no rare resources at all.
  const heightPenalty = mag >= HIGHLAND_MAGNITUDE ? 0 : 1;
  const diamond = fieldGrade(DIAMOND, x, y, epoch) - heightPenalty;
  if (diamond > 0) {
    return { type: ResourceType.Diamond, grade: diamond };
  }
  const ore = fieldGrade(ORE, x, y, epoch) - heightPenalty;
  if (ore > 0) return { type: ResourceType.Ore, grade: ore };

  const coal = fieldGrade(COAL, x, y, epoch);
  if (coal <= 0) return null;
  const grade = coal + coalTerrainBonus(terrainByte);
  if (grade <= 0) return null;
  return {
    type: ResourceType.Coal,
    grade: Math.min(RESOURCE_GRADE_MAX, grade),
  };
}

/**
 * The overlay's per-tile code: 0 for nothing, otherwise `type * 8 + grade`, so
 * one unsigned byte carries both and the shader can split them apart.
 */
export function resourceOverlayCode(
  terrainByte: number,
  x: number,
  y: number,
  ticks: number,
): number {
  const found = resourceAt(terrainByte, x, y, ticks);
  return found === null ? 0 : found.type * 8 + found.grade;
}

/**
 * Smooth integer value noise in −amp..+amp — the same construction
 * OilDeposits uses, kept local so the two systems can be tuned apart.
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
  const fx = x - gx * cell;
  const fy = y - gy * cell;
  const n00 = latticeValue(gx, gy, seed);
  const n10 = latticeValue(gx + 1, gy, seed);
  const n01 = latticeValue(gx, gy + 1, seed);
  const n11 = latticeValue(gx + 1, gy + 1, seed);
  const top = n00 * (cell - fx) + n10 * fx;
  const bottom = n01 * (cell - fx) + n11 * fx;
  const blended = top * (cell - fy) + bottom * fy;
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

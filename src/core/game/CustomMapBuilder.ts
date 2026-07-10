/**
 * Turns a hand-painted terrain grid into the exact byte format the game's
 * GameMapImpl consumes (see GameMap.ts bit layout). The map loader trusts these
 * bytes verbatim — it does not derive ocean/shoreline — so we precompute them
 * here, the same way the offline map generator does.
 *
 * Terrain byte (Uint8): bit7 = land, bit6 = shoreline, bit5 = ocean,
 * bits0-4 = magnitude (elevation 0-31). Land with magnitude 31 is impassable
 * (mountains / void). Water is ocean when it flood-fills from the map border,
 * otherwise a lake (byte 0).
 *
 * Pure integer math, no external deps — safe to run anywhere (deterministic).
 */

// Palette values the editor paints with.
export enum PaintTile {
  Water = 0,
  Land = 1,
  Mountain = 2,
}

const IS_LAND_BIT = 7;
const SHORELINE_BIT = 6;
const OCEAN_BIT = 5;
const IMPASSABLE_MAGNITUDE = 31;
// Plain, passable land elevation. Mountains use IMPASSABLE_MAGNITUDE.
const LAND_MAGNITUDE = 15;

export interface CustomTerrain {
  width: number;
  height: number;
  data: Uint8Array;
  numLandTiles: number;
}

/**
 * @param paint width*height array of PaintTile values (row-major).
 */
export function buildCustomTerrain(
  paint: Uint8Array | number[],
  width: number,
  height: number,
): CustomTerrain {
  const n = width * height;
  if (paint.length !== n) {
    throw new Error(
      `paint length ${paint.length} != ${width}x${height} (${n})`,
    );
  }
  const data = new Uint8Array(n);

  // 1) Land / mountain bytes; water starts as 0 (lake) and may become ocean.
  let numLandTiles = 0;
  for (let i = 0; i < n; i++) {
    const p = paint[i];
    if (p === PaintTile.Land) {
      data[i] = (1 << IS_LAND_BIT) | LAND_MAGNITUDE;
      numLandTiles++;
    } else if (p === PaintTile.Mountain) {
      data[i] = (1 << IS_LAND_BIT) | IMPASSABLE_MAGNITUDE;
      numLandTiles++;
    } else {
      data[i] = 0; // water (lake until proven ocean)
    }
  }

  const isLand = (i: number) => (data[i] & (1 << IS_LAND_BIT)) !== 0;

  // 2) Ocean = water reachable from the map border (flood fill over water).
  const stack: number[] = [];
  const pushIfBorderWater = (i: number) => {
    if (!isLand(i) && (data[i] & (1 << OCEAN_BIT)) === 0) {
      data[i] |= 1 << OCEAN_BIT;
      stack.push(i);
    }
  };
  for (let x = 0; x < width; x++) {
    pushIfBorderWater(x); // top row
    pushIfBorderWater((height - 1) * width + x); // bottom row
  }
  for (let y = 0; y < height; y++) {
    pushIfBorderWater(y * width); // left col
    pushIfBorderWater(y * width + (width - 1)); // right col
  }
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i / width) | 0;
    if (x > 0) pushIfBorderWater(i - 1);
    if (x < width - 1) pushIfBorderWater(i + 1);
    if (y > 0) pushIfBorderWater(i - width);
    if (y < height - 1) pushIfBorderWater(i + width);
  }

  // 3) Shoreline = a land tile orthogonally adjacent to an ocean tile.
  const isOcean = (i: number) => (data[i] & (1 << OCEAN_BIT)) !== 0;
  for (let i = 0; i < n; i++) {
    if (!isLand(i)) continue;
    const x = i % width;
    const y = (i / width) | 0;
    if (
      (x > 0 && isOcean(i - 1)) ||
      (x < width - 1 && isOcean(i + 1)) ||
      (y > 0 && isOcean(i - width)) ||
      (y < height - 1 && isOcean(i + width))
    ) {
      data[i] |= 1 << SHORELINE_BIT;
    }
  }

  return { width, height, data, numLandTiles };
}

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

/**
 * Palette values the editor paints with. Each maps to a land/water flag and an
 * elevation magnitude (0-31) that the renderer colours as a distinct band
 * (plains → highland → mountain → impassable peak; water darkens with depth).
 *
 * The numeric values are wire-stable: 0 (water) and 2 (impassable peak) match
 * the original 3-tile palette, so maps drawn before the richer palette still
 * load correctly. New tiles use higher numbers.
 */
export enum PaintTile {
  Water = 0, // ocean/lake, shallow
  Plains = 1, // low green land
  Peak = 2, // impassable wall (legacy "Mountain")
  Highland = 3, // tan hills
  Mountain = 4, // grey passable mountain
  DeepWater = 5, // darker deep water
}

const IS_LAND_BIT = 7;
const SHORELINE_BIT = 6;
const OCEAN_BIT = 5;
const IMPASSABLE_MAGNITUDE = 31;

// Per-tile land flag + elevation magnitude. Magnitudes sit in the middle of the
// renderer's colour bands (plains <10, highland 10-19, mountain 20-30, peak 31)
// so each type reads as its intended terrain.
interface PaintInfo {
  land: boolean;
  magnitude: number;
}
const PAINT_INFO: Record<PaintTile, PaintInfo> = {
  [PaintTile.Water]: { land: false, magnitude: 0 },
  [PaintTile.DeepWater]: { land: false, magnitude: 10 },
  [PaintTile.Plains]: { land: true, magnitude: 5 },
  [PaintTile.Highland]: { land: true, magnitude: 15 },
  [PaintTile.Mountain]: { land: true, magnitude: 25 },
  [PaintTile.Peak]: { land: true, magnitude: IMPASSABLE_MAGNITUDE },
};

function infoFor(p: number): PaintInfo {
  return PAINT_INFO[p as PaintTile] ?? PAINT_INFO[PaintTile.Water];
}

/** True for any land tile (plains/highland/mountain/peak). */
export function isLandPaint(p: number): boolean {
  return infoFor(p).land;
}

export interface CustomTerrain {
  width: number;
  height: number;
  data: Uint8Array;
  numLandTiles: number;
}

/**
 * Wire form of a hand-drawn map, small enough to ride inside a GameConfig so it
 * reaches both the render thread and the sim worker with the game-start info.
 * `paint` is base64 of a width*height PaintTile grid (row-major).
 */
export interface SerializedCustomMap {
  name: string;
  width: number;
  height: number;
  paint: string;
}

/** Decode a base64 PaintTile grid back into bytes (worker + browser + node). */
export function decodeCustomMapPaint(
  paint: string,
  width: number,
  height: number,
): Uint8Array {
  const bin = atob(paint);
  const n = width * height;
  if (bin.length !== n) {
    throw new Error(
      `custom map paint length ${bin.length} != ${width}x${height} (${n})`,
    );
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Downscale a paint grid to half resolution (ceil), the same ratio the offline
 * map generator uses for its 4x mini map. A block keeps its highest-elevation
 * land tile if any land is present (so thin isthmuses and peaks survive into the
 * coarse pathfinding map), otherwise deep water if any, else shallow water.
 */
export function downscalePaint(
  paint: Uint8Array | number[],
  width: number,
  height: number,
): { paint: Uint8Array; width: number; height: number } {
  const mw = Math.ceil(width / 2);
  const mh = Math.ceil(height / 2);
  const out = new Uint8Array(mw * mh);
  for (let my = 0; my < mh; my++) {
    for (let mx = 0; mx < mw; mx++) {
      let bestLand = -1;
      let bestLandMag = -1;
      let anyDeep = false;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const x = mx * 2 + dx;
          const y = my * 2 + dy;
          if (x >= width || y >= height) continue;
          const p = paint[y * width + x];
          const info = infoFor(p);
          if (info.land) {
            if (info.magnitude > bestLandMag) {
              bestLandMag = info.magnitude;
              bestLand = p;
            }
          } else if (p === PaintTile.DeepWater) {
            anyDeep = true;
          }
        }
      }
      out[my * mw + mx] =
        bestLand >= 0
          ? bestLand
          : anyDeep
            ? PaintTile.DeepWater
            : PaintTile.Water;
    }
  }
  return { paint: out, width: mw, height: mh };
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

  // 1) Land + elevation bytes; water carries its depth magnitude and may later
  //    gain the ocean bit via the border flood fill.
  let numLandTiles = 0;
  for (let i = 0; i < n; i++) {
    const info = infoFor(paint[i]);
    if (info.land) {
      data[i] = (1 << IS_LAND_BIT) | info.magnitude;
      numLandTiles++;
    } else {
      data[i] = info.magnitude; // water depth (lake until proven ocean)
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

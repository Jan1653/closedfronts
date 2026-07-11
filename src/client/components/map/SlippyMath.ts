/**
 * Web-Mercator slippy-map tile math for the OSM map picker — pure and testable
 * (no DOM). Standard OSM tiling: 256 px tiles, z/x/y where x = west→east and
 * y = north→south, both 0..2^z. Fractional tile coords let us position the view
 * to sub-tile precision.
 */

import type { GeoBBox } from "../../../core/game/OsmRaster";

export const TILE_SIZE = 256;

export function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * Math.pow(2, z);
}

export function latToTileY(lat: number, z: number): number {
  const r = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) *
    Math.pow(2, z)
  );
}

export function tileXToLon(x: number, z: number): number {
  return (x / Math.pow(2, z)) * 360 - 180;
}

export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Lon/lat bounding box of a viewport of `widthPx`×`heightPx` centered on
 * (centerLon, centerLat) at integer zoom `z`. This is the area the picker will
 * convert — "what you see is what you get".
 */
export function viewportBBox(
  centerLon: number,
  centerLat: number,
  z: number,
  widthPx: number,
  heightPx: number,
): GeoBBox {
  const cx = lonToTileX(centerLon, z);
  const cy = latToTileY(centerLat, z);
  const halfW = widthPx / 2 / TILE_SIZE;
  const halfH = heightPx / 2 / TILE_SIZE;
  return {
    minLon: tileXToLon(cx - halfW, z),
    maxLon: tileXToLon(cx + halfW, z),
    // Smaller tile-y is further north → larger latitude.
    maxLat: tileYToLat(cy - halfH, z),
    minLat: tileYToLat(cy + halfH, z),
  };
}

/**
 * Integer tile x/y range (inclusive) covering a viewport, plus the pixel offset
 * of the top-left tile relative to the viewport's top-left corner. Used to lay
 * out the <img> tile grid.
 */
export function tilesForViewport(
  centerLon: number,
  centerLat: number,
  z: number,
  widthPx: number,
  heightPx: number,
): {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  offsetX: number;
  offsetY: number;
} {
  const cx = lonToTileX(centerLon, z);
  const cy = latToTileY(centerLat, z);
  // Tile coord of the viewport's top-left corner.
  const leftTile = cx - widthPx / 2 / TILE_SIZE;
  const topTile = cy - heightPx / 2 / TILE_SIZE;
  const x0 = Math.floor(leftTile);
  const y0 = Math.floor(topTile);
  const x1 = Math.floor(cx + widthPx / 2 / TILE_SIZE);
  const y1 = Math.floor(cy + heightPx / 2 / TILE_SIZE);
  // Where the top-left tile's corner sits in viewport pixels (usually negative).
  const offsetX = (x0 - leftTile) * TILE_SIZE;
  const offsetY = (y0 - topTile) * TILE_SIZE;
  return { x0, y0, x1, y1, offsetX, offsetY };
}

/** Wrap a tile x into [0, 2^z) so panning across the antimeridian still loads. */
export function wrapTileX(x: number, z: number): number {
  const n = Math.pow(2, z);
  return ((x % n) + n) % n;
}

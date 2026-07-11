/**
 * Elevation (DEM) source for the OSM map import: samples real-world heights from
 * the open "Terrarium" terrain tiles (AWS `elevation-tiles-prod`, CC-BY, CORS
 * enabled) so imported maps get genuine height variation instead of flat land.
 *
 * Terrarium decodes each RGB pixel to metres: elevation = R*256 + G + B/256 - 32768.
 *
 * Pure tile math lives in SlippyMath; here we do the network fetch + canvas
 * decode. Returns null on any failure so the caller can fall back to flat land.
 */

import type { GeoBBox } from "../../../core/game/OsmRaster";
import { latToTileY, lonToTileX, TILE_SIZE } from "./SlippyMath";

const DEM_TILE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";

/**
 * Pick a Terrarium zoom for `bbox`: the highest zoom whose tile span stays
 * within `maxTilesPerSide` in both directions, so we fetch a bounded number of
 * tiles while keeping resolution as high as possible.
 */
export function demZoomForBBox(bbox: GeoBBox, maxTilesPerSide = 4): number {
  for (let z = 13; z >= 4; z--) {
    const lonTiles =
      Math.abs(lonToTileX(bbox.maxLon, z) - lonToTileX(bbox.minLon, z)) + 1;
    const latTiles =
      Math.abs(latToTileY(bbox.minLat, z) - latToTileY(bbox.maxLat, z)) + 1;
    if (lonTiles <= maxTilesPerSide && latTiles <= maxTilesPerSide) return z;
  }
  return 4;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`tile load failed: ${url}`));
    img.src = url;
  });
}

/**
 * Fetch a real-world elevation value (metres) per grid cell for `bbox` at
 * `width`×`height`. Returns null if the tiles can't be loaded/decoded (caller
 * then falls back to flat terrain). NaN entries mark cells with no data.
 */
export async function fetchElevationGrid(
  bbox: GeoBBox,
  width: number,
  height: number,
): Promise<Float32Array | null> {
  try {
    const z = demZoomForBBox(bbox);
    const x0 = Math.floor(lonToTileX(bbox.minLon, z));
    const x1 = Math.floor(lonToTileX(bbox.maxLon, z));
    const y0 = Math.floor(latToTileY(bbox.maxLat, z)); // north
    const y1 = Math.floor(latToTileY(bbox.minLat, z)); // south
    const cols = x1 - x0 + 1;
    const rows = y1 - y0 + 1;
    if (cols <= 0 || rows <= 0 || cols * rows > 64) return null;

    const canvas = document.createElement("canvas");
    canvas.width = cols * TILE_SIZE;
    canvas.height = rows * TILE_SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    const n = Math.pow(2, z);
    await Promise.all(
      Array.from({ length: rows }, (_, ry) =>
        Array.from({ length: cols }, async (_, rx) => {
          const tx = (((x0 + rx) % n) + n) % n;
          const ty = y0 + ry;
          if (ty < 0 || ty >= n) return;
          const img = await loadImage(`${DEM_TILE}/${z}/${tx}/${ty}.png`);
          ctx.drawImage(img, rx * TILE_SIZE, ry * TILE_SIZE);
        }),
      ).flat(),
    );

    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const out = new Float32Array(width * height);
    for (let cy = 0; cy < height; cy++) {
      for (let cx = 0; cx < width; cx++) {
        // Cell center → lon/lat → tile-space pixel in the composite.
        const lon =
          bbox.minLon + ((cx + 0.5) / width) * (bbox.maxLon - bbox.minLon);
        const yTopT = latToTileY(bbox.maxLat, z);
        const yBotT = latToTileY(bbox.minLat, z);
        const fyTile = yTopT + ((cy + 0.5) / height) * (yBotT - yTopT);
        const fxTile = lonToTileX(lon, z);
        const gx = Math.floor((fxTile - x0) * TILE_SIZE);
        const gy = Math.floor((fyTile - y0) * TILE_SIZE);
        if (gx < 0 || gy < 0 || gx >= canvas.width || gy >= canvas.height) {
          out[cy * width + cx] = NaN;
          continue;
        }
        const o = (gy * canvas.width + gx) * 4;
        out[cy * width + cx] =
          px[o] * 256 + px[o + 1] + px[o + 2] / 256 - 32768;
      }
    }
    return out;
  } catch {
    return null;
  }
}

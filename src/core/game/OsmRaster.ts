/**
 * Core rasteriser for the OSM map import (see docs/osm-import-plan.md).
 *
 * Turns geographic polygons (lon/lat rings, e.g. OSM water areas) into a
 * PaintTile grid the editor/game already understands. Pure and deterministic —
 * no network, no DOM — so it is unit-testable and runs the same everywhere. The
 * network fetch (Overpass) and the editor UI live in the client layer and feed
 * their parsed polygons in here.
 *
 * Projection: longitude maps linearly across the grid; latitude uses Web
 * Mercator so shapes are not stretched north–south (matching how slippy maps
 * look). Row 0 is the north edge of the bbox.
 */

import { PaintTile } from "./CustomMapBuilder";

export interface GeoBBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/** A ring is a closed loop of [lon, lat] points; a polygon is outer + holes. */
export type Ring = ReadonlyArray<readonly [number, number]>;
export type Polygon = ReadonlyArray<Ring>;

// Web Mercator Y for a latitude in degrees (unbounded; clamp near the poles).
function mercatorY(latDeg: number): number {
  const lat = (Math.max(-85.05, Math.min(85.05, latDeg)) * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + lat / 2));
}

// Inverse of mercatorY → latitude in degrees.
function inverseMercatorY(y: number): number {
  return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * (180 / Math.PI);
}

/**
 * Center-crop a bbox so neither span exceeds the given maximum (degrees).
 * Nominatim returns country/region-sized boxes for broad queries, which would
 * time out Overpass and produce an unusably coarse map — cap to a city-sized
 * area around the center. Returns `{ bbox, capped }`.
 */
export function clampBBox(
  bbox: GeoBBox,
  maxLonSpan: number,
  maxLatSpan: number,
): { bbox: GeoBBox; capped: boolean } {
  const lonSpan = bbox.maxLon - bbox.minLon;
  const latSpan = bbox.maxLat - bbox.minLat;
  const capped = lonSpan > maxLonSpan || latSpan > maxLatSpan;
  if (!capped) return { bbox, capped };
  const cLon = (bbox.minLon + bbox.maxLon) / 2;
  const cLat = (bbox.minLat + bbox.maxLat) / 2;
  const hLon = Math.min(lonSpan, maxLonSpan) / 2;
  const hLat = Math.min(latSpan, maxLatSpan) / 2;
  return {
    bbox: {
      minLon: cLon - hLon,
      maxLon: cLon + hLon,
      minLat: cLat - hLat,
      maxLat: cLat + hLat,
    },
    capped: true,
  };
}

/**
 * Grid dimensions for a bbox that preserve its on-screen (Mercator) aspect
 * ratio, with the longer side at `maxDim` and both sides clamped to
 * [minDim, maxDim]. Keeps generated maps within the editor's size limits (and
 * well under the mobile GPU texture limit).
 */
export function gridSizeForBBox(
  bbox: GeoBBox,
  maxDim: number,
  minDim = 8,
): { width: number; height: number } {
  // Web Mercator x is longitude in radians; compare against the same-unit y so
  // the aspect ratio is correct (a degree of longitude ≠ a degree of mercator).
  const xSpan = Math.max(1e-9, ((bbox.maxLon - bbox.minLon) * Math.PI) / 180);
  const ySpan = Math.max(1e-9, mercatorY(bbox.maxLat) - mercatorY(bbox.minLat));
  const aspect = xSpan / ySpan; // width / height
  let width: number;
  let height: number;
  if (aspect >= 1) {
    width = maxDim;
    height = Math.round(maxDim / aspect);
  } else {
    height = maxDim;
    width = Math.round(maxDim * aspect);
  }
  const clamp = (v: number) => Math.max(minDim, Math.min(maxDim, v));
  return { width: clamp(width), height: clamp(height) };
}

/**
 * Draw polylines (e.g. OSM `waterway=river` centre-lines) into an existing grid
 * as continuous strokes of `fill`, `radius` cells thick on each side. Segments
 * are walked at sub-cell steps so a river never breaks into disconnected dots —
 * the "rivers must stay continuous" requirement. Mutates `grid` in place.
 */
export function rasterizeLinesInto(
  grid: Uint8Array,
  bbox: GeoBBox,
  width: number,
  height: number,
  lines: ReadonlyArray<Ring>,
  fill: PaintTile,
  radius = 0,
): void {
  const stamp = (px: number, py: number) => {
    const cx = Math.round(px);
    const cy = Math.round(py);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && y >= 0 && x < width && y < height) {
          grid[y * width + x] = fill;
        }
      }
    }
  };
  for (const line of lines) {
    let prev: { x: number; y: number } | null = null;
    for (const [lon, lat] of line) {
      const cur = lonLatToCell(bbox, width, height, lon, lat);
      if (prev) {
        const steps = Math.max(
          1,
          Math.ceil(
            Math.max(Math.abs(cur.x - prev.x), Math.abs(cur.y - prev.y)),
          ),
        );
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          stamp(prev.x + (cur.x - prev.x) * t, prev.y + (cur.y - prev.y) * t);
        }
      } else {
        stamp(cur.x, cur.y);
      }
      prev = cur;
    }
  }
}

/**
 * Fill the sea from OSM `natural=coastline` ways. OSM orders coastlines so land
 * is on the LEFT of travel; in the y-down grid that puts the sea on the
 * right-hand normal (-dy, dx). We rasterize the coast as a barrier, seed the sea
 * side, and flood-fill Water up to the coast.
 *
 * Safety: if the sea fill leaks to the land side (an open/incomplete coast in
 * the bbox) or floods almost the whole grid, we DISCARD it and leave the grid
 * untouched — never regress a land map into an all-water one. Returns whether it
 * was applied. Mutates `grid` only on success.
 */
export function applyCoastlineSea(
  grid: Uint8Array,
  bbox: GeoBBox,
  width: number,
  height: number,
  coastlines: ReadonlyArray<Ring>,
  sea: PaintTile,
): { applied: boolean } {
  if (coastlines.length === 0) return { applied: false };
  const n = width * height;

  // Coast cells act as the flood-fill barrier (and stay land = shoreline).
  const barrier = new Uint8Array(n);
  rasterizeLinesInto(
    barrier,
    bbox,
    width,
    height,
    coastlines,
    1 as PaintTile,
    0,
  );

  const inBounds = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height;
  const OFF = 2; // cells to step off the coast onto each side
  const seaSeeds: number[] = [];
  const landSeeds: number[] = [];
  const seed = (arr: number[], x: number, y: number) => {
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (inBounds(rx, ry) && barrier[ry * width + rx] === 0) {
      arr.push(ry * width + rx);
    }
  };
  for (const line of coastlines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = lonLatToCell(bbox, width, height, line[i][0], line[i][1]);
      const b = lonLatToCell(
        bbox,
        width,
        height,
        line[i + 1][0],
        line[i + 1][1],
      );
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const rnx = -dy / len; // right-hand normal = sea side
      const rny = dx / len;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      seed(seaSeeds, mx + rnx * OFF, my + rny * OFF);
      seed(landSeeds, mx - rnx * OFF, my - rny * OFF);
    }
  }

  // Flood-fill the sea side over non-barrier cells (4-connectivity).
  const visited = new Uint8Array(n);
  const queue: number[] = [];
  for (const s of seaSeeds)
    if (!visited[s]) {
      visited[s] = 1;
      queue.push(s);
    }
  let head = 0;
  let filled = queue.length;
  while (head < queue.length) {
    const i = queue[head++];
    const x = i % width;
    const y = (i / width) | 0;
    const tryCell = (nx: number, ny: number) => {
      if (!inBounds(nx, ny)) return;
      const ni = ny * width + nx;
      if (visited[ni] || barrier[ni] !== 0) return;
      visited[ni] = 1;
      filled++;
      queue.push(ni);
    };
    tryCell(x - 1, y);
    tryCell(x + 1, y);
    tryCell(x, y - 1);
    tryCell(x, y + 1);
  }

  // Guards: a leak onto the land side, or flooding nearly everything, means the
  // coast didn't cleanly separate the bbox — keep the land map instead.
  if (filled > 0.95 * n) return { applied: false };
  for (const l of landSeeds) if (visited[l]) return { applied: false };

  for (let i = 0; i < n; i++) if (visited[i] && barrier[i] === 0) grid[i] = sea;
  return { applied: true };
}

/**
 * Remove lone speckles from a rasterised grid: a cell with very few same-value
 * neighbours and a clear opposite majority is flipped to that majority. One
 * pass over the 8-neighbourhood, reading the original so changes don't cascade.
 * Produces solid coherent areas (the "grobe zusammenhängende Flächen" goal)
 * without touching solid regions. Run BEFORE drawing thin rivers so their
 * 1-cell strokes survive. Returns a cleaned copy.
 */
export function denoisePaint(
  grid: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(grid);
  const counts = new Map<number, number>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const self = grid[y * width + x];
      counts.clear();
      let same = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const v = grid[ny * width + nx];
          counts.set(v, (counts.get(v) ?? 0) + 1);
          if (v === self) same++;
        }
      }
      // Only touch clear speckles: at most 2 same-value neighbours and a strong
      // (≥5) opposite majority.
      if (same > 2) continue;
      let bestVal = self;
      let bestCount = 0;
      for (const [v, c] of counts) {
        if (c > bestCount) {
          bestCount = c;
          bestVal = v;
        }
      }
      if (bestVal !== self && bestCount >= 5) out[y * width + x] = bestVal;
    }
  }
  return out;
}

/** Longitude/latitude → fractional grid cell (x right, y down = south). */
export function lonLatToCell(
  bbox: GeoBBox,
  width: number,
  height: number,
  lon: number,
  lat: number,
): { x: number; y: number } {
  const x = ((lon - bbox.minLon) / (bbox.maxLon - bbox.minLon)) * width;
  const yTop = mercatorY(bbox.maxLat);
  const yBot = mercatorY(bbox.minLat);
  const y = ((yTop - mercatorY(lat)) / (yTop - yBot)) * height;
  return { x, y };
}

/** Center of grid cell (cx, cy) → longitude/latitude. */
export function cellToLonLat(
  bbox: GeoBBox,
  width: number,
  height: number,
  cx: number,
  cy: number,
): { lon: number; lat: number } {
  const lon = bbox.minLon + ((cx + 0.5) / width) * (bbox.maxLon - bbox.minLon);
  const yTop = mercatorY(bbox.maxLat);
  const yBot = mercatorY(bbox.minLat);
  const y = yTop - ((cy + 0.5) / height) * (yTop - yBot);
  return { lon, lat: inverseMercatorY(y) };
}

// Even-odd ray cast against one ring, in lon/lat space.
function inRing(ring: Ring, lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** True when the point is inside the polygon (outer ring minus holes). */
export function pointInPolygon(
  polygon: Polygon,
  lon: number,
  lat: number,
): boolean {
  let inside = false;
  for (const ring of polygon) {
    if (inRing(ring, lon, lat)) inside = !inside;
  }
  return inside;
}

/**
 * Rasterise polygons into a PaintTile grid over `bbox`. A cell whose center
 * falls inside any polygon becomes `fill`; the rest become `background`. Used to
 * paint OSM water areas onto an otherwise-land grid (or vice-versa); the editor
 * then flood-fills ocean/shoreline via buildCustomTerrain as usual.
 */
export function rasterizePolygons(
  bbox: GeoBBox,
  width: number,
  height: number,
  polygons: ReadonlyArray<Polygon>,
  fill: PaintTile,
  background: PaintTile,
): Uint8Array {
  const out = new Uint8Array(width * height).fill(background);
  // Per-polygon lon/lat bounds so we can skip the point-in-polygon test for
  // cells nowhere near a given water body (cities can have many).
  const bounds = polygons.map((poly) => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const ring of poly) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    return { minX, minY, maxX, maxY };
  });

  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const { lon, lat } = cellToLonLat(bbox, width, height, cx, cy);
      for (let p = 0; p < polygons.length; p++) {
        const b = bounds[p];
        if (lon < b.minX || lon > b.maxX || lat < b.minY || lat > b.maxY) {
          continue;
        }
        if (pointInPolygon(polygons[p], lon, lat)) {
          out[cy * width + cx] = fill;
          break;
        }
      }
    }
  }
  return out;
}

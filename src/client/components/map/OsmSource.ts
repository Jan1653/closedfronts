/**
 * OSM data source for the map import (see docs/osm-import-plan.md), Phase A:
 * fetch water areas for a bounding box from the Overpass API and parse them
 * into lon/lat polygons for the core rasteriser (OsmRaster).
 *
 * Overpass returns OpenStreetMap data (ODbL). A map produced from it is a
 * derived work — attribute "© OpenStreetMap contributors". We never
 * redistribute the raw OSM data, only the rasterised paint grid.
 *
 * The query builder and parser are pure/testable; the fetch is network I/O.
 */

import type { GeoBBox, Polygon, Ring } from "../../../core/game/OsmRaster";

// Public Overpass endpoint. Rate-limited — keep bboxes small and cache results.
const DEFAULT_OVERPASS = "https://overpass-api.de/api/interpreter";

/**
 * Overpass QL for water areas (lakes, rivers-as-areas, reservoirs) within the
 * bbox. `out geom` inlines each way's geometry so we can build rings directly.
 * Overpass bbox order is (south, west, north, east).
 */
export function buildOverpassQuery(bbox: GeoBBox): string {
  const b = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
  return [
    "[out:json][timeout:25];",
    "(",
    `  way["natural"="water"](${b});`,
    `  way["waterway"="riverbank"](${b});`,
    `  relation["natural"="water"](${b});`,
    ");",
    "out geom;",
  ].join("\n");
}

interface OverpassGeomPoint {
  lat: number;
  lon: number;
}
interface OverpassElement {
  type: "node" | "way" | "relation";
  geometry?: OverpassGeomPoint[];
  members?: Array<{ role?: string; geometry?: OverpassGeomPoint[] }>;
  tags?: Record<string, string>;
}

/**
 * Parse an Overpass `out geom` response into water polygons. Handles ways
 * (single ring) and the outer members of water relations. Rings that aren't
 * closed are still usable by the even-odd rasteriser, so we don't drop them.
 */
export function parseOverpassWater(json: unknown): Polygon[] {
  const elements = (json as { elements?: OverpassElement[] })?.elements;
  if (!Array.isArray(elements)) return [];
  const polygons: Polygon[] = [];
  const ringFromGeom = (geom: OverpassGeomPoint[]) =>
    geom.map((p) => [p.lon, p.lat] as const);

  for (const el of elements) {
    if (el.type === "way" && el.geometry && el.geometry.length >= 3) {
      polygons.push([ringFromGeom(el.geometry)]);
    } else if (el.type === "relation" && Array.isArray(el.members)) {
      const rings = el.members
        .filter((m) => (m.role ?? "outer") !== "inner" && m.geometry)
        .map((m) => ringFromGeom(m.geometry!))
        .filter((r) => r.length >= 3);
      if (rings.length > 0) polygons.push(rings);
    }
  }
  return polygons;
}

// Nominatim geocoder (also OSM/ODbL). Usage policy: low volume, identify the
// app. One request per user search is well within limits.
const DEFAULT_NOMINATIM = "https://nominatim.openstreetmap.org/search";

/**
 * Resolve a place name to a bounding box via Nominatim. Returns null when
 * nothing matches. Nominatim's boundingbox is [minLat, maxLat, minLon, maxLon].
 */
export async function geocodePlace(
  query: string,
  endpoint: string = DEFAULT_NOMINATIM,
): Promise<GeoBBox | null> {
  const url = `${endpoint}?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const list = (await res.json()) as Array<{ boundingbox?: string[] }>;
  const bb = list?.[0]?.boundingbox;
  if (!bb || bb.length !== 4) return null;
  const [minLat, maxLat, minLon, maxLon] = bb.map(Number);
  if ([minLat, maxLat, minLon, maxLon].some((n) => Number.isNaN(n)))
    return null;
  return { minLat, maxLat, minLon, maxLon };
}

/** Fetch water polygons for a bbox from Overpass. Throws on network/HTTP error. */
export async function fetchOsmWaterPolygons(
  bbox: GeoBBox,
  endpoint: string = DEFAULT_OVERPASS,
): Promise<Polygon[]> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: buildOverpassQuery(bbox),
  });
  if (!res.ok) {
    throw new Error(`Overpass ${res.status}: ${res.statusText}`);
  }
  return parseOverpassWater(await res.json());
}

/**
 * Overpass QL for waterway centre-lines (rivers/streams/canals) — the linear
 * water the area query misses. Drawn as thick strokes so they stay continuous.
 */
export function buildWaterwayQuery(bbox: GeoBBox): string {
  const b = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
  return [
    "[out:json][timeout:25];",
    `way["waterway"~"^(river|stream|canal)$"](${b});`,
    "out geom;",
  ].join("\n");
}

/** Parse Overpass `out geom` ways into polylines (open, not closed). */
export function parseOverpassWaterways(json: unknown): Ring[] {
  const elements = (json as { elements?: OverpassElement[] })?.elements;
  if (!Array.isArray(elements)) return [];
  const lines: Ring[] = [];
  for (const el of elements) {
    if (el.type === "way" && el.geometry && el.geometry.length >= 2) {
      lines.push(el.geometry.map((p) => [p.lon, p.lat] as const));
    }
  }
  return lines;
}

/** Fetch waterway centre-lines for a bbox from Overpass. */
export async function fetchOsmWaterways(
  bbox: GeoBBox,
  endpoint: string = DEFAULT_OVERPASS,
): Promise<Ring[]> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: buildWaterwayQuery(bbox),
  });
  if (!res.ok) {
    throw new Error(`Overpass ${res.status}: ${res.statusText}`);
  }
  return parseOverpassWaterways(await res.json());
}

/**
 * Overpass QL for coastline ways — the land/sea boundary. OSM orders these so
 * land is on the left; applyCoastlineSea uses that to fill the sea.
 */
export function buildCoastlineQuery(bbox: GeoBBox): string {
  const b = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
  return [
    "[out:json][timeout:25];",
    `way["natural"="coastline"](${b});`,
    "out geom;",
  ].join("\n");
}

/** Fetch coastline ways for a bbox from Overpass (parsed as polylines). */
export async function fetchOsmCoastlines(
  bbox: GeoBBox,
  endpoint: string = DEFAULT_OVERPASS,
): Promise<Ring[]> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: buildCoastlineQuery(bbox),
  });
  if (!res.ok) {
    throw new Error(`Overpass ${res.status}: ${res.statusText}`);
  }
  return parseOverpassWaterways(await res.json());
}

/** Terrain polygons split by the height tier they map to on the game grid. */
export interface OsmTerrain {
  forest: Polygon[]; // wood / forest → Highland (tan wooded hills)
  rock: Polygon[]; // bare rock / scree / fell / glacier → Mountain
}

// natural= values we treat as bare high ground (→ Mountain).
const ROCK_NATURAL = new Set([
  "bare_rock",
  "scree",
  "fell",
  "rock",
  "glacier",
  "ridge",
]);

/**
 * Overpass QL for land-cover areas we turn into terrain height: forests/woods
 * and bare rock/mountain surfaces. `out tags geom` so the parser can tell which
 * tier each element maps to.
 */
export function buildTerrainQuery(bbox: GeoBBox): string {
  const b = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
  const rock = [...ROCK_NATURAL].join("|");
  return [
    "[out:json][timeout:25];",
    "(",
    `  way["natural"="wood"](${b});`,
    `  way["landuse"="forest"](${b});`,
    `  relation["natural"="wood"](${b});`,
    `  relation["landuse"="forest"](${b});`,
    `  way["natural"~"^(${rock})$"](${b});`,
    `  relation["natural"~"^(${rock})$"](${b});`,
    ");",
    "out tags geom;",
  ].join("\n");
}

/** Parse an Overpass `out tags geom` response into forest vs rock polygons. */
export function parseOverpassTerrain(json: unknown): OsmTerrain {
  const elements = (json as { elements?: OverpassElement[] })?.elements;
  const out: OsmTerrain = { forest: [], rock: [] };
  if (!Array.isArray(elements)) return out;
  const ringFromGeom = (geom: OverpassGeomPoint[]) =>
    geom.map((p) => [p.lon, p.lat] as const);

  for (const el of elements) {
    const tags = el.tags ?? {};
    const isRock = tags.natural !== undefined && ROCK_NATURAL.has(tags.natural);
    const bucket = isRock ? out.rock : out.forest;

    if (el.type === "way" && el.geometry && el.geometry.length >= 3) {
      bucket.push([ringFromGeom(el.geometry)]);
    } else if (el.type === "relation" && Array.isArray(el.members)) {
      const rings = el.members
        .filter((m) => (m.role ?? "outer") !== "inner" && m.geometry)
        .map((m) => ringFromGeom(m.geometry!))
        .filter((r) => r.length >= 3);
      if (rings.length > 0) bucket.push(rings);
    }
  }
  return out;
}

/** Fetch land-cover terrain polygons (forest + rock) for a bbox from Overpass. */
export async function fetchOsmTerrain(
  bbox: GeoBBox,
  endpoint: string = DEFAULT_OVERPASS,
): Promise<OsmTerrain> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: buildTerrainQuery(bbox),
  });
  if (!res.ok) {
    throw new Error(`Overpass ${res.status}: ${res.statusText}`);
  }
  return parseOverpassTerrain(await res.json());
}

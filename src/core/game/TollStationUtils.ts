import { UnitType } from "./Game";
import { GameMap, manhattanDistFN, TileRef } from "./GameMap";

// Radius (in tiles) around a water toll station in which two connection anchors
// (a landmass or another toll station) must exist for the station to be
// placeable. The station draws its two road-like connections to them.
export const WATER_TOLL_STATION_RADIUS = 14;

// Two land tiles must be at least this far apart (manhattan distance) to be
// treated as separate landmasses. Guards against both connections snapping to
// the same bank of a channel.
const MIN_LANDMASS_SEPARATION = 6;

// The minimal map/unit surface tollStationConnections needs — satisfied by both
// the server's Game and the client's GameView, so the client can compute a
// station's connections for rendering without a Game instance.
export interface TollConnGame {
  isWater(t: TileRef): boolean;
  isLand(t: TileRef): boolean;
  isImpassable(t: TileRef): boolean;
  manhattanDist(a: TileRef, b: TileRef): number;
  units(...types: UnitType[]): ReadonlyArray<{
    isActive(): boolean;
    tile(): TileRef;
  }>;
  bfs(
    tile: TileRef,
    filter: (gm: GameMap, tile: TileRef) => boolean,
  ): Set<TileRef>;
}

/**
 * Finds the two "connection" anchor tiles for a water toll station placed on
 * `waterTile`. An anchor is either:
 *   - the nearest tile of a landmass, or
 *   - another water toll station within range (this is what lets stations be
 *     chained across open water).
 *
 * Returns [] if `waterTile` is not water, [A] if only one anchor is in range,
 * or [A, B] (the two nearest distinct anchors) when the tile genuinely bridges
 * two of them. Placement requires a result of length 2.
 */
export function tollStationConnections(
  mg: TollConnGame,
  waterTile: TileRef,
  radius: number = WATER_TOLL_STATION_RADIUS,
): TileRef[] {
  if (!mg.isWater(waterTile)) return [];

  const anchors: TileRef[] = [];

  // Other toll stations in range are valid anchors (enables chaining). Exclude
  // any station sitting on this very tile (i.e. the station being placed).
  for (const u of mg.units(UnitType.WaterTollStation)) {
    if (!u.isActive()) continue;
    const t = u.tile();
    if (t === waterTile) continue;
    if (mg.manhattanDist(waterTile, t) <= radius) anchors.push(t);
  }

  // Landmass anchors: nearest land tile, plus the nearest tile of a *different*
  // landmass within the radius.
  const lands: TileRef[] = [];
  for (const t of mg.bfs(waterTile, manhattanDistFN(waterTile, radius))) {
    if (mg.isLand(t) && !mg.isImpassable(t)) lands.push(t);
  }
  if (lands.length > 0) {
    lands.sort(
      (a, b) => mg.manhattanDist(waterTile, a) - mg.manhattanDist(waterTile, b),
    );
    const first = lands[0];
    anchors.push(first);
    const firstLandmass = mg.bfs(
      first,
      (gm, t) => gm.isLand(t) && gm.manhattanDist(waterTile, t) <= radius,
    );
    for (const t of lands) {
      if (firstLandmass.has(t)) continue;
      if (mg.manhattanDist(first, t) < MIN_LANDMASS_SEPARATION) continue;
      anchors.push(t);
      break;
    }
  }

  if (anchors.length === 0) return [];
  // Two nearest distinct anchors.
  anchors.sort(
    (a, b) => mg.manhattanDist(waterTile, a) - mg.manhattanDist(waterTile, b),
  );
  return anchors.length >= 2 ? [anchors[0], anchors[1]] : [anchors[0]];
}

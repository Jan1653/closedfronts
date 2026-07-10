import { UnitType } from "./Game";
import { GameMap, manhattanDistFN, TileRef } from "./GameMap";

// Radius (in tiles) around a water toll station in which two connection anchors
// (a landmass or another toll station) must exist for the station to be
// placeable. The station draws its two road-like connections to them.
export const WATER_TOLL_STATION_RADIUS = 18;

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
 * Finds the "connection" anchor tiles for a water toll station placed on
 * `waterTile`, and thus whether it's placeable. A station needs at least one
 * connection: to land OR to another toll station. It draws at most one of each:
 *   - the nearest reachable land tile in range (at most ONE land connection), and
 *   - the nearest other active toll station in range (lets stations chain across
 *     open water).
 * So the valid shapes are: one land, one station, or one land + one station —
 * never two land connections (to span a wide strait you build a chain).
 *
 * Returns the connection tiles (length 1 or 2), or [] when it can't connect to
 * anything (not placeable).
 */
export function tollStationConnections(
  mg: TollConnGame,
  waterTile: TileRef,
  radius: number = WATER_TOLL_STATION_RADIUS,
): TileRef[] {
  if (!mg.isWater(waterTile)) return [];

  const connections: TileRef[] = [];

  // At most ONE station connection: the nearest other active toll station in
  // range. Exclude any station sitting on this very tile (the one being placed).
  let bestStation: TileRef | null = null;
  let bestStationDist = Infinity;
  for (const u of mg.units(UnitType.WaterTollStation)) {
    if (!u.isActive()) continue;
    const t = u.tile();
    if (t === waterTile) continue;
    const d = mg.manhattanDist(waterTile, t);
    if (d <= radius && d < bestStationDist) {
      bestStationDist = d;
      bestStation = t;
    }
  }
  if (bestStation !== null) connections.push(bestStation);

  // At most ONE land connection: the nearest reachable land tile in range.
  let bestLand: TileRef | null = null;
  let bestLandDist = Infinity;
  for (const t of mg.bfs(waterTile, manhattanDistFN(waterTile, radius))) {
    if (!mg.isLand(t) || mg.isImpassable(t)) continue;
    const d = mg.manhattanDist(waterTile, t);
    if (d < bestLandDist) {
      bestLandDist = d;
      bestLand = t;
    }
  }
  if (bestLand !== null) connections.push(bestLand);

  return connections;
}

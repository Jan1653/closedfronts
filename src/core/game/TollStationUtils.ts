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
 * connection. Its purpose is to bridge two separate landmasses across a strait,
 * so it prefers to link BOTH shores:
 *   - the nearest reachable land tile in range, and
 *   - the nearest land tile in range on a *different* landmass (not connected to
 *     the first over land within the radius — i.e. the opposite shore).
 * When only one landmass is in range it falls back to that single land tile plus
 * (optionally) the nearest other active toll station, which lets stations chain
 * across a body of open water too wide for one span.
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

  // The nearest other active toll station in range, used only as a fallback
  // chain link when there aren't two landmasses to bridge. Exclude any station
  // sitting on this very tile (the one being placed).
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

  // Land tiles in range, nearest first.
  const landTiles: TileRef[] = [];
  for (const t of mg.bfs(waterTile, manhattanDistFN(waterTile, radius))) {
    if (mg.isLand(t) && !mg.isImpassable(t)) landTiles.push(t);
  }
  landTiles.sort(
    (a, b) => mg.manhattanDist(waterTile, a) - mg.manhattanDist(waterTile, b),
  );

  // Up to two land anchors on distinct landmasses: the nearest land tile, then
  // the nearest tile NOT reachable from it over land within the radius (the
  // opposite shore). A coastline that merely curves around stays one landmass.
  const landAnchors: TileRef[] = [];
  if (landTiles.length > 0) {
    const nearestLand = landTiles[0];
    landAnchors.push(nearestLand);
    const sameLandmass = mg.bfs(
      nearestLand,
      (_, t) =>
        mg.isLand(t) &&
        !mg.isImpassable(t) &&
        mg.manhattanDist(waterTile, t) <= radius,
    );
    const otherShore = landTiles.find((t) => !sameLandmass.has(t));
    if (otherShore !== undefined) landAnchors.push(otherShore);
  }

  // Prefer bridging two landmasses; otherwise one land + a station chain (or a
  // lone station out on open water).
  if (landAnchors.length >= 2) {
    return [landAnchors[0], landAnchors[1]];
  }
  const connections: TileRef[] = [];
  if (bestStation !== null) connections.push(bestStation);
  if (landAnchors.length === 1) connections.push(landAnchors[0]);
  return connections;
}

import { Game } from "./Game";
import { manhattanDistFN, TileRef } from "./GameMap";

// Radius (in tiles) around a water toll station in which two distinct
// landmasses must exist for the station to be placeable. The station draws its
// two road-like connections to the nearest tile of each landmass.
export const WATER_TOLL_STATION_RADIUS = 14;

// Two land tiles must be at least this far apart (manhattan distance) to be
// treated as separate landmasses. Guards against both connections snapping to
// the same bank of a channel.
const MIN_LANDMASS_SEPARATION = 6;

/**
 * Finds the "connection" land tiles for a water toll station placed on
 * `waterTile`: the nearest reachable land tile (landmass A), plus the nearest
 * land tile that belongs to a *different* landmass (not land-connected to A
 * within the search radius).
 *
 * Returns [] if `waterTile` is not water, [A] if only one landmass is in range,
 * or [A, B] when the tile genuinely sits between two landmasses (e.g. a river
 * chokepoint). Placement requires a result of length 2.
 */
export function tollStationConnections(
  mg: Game,
  waterTile: TileRef,
  radius: number = WATER_TOLL_STATION_RADIUS,
): TileRef[] {
  if (!mg.isWater(waterTile)) return [];

  // All land tiles within the radius, nearest first.
  const lands: TileRef[] = [];
  for (const t of mg.bfs(waterTile, manhattanDistFN(waterTile, radius))) {
    if (mg.isLand(t) && !mg.isImpassable(t)) lands.push(t);
  }
  if (lands.length === 0) return [];
  lands.sort(
    (a, b) => mg.manhattanDist(waterTile, a) - mg.manhattanDist(waterTile, b),
  );
  const first = lands[0];

  // Landmass of `first`: land tiles reachable from it over land, staying within
  // the radius. Any land tile outside this set is a separate landmass.
  const firstLandmass = mg.bfs(
    first,
    (gm, t) => gm.isLand(t) && gm.manhattanDist(waterTile, t) <= radius,
  );

  for (const t of lands) {
    if (firstLandmass.has(t)) continue;
    if (mg.manhattanDist(first, t) < MIN_LANDMASS_SEPARATION) continue;
    return [first, t];
  }
  return [first];
}

import {
  buildCustomTerrain,
  decodeCustomMapPaint,
  downscalePaint,
  SerializedCustomMap,
} from "./CustomMapBuilder";
import { GameMapSize, GameMapType, TeamGameSpawnAreas } from "./Game";
import { GameMap, GameMapImpl } from "./GameMap";
import { GameMapLoader } from "./GameMapLoader";

export type TerrainMapData = {
  nations: Nation[];
  additionalNations: AdditionalNation[];
  gameMap: GameMap;
  miniGameMap: GameMap;
  teamGameSpawnAreas?: TeamGameSpawnAreas;
};

const loadedMaps = new Map<string, TerrainMapData>();

export interface MapMetadata {
  width: number;
  height: number;
  num_land_tiles: number;
}

export interface MapManifest {
  name: string;
  map: MapMetadata;
  map4x: MapMetadata;
  map16x: MapMetadata;
  nations: Nation[];
  // Optional pool of fallback nation names used when a game requests more
  // nations than the manifest defines. Picked at random; if still not enough,
  // the remainder is generated procedurally.
  additionalNations?: AdditionalNation[];
  teamGameSpawnAreas?: TeamGameSpawnAreas;
}

export interface Nation {
  coordinates?: [number, number];
  flag?: string;
  name: string;
}

export interface AdditionalNation {
  coordinates?: [number, number];
  flag?: string;
  name: string;
}

/**
 * Longest map edge the renderer can hand the GPU as a single texture.
 *
 * The map is uploaded as width × height textures (terrain, territory, trails,
 * heat…). A texture longer than the device's MAX_TEXTURE_SIZE fails silently,
 * and the map draws BLACK — which is what happens on phones, where the cap is
 * commonly 4096 while desktop GPUs allow 16384.
 *
 * So a handful of full-resolution maps are simply too long for a phone. They
 * are played at half resolution instead, which fits everywhere. The limit is a
 * FIXED number, never the device's own MAX_TEXTURE_SIZE: every client
 * simulates the map it loads, so they all have to load the same one.
 */
export const MAX_RENDERABLE_MAP_EDGE = 4096;

/**
 * The size a map is actually loaded at: the requested one, unless full
 * resolution would be too long for a phone GPU (see MAX_RENDERABLE_MAP_EDGE),
 * in which case it drops to Compact. Deterministic — it depends only on the
 * map's own dimensions.
 */
export function renderableMapSize(
  manifest: MapManifest,
  requested: GameMapSize,
): GameMapSize {
  if (requested === GameMapSize.Compact) return requested;
  const longestEdge = Math.max(manifest.map.width, manifest.map.height);
  return longestEdge > MAX_RENDERABLE_MAP_EDGE
    ? GameMapSize.Compact
    : requested;
}

export async function loadTerrainMap(
  map: GameMapType,
  requestedSize: GameMapSize,
  terrainMapFileLoader: GameMapLoader,
): Promise<TerrainMapData> {
  const requestedKey = `${map}:${requestedSize}`;
  const cached = loadedMaps.get(requestedKey);
  if (cached !== undefined) return cached;
  const mapFiles = terrainMapFileLoader.getMapData(map);
  const manifest = await mapFiles.manifest();

  const mapSize = renderableMapSize(manifest, requestedSize);
  const cacheKey = `${map}:${mapSize}`;
  if (cacheKey !== requestedKey) {
    console.warn(
      `Map ${map} is ${manifest.map.width}x${manifest.map.height} at full resolution, longer than the ${MAX_RENDERABLE_MAP_EDGE}px a phone GPU can texture — loading it at half resolution instead.`,
    );
    const already = loadedMaps.get(cacheKey);
    if (already !== undefined) {
      loadedMaps.set(requestedKey, already);
      return already;
    }
  }

  const gameMap =
    mapSize === GameMapSize.Normal
      ? await genTerrainFromBin(manifest.map, await mapFiles.mapBin())
      : await genTerrainFromBin(manifest.map4x, await mapFiles.map4xBin());

  const miniMap =
    mapSize === GameMapSize.Normal
      ? await genTerrainFromBin(
          mapSize === GameMapSize.Normal ? manifest.map4x : manifest.map16x,
          await mapFiles.map4xBin(),
        )
      : await genTerrainFromBin(manifest.map16x, await mapFiles.map16xBin());

  if (mapSize === GameMapSize.Compact) {
    manifest.nations.forEach((nation) => {
      if (nation.coordinates !== undefined) {
        nation.coordinates = [
          Math.floor(nation.coordinates[0] / 2),
          Math.floor(nation.coordinates[1] / 2),
        ];
      }
    });
    manifest.additionalNations?.forEach((nation) => {
      if (nation.coordinates !== undefined) {
        nation.coordinates = [
          Math.floor(nation.coordinates[0] / 2),
          Math.floor(nation.coordinates[1] / 2),
        ];
      }
    });
  }

  // Scale spawn areas for compact maps
  let teamGameSpawnAreas = manifest.teamGameSpawnAreas;
  if (mapSize === GameMapSize.Compact && teamGameSpawnAreas) {
    const scaled: TeamGameSpawnAreas = {};
    for (const [key, areas] of Object.entries(teamGameSpawnAreas)) {
      scaled[key] = areas.map((a) => ({
        x: Math.floor(a.x / 2),
        y: Math.floor(a.y / 2),
        width: Math.max(1, Math.floor(a.width / 2)),
        height: Math.max(1, Math.floor(a.height / 2)),
      }));
    }
    teamGameSpawnAreas = scaled;
  }

  const result = {
    nations: manifest.nations,
    additionalNations: manifest.additionalNations ?? [],
    gameMap: gameMap,
    miniGameMap: miniMap,
    teamGameSpawnAreas,
  };
  loadedMaps.set(cacheKey, result);
  if (cacheKey !== requestedKey) loadedMaps.set(requestedKey, result);
  return result;
}

/**
 * Build a TerrainMapData straight from a hand-drawn map's paint grid — the
 * in-memory equivalent of loadTerrainMap for maps that never touch the CDN.
 * The paint compiles deterministically to the same bytes on both the render
 * thread and the sim worker, so no map files need to be fetched. Custom maps
 * carry no nations or team spawn areas.
 */
export function buildCustomTerrainMapData(
  custom: SerializedCustomMap,
): TerrainMapData {
  const paint = decodeCustomMapPaint(custom.paint, custom.width, custom.height);
  const full = buildCustomTerrain(paint, custom.width, custom.height);
  const gameMap = new GameMapImpl(
    full.width,
    full.height,
    full.data,
    full.numLandTiles,
  );

  const mini = downscalePaint(paint, custom.width, custom.height);
  const miniTerrain = buildCustomTerrain(mini.paint, mini.width, mini.height);
  const miniGameMap = new GameMapImpl(
    miniTerrain.width,
    miniTerrain.height,
    miniTerrain.data,
    miniTerrain.numLandTiles,
  );

  return {
    nations: [],
    additionalNations: [],
    gameMap,
    miniGameMap,
    teamGameSpawnAreas: undefined,
  };
}

export async function genTerrainFromBin(
  mapData: MapMetadata,
  data: Uint8Array,
): Promise<GameMap> {
  if (data.length !== mapData.width * mapData.height) {
    throw new Error(
      `Invalid data: buffer size ${data.length} incorrect for ${mapData.width}x${mapData.height} terrain plus 4 bytes for dimensions.`,
    );
  }

  return new GameMapImpl(
    mapData.width,
    mapData.height,
    data,
    mapData.num_land_tiles,
  );
}

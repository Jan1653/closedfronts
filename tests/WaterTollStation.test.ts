import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { WaterTollStationExecution } from "../src/core/execution/WaterTollStationExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { tollStationConnections } from "../src/core/game/TollStationUtils";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

describe("WaterTollStation", () => {
  let game: Game;
  let p1: Player;
  let p2: Player;

  beforeEach(async () => {
    game = await setup("world", { infiniteGold: true, instantBuild: true }, [
      new PlayerInfo("p1", PlayerType.Human, null, "p1"),
      new PlayerInfo("p2", PlayerType.Human, null, "p2"),
    ]);
    p1 = game.player("p1");
    p2 = game.player("p2");
    p1.addGold(10_000_000n);
    p2.addGold(10_000_000n);
  });

  function firstLandTile(): TileRef {
    for (let y = 0; y < game.height(); y++) {
      for (let x = 0; x < game.width(); x++) {
        const t = game.ref(x, y);
        if (game.isLand(t)) return t;
      }
    }
    throw new Error("no land tile found on map");
  }

  function landNear(x: number, y: number, r: number): boolean {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= game.width() || yy >= game.height()) {
          continue;
        }
        if (game.isLand(game.ref(xx, yy))) return true;
      }
    }
    return false;
  }

  // A water tile that genuinely sits between two distinct landmasses.
  function findStraitTile(): TileRef | null {
    for (let y = 0; y < game.height(); y++) {
      for (let x = 0; x < game.width(); x++) {
        const t = game.ref(x, y);
        if (!game.isWater(t)) continue;
        if (!landNear(x, y, 2)) continue; // cheap gate before the BFS
        if (tollStationConnections(game, t).length === 2) return t;
      }
    }
    return null;
  }

  // Open-ocean water tile with no land nearby.
  function findDeepOceanTile(): TileRef | null {
    for (let y = 0; y < game.height(); y++) {
      for (let x = 0; x < game.width(); x++) {
        const t = game.ref(x, y);
        if (!game.isWater(t)) continue;
        if (landNear(x, y, 2)) continue;
        return t;
      }
    }
    return null;
  }

  test("can be placed on water between two landmasses", () => {
    const strait = findStraitTile();
    expect(strait).not.toBeNull();
    p1.conquer(firstLandTile()); // player must own territory to build
    expect(p1.canBuild(UnitType.WaterTollStation, strait!)).toBe(strait);
  });

  test("cannot be placed in open ocean (needs two landmasses)", () => {
    const ocean = findDeepOceanTile();
    expect(ocean).not.toBeNull();
    p1.conquer(firstLandTile());
    expect(tollStationConnections(game, ocean!).length).toBeLessThan(2);
    expect(p1.canBuild(UnitType.WaterTollStation, ocean!)).toBe(false);
  });

  test("survives placement through the real construction path", () => {
    const strait = findStraitTile();
    expect(strait).not.toBeNull();
    p1.conquer(firstLandTile()); // player must own territory to build
    game.addExecution(
      new ConstructionExecution(p1, UnitType.WaterTollStation, strait!),
    );
    executeTicks(game, 20);
    const stations = p1.units(UnitType.WaterTollStation);
    expect(stations.length).toBe(1);
    expect(stations[0].isActive()).toBe(true);
    expect(stations[0].tile()).toBe(strait);
  });

  test("a nearby toll station counts as a connection anchor (chaining)", () => {
    const strait = findStraitTile();
    expect(strait).not.toBeNull();
    // Build station A at a genuine two-landmass spot.
    p1.buildUnit(UnitType.WaterTollStation, strait!, {});

    // A water tile within range of station A.
    const near = game.neighbors(strait!).find((n) => game.isWater(n));
    expect(near).toBeDefined();
    const conns = tollStationConnections(game, near!);

    // The spot is valid and station A's tile is one of its two anchors — i.e.
    // stations can be chained, not only bridged between landmasses.
    expect(conns.length).toBe(2);
    expect(conns).toContain(strait);
  });

  test("enemy warship captures the station after holding position", () => {
    const strait = findStraitTile();
    expect(strait).not.toBeNull();

    const station = p1.buildUnit(UnitType.WaterTollStation, strait!, {});
    game.addExecution(new WaterTollStationExecution(station));
    expect(station.owner()).toBe(p1);

    // Park an enemy warship right next to the station (no execution, so it
    // holds position) and let the capture timer run out.
    const waterNeighbor = game.neighbors(strait!).find((n) => game.isWater(n));
    expect(waterNeighbor).toBeDefined();
    p2.buildUnit(UnitType.Warship, waterNeighbor!, {
      patrolTile: waterNeighbor!,
    });

    executeTicks(game, 80);

    expect(station.owner()).toBe(p2);
  });

  test("charges an enemy boat a gold toll when passing through", () => {
    const strait = findStraitTile();
    expect(strait).not.toBeNull();
    const station = p1.buildUnit(UnitType.WaterTollStation, strait!, {});
    game.addExecution(new WaterTollStationExecution(station));

    const gate = game.neighbors(strait!).find((n) => game.isWater(n));
    expect(gate).toBeDefined();
    p2.buildUnit(UnitType.TransportShip, gate!, {});

    const p2Before = p2.gold();
    const p1Before = p1.gold();
    executeTicks(game, 5);

    // p2 paid; the station owner p1 received exactly what p2 lost.
    expect(p2.gold()).toBeLessThan(p2Before);
    expect(p1.gold() - p1Before).toBe(p2Before - p2.gold());
  });

  test("does not toll the station owner's own boats", () => {
    const strait = findStraitTile();
    const station = p1.buildUnit(UnitType.WaterTollStation, strait!, {});
    game.addExecution(new WaterTollStationExecution(station));

    const gate = game.neighbors(strait!).find((n) => game.isWater(n));
    p1.buildUnit(UnitType.TransportShip, gate!, {});

    const p1Before = p1.gold();
    executeTicks(game, 1);
    expect(p1.gold()).toBe(p1Before);
  });
});

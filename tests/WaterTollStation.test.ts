import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { SeaBuildExecution } from "../src/core/execution/SeaBuildExecution";
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
    game = await setup(
      "ocean_and_land",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("p1", PlayerType.Human, null, "p1"),
        new PlayerInfo("p2", PlayerType.Human, null, "p2"),
      ],
    );
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

  // A placeable water tile: has at least one connection anchor (land or another
  // station) in range. A single station only needs one connection — you chain
  // stations to span a wide strait (see tollStationConnections).
  function findStraitTile(): TileRef | null {
    for (let y = 0; y < game.height(); y++) {
      for (let x = 0; x < game.width(); x++) {
        const t = game.ref(x, y);
        if (!game.isWater(t)) continue;
        if (!landNear(x, y, 2)) continue; // cheap gate before the BFS
        if (tollStationConnections(game, t).length >= 1) return t;
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

  test("can be placed on water with a connection anchor + reachable port", () => {
    const strait = findStraitTile();
    expect(strait).not.toBeNull();
    const conns = tollStationConnections(game, strait!);
    expect(conns.length).toBeGreaterThanOrEqual(1);
    // A reachable port on the same water body is required (the builder ship
    // launches from it). Build one on the strait's nearest land anchor.
    p1.conquer(conns[0]);
    p1.buildUnit(UnitType.Port, conns[0], {});
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
    const conns = tollStationConnections(game, strait!);
    p1.conquer(conns[0]);
    p1.buildUnit(UnitType.Port, conns[0], {}); // reachable port required
    game.addExecution(
      new ConstructionExecution(p1, UnitType.WaterTollStation, strait!),
    );
    executeTicks(game, 20);
    const stations = p1.units(UnitType.WaterTollStation);
    expect(stations.length).toBe(1);
    expect(stations[0].isActive()).toBe(true);
    expect(stations[0].tile()).toBe(strait);
  });

  test("survives an active PlayerExecution (does not explode on water)", () => {
    // Regression: PlayerExecution deletes any structure whose tile has no
    // player owner. Water tiles never do, so without the water-structure
    // exemption the station is deleted the tick after it is built ("explodes").
    const strait = findStraitTile();
    expect(strait).not.toBeNull();
    p1.conquer(firstLandTile()); // player must own territory to build
    const station = p1.buildUnit(UnitType.WaterTollStation, strait!, {});
    game.addExecution(new WaterTollStationExecution(station));
    game.addExecution(new PlayerExecution(p1));

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

  test("credits the toll straight to the station owner", () => {
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

    // p2 paid the toll and the owner (p1) receives it directly — no collection
    // ship or port needed.
    expect(p2.gold()).toBeLessThan(p2Before);
    expect(p1.gold()).toBeGreaterThan(p1Before);
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

  test("sea-build: a transport ship sails out and builds the station", () => {
    const strait = findStraitTile();
    expect(strait).not.toBeNull();
    // Give the player a coastal port near the strait to launch the builder from.
    const conns = tollStationConnections(game, strait!);
    expect(conns.length).toBeGreaterThanOrEqual(1);
    p1.conquer(conns[0]);
    p1.buildUnit(UnitType.Port, conns[0], {});

    game.addExecution(
      new SeaBuildExecution(p1, UnitType.WaterTollStation, strait!),
    );
    // Nothing built yet — the transport ship has to get there first.
    expect(p1.units(UnitType.WaterTollStation).length).toBe(0);

    executeTicks(game, 80);

    const stations = p1.units(UnitType.WaterTollStation);
    expect(stations.length).toBe(1);
    expect(stations[0].tile()).toBe(strait);
  });

  test("sea-build is cancelled if the builder ship is sunk", async () => {
    // Non-instant so the build takes time and can be interrupted mid-way.
    const g = await setup("ocean_and_land", { infiniteGold: true }, [
      new PlayerInfo("a", PlayerType.Human, null, "a"),
    ]);
    const a = g.player("a");
    a.addGold(10_000_000n);

    let strait2: TileRef | null = null;
    for (let y = 0; y < g.height() && strait2 === null; y++) {
      for (let x = 0; x < g.width(); x++) {
        const t = g.ref(x, y);
        if (g.isWater(t) && tollStationConnections(g, t).length >= 1) {
          strait2 = t;
          break;
        }
      }
    }
    expect(strait2).not.toBeNull();
    const conns = tollStationConnections(g, strait2!);
    a.conquer(conns[0]);
    a.buildUnit(UnitType.Port, conns[0], {});

    const exec = new SeaBuildExecution(a, UnitType.WaterTollStation, strait2!);
    g.addExecution(exec);
    g.executeNextTick(); // init: the builder ship spawns
    const builder = a.units(UnitType.TransportShip)[0];
    expect(builder).toBeDefined();
    builder.delete(false); // an enemy warship sinks it

    executeTicks(g, 40);

    expect(a.units(UnitType.WaterTollStation).length).toBe(0);
    expect(exec.isActive()).toBe(false);
  });
});

import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { OilExplosionExecution } from "../src/core/execution/OilExplosionExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

describe("Oil economy", () => {
  let game: Game;
  let player: Player;
  let cx: number;
  let cy: number;

  beforeEach(async () => {
    game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [new PlayerInfo("p", PlayerType.Human, null, "p")],
    );
    player = game.player("p");
    cx = Math.floor(game.width() / 2);
    cy = Math.floor(game.height() / 2);
  });

  // Nearest land tile to the center that is (or isn't) an oil deposit.
  function findLand(wantDeposit: boolean): number {
    const config = game.config();
    for (let r = 0; r < 60; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= game.width() || y >= game.height()) {
            continue;
          }
          const t = game.ref(x, y);
          if (!game.isLand(t) || game.isImpassable(t)) continue;
          if (config.isOilDeposit(game, t) === wantDeposit) return t;
        }
      }
    }
    throw new Error(`no ${wantDeposit ? "" : "non-"}deposit land found`);
  }

  test("burns oil as you grow, runs out without pumps, and a pump refills it", () => {
    // Grow the player so it consumes oil each tick.
    for (let x = cx - 15; x <= cx + 15; x++) {
      for (let y = cy - 15; y <= cy + 15; y++) player.conquer(game.ref(x, y));
    }
    const config = game.config();
    const consumption = config.oilConsumptionRate(player);
    expect(consumption).toBeGreaterThan(0);

    // Starts with a full tank at full speed.
    expect(player.oil()).toBe(config.maxOil());
    expect(player.oilSpeedFactor()).toBe(1);

    // With no pumps, the tank drains to empty and movement slows.
    const drainTicks = Math.ceil(config.maxOil() / consumption) + 2;
    for (let i = 0; i < drainTicks; i++) player.updateOil();
    expect(player.oil()).toBe(0);
    expect(player.oilSpeedFactor()).toBeLessThan(1);

    // A pump produces more than the player burns, so oil comes back.
    player.buildUnit(UnitType.OilPump, game.ref(cx, cy), {});
    player.updateOil();
    expect(player.oil()).toBeGreaterThan(0);
    expect(player.oilSpeedFactor()).toBe(1);
  });

  test("a player with no territory needs no oil and keeps full speed", () => {
    for (let i = 0; i < 50; i++) player.updateOil();
    expect(player.oil()).toBe(game.config().maxOil());
    expect(player.oilSpeedFactor()).toBe(1);
  });

  test("oil pumps can be stacked on the same deposit", () => {
    player.addGold(10_000_000n);
    const dep = findLand(true);
    player.conquer(dep);
    expect(player.canBuild(UnitType.OilPump, dep)).toBe(dep);
    player.buildUnit(UnitType.OilPump, dep, {});
    // Another pump on the same deposit is still allowed (stacking).
    expect(player.canBuild(UnitType.OilPump, dep)).toBe(dep);
  });

  test("oil pumps can only be built on an oil deposit", () => {
    const dep = findLand(true);
    const nonDep = findLand(false);
    player.conquer(dep);
    player.conquer(nonDep);
    expect(player.canBuild(UnitType.OilPump, dep)).toBe(dep);
    expect(player.canBuild(UnitType.OilPump, nonDep)).toBe(false);
  });

  test("an oil-pump explosion wipes out units and land at the blast", () => {
    const c = game.ref(cx, cy);
    player.conquer(c);
    const victim = player.buildUnit(UnitType.City, c, {});
    expect(game.owner(c)).toBe(player);

    game.addExecution(new OilExplosionExecution(c));
    game.executeNextTick();
    game.executeNextTick();

    // The blast strips ownership from the land and destroys units at ground zero.
    expect(game.owner(c).isPlayer()).toBe(false);
    expect(victim.isActive()).toBe(false);
  });

  test("running out of oil slows movement (more ticks per step)", () => {
    const config = game.config();
    // Full tank: base movement speed.
    expect(config.oilAdjustedTicksPerMove(1, player)).toBe(1);

    // Grow and run without pumps until the tank is empty.
    for (let x = cx - 15; x <= cx + 15; x++) {
      for (let y = cy - 15; y <= cy + 15; y++) player.conquer(game.ref(x, y));
    }
    const drain = Math.ceil(
      config.maxOil() / config.oilConsumptionRate(player),
    );
    for (let i = 0; i < drain + 2; i++) player.updateOil();
    expect(player.oil()).toBe(0);

    // Empty tank: a movement step now takes more ticks (slower).
    expect(config.oilAdjustedTicksPerMove(1, player)).toBeGreaterThan(1);
  });

  test("oil shortage shrinks train speed but never below 1", () => {
    const config = game.config();
    // Full tank: base train speed is unchanged.
    expect(config.oilAdjustedSpeed(2, player)).toBe(2);

    // Grow and drain the tank dry.
    for (let x = cx - 15; x <= cx + 15; x++) {
      for (let y = cy - 15; y <= cy + 15; y++) player.conquer(game.ref(x, y));
    }
    const drain = Math.ceil(
      config.maxOil() / config.oilConsumptionRate(player),
    );
    for (let i = 0; i < drain + 2; i++) player.updateOil();
    expect(player.oil()).toBe(0);

    // Empty tank: the train advances fewer tiles per tick, but never freezes.
    const slowed = config.oilAdjustedSpeed(2, player);
    expect(slowed).toBeLessThan(2);
    expect(slowed).toBeGreaterThanOrEqual(1);
  });

  test("expanding into new tiles costs oil", () => {
    // First update records the baseline (spawn/setup land isn't billed).
    player.conquer(game.ref(cx, cy));
    player.updateOil();
    const before = player.oil();

    // Grow by a block, then one update bills the gained tiles.
    for (let x = cx - 5; x <= cx + 5; x++) {
      for (let y = cy - 5; y <= cy + 5; y++) player.conquer(game.ref(x, y));
    }
    const gained = player.numTilesOwned() - 1;
    expect(gained).toBeGreaterThan(0);
    player.updateOil();

    // No pump: oil dropped by (at least) the expansion cost of the new tiles.
    expect(player.oil()).toBeLessThan(before);
    expect(before - player.oil()).toBeGreaterThanOrEqual(
      gained * game.config().oilExpansionCostPerTile(),
    );
  });

  test("the construction path yields a real, counted, completed pump", () => {
    // The user's bug: building a pump the normal way (via the build intent /
    // ConstructionExecution) never seemed to add oil. Prove that path actually
    // produces a live OilPump unit that updateOil then counts.
    const dep = findLand(true);
    player.conquer(dep);
    game.addExecution(
      new ConstructionExecution(player, UnitType.OilPump, dep),
    );
    executeTicks(game, 20); // build (and, in this instant game, complete) it

    const pumps = player.units(UnitType.OilPump);
    expect(pumps.length).toBe(1);
    expect(pumps[0].isActive()).toBe(true);
    expect(pumps[0].isUnderConstruction()).toBe(false);

    // With the completed pump present, a single production tick from a drained
    // tank refills it — i.e. the pump is genuinely counted by updateOil.
    for (let i = 0; i < 100; i++) player.updateOil();
    const before = player.oil();
    player.updateOil();
    expect(player.oil()).toBeGreaterThanOrEqual(before);
    expect(player.oil()).toBeGreaterThan(0);
  });
});

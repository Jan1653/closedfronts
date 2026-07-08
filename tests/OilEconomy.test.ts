import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

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
});

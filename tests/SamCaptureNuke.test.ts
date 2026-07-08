import { SAMLauncherExecution } from "../src/core/execution/SAMLauncherExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  TrajectoryTile,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

function trajectory(game: Game, tiles: [number, number][]): TrajectoryTile[] {
  return tiles.map(([x, y]) => ({ tile: game.ref(x, y), targetable: true }));
}

/**
 * Rücksender: a high-level SAM launcher may capture an intercepted nuke into
 * its owner's stockpile (Config.samCaptureChancePercent) instead of merely
 * destroying it; the owner can then launch a bomb of that type for free.
 */
describe("Rücksender (SAM nuke capture)", () => {
  let game: Game;
  let attacker: Player;
  let defender: Player;

  beforeEach(async () => {
    game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("defender", PlayerType.Human, null, "defender"),
        new PlayerInfo("attacker", PlayerType.Human, null, "attacker"),
      ],
    );
    defender = game.player("defender");
    attacker = game.player("attacker");
  });

  test("samCaptureChancePercent scales per level and bomb type", () => {
    const c = game.config();
    // Atom bomb: 0 below level 5, +10%/level from level 5, guaranteed by 15.
    expect(c.samCaptureChancePercent(UnitType.AtomBomb, 4)).toBe(0);
    expect(c.samCaptureChancePercent(UnitType.AtomBomb, 5)).toBe(10);
    expect(c.samCaptureChancePercent(UnitType.AtomBomb, 6)).toBe(20);
    expect(c.samCaptureChancePercent(UnitType.AtomBomb, 14)).toBe(100);
    expect(c.samCaptureChancePercent(UnitType.AtomBomb, 15)).toBe(100);
    // Hydrogen bomb: 0 below level 10, +20%/level from level 10, guaranteed by 15.
    expect(c.samCaptureChancePercent(UnitType.HydrogenBomb, 9)).toBe(0);
    expect(c.samCaptureChancePercent(UnitType.HydrogenBomb, 10)).toBe(20);
    expect(c.samCaptureChancePercent(UnitType.HydrogenBomb, 14)).toBe(100);
    expect(c.samCaptureChancePercent(UnitType.HydrogenBomb, 15)).toBe(100);
  });

  test("a level-15 SAM captures the intercepted atom bomb for its owner", () => {
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    for (let i = 0; i < 14; i++) sam.increaseLevel();
    expect(sam.level()).toBe(15);
    game.addExecution(new SAMLauncherExecution(defender, null, sam));

    attacker.buildUnit(UnitType.AtomBomb, game.ref(1, 1), {
      targetTile: game.ref(3, 1),
      trajectory: trajectory(game, [
        [1, 1],
        [2, 1],
        [3, 1],
      ]),
    });

    expect(defender.nukeStockpile(UnitType.AtomBomb)).toBe(0);
    executeTicks(game, 4);

    // Bomb is destroyed either way, and captured because chance is 100% at L15.
    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(0);
    expect(defender.nukeStockpile(UnitType.AtomBomb)).toBe(1);
  });

  test("a level-4 SAM destroys the atom bomb but captures nothing", () => {
    const sam = defender.buildUnit(UnitType.SAMLauncher, game.ref(1, 1), {});
    for (let i = 0; i < 3; i++) sam.increaseLevel();
    expect(sam.level()).toBe(4);
    game.addExecution(new SAMLauncherExecution(defender, null, sam));

    attacker.buildUnit(UnitType.AtomBomb, game.ref(1, 1), {
      targetTile: game.ref(3, 1),
      trajectory: trajectory(game, [
        [1, 1],
        [2, 1],
        [3, 1],
      ]),
    });

    executeTicks(game, 4);

    expect(attacker.units(UnitType.AtomBomb)).toHaveLength(0);
    expect(defender.nukeStockpile(UnitType.AtomBomb)).toBe(0);
  });
});

describe("Rücksender (free launch from stockpile)", () => {
  test("a captured bomb launches for free and spends one stockpile credit", async () => {
    // No infiniteGold, so the base nuke price is charged normally.
    const game = await setup("big_plains", { instantBuild: true }, [
      new PlayerInfo("p", PlayerType.Human, null, "p"),
    ]);
    const player = game.player("p");
    const config = game.config();
    const atomInfo = config.unitInfo(UnitType.AtomBomb);

    // Full price without a captured bomb.
    expect(atomInfo.cost(game, player)).toBe(750_000n);

    player.addNukeToStockpile(UnitType.AtomBomb);
    // Free while a captured bomb is held.
    expect(atomInfo.cost(game, player)).toBe(0n);

    const goldBefore = player.gold();
    player.buildUnit(UnitType.AtomBomb, game.ref(5, 5), {
      targetTile: game.ref(6, 5),
      trajectory: trajectory(game, [
        [5, 5],
        [6, 5],
      ]),
    });

    // The credit is spent, no gold was charged, and the next bomb costs full price again.
    expect(player.nukeStockpile(UnitType.AtomBomb)).toBe(0);
    expect(player.gold()).toBe(goldBefore);
    expect(atomInfo.cost(game, player)).toBe(750_000n);
  });
});

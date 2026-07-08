import { AttackExecution } from "../src/core/execution/AttackExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

describe("Wall attack detour", () => {
  let game: Game;
  let attacker: Player;
  let defender: Player;

  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      { infiniteGold: true, instantBuild: true, infiniteTroops: true },
      [
        new PlayerInfo("atk", PlayerType.Human, null, "atk"),
        new PlayerInfo("def", PlayerType.Human, null, "def"),
      ],
    );
    attacker = game.player("atk");
    defender = game.player("def");
  });

  test("an attack takes non-walled tiles before breaking through a wall", () => {
    // Defender owns the whole land block (columns 1..7) so it stays well above
    // 100 tiles — otherwise the dead-defender shortcut wipes it in one step,
    // bypassing the tile-by-tile priority queue this feature works through.
    const H = game.height();
    for (let y = 0; y < H; y++) {
      for (let x = 1; x <= 7; x++) defender.conquer(game.ref(x, y));
    }
    // Attacker only touches the defender at three tiles (rows 7,8,9), so the
    // whole front is small and only a few tiles are taken during the test.
    attacker.conquer(game.ref(0, 7));
    attacker.conquer(game.ref(0, 8));
    attacker.conquer(game.ref(0, 9));
    expect(defender.numTilesOwned()).toBeGreaterThanOrEqual(100);

    // Wall the middle front tile.
    const wallTile = game.ref(1, 8);
    defender.buildUnit(UnitType.Wall, wallTile, {});
    executeTicks(game, 5); // let the unit grid index the wall
    expect(
      game
        .nearbyUnits(wallTile, 1, UnitType.Wall)
        .some((w) => w.distSquared === 0),
    ).toBe(true);

    game.addExecution(new AttackExecution(1_000_000, attacker, defender.id()));

    // attackTilesPerTick is 1; the two non-walled front tiles are taken first,
    // the deferred wall tile is gone around (still the defender's).
    executeTicks(game, 4);

    expect(game.owner(game.ref(1, 7))).toBe(attacker);
    expect(game.owner(game.ref(1, 9))).toBe(attacker);
    expect(game.owner(wallTile)).toBe(defender); // gone around, not broken
    expect(defender.numTilesOwned()).toBeGreaterThanOrEqual(100);
  });
});

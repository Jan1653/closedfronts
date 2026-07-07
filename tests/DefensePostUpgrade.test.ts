import path from "path";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { UseRealAttackLogic } from "./util/TestConfig";
import { executeTicks } from "./util/utils";

describe("DefensePost upgrade", () => {
  let game: Game;
  let attacker: Player;
  let defender: Player;
  let cx: number;
  let cy: number;

  beforeEach(async () => {
    game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("atk", PlayerType.Human, null, "atk"),
        new PlayerInfo("def", PlayerType.Human, null, "def"),
      ],
      path.join(__dirname, "util"),
      UseRealAttackLogic,
    );
    attacker = game.player("atk");
    defender = game.player("def");
    attacker.addGold(10_000_000n);
    defender.addGold(10_000_000n);
    cx = Math.floor(game.width() / 2);
    cy = Math.floor(game.height() / 2);
    // Defender owns territory (keeps it alive and avoids divide-by-zero in
    // attackLogic, which reads troops / numTilesOwned).
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        defender.conquer(game.ref(cx + dx, cy + dy));
      }
    }
  });

  test("range grows with level up to a cap", () => {
    const c = game.config();
    expect(c.defensePostRange(1)).toBe(30);
    expect(c.defensePostRange(2)).toBe(40);
    expect(c.defensePostRange(4)).toBe(60);
    expect(c.defensePostRange(99)).toBe(60);
  });

  test("is upgradable and gains levels", () => {
    const post = defender.buildUnit(UnitType.DefensePost, game.ref(cx, cy), {});
    expect(post.level()).toBe(1);
    expect(defender.canUpgradeUnit(post)).toBe(true);
    defender.upgradeUnit(post);
    expect(post.level()).toBe(2);
  });

  test("upgrading extends the defensive bonus to farther tiles", () => {
    const d = game.ref(cx, cy);
    const post = defender.buildUnit(UnitType.DefensePost, d, {});
    executeTicks(game, 5); // let the unit grid index the post

    const near = game.ref(cx, cy + 20); // within level-1 range (30)
    const far = game.ref(cx, cy + 35); // outside level 1 (30), inside level 2 (40)

    // Sanity: the post is indexed and findable.
    expect(game.nearbyUnits(near, 60, UnitType.DefensePost).length).toBe(1);

    const loss = (t: number) =>
      game.config().attackLogic(game, 1000, attacker, defender, t)
        .attackerTroopLoss;

    // At level 1 the near tile is protected (higher attacker loss), the far
    // tile is not.
    expect(loss(near)).toBeGreaterThan(loss(far));

    const farLossBefore = loss(far);
    defender.upgradeUnit(post); // level 2 → range 40 now reaches the far tile
    expect(loss(far)).toBeGreaterThan(farLossBefore);
  });
});

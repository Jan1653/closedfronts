import { DefensePostExecution } from "../src/core/execution/DefensePostExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

describe("DefensePost barrage", () => {
  let game: Game;
  let owner: Player;
  let enemy: Player;
  let cx: number;
  let cy: number;

  beforeEach(async () => {
    game = await setup(
      "big_plains",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("own", PlayerType.Human, null, "own"),
        new PlayerInfo("enemy", PlayerType.Human, null, "enemy"),
      ],
    );
    owner = game.player("own");
    enemy = game.player("enemy");
    cx = Math.floor(game.width() / 2);
    cy = Math.floor(game.height() / 2);
  });

  // Owner holds a block; the enemy holds an adjacent block within range.
  function setUpFront(): TileRef[] {
    for (let x = cx - 2; x <= cx + 1; x++) {
      for (let y = cy - 2; y <= cy + 2; y++) owner.conquer(game.ref(x, y));
    }
    const enemyTiles: TileRef[] = [];
    for (let x = cx + 2; x <= cx + 4; x++) {
      for (let y = cy - 2; y <= cy + 2; y++) {
        const t = game.ref(x, y);
        enemy.conquer(t);
        enemyTiles.push(t);
      }
    }
    return enemyTiles;
  }

  test("captures nearby enemy tiles when at war", () => {
    const enemyTiles = setUpFront();
    // At war (hostile) → the barrage may annex their land.
    owner.updateRelation(enemy, -100);
    enemy.updateRelation(owner, -100);

    const post = owner.buildUnit(UnitType.DefensePost, game.ref(cx, cy), {});
    game.addExecution(new DefensePostExecution(post));

    const heldBefore = enemyTiles.filter((t) => game.owner(t) === enemy).length;
    executeTicks(game, 6);
    const heldAfter = enemyTiles.filter((t) => game.owner(t) === enemy).length;

    // The barrage captured enemy tiles for the post owner.
    expect(heldAfter).toBeLessThan(heldBefore);
    expect(enemyTiles.some((t) => game.owner(t) === owner)).toBe(true);
  });

  test("does NOT capture a neutral player's tiles", () => {
    const enemyTiles = setUpFront();
    // Relations left neutral → the post's range reaches the other player's land
    // but must not annex it.
    const post = owner.buildUnit(UnitType.DefensePost, game.ref(cx, cy), {});
    game.addExecution(new DefensePostExecution(post));

    executeTicks(game, 8);

    // Every neutral tile is still held by that player.
    expect(enemyTiles.every((t) => game.owner(t) === enemy)).toBe(true);
  });

  test("fires slower at level 1 and faster/harder when upgraded", () => {
    const c = game.config();
    // Base level fires every 2nd tick (half the old every-tick rate)...
    expect(c.defensePostFireInterval(1)).toBe(2);
    // ...upgrading speeds it up to every tick.
    expect(c.defensePostFireInterval(2)).toBe(1);
    // And each level captures more tiles per burst.
    expect(c.defensePostGrenadesPerBurst(1)).toBe(3);
    expect(c.defensePostGrenadesPerBurst(3)).toBeGreaterThan(
      c.defensePostGrenadesPerBurst(1),
    );
  });

  test("captures unowned wilderness around it", () => {
    const d = game.ref(cx, cy);
    owner.conquer(d);
    const post = owner.buildUnit(UnitType.DefensePost, d, {});
    game.addExecution(new DefensePostExecution(post));

    const before = owner.numTilesOwned();
    executeTicks(game, 5);
    // The barrage eats the neutral land around the post.
    expect(owner.numTilesOwned()).toBeGreaterThan(before);
  });
});

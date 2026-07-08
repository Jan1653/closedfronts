import path from "path";
import { WallExecution } from "../src/core/execution/WallExecution";
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

describe("Wall", () => {
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
    cx = Math.floor(game.width() / 2);
    cy = Math.floor(game.height() / 2);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++)
        defender.conquer(game.ref(cx + dx, cy + dy));
    }
  });

  test("makes its tile far harder to conquer", () => {
    const walled = game.ref(cx, cy);
    const plain = game.ref(cx + 2, cy);
    defender.buildUnit(UnitType.Wall, walled, {});
    executeTicks(game, 5); // let the unit grid index the wall

    const loss = (t: number) =>
      game.config().attackLogic(game, 1000, attacker, defender, t)
        .attackerTroopLoss;

    expect(loss(walled)).toBeGreaterThan(loss(plain));
  });

  test("is taken over when its tile is captured", () => {
    const w = game.ref(cx, cy);
    const wall = defender.buildUnit(UnitType.Wall, w, {});
    game.addExecution(new WallExecution(wall));
    expect(wall.owner()).toBe(defender);

    attacker.conquer(w); // the tile changes hands (broken through / grenaded)
    executeTicks(game, 2);

    expect(wall.owner()).toBe(attacker);
  });

  test("walls keep a minimum spacing (no stacking)", () => {
    const t1 = game.ref(cx, cy);
    const t2 = game.ref(cx + 1, cy); // adjacent
    expect(defender.canBuild(UnitType.Wall, t1)).toBe(t1);
    defender.buildUnit(UnitType.Wall, t1, {});
    // Adjacent placement is now rejected — walls can't be stacked densely.
    expect(defender.canBuild(UnitType.Wall, t2)).toBe(false);
  });

  test("placing a wall near another auto-builds a connecting line", () => {
    // Own a horizontal strip so the line between the two walls is buildable land.
    for (let x = cx; x <= cx + 8; x++) defender.conquer(game.ref(x, cy));
    const a = game.ref(cx, cy);
    const b = game.ref(cx + 8, cy); // within wallConnectRange, beyond spacing
    defender.buildUnit(UnitType.Wall, a, {});
    const wallB = defender.buildUnit(UnitType.Wall, b, {});

    const before = defender.units(UnitType.Wall).length;
    game.addExecution(new WallExecution(wallB)); // connect = true
    executeTicks(game, 2); // init runs, filler segments bridge the gap
    const after = defender.units(UnitType.Wall).length;

    expect(after).toBeGreaterThan(before);
    // A midpoint tile now carries a wall (checked via the unit list, which is
    // updated immediately — the spatial grid is indexed a tick later).
    const mid = game.ref(cx + 4, cy);
    expect(defender.units(UnitType.Wall).some((w) => w.tile() === mid)).toBe(
      true,
    );
  });
});

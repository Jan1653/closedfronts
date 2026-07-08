import { Execution, Game, Player, Unit } from "../game/Game";
import { manhattanDistFN, TileRef } from "../game/GameMap";

// A defense post under pressure fires bursts of "grenades" that capture the
// nearest enemy tiles within its range. Level 1 fires slowly; upgrading a post
// makes it fire more often (shorter interval) and capture more tiles per burst,
// so a stacked post is a strong, aggressive front.
// Cap on tiles scanned per burst, so a post sitting deep in friendly territory
// (no enemies in range) stays cheap.
const MAX_SCAN = 2500;

export class DefensePostExecution implements Execution {
  private mg: Game;
  private active: boolean = true;
  // Ticks left before the next burst; counts down each tick.
  private cooldown = 0;

  constructor(private post: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.post.isActive()) {
      this.active = false;
      return;
    }
    // Do nothing while the structure is under construction.
    if (this.post.isUnderConstruction()) {
      return;
    }
    if (this.cooldown > 0) {
      this.cooldown--;
      return;
    }
    this.fireBarrage();
    this.cooldown =
      this.mg.config().defensePostFireInterval(this.post.level()) - 1;
  }

  // Capture up to defensePostGrenadesPerBurst(level) of the nearest enemy tiles
  // within the post's (level-scaled) range. Own and allied tiles are never hit.
  private fireBarrage(): void {
    const owner = this.post.owner();
    const level = this.post.level();
    const range = this.mg.config().defensePostRange(level);
    const perBurst = this.mg.config().defensePostGrenadesPerBurst(level);
    const postTile = this.post.tile();

    const targets: TileRef[] = [];
    let scanned = 0;
    for (const t of this.mg.bfs(postTile, manhattanDistFN(postTile, range))) {
      if (++scanned > MAX_SCAN || targets.length >= perBurst) break;
      // Only conquerable land (conquer() throws on water / impassable).
      if (!this.mg.isLand(t) || this.mg.isImpassable(t)) continue;
      const tileOwner = this.mg.owner(t);
      if (tileOwner.isPlayer()) {
        const p = tileOwner as Player;
        // Own and allied tiles are never hit.
        if (p === owner || p.isFriendly(owner) || p.isOnSameTeam(owner))
          continue;
      }
      // Enemy tile or unowned wilderness — grenade it and take it.
      targets.push(t);
    }

    for (const t of targets) {
      owner.conquer(t);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

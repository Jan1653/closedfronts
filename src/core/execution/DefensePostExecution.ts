import { Execution, Game, Player, Unit } from "../game/Game";
import { manhattanDistFN, TileRef } from "../game/GameMap";

// A defense post under pressure fires a rapid barrage of "grenades" that
// capture the nearest enemy tiles within its range each tick. Many posts
// together form a strong, aggressive front.
const GRENADES_PER_TICK = 3;
// Cap on tiles scanned per tick, so a post sitting deep in friendly territory
// (no enemies in range) stays cheap.
const MAX_SCAN = 2500;

export class DefensePostExecution implements Execution {
  private mg: Game;
  private active: boolean = true;

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
    this.fireBarrage();
  }

  // Capture up to GRENADES_PER_TICK of the nearest enemy tiles within the
  // post's (level-scaled) range. Own and allied tiles are never targeted.
  private fireBarrage(): void {
    const owner = this.post.owner();
    const range = this.mg.config().defensePostRange(this.post.level());
    const postTile = this.post.tile();

    const targets: TileRef[] = [];
    let scanned = 0;
    for (const t of this.mg.bfs(postTile, manhattanDistFN(postTile, range))) {
      if (++scanned > MAX_SCAN || targets.length >= GRENADES_PER_TICK) break;
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

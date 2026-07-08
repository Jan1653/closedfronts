import { Execution, Game, Player, Unit } from "../game/Game";

export class WallExecution implements Execution {
  private mg: Game;
  private active: boolean = true;

  constructor(private wall: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.wall.isActive()) {
      this.active = false;
      return;
    }
    if (this.wall.isUnderConstruction()) {
      return;
    }
    // A wall is a physical barrier: whoever ends up holding its tile (by
    // breaking through, a defense-post barrage, etc.) takes the wall too.
    const tileOwner = this.mg.owner(this.wall.tile());
    if (tileOwner.isPlayer() && tileOwner !== this.wall.owner()) {
      this.wall.setOwner(tileOwner as Player);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

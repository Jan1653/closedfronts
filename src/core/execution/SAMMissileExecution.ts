import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFinding } from "../pathfinding/PathFinder";
import { PathStatus, SteppingPathFinder } from "../pathfinding/types";
import { PseudoRandom } from "../PseudoRandom";
import { NukeType } from "../StatsSchemas";

export class SAMMissileExecution implements Execution {
  private active = true;
  private pathFinder: SteppingPathFinder<TileRef>;
  private SAMMissile: Unit | undefined;
  private mg: Game;
  private speed: number = 0;
  private pseudoRandom: PseudoRandom | undefined;

  constructor(
    private spawn: TileRef,
    private _owner: Player,
    private ownerUnit: Unit,
    private target: Unit,
    private targetTile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.pathFinder = PathFinding.Air(mg);
    this.mg = mg;
    this.speed = this.mg.config().defaultSamMissileSpeed();
  }

  tick(ticks: number): void {
    this.SAMMissile ??= this._owner.buildUnit(
      UnitType.SAMMissile,
      this.spawn,
      {},
    );
    if (!this.SAMMissile.isActive()) {
      this.active = false;
      return;
    }
    // Mirv warheads are too fast, and mirv shouldn't be stopped ever
    const nukesWhitelist = [UnitType.AtomBomb, UnitType.HydrogenBomb];
    if (
      !this.target.isActive() ||
      !this.ownerUnit.isActive() ||
      this.target.owner() === this.SAMMissile.owner() ||
      !nukesWhitelist.includes(this.target.type())
    ) {
      // Clear the flag so other SAMs can re-target this nuke
      if (this.target.isActive()) {
        this.target.setTargetedBySAM(false);
      }
      this.SAMMissile.delete(false);
      this.active = false;
      return;
    }
    for (let i = 0; i < this.speed; i++) {
      const result = this.pathFinder.next(
        this.SAMMissile.tile(),
        this.targetTile,
      );
      if (result.status === PathStatus.COMPLETE) {
        this.mg.displayMessage(
          "events_display.missile_intercepted",
          MessageType.SAM_HIT,
          this._owner.id(),
          undefined,
          { unit: this.target.type() },
        );
        this.active = false;
        // Rücksender: a high-level SAM may capture the bomb before destroying it.
        this.maybeCaptureNuke();
        this.target.delete(true, this._owner);
        this.SAMMissile.delete(false);

        // Record stats
        this.mg
          .stats()
          .bombIntercept(this._owner, this.target.type() as NukeType, 1);
        return;
      } else if (result.status === PathStatus.NEXT) {
        this.SAMMissile.move(result.node);
      }
    }
  }

  /**
   * Rücksender: with a level-scaled chance (Config.samCaptureChancePercent),
   * bank the intercepted bomb in the SAM owner's stockpile as a free nuke of
   * the same type instead of only destroying it. Rolled once, at interception.
   */
  private maybeCaptureNuke(): void {
    const nukeType = this.target.type();
    if (nukeType !== UnitType.AtomBomb && nukeType !== UnitType.HydrogenBomb) {
      return;
    }
    const chance = this.mg
      .config()
      .samCaptureChancePercent(nukeType, this.ownerUnit.level());
    if (chance <= 0) {
      return;
    }
    this.pseudoRandom ??= new PseudoRandom(this.SAMMissile!.id());
    if (this.pseudoRandom.nextInt(0, 100) >= chance) {
      return;
    }
    const owner = this.ownerUnit.owner();
    owner.addNukeToStockpile(nukeType);
    this.mg.displayMessage(
      nukeType === UnitType.AtomBomb
        ? "events_display.atom_bomb_captured"
        : "events_display.hydrogen_bomb_captured",
      MessageType.SAM_HIT,
      owner.id(),
    );
  }

  isActive(): boolean {
    return this.active;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

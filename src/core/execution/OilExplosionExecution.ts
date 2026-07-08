import { Execution, Game, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

// The blast is sized like a hydrogen bomb, per the feature request.
const BLAST_TYPE = UnitType.HydrogenBomb;

/**
 * A one-shot secondary explosion at an oil pump that was hit by a bomb: the
 * stored fuel goes up in a hydrogen-bomb-sized blast that wipes out units and
 * strips ownership from the land around it. It does not chain (it deletes other
 * pumps without re-triggering their explosions).
 */
export class OilExplosionExecution implements Execution {
  private mg: Game;
  private active: boolean = true;

  constructor(private tile: TileRef) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    const mg = this.mg;
    const outer = mg.config().nukeMagnitudes(BLAST_TYPE).outer;
    const outer2 = outer * outer;

    // Destroy units caught in the blast (but not other in-flight bombs).
    for (const unit of mg.units()) {
      const t = unit.type();
      if (
        t === UnitType.AtomBomb ||
        t === UnitType.HydrogenBomb ||
        t === UnitType.MIRV ||
        t === UnitType.MIRVWarhead ||
        t === UnitType.SAMMissile
      ) {
        continue;
      }
      if (mg.euclideanDistSquared(this.tile, unit.tile()) < outer2) {
        unit.delete(true);
      }
    }

    // Crater the land: strip ownership from every owned tile in the blast.
    const cx = mg.x(this.tile);
    const cy = mg.y(this.tile);
    const x0 = Math.max(0, cx - outer);
    const y0 = Math.max(0, cy - outer);
    const x1 = Math.min(mg.width() - 1, cx + outer);
    const y1 = Math.min(mg.height() - 1, cy + outer);
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const dx = px - cx;
        const dy = py - cy;
        if (dx * dx + dy * dy > outer2) continue;
        const tile = mg.ref(px, py);
        const owner = mg.owner(tile);
        if (owner.isPlayer()) (owner as Player).relinquish(tile);
      }
    }

    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

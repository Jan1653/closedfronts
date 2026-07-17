import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

// Water structures a warship can be explicitly ordered to capture.
const CAPTURABLE_TYPES: ReadonlySet<UnitType> = new Set([
  UnitType.WaterTollStation,
  UnitType.OilPump,
]);

export class MoveWarshipExecution implements Execution {
  constructor(
    private readonly owner: Player,
    private readonly unitIds: number[],
    private readonly position: TileRef,
    // Optional: the enemy water structure the player clicked — the moved
    // warships get an explicit capture order for it.
    private readonly targetUnitId?: number,
  ) {}

  init(mg: Game, _ticks: number): void {
    if (!mg.isValidRef(this.position)) {
      console.warn(`MoveWarshipExecution: position ${this.position} not valid`);
      return;
    }
    const captureTarget = this.resolveCaptureTarget(mg);
    // Get water component of new TargetTile for connectivity check
    const newPatrolTileWaterComponent = mg.getWaterComponent(this.position);
    // Cache warship list and build a lookup map — avoids repeated iteration
    const warshipMap = new Map(
      this.owner.units(UnitType.Warship).map((u) => [u.id(), u]),
    );
    // Deduplicate ids so each warship is only moved once
    for (const unitId of new Set(this.unitIds)) {
      const warship = warshipMap.get(unitId);
      if (!warship) {
        console.warn(`MoveWarshipExecution: warship ${unitId} not found`);
        continue;
      }
      if (!warship.isActive()) {
        console.warn(`MoveWarshipExecution: warship ${unitId} is not active`);
        continue;
      }
      // Do not update the warship's patrolTile if it is in a different Water Component
      if (!mg.hasWaterComponent(warship.tile(), newPatrolTileWaterComponent!)) {
        continue;
      }
      warship.updateWarshipState({
        patrolTile: this.position,
        // A plain move cancels a previous capture order; clicking a structure
        // sets one.
        captureTargetId: captureTarget?.id(),
      });
      warship.setTargetTile(undefined);
    }
  }

  private resolveCaptureTarget(mg: Game): Unit | undefined {
    if (this.targetUnitId === undefined) return undefined;
    const unit = mg.unit(this.targetUnitId);
    if (
      unit === undefined ||
      !unit.isActive() ||
      unit.isUnderConstruction() ||
      !CAPTURABLE_TYPES.has(unit.type()) ||
      !mg.isWater(unit.tile()) ||
      unit.owner() === this.owner ||
      unit.owner().isFriendly(this.owner) ||
      unit.owner().isOnSameTeam(this.owner)
    ) {
      return undefined;
    }
    return unit;
  }

  tick(_ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

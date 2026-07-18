import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

// Water structures a warship can be explicitly ordered to capture.
const CAPTURABLE_TYPES: ReadonlySet<UnitType> = new Set([
  UnitType.WaterTollStation,
  UnitType.OilPump,
  UnitType.Lighthouse,
]);

// Every player-steerable ship (they all carry warshipState.patrolTile).
const MOVABLE_SHIP_TYPES = [
  UnitType.Warship,
  UnitType.FishingBoat,
  UnitType.PatrolBoat,
  UnitType.Submarine,
  UnitType.AtomicSubmarine,
] as const;

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
    // Clicking LAND is only meaningful for ships that can seize a land tile
    // (ultra warship / atomic submarine) — everyone else ignores the order.
    const landTarget = mg.isLand(this.position) ? this.position : undefined;
    // Get water component of new TargetTile for connectivity check
    const newPatrolTileWaterComponent =
      landTarget === undefined ? mg.getWaterComponent(this.position) : null;
    // Cache ship list and build a lookup map — avoids repeated iteration
    const shipMap = new Map(
      this.owner
        .units(MOVABLE_SHIP_TYPES as unknown as UnitType[])
        .map((u) => [u.id(), u]),
    );
    // Deduplicate ids so each ship is only moved once
    for (const unitId of new Set(this.unitIds)) {
      const ship = shipMap.get(unitId);
      if (!ship) {
        console.warn(`MoveWarshipExecution: ship ${unitId} not found`);
        continue;
      }
      if (!ship.isActive()) {
        console.warn(`MoveWarshipExecution: ship ${unitId} is not active`);
        continue;
      }
      if (landTarget !== undefined) {
        if (this.canSeizeLand(ship)) {
          ship.updateWarshipState({ landTargetTile: landTarget });
        }
        continue;
      }
      // Do not update the ship's patrolTile if it is in a different Water Component
      if (!mg.hasWaterComponent(ship.tile(), newPatrolTileWaterComponent!)) {
        continue;
      }
      ship.updateWarshipState({
        patrolTile: this.position,
        // A plain move cancels a previous capture order; clicking a structure
        // sets one. Only real warships capture structures.
        captureTargetId:
          ship.type() === UnitType.Warship ? captureTarget?.id() : undefined,
        landTargetTile: undefined,
      });
      ship.setTargetTile(undefined);
    }
  }

  private canSeizeLand(ship: Unit): boolean {
    if (ship.type() === UnitType.AtomicSubmarine) return true;
    return (
      ship.type() === UnitType.Warship &&
      ship.warshipState().shipClass === "ultra"
    );
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

import {
  Execution,
  Game,
  isUnit,
  OwnerComp,
  Unit,
  UnitParams,
  UnitType,
} from "../game/Game";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PseudoRandom } from "../PseudoRandom";
import { ShipPatrol } from "./ShipPatrol";

/**
 * Patrol boat: an unarmed scout. It wanders its patrol area and "pings"
 * enemy submarines in its scan radius: a spotted submarine becomes targetable
 * (and visible to the scanning player, client-side) for a while. Only
 * attackable from very close range, and not attacked outside of war.
 */
export class PatrolBoatExecution implements Execution {
  private mg: Game;
  private boat: Unit;
  private patrol: ShipPatrol;
  private lastObservedPatrolTile: number | undefined;

  constructor(
    private input: (UnitParams<UnitType.PatrolBoat> & OwnerComp) | Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (isUnit(this.input)) {
      this.boat = this.input;
    } else {
      const spawn = this.input.owner.canBuild(
        UnitType.PatrolBoat,
        this.input.patrolTile,
      );
      if (spawn === false) {
        console.warn(`Failed to spawn patrol boat`);
        return;
      }
      this.boat = this.input.owner.buildUnit(
        UnitType.PatrolBoat,
        spawn,
        this.input,
      );
      this.input.owner.useOil(mg.config().oilCostPerShipLaunch());
    }
    this.patrol = new ShipPatrol(
      mg,
      this.boat,
      new WaterPathFinder(mg),
      new PseudoRandom(mg.ticks() + this.boat.id()),
      mg.config().warshipPatrolRange(),
    );
    this.lastObservedPatrolTile = this.boat.warshipState().patrolTile;
  }

  tick(ticks: number): void {
    if (this.boat === undefined || !this.boat.isActive()) return;
    if (this.boat.health() <= 0) {
      this.boat.delete();
      return;
    }

    const patrolTile = this.boat.warshipState().patrolTile;
    if (patrolTile !== this.lastObservedPatrolTile) {
      this.lastObservedPatrolTile = patrolTile;
      this.patrol.resetWaypoint();
    }

    this.patrol.tick();
    this.scanForSubmarines();
  }

  // Ping enemy submarines in scan range: spotted subs become targetable for a
  // while (SubmarineExecution clears the flag once the window expires).
  private scanForSubmarines(): void {
    const config = this.mg.config();
    const owner = this.boat.owner();
    const until = this.mg.ticks() + config.submarineSpottedDurationTicks();
    for (const { unit } of this.mg.nearbyUnits(
      this.boat.tile(),
      config.patrolBoatScanRange(),
      [UnitType.Submarine, UnitType.AtomicSubmarine],
    )) {
      if (!unit.isActive()) continue;
      const so = unit.owner();
      if (so === owner || so.isFriendly(owner) || so.isOnSameTeam(owner)) {
        continue;
      }
      unit.spot(until);
    }
  }

  isActive(): boolean {
    return this.boat?.isActive() ?? false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

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
 * Fishing boat: a cheap, harmless earner. It wanders its patrol area and
 * every payout interval banks a small amount of gold for its owner (with a
 * "+N" popup at the boat). Not attacked outside of war (see
 * WarshipExecution/SubmarineExecution target filters).
 */
export class FishingBoatExecution implements Execution {
  private mg: Game;
  private boat: Unit;
  private patrol: ShipPatrol;
  private lastObservedPatrolTile: number | undefined;
  private lastPayout = 0;

  constructor(
    private input: (UnitParams<UnitType.FishingBoat> & OwnerComp) | Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (isUnit(this.input)) {
      this.boat = this.input;
    } else {
      const spawn = this.input.owner.canBuild(
        UnitType.FishingBoat,
        this.input.patrolTile,
      );
      if (spawn === false) {
        console.warn(`Failed to spawn fishing boat`);
        return;
      }
      this.boat = this.input.owner.buildUnit(
        UnitType.FishingBoat,
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
      Math.floor(mg.config().warshipPatrolRange() / 2),
    );
    this.lastObservedPatrolTile = this.boat.warshipState().patrolTile;
    this.lastPayout = ticks;
  }

  tick(ticks: number): void {
    if (this.boat === undefined || !this.boat.isActive()) return;
    if (this.boat.health() <= 0) {
      this.boat.delete();
      return;
    }

    // Manual move order: the player re-set patrolTile.
    const patrolTile = this.boat.warshipState().patrolTile;
    if (patrolTile !== this.lastObservedPatrolTile) {
      this.lastObservedPatrolTile = patrolTile;
      this.patrol.resetWaypoint();
    }

    this.patrol.tick();

    // The catch comes in on a slow cadence.
    const config = this.mg.config();
    if (ticks - this.lastPayout >= config.fishingBoatIncomeIntervalTicks()) {
      this.lastPayout = ticks;
      this.boat.owner().addGold(config.fishingBoatIncome(), this.boat.tile());
    }
  }

  isActive(): boolean {
    return this.boat?.isActive() ?? false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

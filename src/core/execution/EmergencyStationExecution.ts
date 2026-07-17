import { Execution, Game, Structures, Unit } from "../game/Game";

/**
 * Emergency Station: disaster response.
 *
 *  - Repairs disabled structures (flood / landslide / EMP) in its radius, one
 *    at a time on a slow cadence, so a knocked-out district comes back on line
 *    but not instantly.
 *  - Its coverage also lowers the chance a localized disaster strikes there
 *    (checked by NaturalDisasterExecution) and keeps covered oil pumps from
 *    blowing up in heatwaves.
 *
 * Repairs cover the owner's and teammates' structures only.
 */
export class EmergencyStationExecution implements Execution {
  private mg: Game;
  private active = true;
  private lastRepairTick = 0;

  constructor(private station: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.lastRepairTick = ticks;
  }

  tick(ticks: number): void {
    if (!this.station.isActive()) {
      this.active = false;
      return;
    }
    if (
      this.station.isUnderConstruction() ||
      this.station.isDisabled() // a disabled station repairs nothing
    ) {
      return;
    }
    const interval = this.mg.config().emergencyStationRepairIntervalTicks();
    if (ticks - this.lastRepairTick < interval) {
      return;
    }
    const repaired = this.repairOne();
    if (repaired) {
      this.lastRepairTick = ticks;
    }
  }

  // Repair the nearest disabled friendly structure in radius. Returns whether
  // anything was repaired this attempt.
  private repairOne(): boolean {
    const owner = this.station.owner();
    const radius = this.mg.config().emergencyStationRadius();
    let best: Unit | null = null;
    let bestDist = Infinity;
    for (const { unit, distSquared } of this.mg.nearbyUnits(
      this.station.tile(),
      radius,
      Structures.types,
    )) {
      if (!unit.isActive() || !unit.isDisabled()) continue;
      const uo = unit.owner();
      if (uo !== owner && !uo.isOnSameTeam(owner)) continue;
      if (distSquared < bestDist) {
        bestDist = distSquared;
        best = unit;
      }
    }
    if (best === null) return false;
    best.clearDisable();
    return true;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

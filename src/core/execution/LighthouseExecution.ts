import { Execution, Game, Unit, UnitType } from "../game/Game";
import { WarshipCaptureTracker } from "./StructureCapture";

// Every ship type the lighthouse slowly heals.
const HEALABLE_SHIPS = [
  UnitType.Warship,
  UnitType.FishingBoat,
  UnitType.PatrolBoat,
  UnitType.Submarine,
  UnitType.AtomicSubmarine,
] as const;

/**
 * Lighthouse: coastal/offshore support structure with a very large radius
 * reaching well into the sea.
 *
 *  - Scans like a patrol boat: enemy submarines in radius are spotted.
 *  - Slowly heals the owner's (and teammates') ships in radius.
 *  - Built on open water it can be captured by enemy warships, exactly like
 *    sea oil pumps and toll stations.
 */
export class LighthouseExecution implements Execution {
  private mg: Game;
  private active = true;
  private lastHeal = 0;
  private readonly capture = new WarshipCaptureTracker();

  constructor(private lighthouse: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.lastHeal = ticks;
  }

  tick(ticks: number): void {
    if (!this.lighthouse.isActive()) {
      this.active = false;
      return;
    }
    if (this.lighthouse.isUnderConstruction() || this.lighthouse.isDisabled()) {
      return;
    }

    this.scanForSubmarines();

    const config = this.mg.config();
    if (ticks - this.lastHeal >= config.lighthouseHealIntervalTicks()) {
      this.lastHeal = ticks;
      this.healShips();
    }

    // Only an offshore lighthouse is reachable (and capturable) by warships.
    if (this.mg.isWater(this.lighthouse.tile())) {
      this.capture.tick(this.mg, this.lighthouse);
    }
  }

  private scanForSubmarines(): void {
    const config = this.mg.config();
    const owner = this.lighthouse.owner();
    const until = this.mg.ticks() + config.submarineSpottedDurationTicks();
    for (const { unit } of this.mg.nearbyUnits(
      this.lighthouse.tile(),
      config.lighthouseRadius(),
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

  private healShips(): void {
    const config = this.mg.config();
    const owner = this.lighthouse.owner();
    const heal = config.lighthouseHealPerInterval();
    for (const { unit } of this.mg.nearbyUnits(
      this.lighthouse.tile(),
      config.lighthouseRadius(),
      HEALABLE_SHIPS as unknown as UnitType[],
    )) {
      if (!unit.isActive() || !unit.hasHealth()) continue;
      const uo = unit.owner();
      if (uo !== owner && !uo.isOnSameTeam(owner)) continue;
      if (unit.health() >= unit.maxHealth()) continue;
      unit.modifyHealth(heal);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

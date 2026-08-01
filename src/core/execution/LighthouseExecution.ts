import { Execution, Game, Relation, Unit, UnitType } from "../game/Game";
import { ShellExecution } from "./ShellExecution";
import { WarshipCaptureTracker } from "./StructureCapture";

// Every ship type the lighthouse slowly heals (and speeds up).
const HEALABLE_SHIPS = [
  UnitType.Warship,
  UnitType.FishingBoat,
  UnitType.PatrolBoat,
  UnitType.Submarine,
  UnitType.AtomicSubmarine,
] as const;

// Everything the coastal battery is willing to shoot at.
const SHOOTABLE_SHIPS: UnitType[] = [
  UnitType.TransportShip,
  UnitType.Warship,
  UnitType.FishingBoat,
  UnitType.PatrolBoat,
  UnitType.Submarine,
  UnitType.AtomicSubmarine,
];

/** Widest radius any lighthouse can have — used to bound proximity queries. */
const MAX_LIGHTHOUSE_LEVEL = 5;

/**
 * Lighthouse: coastal/offshore support structure with a very large radius
 * reaching well into the sea. Stackable up to level 5; every level widens the
 * radius enormously and strengthens its guns.
 *
 *  - Scans like a patrol boat: enemy submarines in radius are spotted.
 *  - Coastal battery: shells enemy ships that come inside the radius.
 *  - Slowly heals — and noticeably speeds up — the owner's (and teammates')
 *    ships in radius.
 *  - Built on open water it can be captured by enemy warships, exactly like
 *    sea oil pumps and toll stations.
 */
export class LighthouseExecution implements Execution {
  private mg: Game;
  private active = true;
  private lastHeal = 0;
  private lastShell = 0;
  private readonly capture = new WarshipCaptureTracker();

  constructor(private lighthouse: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.lastHeal = ticks;
    this.lastShell = ticks;
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
    if (ticks - this.lastShell >= config.lighthouseShellAttackRate()) {
      const target = this.findGunTarget();
      if (target !== undefined) {
        this.lastShell = ticks;
        this.mg.addExecution(
          new ShellExecution(
            this.lighthouse.tile(),
            this.lighthouse.owner(),
            this.lighthouse,
            target,
            config.lighthouseShellDamage(this.lighthouse.level()),
          ),
        );
      }
    }

    // Only an offshore lighthouse is reachable (and capturable) by warships.
    if (this.mg.isWater(this.lighthouse.tile())) {
      this.capture.tick(this.mg, this.lighthouse);
    }
  }

  private radius(): number {
    return this.mg.config().lighthouseRadius(this.lighthouse.level());
  }

  private scanForSubmarines(): void {
    const config = this.mg.config();
    const owner = this.lighthouse.owner();
    const until = this.mg.ticks() + config.submarineSpottedDurationTicks();
    for (const { unit } of this.mg.nearbyUnits(
      this.lighthouse.tile(),
      this.radius(),
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
      this.radius(),
      HEALABLE_SHIPS as unknown as UnitType[],
    )) {
      if (!unit.isActive() || !unit.hasHealth()) continue;
      const uo = unit.owner();
      if (uo !== owner && !uo.isOnSameTeam(owner)) continue;
      if (unit.health() >= unit.maxHealth()) continue;
      unit.modifyHealth(heal);
    }
  }

  /**
   * Closest hostile ship inside the radius. The battery only opens fire on
   * players it is actually AT WAR with, so a lighthouse never starts a war on
   * its own; submarines have to be spotted first, exactly like for a warship.
   */
  private findGunTarget(): Unit | undefined {
    const owner = this.lighthouse.owner();
    let best: Unit | undefined;
    let bestDist = Infinity;
    for (const { unit, distSquared } of this.mg.nearbyUnits(
      this.lighthouse.tile(),
      this.radius(),
      SHOOTABLE_SHIPS,
    )) {
      if (!unit.isActive() || unit.owner() === owner) continue;
      if (!owner.canAttackPlayer(unit.owner(), true)) continue;
      if (owner.relation(unit.owner()) !== Relation.Hostile) continue;
      const type = unit.type();
      if (
        (type === UnitType.Submarine || type === UnitType.AtomicSubmarine) &&
        !unit.isTargetable()
      ) {
        continue;
      }
      if (distSquared < bestDist) {
        bestDist = distSquared;
        best = unit;
      }
    }
    return best;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

/**
 * Extra movement steps a ship gets this tick from friendly lighthouses: a
 * finished, enabled lighthouse of the ship's owner (or a teammate's) whose
 * radius actually reaches the ship. Own waters are fast waters.
 */
export function lighthouseSpeedBonus(mg: Game, ship: Unit): number {
  const config = mg.config();
  const maxRadius = config.lighthouseRadius(MAX_LIGHTHOUSE_LEVEL);
  const owner = ship.owner();
  for (const { unit, distSquared } of mg.nearbyUnits(ship.tile(), maxRadius, [
    UnitType.Lighthouse,
  ])) {
    if (!unit.isActive() || unit.isUnderConstruction() || unit.isDisabled()) {
      continue;
    }
    const lo = unit.owner();
    if (lo !== owner && !lo.isOnSameTeam(owner)) continue;
    const r = config.lighthouseRadius(unit.level());
    if (distSquared <= r * r) {
      return config.lighthouseSpeedBoostSteps();
    }
  }
  return 0;
}

import {
  Execution,
  Game,
  isUnit,
  OwnerComp,
  Player,
  Relation,
  Unit,
  UnitParams,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PathStatus } from "../pathfinding/types";
import { PseudoRandom } from "../PseudoRandom";
import { ShellExecution } from "./ShellExecution";
import { ShipPatrol } from "./ShipPatrol";
import { startWar } from "./StructureCapture";

/**
 * Submarines (normal + atomic). Both run silent — not targetable until a
 * patrol boat / lighthouse pings them (see UnitImpl.spot; the flag is cleared
 * here once the window expires). They patrol like warships and fire torpedoes
 * (shells) at enemy ships in range; warships are harder to hit (a torpedo can
 * miss), other ships rarely escape.
 *
 * The atomic submarine additionally
 *  - serves as a mobile missile silo (PlayerImpl.nukeSpawn considers it; the
 *    launch/reload cooldown mirrors MissileSiloExecution), and
 *  - can seize a single land tile when ordered ashore (like the ultra
 *    warship — see warshipState.landTargetTile).
 */
export class SubmarineExecution implements Execution {
  private mg: Game;
  private sub: Unit;
  private patrol: ShipPatrol;
  private pathfinder: WaterPathFinder;
  private random: PseudoRandom;
  private lastObservedPatrolTile: number | undefined;
  private lastTorpedo = 0;

  constructor(
    private subType: UnitType.Submarine | UnitType.AtomicSubmarine,
    private input:
      | (UnitParams<UnitType.Submarine> & OwnerComp)
      | Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (isUnit(this.input)) {
      this.sub = this.input;
    } else {
      const spawn = this.input.owner.canBuild(
        this.subType,
        this.input.patrolTile,
      );
      if (spawn === false) {
        console.warn(`Failed to spawn ${this.subType}`);
        return;
      }
      this.sub = this.input.owner.buildUnit(this.subType, spawn, this.input);
      this.input.owner.useOil(mg.config().oilCostPerShipLaunch());
    }
    this.random = new PseudoRandom(mg.ticks() + this.sub.id());
    this.pathfinder = new WaterPathFinder(mg);
    this.patrol = new ShipPatrol(
      mg,
      this.sub,
      this.pathfinder,
      this.random,
      mg.config().warshipPatrolRange(),
    );
    this.lastObservedPatrolTile = this.sub.warshipState().patrolTile;
  }

  tick(ticks: number): void {
    if (this.sub === undefined || !this.sub.isActive()) return;
    if (this.sub.health() <= 0) {
      this.sub.delete();
      return;
    }

    // Spotting window expired → dive again (not targetable).
    if (this.sub.isTargetable() && ticks > this.sub.spottedUntilTick()) {
      this.sub.setTargetable(false);
    }

    // Atomic sub: reload fired missiles like a silo does.
    if (this.subType === UnitType.AtomicSubmarine) {
      this.reloadMissiles();
      if (this.captureOrderedLand()) return;
    }

    const patrolTile = this.sub.warshipState().patrolTile;
    if (patrolTile !== this.lastObservedPatrolTile) {
      this.lastObservedPatrolTile = patrolTile;
      this.patrol.resetWaypoint();
    }

    this.fireTorpedo(ticks);
    this.patrol.tick();
  }

  // Torpedo run: pick the closest enemy ship in range and fire. Warships are
  // harder to hit; a missed torpedo simply fizzles. Fishing and patrol boats
  // are only fair game when at war (and patrol boats only up close).
  private fireTorpedo(ticks: number): void {
    const config = this.mg.config();
    if (ticks - this.lastTorpedo < config.submarineAttackRate()) return;
    const target = this.findTarget();
    if (target === undefined) return;
    this.lastTorpedo = ticks;
    this.sub.updateWarshipState({ isInCombat: true });

    const vsWarship = target.type() === UnitType.Warship;
    const hitPercent = vsWarship
      ? config.submarineHitPercentVsWarship()
      : config.submarineHitPercent();
    if (this.random.nextInt(0, 100) >= hitPercent) {
      return; // torpedo missed
    }
    const damageMultiplier =
      this.subType === UnitType.AtomicSubmarine ? 1.6 : 1;
    this.mg.addExecution(
      new ShellExecution(
        this.sub.tile(),
        this.sub.owner(),
        this.sub,
        target,
        damageMultiplier,
      ),
    );
  }

  private findTarget(): Unit | undefined {
    const config = this.mg.config();
    const owner = this.sub.owner();
    const patrolBoatRange2 = config.patrolBoatMaxTargetRange() ** 2;
    let best: Unit | undefined;
    let bestDist = Infinity;
    for (const { unit, distSquared } of this.mg.nearbyUnits(
      this.sub.tile(),
      config.warshipTargettingRange(),
      [
        UnitType.Warship,
        UnitType.TransportShip,
        UnitType.TradeShip,
        UnitType.FishingBoat,
        UnitType.PatrolBoat,
      ],
    )) {
      if (!unit.isActive() || unit.owner() === owner) continue;
      if (!owner.canAttackPlayer(unit.owner(), true)) continue;
      const type = unit.type();
      // Harmless boats are only attacked when actually at war…
      if (
        (type === UnitType.FishingBoat || type === UnitType.PatrolBoat) &&
        owner.relation(unit.owner()) !== Relation.Hostile
      ) {
        continue;
      }
      // …and patrol boats only from point-blank range, so a submarine can't
      // snipe its own counter from across the map.
      if (type === UnitType.PatrolBoat && distSquared > patrolBoatRange2) {
        continue;
      }
      if (distSquared < bestDist) {
        bestDist = distSquared;
        best = unit;
      }
    }
    return best;
  }

  // Mirror of MissileSiloExecution's reload loop.
  private reloadMissiles(): void {
    const cooldown = this.mg.config().SiloCooldown();
    const queue = this.sub.missileTimerQueue();
    if (queue.length > 0 && this.mg.ticks() - queue[0] >= cooldown) {
      this.sub.reloadMissile();
    }
  }

  // Ordered ashore: sail next to the target land tile and seize exactly that
  // tile. Seizing another player's land starts the war.
  private captureOrderedLand(): boolean {
    const landTile = this.sub.warshipState().landTargetTile;
    if (landTile === undefined) return false;
    if (!this.mg.isLand(landTile)) {
      this.sub.updateWarshipState({ landTargetTile: undefined });
      return false;
    }
    if (this.mg.manhattanDist(this.sub.tile(), landTile) <= 2) {
      seizeLandTile(this.mg, this.sub.owner(), landTile);
      this.sub.updateWarshipState({ landTargetTile: undefined });
      return true;
    }
    const result = this.pathfinder.next(this.sub.tile(), landTile);
    if (result.status === PathStatus.NOT_FOUND) {
      this.sub.updateWarshipState({ landTargetTile: undefined });
    } else {
      this.sub.move(result.node);
    }
    return true;
  }

  isActive(): boolean {
    return this.sub?.isActive() ?? false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

/** Seize a single land tile; taking it from another player starts the war. */
export function seizeLandTile(mg: Game, owner: Player, tile: TileRef): void {
  const prev = mg.owner(tile);
  if (prev.isPlayer()) {
    if (prev === owner || !owner.canAttackPlayer(prev as Player, true)) {
      return;
    }
    startWar(owner, prev as Player);
  }
  owner.conquer(tile);
}

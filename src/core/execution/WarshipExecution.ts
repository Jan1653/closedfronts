import {
  Execution,
  Game,
  isUnit,
  OwnerComp,
  Relation,
  SHIP_CLASS_DAMAGE,
  Unit,
  UnitParams,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PathStatus } from "../pathfinding/types";
import { PseudoRandom } from "../PseudoRandom";
import { findMinimumBy } from "../Util";
import { ShellExecution } from "./ShellExecution";
import { CAPTURE_RANGE } from "./StructureCapture";
import { seizeLandTile } from "./SubmarineExecution";

export class WarshipExecution implements Execution {
  private random: PseudoRandom;
  private warship: Unit;
  private mg: Game;
  private pathfinder: WaterPathFinder;
  private lastShellAttack = 0;
  private alreadySentShell = new Set<Unit>();
  private lastManualMoveTickRetreatDisabled = 0;
  private lastObservedPatrolTile: TileRef | undefined;
  // Last tick the warship actually moved, for the oil throttle below.
  private lastMoveTick = -Infinity;
  private activeHealingRemainder = 0;
  private lastEmittedCombat = false;

  constructor(
    private input: (UnitParams<UnitType.Warship> & OwnerComp) | Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathfinder = new WaterPathFinder(mg);
    this.random = new PseudoRandom(mg.ticks());
    if (isUnit(this.input)) {
      this.warship = this.input;
    } else {
      const owner = this.input.owner;
      const shipClass = this.input.shipClass ?? "normal";
      // The hull class has its own full price; buildUnit charges the base
      // warship price, the difference is collected here. Refuse the build if
      // the full class price isn't affordable.
      const classCost = mg.config().warshipClassCost(shipClass, owner);
      const baseCost = mg
        .config()
        .unitInfo(UnitType.Warship)
        .cost(mg, owner);
      if (owner.gold() < classCost) {
        console.warn(`cannot afford ${shipClass} warship`);
        return;
      }
      const spawn = owner.canBuild(UnitType.Warship, this.input.patrolTile);
      if (spawn === false) {
        console.warn(
          `Failed to spawn warship for ${owner.name()} at ${this.input.patrolTile}`,
        );
        return;
      }
      this.warship = owner.buildUnit(UnitType.Warship, spawn, this.input);
      if (classCost > baseCost) {
        owner.removeGold(classCost - baseCost);
      }
      // Launching a warship burns a little fuel.
      owner.useOil(mg.config().oilCostPerShipLaunch());
    }
    this.lastObservedPatrolTile = this.warship.warshipState().patrolTile;
  }

  tick(ticks: number): void {
    if (this.warship.health() <= 0) {
      this.warship.delete();
      return;
    }
    const isInCombat = this.warship.warshipState().isInCombat ?? false;
    if (this.lastEmittedCombat && !isInCombat) {
      this.warship.touch();
    }
    this.lastEmittedCombat = isInCombat;
    const healthBeforeHealing = this.warship.health();

    this.healWarship();
    this.handleManualPatrolOverride();

    if (this.warship.warshipState().state === "docked") {
      if (this.currentRetreatPort() === undefined) {
        this.cancelRepairRetreat();
      }
      if (this.isFullyHealed()) {
        this.cancelRepairRetreat();
      }
      if (this.warship.warshipState().state === "docked") {
        return;
      }
    }

    if (this.handleRepairRetreat()) {
      return;
    }

    // Priority 1: Check if need to heal before doing anything else
    if (this.shouldStartRepairRetreat(healthBeforeHealing)) {
      this.startRepairRetreat();
      if (this.handleRepairRetreat()) {
        return;
      }
    }

    this.warship.setTargetUnit(this.findTargetUnit());

    // Priority 1+2: Shoot any shootable target in range (transports first,
    // then warships/spotted submarines, then — at war — fishing/patrol
    // boats; see findBestTarget's priorities). Trade ships are captured, not
    // shot (below).
    const targetType = this.warship.targetUnit()?.type();
    if (targetType !== undefined && targetType !== UnitType.TradeShip) {
      this.shootTarget();
      this.patrol();
      return;
    }

    // Priority 2.5: an ultra warship ordered ashore seizes its land tile.
    if (this.handleLandCapture()) {
      return;
    }

    // Priority 3: An explicit capture order (player clicked an enemy water
    // structure) — sail there and hold, don't get distracted by trade ships.
    const orderedTarget = this.explicitCaptureTarget();
    if (orderedTarget !== undefined) {
      this.moveToCapture(orderedTarget);
      return;
    }

    // Priority 4: Hunt trade ship only if not healing and no enemy warship
    if (this.warship.targetUnit()?.type() === UnitType.TradeShip) {
      this.huntDownTradeShip();
      return;
    }

    // Priority 5: Sail to and hold next to a capturable enemy water structure
    // (sea oil pump / toll station). The structure's own execution runs the
    // 60-tick capture timer once we're within CAPTURE_RANGE; wandering off on a
    // random patrol would keep resetting it, so approach and then hold. Only
    // structures of owners we are AT WAR with are seized automatically —
    // neutral ones need an explicit order (priority 3).
    const captureTarget = this.findCapturableStructure();
    if (captureTarget !== undefined) {
      this.moveToCapture(captureTarget);
      return;
    }

    this.patrol();
  }

  /**
   * Ultra-class only: ordered ashore (landTargetTile), sail next to the tile
   * and seize exactly that one tile. Returns true while the order is running.
   */
  private handleLandCapture(): boolean {
    const state = this.warship.warshipState();
    const landTile = state.landTargetTile;
    if (landTile === undefined) return false;
    if (state.shipClass !== "ultra" || !this.mg.isLand(landTile)) {
      this.warship.updateWarshipState({ landTargetTile: undefined });
      return false;
    }
    if (this.mg.manhattanDist(this.warship.tile(), landTile) <= 2) {
      seizeLandTile(this.mg, this.warship.owner(), landTile);
      this.warship.updateWarshipState({ landTargetTile: undefined });
      return true;
    }
    const result = this.pathfinder.next(this.warship.tile(), landTile);
    if (result.status === PathStatus.NOT_FOUND) {
      this.warship.updateWarshipState({ landTargetTile: undefined });
    } else {
      this.moveWarship(result.node);
    }
    return true;
  }

  /**
   * The structure this warship was explicitly ordered to capture, if it is
   * still a valid target. Clears a stale order (target destroyed, captured, or
   * became friendly) so the ship returns to normal duty.
   */
  private explicitCaptureTarget(): Unit | undefined {
    const targetId = this.warship.warshipState().captureTargetId;
    if (targetId === undefined) return undefined;
    const unit = this.mg.unit(targetId);
    const owner = this.warship.owner();
    if (
      unit === undefined ||
      !unit.isActive() ||
      unit.owner() === owner ||
      unit.owner().isFriendly(owner) ||
      unit.owner().isOnSameTeam(owner) ||
      !this.mg.isWater(unit.tile())
    ) {
      this.warship.updateWarshipState({ captureTargetId: undefined });
      return undefined;
    }
    // Skip structures on a disconnected body of water we can't sail to.
    const warshipComponent = this.mg.getWaterComponent(this.warship.tile());
    if (
      warshipComponent !== null &&
      !this.mg.hasWaterComponent(unit.tile(), warshipComponent)
    ) {
      this.warship.updateWarshipState({ captureTargetId: undefined });
      return undefined;
    }
    return unit;
  }

  private healWarship(): void {
    const owner = this.warship.owner();
    // A doomed side (below the Doomsday Clock bar) cannot repair its navy, so the
    // decay in DoomsdayClockExecution actually sinks warships instead of being
    // out-healed at a port. Inert when the mode is off: the mark is never set.
    if (owner.inDoomsdayClock()) return;
    const passiveHealing = this.mg.config().warshipPassiveHealing();
    const passiveHealingRange = this.mg.config().warshipPassiveHealingRange();
    const passiveHealingRangeSquared =
      passiveHealingRange * passiveHealingRange;
    const warshipTile = this.warship.tile();

    let isNearPort = false;
    for (const port of owner.units(UnitType.Port)) {
      const distSquared = this.mg.euclideanDistSquared(
        warshipTile,
        port.tile(),
      );
      if (distSquared <= passiveHealingRangeSquared) {
        isNearPort = true;
        break;
      }
    }

    if (isNearPort) {
      this.warship.modifyHealth(passiveHealing);
    }

    if (this.warship.warshipState().state === "docked") {
      this.applyActiveDockedHealing();
    }
  }

  private isFullyHealed(): boolean {
    if (!this.warship.hasHealth()) {
      return true;
    }
    return this.warship.health() >= this.warship.maxHealth();
  }

  private shouldStartRepairRetreat(
    healthBeforeHealing = this.warship.health(),
  ): boolean {
    if (this.warship.warshipState().state !== "patrolling") {
      return false;
    }
    const manualMoveRetreatDisabledDuration = 50;
    if (
      this.mg.ticks() - this.lastManualMoveTickRetreatDisabled <
      manualMoveRetreatDisabledDuration
    ) {
      return false;
    }
    // Percentage of (veterancy-adjusted) max health, so a tougher veteran ship
    // retreats at the same relative health as a fresh one. Integer math.
    const retreatThreshold = Math.floor(
      (this.warship.maxHealth() *
        this.mg.config().warshipRetreatHealthPercent()) /
        100,
    );
    if (healthBeforeHealing >= retreatThreshold) {
      return false;
    }
    const ports = this.warship.owner().units(UnitType.Port);
    return ports.length > 0;
  }

  private findNearestPort(): TileRef | undefined {
    const ports = this.warship.owner().units(UnitType.Port);
    if (ports.length === 0) {
      return undefined;
    }

    const warshipTile = this.warship.tile();
    const warshipComponent = this.mg.getWaterComponent(warshipTile);
    if (warshipComponent === null) {
      throw new Error(`Warship at tile ${warshipTile} has no water component`);
    }

    const nearest = findMinimumBy(
      ports,
      (port) => this.mg.euclideanDistSquared(warshipTile, port.tile()),
      (port) => {
        const portComponent = this.mg.getWaterComponent(port.tile());
        if (portComponent === null) {
          throw new Error(`Port at tile ${port.tile()} has no water component`);
        }
        return portComponent === warshipComponent;
      },
    );

    return nearest?.tile();
  }

  private findRetreatAggroTarget(): Unit | undefined {
    return this.findBestTarget([UnitType.TransportShip, UnitType.Warship]);
  }

  private findTargetUnit(): Unit | undefined {
    return this.findBestTarget(
      [
        UnitType.TransportShip,
        UnitType.Warship,
        UnitType.Submarine,
        UnitType.AtomicSubmarine,
        UnitType.TradeShip,
        UnitType.FishingBoat,
        UnitType.PatrolBoat,
      ],
      true,
    );
  }

  /**
   * Shared target selection: searches nearby units of given types,
   * filters common exclusions (self, friendly, docked, already-shelled),
   * picks best by type priority (lower index = higher priority) then distance.
   *
   * When `includeTradeShips` is true, applies trade-ship-specific filters
   * (safe from pirates, patrol range, water component, allied destination).
   */
  private findBestTarget(
    types: UnitType[],
    includeTradeShips = false,
  ): Unit | undefined {
    const mg = this.mg;
    const config = mg.config();
    const owner = this.warship.owner();

    const ships = mg.nearbyUnits(
      this.warship.tile(),
      config.warshipTargettingRange(),
      types,
    );

    // Trade-ship-specific state, lazily computed.
    let hasPort: boolean | undefined;
    let patrolTile: number | undefined;
    let patrolRangeSquared: number | undefined;
    let warshipComponent: number | null | undefined = undefined;

    let bestUnit: Unit | undefined = undefined;
    let bestTypePriority = 0;
    let bestDistSquared = 0;

    for (const { unit, distSquared } of ships) {
      if (
        unit === this.warship ||
        unit.owner() === owner ||
        !owner.canAttackPlayer(unit.owner(), true) ||
        this.alreadySentShell.has(unit) ||
        (unit.type() === UnitType.Warship &&
          unit.warshipState().state === "docked")
      ) {
        continue;
      }

      const type = unit.type();

      // Submarines run silent: only shootable while spotted by a patrol
      // boat / lighthouse ping.
      if (
        (type === UnitType.Submarine || type === UnitType.AtomicSubmarine) &&
        !unit.isTargetable()
      ) {
        continue;
      }
      // Harmless boats are only attacked when actually at war — and patrol
      // boats only from very close range (they're the submarine counter and
      // must not be sniped from afar).
      if (type === UnitType.FishingBoat || type === UnitType.PatrolBoat) {
        if (owner.relation(unit.owner()) !== Relation.Hostile) {
          continue;
        }
        if (
          type === UnitType.PatrolBoat &&
          distSquared > config.patrolBoatMaxTargetRange() ** 2
        ) {
          continue;
        }
      }

      if (includeTradeShips && type === UnitType.TradeShip) {
        if (hasPort === undefined) {
          hasPort = owner.unitCount(UnitType.Port) > 0;
          patrolTile = this.warship.warshipState().patrolTile;
          patrolRangeSquared = config.warshipPatrolRange() ** 2;
        }
        if (
          !hasPort ||
          patrolTile === undefined ||
          unit.isSafeFromPirates() ||
          unit.targetUnit()?.owner() === owner ||
          unit.targetUnit()?.owner().isFriendly(owner)
        ) {
          continue;
        }
        if (warshipComponent === undefined) {
          warshipComponent = mg.getWaterComponent(this.warship.tile());
        }
        if (
          warshipComponent !== null &&
          !mg.hasWaterComponent(unit.tile(), warshipComponent)
        ) {
          continue;
        }
        if (
          mg.euclideanDistSquared(patrolTile, unit.tile()) > patrolRangeSquared!
        ) {
          continue;
        }
      }

      const typePriority =
        type === UnitType.TransportShip
          ? 0
          : type === UnitType.Warship ||
              type === UnitType.Submarine ||
              type === UnitType.AtomicSubmarine
            ? 1
            : type === UnitType.TradeShip
              ? 2
              : 3; // fishing / patrol boats last

      if (
        bestUnit === undefined ||
        typePriority < bestTypePriority ||
        (typePriority === bestTypePriority && distSquared < bestDistSquared)
      ) {
        bestUnit = unit;
        bestTypePriority = typePriority;
        bestDistSquared = distSquared;
      }
    }

    return bestUnit;
  }

  /**
   * Nearest enemy water structure (sea oil pump or toll station) this warship is
   * allowed to attack, within targetting range and reachable across the same
   * body of water. Land oil pumps sit on owned land out of a ship's reach and
   * are skipped; friendly/teammate owners are never targeted. Returns undefined
   * if there is nothing to seize.
   */
  private findCapturableStructure(): Unit | undefined {
    const owner = this.warship.owner();
    const range = this.mg.config().warshipTargettingRange();
    const warshipComponent = this.mg.getWaterComponent(this.warship.tile());
    let best: Unit | undefined = undefined;
    let bestDistSquared = 0;
    for (const { unit, distSquared } of this.mg.nearbyUnits(
      this.warship.tile(),
      range,
      [UnitType.OilPump, UnitType.WaterTollStation, UnitType.Lighthouse],
    )) {
      if (
        !unit.isActive() ||
        unit.isUnderConstruction() ||
        unit.owner() === owner ||
        !owner.canAttackPlayer(unit.owner(), true) ||
        // Auto-seizure only against owners we are at war with; neutral
        // structures need an explicit capture order.
        owner.relation(unit.owner()) !== Relation.Hostile
      ) {
        continue;
      }
      // Only structures standing on open water are reachable by a warship.
      if (unit.type() === UnitType.OilPump && !this.mg.isWater(unit.tile())) {
        continue;
      }
      // Skip structures on a disconnected body of water we can't sail to.
      if (
        warshipComponent !== null &&
        !this.mg.hasWaterComponent(unit.tile(), warshipComponent)
      ) {
        continue;
      }
      if (best === undefined || distSquared < bestDistSquared) {
        best = unit;
        bestDistSquared = distSquared;
      }
    }
    return best;
  }

  /**
   * Approach `structure` and hold once within CAPTURE_RANGE so its execution's
   * capture timer can fill. Uses greedy stepping when close (upscaled minimap
   * paths converge poorly at short range) and the pathfinder otherwise.
   */
  private moveToCapture(structure: Unit): void {
    this.warship.updateWarshipState({ isInCombat: true });
    const structTile = structure.tile();
    const dist = this.mg.manhattanDist(this.warship.tile(), structTile);
    if (dist <= CAPTURE_RANGE) {
      return; // in range — hold position and let the capture timer run
    }
    if (dist <= 20) {
      const nextTile = this.bestNeighborToward(structTile);
      if (nextTile !== undefined) {
        this.moveWarship(nextTile);
        return;
      }
    }
    const result = this.pathfinder.next(this.warship.tile(), structTile);
    switch (result.status) {
      case PathStatus.COMPLETE:
      case PathStatus.NEXT:
        this.moveWarship(result.node);
        break;
      case PathStatus.NOT_FOUND:
        break;
    }
  }

  private startRepairRetreat(): void {
    const portTile = this.findNearestPort();
    if (portTile === undefined) {
      return;
    }
    this.warship.updateWarshipState({
      retreatPort: portTile,
      state: "retreating",
    });
    this.activeHealingRemainder = 0;
    this.warship.setTargetUnit(undefined);
  }

  private cancelRepairRetreat(clearTargetTile = true): void {
    this.activeHealingRemainder = 0;
    this.warship.updateWarshipState({
      state: "patrolling",
      retreatPort: undefined,
    });
    if (clearTargetTile) {
      this.warship.setTargetTile(undefined);
    }
  }

  private handleManualPatrolOverride(): void {
    const patrolTile = this.warship.warshipState().patrolTile;
    if (
      this.lastObservedPatrolTile !== undefined &&
      patrolTile !== this.lastObservedPatrolTile
    ) {
      this.lastManualMoveTickRetreatDisabled = this.mg.ticks();
      if (this.warship.warshipState().state !== "patrolling") {
        this.cancelRepairRetreat(false);
      }
    }
    this.lastObservedPatrolTile = patrolTile;
  }

  private handleRepairRetreat(): boolean {
    if (this.warship.warshipState().state === "patrolling") {
      return false;
    }

    const retreatAggroTarget = this.findRetreatAggroTarget();
    if (retreatAggroTarget) {
      this.warship.setTargetUnit(retreatAggroTarget);
      this.shootTarget();
      // Fall through — continue retreating toward port even while firing back.
    }

    if (!this.refreshRetreatPortTile()) {
      this.cancelRepairRetreat();
      return false;
    }

    // Only clear the target when there's no active aggro target this tick.
    if (!retreatAggroTarget) {
      this.warship.setTargetUnit(undefined);
    }

    const retreatPortTile = this.warship.warshipState().retreatPort;
    if (retreatPortTile === undefined) {
      return false;
    }

    const dockingRadius = this.mg.config().warshipDockingRange();
    const dockingRadiusSq = dockingRadius * dockingRadius;
    const distToPort = this.mg.euclideanDistSquared(
      this.warship.tile(),
      retreatPortTile,
    );

    if (distToPort <= dockingRadiusSq) {
      // Check if the port has capacity available (excluding this warship from capacity check)
      const port = this.warship
        .owner()
        .units(UnitType.Port)
        .find((p) => p.tile() === retreatPortTile);
      if (port && !this.isPortFullOfHealing(port, this.warship)) {
        // Port has capacity - dock here
        this.warship.setTargetTile(undefined);
        this.warship.updateWarshipState({
          state: "docked",
        });
        return true;
      } else {
        // Port is full - wait near port, but leave if already fully healed
        if (this.isFullyHealed()) {
          this.cancelRepairRetreat();
          return false;
        }
        return true;
      }
    }

    this.warship.setTargetTile(retreatPortTile);
    const result = this.pathfinder.next(this.warship.tile(), retreatPortTile);
    switch (result.status) {
      case PathStatus.COMPLETE:
        this.moveWarship(result.node);
        if (result.node === retreatPortTile) {
          this.warship.setTargetTile(undefined);
        }
        break;
      case PathStatus.NEXT:
        this.moveWarship(result.node);
        break;
      case PathStatus.NOT_FOUND: {
        const newPort = this.findNearestAvailablePortTile();
        this.warship.updateWarshipState({
          retreatPort: newPort,
        });
        if (newPort === undefined) {
          this.cancelRepairRetreat();
        }
        break;
      }
    }

    return true;
  }

  private refreshRetreatPortTile(): boolean {
    const ports = this.warship.owner().units(UnitType.Port);
    if (ports.length === 0) {
      return false;
    }

    const currentRetreatPort = this.warship.warshipState().retreatPort;

    // Check if current retreat port still exists
    const currentPortExists =
      currentRetreatPort !== undefined &&
      ports.some((port) => port.tile() === currentRetreatPort);

    if (!currentPortExists) {
      const newPort = this.findNearestAvailablePortTile();
      this.warship.updateWarshipState({
        retreatPort: newPort,
      });
      return newPort !== undefined;
    }

    // Check if current port is now full of healing (not counting arrived warships)
    const currentPort = ports.find((p) => p.tile() === currentRetreatPort);
    if (currentPort && this.isPortFullOfHealing(currentPort)) {
      // Current port is at healing capacity, look for alternatives
      const alternativePort = this.findNearestAvailablePort();
      if (alternativePort) {
        this.warship.updateWarshipState({
          retreatPort: alternativePort,
        });
      }
      return this.warship.warshipState().retreatPort !== undefined;
    }

    // Check if a significantly closer port is available
    const closerPort = this.findBetterPortTile();
    if (closerPort && closerPort !== currentRetreatPort) {
      this.warship.updateWarshipState({
        retreatPort: closerPort,
      });
      return true;
    }

    return true;
  }

  private isPortFullOfHealing(port: Unit, excludeShip?: Unit): boolean {
    const maxShipsHealing = port.level();
    return this.dockedShipsAtPort(port, excludeShip).length >= maxShipsHealing;
  }

  private dockedShipsAtPort(port: Unit, excludeShip?: Unit): Unit[] {
    const dockingRadius = this.mg.config().warshipDockingRange();
    const owner = this.warship.owner();

    return this.mg
      .nearbyUnits(port.tile(), dockingRadius, [UnitType.Warship])
      .filter(({ unit: ship }) => {
        if (excludeShip && ship === excludeShip) return false;
        if (ship.owner() !== owner) return false;
        if (ship.warshipState().state === "patrolling") return false;
        if (ship.targetTile() !== undefined) return false;
        return true;
      })
      .map(({ unit }) => unit);
  }

  private applyActiveDockedHealing(): void {
    const dockedPort = this.currentRetreatPort();
    if (!dockedPort) {
      return;
    }

    const dockedShips = this.dockedShipsAtPort(dockedPort);
    if (!dockedShips.some((ship) => ship === this.warship)) {
      return;
    }

    const healingPool =
      dockedPort.level() * this.mg.config().warshipPortHealingBonusPerLevel();
    if (healingPool <= 0 || dockedShips.length === 0) {
      return;
    }

    // Preserve fractional split healing over time with a per-ship remainder.
    const activeHealing = healingPool / dockedShips.length;
    this.activeHealingRemainder += activeHealing;
    const integerHealing = Math.floor(this.activeHealingRemainder);
    if (integerHealing <= 0) {
      return;
    }

    this.activeHealingRemainder -= integerHealing;
    this.warship.modifyHealth(integerHealing);
  }

  private currentRetreatPort(): Unit | undefined {
    const retreatPort = this.warship.warshipState().retreatPort;
    if (retreatPort === undefined) {
      return undefined;
    }

    return this.warship
      .owner()
      .units(UnitType.Port)
      .find((port) => port.tile() === retreatPort);
  }

  private nearestAvailablePortTile(
    excludeShip?: Unit,
  ): { tile: TileRef; distSquared: number } | undefined {
    const ports = this.warship.owner().units(UnitType.Port);
    const warshipTile = this.warship.tile();
    const warshipComponent = this.mg.getWaterComponent(warshipTile);
    if (warshipComponent === null) {
      throw new Error(`Warship at tile ${warshipTile} has no water component`);
    }

    let bestTile: TileRef | undefined = undefined;
    let bestDistance = Infinity;

    for (const port of ports) {
      if (this.isPortFullOfHealing(port, excludeShip)) {
        continue;
      }

      const portTile = port.tile();
      if (!this.mg.hasWaterComponent(portTile, warshipComponent)) {
        continue;
      }

      const distance = this.mg.euclideanDistSquared(warshipTile, portTile);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestTile = portTile;
      }
    }

    return bestTile !== undefined
      ? { tile: bestTile, distSquared: bestDistance }
      : undefined;
  }

  private findNearestAvailablePort(): TileRef | undefined {
    return this.nearestAvailablePortTile()?.tile;
  }

  private findBetterPortTile(): TileRef | undefined {
    const result = this.nearestAvailablePortTile();
    if (!result) return undefined;

    let currentDistance = Infinity;
    const currentRetreatPort = this.warship.warshipState().retreatPort;
    if (currentRetreatPort !== undefined) {
      currentDistance = this.mg.euclideanDistSquared(
        this.warship.tile(),
        currentRetreatPort,
      );
    }

    if (
      result.distSquared <
      currentDistance * this.mg.config().warshipPortSwitchThreshold()
    ) {
      return result.tile;
    }
    return undefined;
  }

  private findNearestAvailablePortTile(): TileRef | undefined {
    return this.nearestAvailablePortTile(this.warship)?.tile;
  }

  private shootTarget() {
    this.warship.updateWarshipState({ isInCombat: true });
    const shellAttackRate = this.mg.config().warshipShellAttackRate();
    if (this.mg.ticks() - this.lastShellAttack > shellAttackRate) {
      if (this.warship.targetUnit()?.type() !== UnitType.TransportShip) {
        // Warships don't need to reload when attacking transport ships.
        this.lastShellAttack = this.mg.ticks();
      }
      this.mg.addExecution(
        new ShellExecution(
          this.warship.tile(),
          this.warship.owner(),
          this.warship,
          this.warship.targetUnit()!,
          SHIP_CLASS_DAMAGE[
            this.warship.warshipState().shipClass ?? "normal"
          ] ?? 1,
        ),
      );
      if (!this.warship.targetUnit()!.hasHealth()) {
        // Don't send multiple shells to target that can be oneshotted
        this.alreadySentShell.add(this.warship.targetUnit()!);
        this.warship.setTargetUnit(undefined);
        return;
      }
    }
  }

  private huntDownTradeShip() {
    this.warship.updateWarshipState({ isInCombat: true });
    for (let i = 0; i < 2; i++) {
      const target = this.warship.targetUnit()!;
      const targetTile = target.tile();
      const dist = this.mg.manhattanDist(this.warship.tile(), targetTile);

      if (dist <= 5) {
        this.warship.owner().captureUnit(target);
        this.warship.recordTradeCapture();
        this.warship.setTargetUnit(undefined);
        this.warship.touch();
        return;
      }

      // When close, the minimap (2x scale) produces diagonal upscaled paths that
      // make it hard to converge. Use direct greedy movement instead.
      if (dist <= 20) {
        const nextTile = this.bestNeighborToward(targetTile);
        if (nextTile !== undefined) {
          this.moveWarship(nextTile);
          continue;
        }
      }

      const result = this.pathfinder.next(this.warship.tile(), targetTile, 5);
      switch (result.status) {
        case PathStatus.COMPLETE:
          this.warship.owner().captureUnit(target);
          this.warship.recordTradeCapture();
          this.warship.setTargetUnit(undefined);
          this.warship.touch();
          return;
        case PathStatus.NEXT:
          this.moveWarship(result.node);
          break;
        case PathStatus.NOT_FOUND:
          console.log(`path not found to target`);
          break;
      }
    }
  }

  private bestNeighborToward(targetTile: TileRef): TileRef | undefined {
    const warshipTile = this.warship.tile();
    let best: TileRef | undefined;
    let bestDist = this.mg.manhattanDist(warshipTile, targetTile);
    this.mg.forEachNeighbor(warshipTile, (neighbor) => {
      if (!this.mg.isWater(neighbor)) return;
      const d = this.mg.manhattanDist(neighbor, targetTile);
      if (d < bestDist) {
        bestDist = d;
        best = neighbor;
      }
    });
    return best;
  }

  // Movement throttle: an owner with an empty oil tank moves its warships less
  // often (oilAdjustedTicksPerMove is 1 at full oil, so no effect there). Firing
  // is unaffected — a stranded warship still shoots, it just repositions slowly.
  private moveWarship(tile: TileRef): void {
    const ticksPerMove = this.mg
      .config()
      .oilAdjustedTicksPerMove(1, this.warship.owner());
    // Only throttle when oil-starved (ticksPerMove > 1). At full oil this is 1,
    // so we don't cap the warship's normal multi-tile moves per tick (e.g. the
    // greedy trade-ship pursuit).
    if (ticksPerMove > 1) {
      if (this.mg.ticks() - this.lastMoveTick < ticksPerMove) return;
      this.lastMoveTick = this.mg.ticks();
    }
    this.warship.move(tile);
  }

  private patrol() {
    if (this.warship.targetTile() === undefined) {
      this.warship.setTargetTile(this.randomTile());
      if (this.warship.targetTile() === undefined) {
        return;
      }
    }

    const result = this.pathfinder.next(
      this.warship.tile(),
      this.warship.targetTile()!,
    );
    switch (result.status) {
      case PathStatus.COMPLETE:
        this.warship.setTargetTile(undefined);
        this.moveWarship(result.node);
        break;
      case PathStatus.NEXT:
        this.moveWarship(result.node);
        break;
      case PathStatus.NOT_FOUND: {
        console.log(`path not found to target`);
        this.warship.setTargetTile(undefined);
        break;
      }
    }
  }

  isActive(): boolean {
    return this.warship?.isActive();
  }

  isDocked(): boolean {
    return (this.warship?.warshipState().state ?? "patrolling") === "docked";
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  randomTile(allowShoreline: boolean = false): TileRef | undefined {
    let warshipPatrolRange = this.mg.config().warshipPatrolRange();
    const maxAttemptBeforeExpand: number = 500;
    let attempts: number = 0;
    let expandCount: number = 0;

    // Get warship's water component for connectivity check
    const warshipComponent = this.mg.getWaterComponent(this.warship.tile());

    const patrolTile = this.warship.warshipState().patrolTile;
    if (patrolTile === undefined) {
      return undefined;
    }

    while (expandCount < 3) {
      const x =
        this.mg.x(patrolTile) +
        this.random.nextInt(-warshipPatrolRange / 2, warshipPatrolRange / 2);
      const y =
        this.mg.y(patrolTile) +
        this.random.nextInt(-warshipPatrolRange / 2, warshipPatrolRange / 2);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (
        !this.mg.isWater(tile) ||
        (!allowShoreline && this.mg.isShoreline(tile))
      ) {
        attempts++;
        if (attempts === maxAttemptBeforeExpand) {
          expandCount++;
          attempts = 0;
          warshipPatrolRange =
            warshipPatrolRange + Math.floor(warshipPatrolRange / 2);
        }
        continue;
      }
      // Check water component connectivity
      if (
        warshipComponent !== null &&
        !this.mg.hasWaterComponent(tile, warshipComponent)
      ) {
        attempts++;
        if (attempts === maxAttemptBeforeExpand) {
          expandCount++;
          attempts = 0;
          warshipPatrolRange =
            warshipPatrolRange + Math.floor(warshipPatrolRange / 2);
        }
        continue;
      }
      return tile;
    }
    console.warn(
      `Failed to find random tile for warship for ${this.warship.owner().name()}`,
    );
    if (!allowShoreline) {
      // If we failed to find a tile on the ocean, try again but allow shoreline
      return this.randomTile(true);
    }
    return undefined;
  }
}

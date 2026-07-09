import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { tollStationConnections } from "../game/TollStationUtils";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PathStatus } from "../pathfinding/types";
import { WarshipCaptureTracker } from "./StructureCapture";

// How close (manhattan distance) a boat must be to the station to be tolled.
const TOLL_GATE_RADIUS = 2;
// Gold accrued at the station once per pass by enemy/neutral boats.
const TOLL_GOLD = 10_000n;
// Ticks to wait after a collection run ends before dispatching the next ship
// (also throttles retries when no water route to a port exists).
const DISPATCH_COOLDOWN = 30;

/**
 * Water toll station.
 *
 * Toll is NOT paid straight to the owner. Enemy/neutral boats passing the gate
 * deposit gold that **accrues at the station**. To realise it, the owner needs a
 * **port**: the station dispatches a **collection ship** (a normal transport
 * ship, same type/trail as an expansion boat) that sails **from the port to the
 * station and back**. Only when it returns to the port is the carried gold
 * credited. Enemies can sink the collection ship with warships on the way — if
 * they do, the gold it was carrying is **lost**. One collection ship per station
 * at a time, so toll keeps accruing while it is away.
 */
export class WaterTollStationExecution implements Execution {
  private mg: Game;
  private active = true;

  // The two land tiles this station bridges. Empty if placement was degenerate.
  private connections: TileRef[] = [];

  // Capture: an enemy warship parks next to the station and fills a progress
  // bar; capturing it turns the two players hostile (starts the war).
  private readonly capture = new WarshipCaptureTracker();

  // Boats currently inside the toll gate that have already paid this pass.
  private readonly paidBoats = new Set<Unit>();

  // Toll that has accrued at the station, waiting to be collected.
  private pendingGold = 0n;

  // The in-transit collection ship (a transport ship). Null when none is out.
  private collector: Unit | null = null;
  // The player who dispatched the current collection ship (credited on return).
  private collectorOwner: Player | null = null;
  // Water tile next to the owner's port that the ship launches from / returns to.
  private collectorHome: TileRef | null = null;
  // Gold the collection ship is currently carrying (loaded at the station).
  private collectorCarry = 0n;
  private collectorPhase: "toStation" | "toPort" = "toStation";
  private pathFinder: WaterPathFinder | null = null;
  private dispatchCooldown = 0;
  private static staggerCounter = 0;

  constructor(private station: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.connections = tollStationConnections(mg, this.station.tile());
  }

  tick(ticks: number): void {
    if (!this.station.isActive()) {
      if (this.collector?.isActive()) this.collector.delete(false);
      this.active = false;
      return;
    }
    if (this.station.isUnderConstruction()) {
      return;
    }
    this.collectToll();
    this.capture.tick(this.mg, this.station);
    this.manageCollector();
  }

  // Accrue a one-time gold toll from enemy/neutral boats in the gate. Own and
  // allied boats (and our own collection ship) pass free. The gold is held at
  // the station until a collection ship carries it back to a port.
  private collectToll(): void {
    const owner = this.station.owner();
    const inGate = new Set<Unit>();
    for (const { unit } of this.mg.nearbyUnits(
      this.station.tile(),
      TOLL_GATE_RADIUS,
      [UnitType.TransportShip, UnitType.TradeShip],
    )) {
      if (!unit.isActive() || unit === this.collector) continue;
      const boatOwner = unit.owner();
      if (
        boatOwner === owner ||
        boatOwner.isFriendly(owner) ||
        boatOwner.isOnSameTeam(owner)
      ) {
        continue; // own & allied boats pass free
      }
      inGate.add(unit);
      if (!this.paidBoats.has(unit)) {
        const paid = boatOwner.removeGold(TOLL_GOLD);
        if (paid > 0n) this.pendingGold += paid; // accrue at the station
        this.paidBoats.add(unit);
      }
    }
    // Forget boats that have left the gate so a later pass is charged again.
    for (const boat of this.paidBoats) {
      if (!inGate.has(boat)) this.paidBoats.delete(boat);
    }
  }

  private manageCollector(): void {
    if (this.collector !== null) {
      if (!this.collector.isActive()) {
        // Sunk en route → whatever it was carrying is lost.
        this.resetCollector();
        return;
      }
      this.stepCollector();
      return;
    }
    if (this.dispatchCooldown > 0) {
      this.dispatchCooldown--;
      return;
    }
    // No ship out: launch one if there is toll to fetch and a port to fetch to.
    if (this.pendingGold > 0n) this.dispatchCollector();
  }

  // Launch a free collection ship from the owner's nearest port (a water tile
  // beside it) toward the station. No port reachable → nothing collected yet.
  private dispatchCollector(): void {
    const owner = this.station.owner();
    const stationTile = this.station.tile();

    let bestSpawn: TileRef | null = null;
    let bestDist = Infinity;
    for (const port of owner.units(UnitType.Port)) {
      if (!port.isActive() || port.isUnderConstruction()) continue;
      for (const n of this.mg.neighbors(port.tile())) {
        if (!this.mg.isWater(n) || this.mg.isImpassable(n)) continue;
        const d = this.mg.manhattanDist(n, stationTile);
        if (d < bestDist) {
          bestDist = d;
          bestSpawn = n;
        }
      }
    }
    if (bestSpawn === null) {
      // No port yet — wait a bit before checking again (avoids per-tick churn).
      this.dispatchCooldown = DISPATCH_COOLDOWN;
      return;
    }

    const stagger =
      WaterTollStationExecution.staggerCounter++ % WaterPathFinder.STAGGER_SPREAD;
    this.pathFinder = new WaterPathFinder(this.mg, stagger);

    // The collection ship is free (only the toll is realised on return).
    const goldBefore = owner.gold();
    this.collector = owner.buildUnit(UnitType.TransportShip, bestSpawn, {
      troops: 0,
      targetTile: stationTile,
    });
    owner.addGold(goldBefore - owner.gold());

    this.collectorOwner = owner;
    this.collectorHome = bestSpawn;
    this.collectorPhase = "toStation";
    this.collectorCarry = 0n;
  }

  private stepCollector(): void {
    const ship = this.collector!;

    // Captured mid-run (no longer ours) → stop tracking; carry is lost.
    if (ship.owner() !== this.collectorOwner) {
      this.resetCollector();
      return;
    }

    const target =
      this.collectorPhase === "toStation"
        ? this.station.tile()
        : this.collectorHome!;

    if (ship.tile() === target) {
      if (this.collectorPhase === "toStation") {
        // Load the accrued toll and head home.
        this.collectorCarry = this.pendingGold;
        this.pendingGold = 0n;
        this.collectorPhase = "toPort";
      } else {
        // Back at the port → the toll is finally realised for the owner.
        if (this.collectorCarry > 0n) {
          this.collectorOwner!.addGold(this.collectorCarry, this.collectorHome!);
        }
        ship.delete(false);
        this.resetCollector();
      }
      return;
    }

    const result = this.pathFinder!.next(ship.tile(), target);
    switch (result.status) {
      case PathStatus.NEXT:
      case PathStatus.COMPLETE:
        ship.move(result.node);
        break;
      case PathStatus.NOT_FOUND:
        ship.delete(false);
        this.resetCollector();
        break;
    }
  }

  private resetCollector(): void {
    this.collector = null;
    this.collectorOwner = null;
    this.collectorHome = null;
    this.collectorCarry = 0n;
    this.collectorPhase = "toStation";
    this.pathFinder = null;
    this.dispatchCooldown = DISPATCH_COOLDOWN;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

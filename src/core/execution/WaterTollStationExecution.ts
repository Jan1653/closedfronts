import { Execution, Game, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { tollStationConnections } from "../game/TollStationUtils";

// How close (manhattan distance) an enemy warship must be to begin capturing.
const CAPTURE_RANGE = 3;
// Ticks an enemy warship must hold position next to the station to capture it.
const CAPTURE_TICKS = 60;
// How close (manhattan distance) a boat must be to the station to be tolled.
const TOLL_GATE_RADIUS = 2;
// Gold charged once per pass to enemy/neutral boats.
const TOLL_GOLD = 10_000n;

export class WaterTollStationExecution implements Execution {
  private mg: Game;
  private active = true;

  // The two land tiles this station bridges. Used for rendering the connections
  // and (in phase 2) for the toll corridor. Empty if placement was degenerate.
  private connections: TileRef[] = [];

  // Capture state. When at war, an enemy warship parks next to the station and
  // fills a progress bar; it can be interrupted by destroying/repelling it.
  private captor: Unit | null = null;
  private captureProgress = 0;

  // Boats currently inside the toll gate that have already paid this pass.
  // Cleared when they leave, so a later pass is charged again.
  private readonly paidBoats = new Set<Unit>();

  constructor(private station: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.connections = tollStationConnections(mg, this.station.tile());
  }

  tick(ticks: number): void {
    if (!this.station.isActive()) {
      this.active = false;
      return;
    }
    if (this.station.isUnderConstruction()) {
      return;
    }
    this.collectToll();
    this.handleCapture();
  }

  // Charge enemy/neutral boats a one-time gold toll for passing through the
  // station's gate; own and allied boats pass free. This is the heart of the
  // feature: at a river/chokepoint boats must pass and therefore pay.
  private collectToll(): void {
    const owner = this.station.owner();
    const inGate = new Set<Unit>();
    for (const { unit } of this.mg.nearbyUnits(
      this.station.tile(),
      TOLL_GATE_RADIUS,
      [UnitType.TransportShip, UnitType.TradeShip],
    )) {
      if (!unit.isActive()) continue;
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
        if (paid > 0n) owner.addGold(paid);
        this.paidBoats.add(unit);
      }
    }
    // Forget boats that have left the gate so a later pass is charged again.
    for (const boat of this.paidBoats) {
      if (!inGate.has(boat)) this.paidBoats.delete(boat);
    }
  }

  private handleCapture(): void {
    const owner = this.station.owner();

    // Enemy warships in range that are actually at war with the owner (not
    // allied and not on the same team). Allies never capture.
    const enemyWarships = this.mg
      .nearbyUnits(this.station.tile(), CAPTURE_RANGE, [UnitType.Warship])
      .map(({ unit }) => unit)
      .filter(
        (w) =>
          w.isActive() &&
          w.owner() !== owner &&
          !w.owner().isFriendly(owner) &&
          !w.owner().isOnSameTeam(owner),
      );

    // Interrupt: the captor died or left range (e.g. repelled by defenders).
    if (this.captor !== null && !enemyWarships.includes(this.captor)) {
      this.captor = null;
      this.captureProgress = 0;
    }

    if (this.captor === null) {
      if (enemyWarships.length === 0) {
        this.captureProgress = 0;
        return;
      }
      this.captor = enemyWarships[0];
    }

    this.captureProgress++;
    if (this.captureProgress >= CAPTURE_TICKS) {
      this.station.setOwner(this.captor.owner());
      this.captor = null;
      this.captureProgress = 0;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

import { Execution, Game, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { tollStationConnections } from "../game/TollStationUtils";
import { WarshipCaptureTracker } from "./StructureCapture";

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

  // Capture: an enemy warship parks next to the station and fills a progress
  // bar; capturing it turns the two players hostile (starts the war).
  private readonly capture = new WarshipCaptureTracker();

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
    this.capture.tick(this.mg, this.station);
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

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

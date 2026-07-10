import { Execution, Game, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { tollStationConnections } from "../game/TollStationUtils";
import { WarshipCaptureTracker } from "./StructureCapture";

// How close (manhattan distance) a boat must be to the station to be tolled.
const TOLL_GATE_RADIUS = 2;
// Gold paid once per pass by each enemy/neutral boat.
const TOLL_GOLD = 10_000n;

/**
 * Water toll station.
 *
 * Enemy/neutral boats passing the gate pay a one-time toll that is credited
 * **straight to the station owner**, with a floating "+N" popup at the station
 * (like a port's trade income) — no collection ship and no port needed. Own and
 * allied boats pass free. An enemy warship that holds position next to the
 * station captures it (which starts the war).
 */
export class WaterTollStationExecution implements Execution {
  private mg: Game;
  private active = true;

  // The two anchor tiles this station bridges (computed for parity with the
  // client's connection rendering; not otherwise used here).
  private connections: TileRef[] = [];

  // Capture: an enemy warship parks next to the station and fills a progress
  // bar; capturing it turns the two players hostile (starts the war).
  private readonly capture = new WarshipCaptureTracker();

  // Boats currently inside the toll gate that have already paid this pass.
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

  // Charge a one-time gold toll to enemy/neutral boats in the gate, credited
  // straight to the station owner with a "+N" popup at the station. Own and
  // allied boats pass free.
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
        // Credit the owner directly and float a "+N" over the station.
        if (paid > 0n) owner.addGold(paid, this.station.tile());
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

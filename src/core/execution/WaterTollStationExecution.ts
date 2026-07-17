import { Execution, Game, Unit } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { tollStationConnections } from "../game/TollStationUtils";
import { WarshipCaptureTracker } from "./StructureCapture";

/**
 * Water toll station.
 *
 * Tolling itself is settled by the passing trade ship on arrival (see
 * TradeShipExecution): each distinct enemy/neutral station owner on the route
 * claims a share of the trade's arrival gold — nothing is ever deducted from a
 * player's treasury, and several stations of the same owner only collect once.
 *
 * This execution only runs the station's capture mechanic: an enemy warship
 * that holds position next to the station fills a capture bar and takes it
 * over (auto only when at war; explicitly ordered otherwise — see
 * WarshipCaptureTracker).
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
    this.capture.tick(this.mg, this.station);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

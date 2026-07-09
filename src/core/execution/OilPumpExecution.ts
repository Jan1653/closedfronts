import { Execution, Game, Unit } from "../game/Game";
import { WarshipCaptureTracker } from "./StructureCapture";

/**
 * Per-oil-pump execution. Oil production itself is aggregated per tick in
 * PlayerExecution.updateOil(); this execution exists only so an oil pump can be
 * captured the same way a water toll station is: an enemy warship holds
 * position next to it until the capture timer fills. Capturing it starts a war
 * with the previous owner if the two weren't already hostile.
 *
 * Land pumps sit on owned land and are practically out of a warship's reach;
 * the capture only ever bites for sea pumps, which stand on open water. The
 * land-owner reconciliation in PlayerExecution still hands a land pump to
 * whoever conquers its tile (this execution never fires there).
 */
export class OilPumpExecution implements Execution {
  private mg: Game;
  private active = true;
  private readonly capture = new WarshipCaptureTracker();

  constructor(private pump: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.pump.isActive()) {
      this.active = false;
      return;
    }
    if (this.pump.isUnderConstruction()) {
      return;
    }
    this.capture.tick(this.mg, this.pump);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

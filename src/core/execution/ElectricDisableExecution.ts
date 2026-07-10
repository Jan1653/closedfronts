import { Execution, Game, Unit } from "../game/Game";

/**
 * Watches a structure that an electric bomb deactivated. The unit's own
 * `isDisabled()` is time-based (so the simulation auto-clears it), but nothing
 * would re-serialize the unit when the window ends — so clients would keep
 * showing it greyed. This tiny execution fires one update the moment the
 * structure re-enables, then ends.
 *
 * Multiple executions can watch the same unit (hit by two bombs); each only
 * re-enables once ticks() has passed the unit's (possibly extended) window, so
 * they never re-enable it early.
 */
export class ElectricDisableExecution implements Execution {
  private mg: Game;
  private active = true;

  constructor(private unit: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.unit.isActive()) {
      this.active = false;
      return;
    }
    if (this.mg.ticks() >= this.unit.disabledUntilTick()) {
      // Push a fresh update so clients drop the greyed-out state.
      this.unit.touch();
      this.active = false;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

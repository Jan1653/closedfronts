import { Execution, Game, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { tollStationConnections } from "../game/TollStationUtils";

// How close (manhattan distance) an enemy warship must be to begin capturing.
const CAPTURE_RANGE = 3;
// Ticks an enemy warship must hold position next to the station to capture it.
const CAPTURE_TICKS = 60;

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
    this.handleCapture();
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

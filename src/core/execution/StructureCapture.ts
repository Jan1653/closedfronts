import { Game, Player, Relation, Unit, UnitType } from "../game/Game";

// How close (manhattan distance) an enemy warship must be to begin capturing.
export const CAPTURE_RANGE = 3;
// Ticks an enemy warship must hold position next to the structure to capture it.
export const CAPTURE_TICKS = 60;

/**
 * Shared "an enemy warship parks next to a water structure and captures it"
 * mechanic, used by the water toll station and (sea) oil pumps.
 *
 * A warship only captures when either
 *  - its owner is AT WAR with the structure owner (relation Hostile) — the
 *    old automatic seizure, now restricted so neutral structures are safe, or
 *  - the player explicitly ordered THIS structure captured (captureTargetId
 *    on the warship, set by clicking the structure with a warship selected).
 * Completing an explicit capture against a neutral owner turns the two
 * players hostile — i.e. it *starts* the war. Allies and teammates never
 * capture (their warships are filtered out), so no alliance is ever broken by
 * accident.
 *
 * The capture is a proximity-hold timer that can be interrupted: if the captor
 * dies or is repelled out of range before the timer fills, progress resets.
 * Progress is mirrored onto the structure (setCaptureProgress) so the client
 * renders a capture bar.
 */
export class WarshipCaptureTracker {
  private captor: Unit | null = null;
  private progress = 0;

  constructor(
    private readonly range: number = CAPTURE_RANGE,
    private readonly ticksToCapture: number = CAPTURE_TICKS,
  ) {}

  /**
   * Advance the capture for `structure` by one tick. Returns the new owner if
   * the structure changed hands this tick, otherwise null.
   */
  tick(mg: Game, structure: Unit): Player | null {
    const owner = structure.owner();

    // Enemy warships in range that are allowed to capture: not allied/teamed
    // with the owner, and either at war with them or explicitly ordered here.
    const enemyWarships = mg
      .nearbyUnits(structure.tile(), this.range, [UnitType.Warship])
      .map(({ unit }) => unit)
      .filter(
        (w) =>
          w.isActive() &&
          w.owner() !== owner &&
          !w.owner().isFriendly(owner) &&
          !w.owner().isOnSameTeam(owner) &&
          (w.owner().relation(owner) === Relation.Hostile ||
            w.warshipState().captureTargetId === structure.id()),
      );

    // Interrupt: the captor died or left range (e.g. repelled by defenders).
    if (this.captor !== null && !enemyWarships.includes(this.captor)) {
      this.captor = null;
      this.setProgress(structure, 0);
    }

    if (this.captor === null) {
      if (enemyWarships.length === 0) {
        this.setProgress(structure, 0);
        return null;
      }
      this.captor = enemyWarships[0];
    }

    this.setProgress(structure, this.progress + 1);
    if (this.progress >= this.ticksToCapture) {
      const newOwner = this.captor.owner() as Player;
      startWar(newOwner, owner as Player);
      structure.setOwner(newOwner);
      // The order is fulfilled — release the warship back to normal duty.
      if (this.captor.warshipState().captureTargetId === structure.id()) {
        this.captor.updateWarshipState({ captureTargetId: undefined });
      }
      this.captor = null;
      this.setProgress(structure, 0);
      return newOwner;
    }
    return null;
  }

  private setProgress(structure: Unit, ticks: number): void {
    this.progress = ticks;
    structure.setCaptureProgress(ticks / this.ticksToCapture);
  }
}

/**
 * Turn two players hostile both ways, "starting the war" if they were only
 * neutral before. Relations are clamped to [-100, 100]; the Hostile threshold
 * is -50, so -100 puts them firmly at war (and decays back only slowly).
 */
export function startWar(a: Player, b: Player): void {
  if (a === b) return;
  a.updateRelation(b, -100);
  b.updateRelation(a, -100);
}

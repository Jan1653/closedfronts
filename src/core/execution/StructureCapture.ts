import { Game, Player, Unit, UnitType } from "../game/Game";

// How close (manhattan distance) an enemy warship must be to begin capturing.
export const CAPTURE_RANGE = 3;
// Ticks an enemy warship must hold position next to the structure to capture it.
export const CAPTURE_TICKS = 60;

/**
 * Shared "an enemy warship parks next to a water structure and captures it"
 * mechanic, used by both the water toll station and (sea) oil pumps.
 *
 * Capturing an enemy structure is an act of war: it works even against a
 * neutral owner you are not yet at war with, and completing it turns the two
 * players hostile — i.e. it *starts* the war. Allies and teammates never
 * capture (their warships are filtered out), so no alliance is ever broken by
 * accident.
 *
 * The capture is a proximity-hold timer that can be interrupted: if the captor
 * dies or is repelled out of range before the timer fills, progress resets.
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

    // Enemy warships in range that are neither allied nor on the owner's team.
    const enemyWarships = mg
      .nearbyUnits(structure.tile(), this.range, [UnitType.Warship])
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
      this.progress = 0;
    }

    if (this.captor === null) {
      if (enemyWarships.length === 0) {
        this.progress = 0;
        return null;
      }
      this.captor = enemyWarships[0];
    }

    this.progress++;
    if (this.progress >= this.ticksToCapture) {
      const newOwner = this.captor.owner() as Player;
      startWar(newOwner, owner as Player);
      structure.setOwner(newOwner);
      this.captor = null;
      this.progress = 0;
      return newOwner;
    }
    return null;
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

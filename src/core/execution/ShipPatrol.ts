import { Game, Unit } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PathStatus } from "../pathfinding/types";
import { PseudoRandom } from "../PseudoRandom";

/**
 * Shared random-patrol movement for the light ships (fishing boat, patrol
 * boat, submarines): wander around warshipState.patrolTile like a warship
 * does, honoring manual move orders (the player re-setting patrolTile).
 * A trimmed-down copy of WarshipExecution's patrol/randomTile logic.
 */
export class ShipPatrol {
  constructor(
    private readonly mg: Game,
    private readonly ship: Unit,
    private readonly pathfinder: WaterPathFinder,
    private readonly random: PseudoRandom,
    private readonly patrolRange: number,
  ) {}

  /** One movement step of the patrol. */
  tick(): void {
    if (this.ship.targetTile() === undefined) {
      const next = this.randomTile();
      if (next === undefined) return;
      this.ship.setTargetTile(next);
    }
    const result = this.pathfinder.next(
      this.ship.tile(),
      this.ship.targetTile()!,
    );
    switch (result.status) {
      case PathStatus.COMPLETE:
        this.ship.setTargetTile(undefined);
        this.ship.move(result.node);
        break;
      case PathStatus.NEXT:
        this.ship.move(result.node);
        break;
      case PathStatus.NOT_FOUND:
        this.ship.setTargetTile(undefined);
        break;
    }
  }

  /** Forget the current waypoint (e.g. after a manual move order). */
  resetWaypoint(): void {
    this.ship.setTargetTile(undefined);
  }

  private randomTile(allowShoreline = false): TileRef | undefined {
    let range = this.patrolRange;
    const patrolTile = this.ship.warshipState().patrolTile;
    if (patrolTile === undefined) return undefined;
    const component = this.mg.getWaterComponent(this.ship.tile());
    let attempts = 0;
    let expands = 0;
    while (expands < 3) {
      const x = this.mg.x(patrolTile) + this.random.nextInt(-range / 2, range / 2);
      const y = this.mg.y(patrolTile) + this.random.nextInt(-range / 2, range / 2);
      if (this.mg.isValidCoord(x, y)) {
        const tile = this.mg.ref(x, y);
        if (
          this.mg.isWater(tile) &&
          (allowShoreline || !this.mg.isShoreline(tile)) &&
          (component === null || this.mg.hasWaterComponent(tile, component))
        ) {
          return tile;
        }
      }
      attempts++;
      if (attempts >= 300) {
        attempts = 0;
        expands++;
        range += Math.floor(range / 2);
      }
    }
    return allowShoreline ? undefined : this.randomTile(true);
  }
}

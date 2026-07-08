import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PathStatus } from "../pathfinding/types";
import { WaterTollStationExecution } from "./WaterTollStationExecution";

/**
 * Builds a water structure (currently the Water Toll Station) out at sea: a
 * troop transport ship sails from the owner's nearest port to the target tile
 * and constructs it on arrival. The ship stays vulnerable the whole way and
 * during the build — an enemy warship that sinks it cancels the construction,
 * and nothing is charged.
 */
export class SeaBuildExecution implements Execution {
  private mg: Game;
  private active = true;
  private builder: Unit | null = null;
  private pathFinder: WaterPathFinder;
  private buildTicksLeft = 0;

  private static staggerCounter = 0;

  constructor(
    private player: Player,
    private structureType: UnitType,
    private targetTile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;

    // Must still be a valid spot for the structure.
    if (this.player.canBuild(this.structureType, this.targetTile) === false) {
      this.active = false;
      return;
    }

    const src = this.spawnTile();
    if (src === null) {
      this.active = false; // no port to launch from
      return;
    }

    const stagger =
      SeaBuildExecution.staggerCounter++ % WaterPathFinder.STAGGER_SPREAD;
    this.pathFinder = new WaterPathFinder(mg, stagger);

    // The builder is a troop transport (not a trade ship). It is free — only the
    // finished structure is charged, on completion.
    const goldBefore = this.player.gold();
    this.builder = this.player.buildUnit(UnitType.TransportShip, src, {
      troops: 0,
      targetTile: this.targetTile,
    });
    this.player.addGold(goldBefore - this.player.gold());
    this.buildTicksLeft = mg.config().seaBuildTicks();
  }

  tick(ticks: number): void {
    if (this.builder === null || !this.builder.isActive()) {
      this.active = false; // ship sunk / never launched → build cancelled
      return;
    }

    if (this.builder.tile() === this.targetTile) {
      if (this.buildTicksLeft > 0) {
        this.buildTicksLeft--; // holding position, still sinkable
        return;
      }
      this.complete();
      return;
    }

    const result = this.pathFinder.next(this.builder.tile(), this.targetTile);
    switch (result.status) {
      case PathStatus.NEXT:
      case PathStatus.COMPLETE:
        this.builder.move(result.node);
        break;
      case PathStatus.NOT_FOUND:
        this.builder.delete(false);
        this.active = false;
        break;
    }
  }

  private complete(): void {
    // Re-check validity (the strait could have changed) and build the structure.
    if (this.player.canBuild(this.structureType, this.targetTile) !== false) {
      const structure = this.player.buildUnit(
        this.structureType,
        this.targetTile,
        {},
      );
      if (this.structureType === UnitType.WaterTollStation) {
        this.mg.addExecution(new WaterTollStationExecution(structure));
      }
    }
    this.builder?.delete(false);
    this.active = false;
  }

  // A water tile next to the owner's port that is nearest to the target.
  private spawnTile(): TileRef | null {
    let best: TileRef | null = null;
    let bestDist = Infinity;
    for (const port of this.player.units(UnitType.Port)) {
      if (!port.isActive()) continue;
      for (const n of this.mg.neighbors(port.tile())) {
        if (!this.mg.isWater(n) || this.mg.isImpassable(n)) continue;
        const d = this.mg.manhattanDist(n, this.targetTile);
        if (d < bestDist) {
          bestDist = d;
          best = n;
        }
      }
    }
    return best;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

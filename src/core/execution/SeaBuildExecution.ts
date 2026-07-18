import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PathStatus } from "../pathfinding/types";
import { LighthouseExecution } from "./LighthouseExecution";
import { OilPumpExecution } from "./OilPumpExecution";
import { WaterTollStationExecution } from "./WaterTollStationExecution";

/**
 * Builds a water structure (Water Toll Station or a sea oil pump) out at sea: a
 * troop transport ship sails from the owner's nearest port to the target tile.
 * On arrival the structure appears "under construction" (showing the normal
 * build progress bar) while the ship holds position and guards it; when the bar
 * fills the structure activates and the ship leaves. The ship stays vulnerable
 * the whole way AND during the build — an enemy warship that sinks it cancels
 * the construction (the half-built structure is removed) and nothing is charged.
 */
export class SeaBuildExecution implements Execution {
  private mg: Game;
  private active = true;
  private builder: Unit | null = null;
  private pathFinder: WaterPathFinder;
  private buildTicksLeft = 0;
  private structure: Unit | null = null;

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
  }

  tick(ticks: number): void {
    if (this.builder === null || !this.builder.isActive()) {
      // Ship sunk / never launched → cancel and tear down any half-built
      // structure so a sunk builder truly loses the toll station.
      if (this.structure !== null && this.structure.isActive()) {
        this.structure.delete(false);
      }
      this.active = false;
      return;
    }

    // Still sailing to the build site.
    if (this.builder.tile() !== this.targetTile) {
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
      return;
    }

    // Arrived: start construction (structure shows the normal progress bar).
    if (this.structure === null) {
      if (this.player.canBuild(this.structureType, this.targetTile) === false) {
        this.builder.delete(false);
        this.active = false;
        return;
      }
      this.structure = this.player.buildUnit(
        this.structureType,
        this.targetTile,
        {},
      );
      this.buildTicksLeft =
        this.mg.unitInfo(this.structureType).constructionDuration ??
        this.mg.config().seaBuildTicks();
      if (this.buildTicksLeft > 0) {
        this.structure.setUnderConstruction(true);
      }
    }

    // Building — the ship holds position and guards it (still sinkable above).
    if (this.buildTicksLeft > 0) {
      this.buildTicksLeft--;
      return;
    }

    this.complete();
  }

  private complete(): void {
    const structure = this.structure;
    if (structure !== null && structure.isActive()) {
      structure.setUnderConstruction(false);
      if (this.structureType === UnitType.WaterTollStation) {
        this.mg.addExecution(new WaterTollStationExecution(structure));
      } else if (this.structureType === UnitType.OilPump) {
        this.mg.addExecution(new OilPumpExecution(structure));
      } else if (this.structureType === UnitType.Lighthouse) {
        this.mg.addExecution(new LighthouseExecution(structure));
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

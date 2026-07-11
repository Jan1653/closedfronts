import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { WallExecution } from "./WallExecution";

/**
 * Drag-built wall line: the player clicks a start tile, drags, and clicks an end
 * tile; the whole straight line of walls between them is built at once.
 *
 * Cost mirrors the old place-two-walls-and-auto-connect model: the two endpoints
 * are charged the normal wall price, the interior segments are free fillers. The
 * line follows the exact Bresenham path start→end (unlike the auto-connect
 * heuristic), skips tiles it can't wall (water/impassable/enemy land/already
 * walled) and claims wilderness underneath, like WallExecution.connectToNearbyWall.
 *
 * Segments are built instantly and with connect=false so they don't cascade into
 * further auto-connect fills — the drag is an explicit, self-contained line.
 */
export class WallLineExecution implements Execution {
  private mg: Game;
  private active = true;

  constructor(
    private player: Player,
    private start: TileRef,
    private end: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;

    if (!mg.isValidRef(this.start) || !mg.isValidRef(this.end)) {
      this.active = false;
      return;
    }

    // Existing walls, so the line skips tiles that are already walled.
    const walled = new Set<TileRef>();
    for (const w of mg.units(UnitType.Wall)) walled.add(w.tile());

    const buildable = this.lineTiles().filter((t) => {
      if (!mg.isLand(t) || mg.isImpassable(t)) return false;
      if (walled.has(t)) return false;
      const o = mg.owner(t);
      if (o.isPlayer() && o !== this.player) return false; // don't wall others' land
      return true;
    });
    if (buildable.length === 0) {
      this.active = false;
      return;
    }

    // The two endpoints are charged; everything between is free. Charge upfront
    // and abort if it can't be afforded (the client gates this too).
    const wallCost = mg.unitInfo(UnitType.Wall).cost(mg, this.player);
    const chargedCount = BigInt(Math.min(2, buildable.length));
    const totalCharge = wallCost * chargedCount;
    if (this.player.gold() < totalCharge) {
      this.active = false;
      return;
    }

    for (const t of buildable) {
      if (!mg.owner(t).isPlayer()) this.player.conquer(t); // claim wilderness
      // Build free (refund whatever buildUnit charged); the flat endpoint charge
      // is applied once below.
      const goldBefore = this.player.gold();
      const seg: Unit = this.player.buildUnit(UnitType.Wall, t, {});
      this.player.addGold(goldBefore - this.player.gold());
      this.mg.addExecution(new WallExecution(seg, false));
    }
    this.player.removeGold(totalCharge);

    this.active = false;
  }

  tick(ticks: number): void {}

  // Bresenham line from start to end, INCLUDING both endpoints.
  private lineTiles(): TileRef[] {
    const mg = this.mg;
    const tiles: TileRef[] = [];
    let x0 = mg.x(this.start);
    let y0 = mg.y(this.start);
    const x1 = mg.x(this.end);
    const y1 = mg.y(this.end);
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      tiles.push(mg.ref(x0, y0));
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
    return tiles;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

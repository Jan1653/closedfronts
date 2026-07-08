import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

export class WallExecution implements Execution {
  private mg: Game;
  private active: boolean = true;

  // connect = true for a player-placed wall (it auto-links to a nearby wall);
  // the filler segments are built with connect = false so they don't cascade.
  constructor(
    private wall: Unit,
    private connect: boolean = true,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (this.connect) {
      this.connectToNearbyWall();
    }
  }

  tick(ticks: number): void {
    if (!this.wall.isActive()) {
      this.active = false;
      return;
    }
    if (this.wall.isUnderConstruction()) {
      return;
    }
    // A wall is a physical barrier: whoever ends up holding its tile (by
    // breaking through, a defense-post barrage, etc.) takes the wall too.
    const tileOwner = this.mg.owner(this.wall.tile());
    if (tileOwner.isPlayer() && tileOwner !== this.wall.owner()) {
      this.wall.setOwner(tileOwner as Player);
    }
  }

  // Link this wall to the nearest of the owner's other walls within range by
  // filling the straight line between them with free wall segments (like a road
  // drawn between two nodes).
  private connectToNearbyWall(): void {
    const mg = this.mg;
    const owner = this.wall.owner();
    const from = this.wall.tile();
    const range = mg.config().wallConnectRange();
    const range2 = range * range;

    // Use the owner's unit list (not the spatial grid, which is indexed a tick
    // later) so a freshly built wall can connect immediately.
    const walledTiles = new Set<TileRef>();
    let target: Unit | null = null;
    let best = Infinity;
    for (const w of owner.units(UnitType.Wall)) {
      walledTiles.add(w.tile());
      if (w.id() === this.wall.id()) continue;
      const d = mg.euclideanDistSquared(from, w.tile());
      if (d > 0 && d <= range2 && d < best) {
        best = d;
        target = w;
      }
    }
    if (target === null) return;

    for (const t of this.lineTiles(from, target.tile())) {
      if (!mg.isLand(t) || mg.isImpassable(t)) continue;
      if (walledTiles.has(t)) continue; // already walled
      const to = mg.owner(t);
      if (to.isPlayer() && to !== owner) continue; // don't wall enemy land
      if (!to.isPlayer()) owner.conquer(t); // claim wilderness under the line
      // Filler segments are free: refund exactly what buildUnit charged.
      const goldBefore = owner.gold();
      const seg = owner.buildUnit(UnitType.Wall, t, {});
      owner.addGold(goldBefore - owner.gold());
      mg.addExecution(new WallExecution(seg, false));
      walledTiles.add(t);
    }
  }

  // Bresenham line between two tiles, excluding both endpoints.
  private *lineTiles(a: TileRef, b: TileRef): Generator<TileRef> {
    const mg = this.mg;
    let x0 = mg.x(a),
      y0 = mg.y(a);
    const x1 = mg.x(b),
      y1 = mg.y(b);
    const dx = Math.abs(x1 - x0),
      dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1,
      sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
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
      if (x0 === x1 && y0 === y1) break; // reached endpoint b, stop
      yield mg.ref(x0, y0);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

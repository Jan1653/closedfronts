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
      return;
    }
    // Siege damage is applied by the attacker (AttackExecution). Here we only
    // regenerate health once the wall is no longer under active siege — that's
    // how the damage bar "reverts" when the attacker is repelled/counterattacked.
    if (this.underSiege()) return;
    if (this.wall.health() < this.wall.maxHealth()) {
      this.wall.modifyHealth(this.mg.config().wallRegenPerTick(this.wall.owner()));
    }
  }

  // True while an enemy who is actively attacking this wall's owner holds a tile
  // next to the wall (i.e. the wall is on the front of a live assault).
  private underSiege(): boolean {
    const owner = this.wall.owner();
    let sieged = false;
    this.mg.forEachNeighbor(this.wall.tile(), (n) => {
      if (sieged) return;
      const nOwner = this.mg.owner(n);
      if (!nOwner.isPlayer()) return;
      const enemy = nOwner as Player;
      if (enemy === owner || enemy.isFriendly(owner)) return;
      for (const atk of enemy.outgoingAttacks()) {
        if (atk.isActive() && atk.target() === owner) {
          sieged = true;
          return;
        }
      }
    });
    return sieged;
  }

  // Link this wall into nearby walls by filling the straight line between them
  // with free wall segments (like a road drawn between two nodes). Connects to
  // the nearest wall AND the nearest one on the opposite side, so a wall placed
  // between two walls extends the line in both directions. Candidate walls are
  // the owner's plus teammates' (team play — link your walls into your team's
  // barrier).
  private connectToNearbyWall(): void {
    const mg = this.mg;
    const owner = this.wall.owner();
    const from = this.wall.tile();
    const fx = mg.x(from);
    const fy = mg.y(from);
    const range = mg.config().wallConnectRange();
    const range2 = range * range;

    const walledTiles = new Set<TileRef>();
    const candidates: {
      unit: Unit;
      dist: number;
      dx: number;
      dy: number;
    }[] = [];
    for (const w of mg.units(UnitType.Wall)) {
      walledTiles.add(w.tile());
      if (w.id() === this.wall.id()) continue;
      const wo = w.owner();
      if (wo !== owner && !wo.isOnSameTeam(owner)) continue; // own or teammate
      const d = mg.euclideanDistSquared(from, w.tile());
      if (d <= 0 || d > range2) continue;
      candidates.push({
        unit: w,
        dist: d,
        dx: mg.x(w.tile()) - fx,
        dy: mg.y(w.tile()) - fy,
      });
    }
    if (candidates.length === 0) return;

    candidates.sort((a, b) => a.dist - b.dist);
    const nearest = candidates[0];
    const targets: Unit[] = [nearest.unit];
    // Extend the other way too: the nearest wall roughly opposite the first
    // (direction dot-product < 0), so building between two walls links both.
    for (const c of candidates) {
      if (c === nearest) continue;
      if (c.dx * nearest.dx + c.dy * nearest.dy < 0) {
        targets.push(c.unit);
        break;
      }
    }

    for (const target of targets) {
      for (const t of this.lineTiles(from, target.tile())) {
        if (!mg.isLand(t) || mg.isImpassable(t)) continue;
        if (walledTiles.has(t)) continue; // already walled
        const to = mg.owner(t);
        if (to.isPlayer() && to !== owner) continue; // don't wall others' land
        if (!to.isPlayer()) owner.conquer(t); // claim wilderness under the line
        // Filler segments are free: refund exactly what buildUnit charged.
        const goldBefore = owner.gold();
        const seg = owner.buildUnit(UnitType.Wall, t, {});
        owner.addGold(goldBefore - owner.gold());
        mg.addExecution(new WallExecution(seg, false));
        walledTiles.add(t);
      }
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

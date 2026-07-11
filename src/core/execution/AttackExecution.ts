import { renderTroops } from "../../client/Utils";
import {
  Attack,
  Difficulty,
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
  PlayerType,
  TerrainType,
  TerraNullius,
  Unit,
  UnitType,
} from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { assertNever } from "../Util";
import { FlatBinaryHeap } from "./utils/FlatBinaryHeap"; // adjust path if needed

const malusForRetreat = 25;
export class AttackExecution implements Execution {
  private active: boolean = true;
  private toConquer = new FlatBinaryHeap();

  private random = new PseudoRandom(123);

  private target: Player | TerraNullius;

  private mg: Game;
  // Direct GameMap reference to skip the Game delegation hop in hot loops.
  private map: GameMap;

  private attack: Attack | null = null;

  // Cached smallIDs for integer owner comparisons in hot loops.
  private ownerSmallID: number;
  private targetSmallID: number;
  // Reusable neighbor buffers to avoid closures/allocation in hot loops.
  private nbuf: TileRef[] = [0, 0, 0, 0];
  private nbuf2: TileRef[] = [0, 0, 0, 0];

  // Walls are conquered only as a last resort: their border tiles get this huge
  // priority penalty so the attack flows around them first (and only breaks
  // through when the whole frontier is walled). Cached per tick to skip the
  // wall lookup entirely in the common wall-free game.
  private static readonly WALL_ATTACK_DEFER = 1e9;
  private wallsCheckedTick = -1;
  private wallsExist = false;

  // Bounded breach: breaking a wall tile lets this attack push at most this many
  // tiles into the enclosed area past that break; tiles deeper stay untouched
  // (the wall keeps protecting them). To take more, break more wall. Only bites
  // for a fully-enclosed area — a partial wall can still be flanked (reached with
  // no breach budget in effect, so uncapped). breachBudget maps a queued interior
  // tile to how many further inward steps are still allowed from it.
  private static readonly BREACH_DEPTH = 3;
  private breachBudget = new Map<TileRef, number>();

  // Gradual wall siege: a wall on the frontier is worn down (health) before it
  // can be breached. Damage once per wall per tick; the set is reset each tick.
  private siegedThisTick = new Set<TileRef>();
  private siegeTickStamp = -1;

  constructor(
    private startTroops: number | null = null,
    private _owner: Player,
    private _targetID: PlayerID | null,
    private sourceTile: TileRef | null = null,
    private removeTroops: boolean = true,
  ) {}

  public targetID(): PlayerID | null {
    return this._targetID;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    if (!this.active) {
      return;
    }
    this.mg = mg;
    this.map = mg.map();

    if (this._targetID !== null && !mg.hasPlayer(this._targetID)) {
      console.warn(`target ${this._targetID} not found`);
      this.active = false;
      return;
    }

    this.target =
      this._targetID === this.mg.terraNullius().id()
        ? mg.terraNullius()
        : mg.player(this._targetID);
    this.ownerSmallID = this._owner.smallID();
    this.targetSmallID = this.target.smallID();

    if (this._owner === this.target) {
      console.error(`Player ${this._owner} cannot attack itself`);
      this.active = false;
      return;
    }

    // ALLIANCE CHECK — block attacks on friendly (ally or same team)
    if (this.target.isPlayer()) {
      const targetPlayer = this.target as Player;
      if (this._owner.isFriendly(targetPlayer)) {
        console.warn(
          `${this._owner.displayName()} cannot attack ${targetPlayer.displayName()} because they are friendly (allied or same team)`,
        );
        this.active = false;
        return;
      }
    }

    if (this.target && this.target.isPlayer()) {
      const targetPlayer = this.target as Player;
      if (
        targetPlayer.type() !== PlayerType.Bot &&
        this._owner.type() !== PlayerType.Bot
      ) {
        // Don't let bots embargo since they can't trade anyway.
        targetPlayer.addEmbargo(this._owner, true);
        this.rejectIncomingAllianceRequests(targetPlayer);
      }
    }

    if (this.target.isPlayer() && !this._owner.canAttackPlayer(this.target)) {
      this.active = false;
      return;
    }

    this.startTroops ??= this.mg
      .config()
      .attackAmount(this._owner, this.target);
    if (this.removeTroops) {
      this.startTroops = Math.min(this._owner.troops(), this.startTroops);
      this._owner.removeTroops(this.startTroops);
    }
    this.attack = this._owner.createAttack(
      this.target,
      this.startTroops,
      this.sourceTile,
      new Set<TileRef>(),
    );

    if (this.sourceTile !== null) {
      this.addNeighbors(this.sourceTile);
    } else {
      this.refreshToConquer();
    }

    // Record stats
    this.mg.stats().attack(this._owner, this.target, this.startTroops);

    for (const incoming of this._owner.incomingAttacks()) {
      if (incoming.attacker() === this.target) {
        // Target has opposing attack, cancel them out
        if (incoming.troops() > this.attack.troops()) {
          incoming.setTroops(incoming.troops() - this.attack.troops());
          this.attack.delete();
          this.active = false;
          return;
        } else {
          this.attack.setTroops(this.attack.troops() - incoming.troops());
          incoming.delete();
        }
      }
    }
    for (const outgoing of this._owner.outgoingAttacks()) {
      if (
        outgoing !== this.attack &&
        outgoing.target() === this.attack.target() &&
        // Boat attacks (sourceTile is not null) are not combined with other attacks
        this.attack.sourceTile() === null
      ) {
        this.attack.setTroops(this.attack.troops() + outgoing.troops());
        outgoing.delete();
      }
    }

    if (this.target.isPlayer()) {
      const difficulty = this.mg.config().gameConfig().difficulty;
      let relationChange: number;
      switch (difficulty) {
        case Difficulty.Easy:
          relationChange = -60;
          break;
        case Difficulty.Medium:
          relationChange = -70;
          break;
        case Difficulty.Hard:
          relationChange = -80;
          break;
        case Difficulty.Impossible:
          relationChange = -100;
          break;
        default:
          assertNever(difficulty);
      }
      this.target.updateRelation(this._owner, relationChange);
    }
  }

  private refreshToConquer() {
    if (this.attack === null) {
      throw new Error("Attack not initialized");
    }

    this.toConquer.clear();
    this.attack.clearBorder();
    for (const tile of this._owner.borderTiles()) {
      this.addNeighbors(tile);
    }
  }

  private retreat(malusPercent = 0) {
    if (this.attack === null) {
      throw new Error("Attack not initialized");
    }

    const deaths = this.attack.troops() * (malusPercent / 100);
    if (deaths) {
      this.mg.displayMessage(
        "events_display.attack_cancelled_retreat",
        MessageType.ATTACK_CANCELLED,
        this._owner.id(),
        undefined,
        { troops: renderTroops(deaths) },
      );
    }
    if (this.removeTroops === false && this.sourceTile === null) {
      // startTroops are always added to attack troops at init but not always removed from owner troops
      // subtract startTroops from attack troops so we don't give back startTroops to owner that were never removed
      // boat attacks (sourceTile !== null) are the exception: troops were removed at departure and must be returned after attack still
      this.attack.setTroops(this.attack.troops() - (this.startTroops ?? 0));
    }

    const survivors = this.attack.troops() - deaths;
    this._owner.addTroops(survivors);
    this.attack.delete();
    this.active = false;

    // Not all retreats are canceled attacks
    if (this.attack.retreated()) {
      // Record stats
      this.mg.stats().attackCancel(this._owner, this.target, survivors);
    }
  }

  tick(ticks: number) {
    if (this.attack === null) {
      throw new Error("Attack not initialized");
    }
    let troopCount = this.attack.troops(); // cache troop count
    const targetIsPlayer = this.target.isPlayer(); // cache target type
    const targetPlayer = targetIsPlayer ? (this.target as Player) : null; // cache target player

    if (this.attack.retreated()) {
      if (targetIsPlayer) {
        this.retreat(malusForRetreat);
      } else {
        this.retreat();
      }
      this.active = false;
      return;
    }

    if (this.attack.retreating()) {
      return;
    }

    if (!this.attack.isActive()) {
      this.active = false;
      return;
    }

    if (targetPlayer && this._owner.isFriendly(targetPlayer)) {
      // In this case a new alliance was created AFTER the attack started.
      this.retreat();
      return;
    }

    let numTilesPerTick = this.mg
      .config()
      .attackTilesPerTick(
        troopCount,
        this._owner,
        this.target,
        this.attack.borderSize() + this.random.nextInt(0, 5),
      );

    while (numTilesPerTick > 0) {
      if (troopCount < 1) {
        this.attack.delete();
        this.active = false;
        return;
      }

      if (this.toConquer.size() === 0) {
        this.refreshToConquer();
        this.retreat();
        return;
      }

      const tileToConquer = this.toConquer.dequeue();
      this.attack.removeBorderTile(tileToConquer);

      let onBorder = false;
      const numNeighbors = this.map.neighbors4(tileToConquer, this.nbuf);
      for (let i = 0; i < numNeighbors; i++) {
        if (this.map.ownerID(this.nbuf[i]) === this.ownerSmallID) {
          onBorder = true;
          break;
        }
      }
      if (this.map.ownerID(tileToConquer) !== this.targetSmallID || !onBorder) {
        continue;
      }
      if (
        !this.map.isLand(tileToConquer) ||
        this.map.isImpassable(tileToConquer)
      ) {
        continue;
      }
      // A wall must be sieged down before it can be breached. While the wall
      // here still stands, wear its health down (once per tick) and keep
      // pressing — don't take the tile yet. Once broken (health 1) it becomes a
      // normal, breachable target below.
      const wall = this.anyWallsThisTick()
        ? this.wallAt(tileToConquer)
        : undefined;
      if (wall !== undefined && wall.health() > 1) {
        this.siegeWall(tileToConquer, wall, troopCount);
        // Keep the wall on the frontier so the siege continues; consume a
        // tile-action so this tick's loop still terminates.
        this.attack.addBorderTile(tileToConquer);
        this.toConquer.enqueue(
          tileToConquer,
          this.mg.ticks() + AttackExecution.WALL_ATTACK_DEFER,
        );
        numTilesPerTick -= 1;
        continue;
      }
      // Breach budget for expanding out of this tile: breaking a wall opens a
      // fresh bounded bridgehead; an interior tile carries its remaining budget.
      let breachBudget: number | null = null;
      if (this.anyWallsThisTick()) {
        if (this.isWalled(tileToConquer)) {
          breachBudget = AttackExecution.BREACH_DEPTH;
        } else {
          const b = this.breachBudget.get(tileToConquer);
          if (b !== undefined) breachBudget = b;
        }
      }
      this.addNeighbors(tileToConquer, breachBudget);
      const { attackerTroopLoss, defenderTroopLoss, tilesPerTickUsed } = this.mg
        .config()
        .attackLogic(
          this.mg,
          troopCount,
          this._owner,
          this.target,
          tileToConquer,
        );
      numTilesPerTick -= tilesPerTickUsed;
      troopCount -= attackerTroopLoss;
      this.attack.setTroops(troopCount);
      if (targetPlayer) {
        targetPlayer.removeTroops(defenderTroopLoss);
      }
      this._owner.conquer(tileToConquer);
      // A breached (broken) wall is destroyed, not captured — remove it so it
      // stops blocking and doesn't linger as a health-1 wall on the new owner.
      if (wall !== undefined) {
        wall.delete();
      }
      this.handleDeadDefender();
    }
  }

  // The wall unit sitting on `tile`, if any.
  private wallAt(tile: TileRef): Unit | undefined {
    for (const { unit, distSquared } of this.mg.nearbyUnits(tile, 1, [
      UnitType.Wall,
    ])) {
      if (distSquared === 0) return unit as Unit;
    }
    return undefined;
  }

  // Wear down a standing wall by one tick of siege, scaled by the attacking
  // force (bigger army → faster). Floored at 1 health so it isn't auto-deleted
  // here; the attack finishes it off (and applies the breach cap) by conquering
  // the broken tile. Damage is applied at most once per wall per tick.
  private siegeWall(tile: TileRef, wall: Unit, troopCount: number): void {
    const tk = this.mg.ticks();
    if (this.siegeTickStamp !== tk) {
      this.siegeTickStamp = tk;
      this.siegedThisTick.clear();
    }
    if (this.siegedThisTick.has(tile)) return;
    this.siegedThisTick.add(tile);
    const raw = this.mg.config().wallSiegeDamagePerTick(troopCount);
    const dmg = Math.min(raw, wall.health() - 1);
    if (dmg > 0) wall.modifyHealth(-dmg, this._owner);
  }

  private rejectIncomingAllianceRequests(target: Player) {
    const request = this._owner
      .incomingAllianceRequests()
      .find((ar) => ar.requestor() === target);
    if (request !== undefined) {
      request.reject();
    }
  }

  // breachBudget: null in the common case (no wall context). When we're
  // expanding out of a freshly-broken wall or a bridgehead tile, it's how many
  // more inward tiles the breach may take — non-wall interior neighbours are
  // skipped once it hits 0, capping how far one breach reaches (see BREACH_DEPTH).
  private addNeighbors(tile: TileRef, breachBudget: number | null = null) {
    if (this.attack === null) {
      throw new Error("Attack not initialized");
    }

    const tickNow = this.mg.ticks(); // cache tick
    const anyWalls = this.anyWallsThisTick();

    const numNeighbors = this.map.neighbors4(tile, this.nbuf);
    for (let i = 0; i < numNeighbors; i++) {
      const neighbor = this.nbuf[i];
      if (
        this.map.isWater(neighbor) ||
        this.map.isImpassable(neighbor) ||
        this.map.ownerID(neighbor) !== this.targetSmallID
      ) {
        continue;
      }
      const wallUnit = anyWalls ? this.wallAt(neighbor) : undefined;
      const walled = wallUnit !== undefined;
      // A standing wall (health > 1) blocks; a sieged-down one (health 1) is a
      // ready breach point and gets normal priority so it's taken promptly.
      const standing = walled && wallUnit.health() > 1;
      // Once a breach is in progress, don't let it reach past its budget into
      // the enclosed interior; those tiles stay protected by the wall this
      // attack. Wall tiles themselves are always allowed (as a deferred break).
      if (breachBudget !== null && !walled) {
        if (breachBudget <= 0) continue;
        const remaining = breachBudget - 1;
        const prev = this.breachBudget.get(neighbor);
        if (prev === undefined || prev < remaining) {
          this.breachBudget.set(neighbor, remaining);
        }
      }
      this.attack.addBorderTile(neighbor);
      let numOwnedByMe = 0;
      const numInner = this.map.neighbors4(neighbor, this.nbuf2);
      for (let j = 0; j < numInner; j++) {
        if (this.map.ownerID(this.nbuf2[j]) === this.ownerSmallID) {
          numOwnedByMe++;
        }
      }

      let mag: number;
      switch (this.map.terrainType(neighbor)) {
        case TerrainType.Plains:
          mag = 1;
          break;
        case TerrainType.Highland:
          mag = 1.5;
          break;
        case TerrainType.Mountain:
          mag = 2;
          break;
        default:
          mag = 0;
          break;
      }

      let priority =
        (this.random.nextInt(0, 7) + 10) * (1 - numOwnedByMe * 0.5 + mag / 2) +
        tickNow;

      // Defer standing walls: go around them first, siege through only if the
      // frontier leaves no other tile.
      if (standing) {
        priority += AttackExecution.WALL_ATTACK_DEFER;
      }

      this.toConquer.enqueue(neighbor, priority);
    }
  }

  // Are there any walls on the map this tick? Cached so the common wall-free
  // game pays a single cheap lookup per tick instead of one per border tile.
  private anyWallsThisTick(): boolean {
    const t = this.mg.ticks();
    if (t !== this.wallsCheckedTick) {
      this.wallsCheckedTick = t;
      this.wallsExist = this.mg.units(UnitType.Wall).length > 0;
    }
    return this.wallsExist;
  }

  private isWalled(tile: TileRef): boolean {
    for (const w of this.mg.nearbyUnits(tile, 1, UnitType.Wall)) {
      if (w.distSquared === 0) return true;
    }
    return false;
  }

  private handleDeadDefender() {
    if (!(this.target.isPlayer() && this.target.numTilesOwned() < 100)) return;
    const target: Player = this.target;

    this.mg.conquerPlayer(this._owner, target);

    for (let i = 0; i < 10; i++) {
      for (const tile of target.tiles()) {
        let borders = false;
        this.mg.forEachNeighbor(tile, (t) => {
          if (!borders && this.mg.owner(t) === this._owner) {
            borders = true;
          }
        });
        if (borders) {
          this._owner.conquer(tile);
        } else {
          let captured = false;
          this.mg.forEachNeighbor(tile, (neighbor) => {
            if (captured) return;
            const no = this.mg.owner(neighbor);
            if (no.isPlayer() && no !== target && !no.isFriendly(target)) {
              this.mg.player(no.id()).conquer(tile);
              captured = true;
            }
          });
        }
      }
    }
  }

  owner(): Player {
    return this._owner;
  }

  isActive(): boolean {
    return this.active;
  }
}

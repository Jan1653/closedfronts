import { renderNumber } from "../../client/Utils";
import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import {
  TOLL_GATE_RADIUS,
  TOLL_INCOME_SHARE_PERCENT,
} from "../game/TollStationUtils";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PathStatus } from "../pathfinding/types";
import { findClosestBy } from "../Util";

export class TradeShipExecution implements Execution {
  private active = true;
  private mg: Game;
  private tradeShip: Unit | undefined;
  private wasCaptured = false;
  private pathFinder: WaterPathFinder;
  private tilesTraveled = 0;
  private motionPlanId = 1;
  private motionPlanDst: TileRef | null = null;
  private ticksPerMove = 1;
  private lastMove = 0;

  // Toll claims accrued along the route: each distinct enemy/neutral toll
  // station owner is recorded ONCE (with the station tile for the payout
  // popup), no matter how many of their stations the route crosses. Settled
  // out of the arrival gold in complete() — never from anyone's treasury.
  private readonly tollClaims = new Map<Player, TileRef>();

  private static _staggerCounter = 0;

  constructor(
    private origOwner: Player,
    private srcPort: Unit,
    private _dstPort: Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    const stagger =
      TradeShipExecution._staggerCounter++ % WaterPathFinder.STAGGER_SPREAD;
    this.pathFinder = new WaterPathFinder(mg, stagger);
  }

  tick(ticks: number): void {
    if (this.pathFinder.rebuilt) {
      this.motionPlanDst = null; // Force motion plan re-recording
    }

    if (this.tradeShip === undefined) {
      const spawn = this.origOwner.canBuild(
        UnitType.TradeShip,
        this.srcPort.tile(),
      );
      if (spawn === false) {
        console.warn(`cannot build trade ship`);
        this.active = false;
        return;
      }
      this.tradeShip = this.origOwner.buildUnit(UnitType.TradeShip, spawn, {
        targetUnit: this._dstPort,
        lastSetSafeFromPirates: ticks,
      });
      // Dispatching a trade ship burns a little fuel.
      this.origOwner.useOil(this.mg.config().oilCostPerShipLaunch());
      this.mg.stats().boatSendTrade(this.origOwner, this._dstPort.owner());
    }

    if (!this.tradeShip.isActive()) {
      this.active = false;
      return;
    }

    const tradeShipOwner = this.tradeShip.owner();
    const dstPortOwner = this._dstPort.owner();
    if (this.wasCaptured !== true && this.origOwner !== tradeShipOwner) {
      // Store as variable in case ship is recaptured by previous owner
      this.wasCaptured = true;
      this.mg.displayMessage(
        "events_display.trade_ship_captured",
        MessageType.UNIT_DESTROYED,
        this.origOwner.id(),
        undefined,
        { name: tradeShipOwner.displayName() },
        this.tradeShip.id(),
      );
    }

    // If a player captures another player's port while trading we should delete
    // the ship.
    if (dstPortOwner.id() === this.srcPort.owner().id()) {
      this.tradeShip.delete(false);
      this.active = false;
      return;
    }

    if (
      !this.wasCaptured &&
      (!this._dstPort.isActive() || !tradeShipOwner.canTrade(dstPortOwner))
    ) {
      this.tradeShip.delete(false);
      this.active = false;
      return;
    }

    const curTile = this.tradeShip.tile();

    if (
      this.wasCaptured &&
      (tradeShipOwner !== dstPortOwner || !this._dstPort.isActive())
    ) {
      const myComponent = this.mg.getWaterComponent(curTile);
      const nearestPort = findClosestBy(
        tradeShipOwner.units(UnitType.Port),
        (port) => this.mg.manhattanDist(port.tile(), curTile),
        (port) =>
          port.isActive() &&
          !port.isMarkedForDeletion() &&
          !port.isUnderConstruction() &&
          myComponent !== null &&
          this.mg.hasWaterComponent(port.tile(), myComponent),
      );
      if (nearestPort === null) {
        this.tradeShip.delete(false);
        this.active = false;
        return;
      } else {
        this._dstPort = nearestPort;
        this.tradeShip.setTargetUnit(this._dstPort);
        // Plan-driven units don't emit per-tick unit updates, so force a sync for the new target.
        this.tradeShip.touch();
      }
    }

    if (curTile === this.dstPort()) {
      this.complete();
      return;
    }

    // Oil shortage slows the ship: recompute the cadence and, if it changed,
    // force the motion plan to be re-recorded so the client interpolates at the
    // new speed.
    const newTicksPerMove = this.mg
      .config()
      .oilAdjustedTicksPerMove(1, tradeShipOwner);
    if (newTicksPerMove !== this.ticksPerMove) {
      this.ticksPerMove = newTicksPerMove;
      this.motionPlanDst = null;
    }

    // Only step every ticksPerMove ticks (an empty tank stretches the interval).
    if (ticks - this.lastMove < this.ticksPerMove) {
      return;
    }
    this.lastMove = ticks;

    const dst = this._dstPort.tile();
    const result = this.pathFinder.next(curTile, dst);

    switch (result.status) {
      case PathStatus.NEXT:
        if (dst !== this.motionPlanDst) {
          this.motionPlanId++;
          const from = result.node;
          const path = this.pathFinder.findPath(from, dst) ?? [from];
          if (path.length === 0 || path[0] !== from) {
            path.unshift(from);
          }

          this.mg.recordMotionPlan({
            kind: "grid",
            unitId: this.tradeShip.id(),
            planId: this.motionPlanId,
            startTick: ticks + this.ticksPerMove,
            ticksPerStep: this.ticksPerMove,
            path,
          });
          this.motionPlanDst = dst;
        }
        // Update safeFromPirates status
        if (this.mg.isWater(result.node) && this.mg.isShoreline(result.node)) {
          this.tradeShip.setSafeFromPirates();
        }
        this.tradeShip.move(result.node);
        this.recordTollPassage(result.node);
        this.tilesTraveled++;
        break;
      case PathStatus.COMPLETE:
        this.complete();
        return;
      case PathStatus.NOT_FOUND:
        console.warn("captured trade ship cannot find route");
        if (this.tradeShip.isActive()) {
          this.tradeShip.delete(false);
        }
        this.active = false;
        return;
    }
  }

  // Record which enemy/neutral toll-station owners this ship sails past. Each
  // owner is charged for at most ONE station per route (stacking stations of
  // the same owner never multiplies the toll).
  private recordTollPassage(tile: TileRef): void {
    const shipOwner = this.tradeShip!.owner();
    for (const { unit } of this.mg.nearbyUnits(
      tile,
      TOLL_GATE_RADIUS,
      UnitType.WaterTollStation,
    )) {
      if (!unit.isActive() || unit.isUnderConstruction()) continue;
      const stationOwner = unit.owner();
      if (
        stationOwner === shipOwner ||
        stationOwner.isFriendly(shipOwner) ||
        stationOwner.isOnSameTeam(shipOwner)
      ) {
        continue; // own & allied stations don't toll us
      }
      if (!this.tollClaims.has(stationOwner)) {
        this.tollClaims.set(stationOwner, unit.tile());
      }
    }
  }

  // Pay each distinct toll owner their share out of the arrival gold. Returns
  // what is left for the trader — at least 0, never negative.
  private settleTolls(gold: bigint): bigint {
    let remaining = gold;
    const share = (gold * TOLL_INCOME_SHARE_PERCENT) / 100n;
    for (const [tollOwner, stationTile] of this.tollClaims) {
      if (remaining <= 0n) break;
      if (!tollOwner.isAlive()) continue;
      const cut = share < remaining ? share : remaining;
      if (cut <= 0n) break;
      tollOwner.addGold(cut, stationTile);
      remaining -= cut;
    }
    return remaining;
  }

  private complete() {
    this.active = false;
    this.tradeShip!.delete(false);
    const gold = this.mg
      .config()
      .tradeShipGold(this.tilesTraveled, this.tradeShip!.owner());

    if (this.wasCaptured) {
      this.tradeShip!.owner().addGold(gold, this._dstPort.tile());
      this.mg.displayMessage(
        "events_display.received_gold_from_captured_ship",
        MessageType.CAPTURED_ENEMY_UNIT,
        this.tradeShip!.owner().id(),
        gold,
        {
          gold: renderNumber(gold),
          name: this.origOwner.displayName(),
        },
      );
      // Record stats
      this.mg
        .stats()
        .boatCapturedTrade(this.tradeShip!.owner(), this.origOwner, gold);
    } else {
      // Tolls come out of the trader's arrival income (never their treasury);
      // the destination port's side of the trade is untouched.
      const traderGold = this.settleTolls(gold);
      this.srcPort.owner().addGold(traderGold, this.srcPort.tile());
      this._dstPort.owner().addGold(gold, this._dstPort.tile());
      // Record stats
      this.mg
        .stats()
        .boatArriveTrade(this.srcPort.owner(), this._dstPort.owner(), gold);
    }
    return;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  dstPort(): TileRef {
    return this._dstPort.tile();
  }
}

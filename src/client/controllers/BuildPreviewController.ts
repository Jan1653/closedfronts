/**
 * BuildPreviewController — build-ghost state machine + click-to-build flow.
 *
 * All rendering for the build ghost (outline, range circle, rail snap,
 * crosshair) lives in the WebGL renderer. This controller owns the state:
 * it queries buildables for the cursor tile, tracks whether the placement
 * is valid, and pushes preview data straight to the WebGL view.
 */

import { EventBus } from "../../core/EventBus";
import {
  listNukeBreakAlliance,
  wouldNukeBreakAlliance,
} from "../../core/execution/Util";
import {
  BuildableUnit,
  PlayerBuildableUnitType,
  UnitType,
} from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { WATER_TOLL_STATION_RADIUS } from "../../core/game/TollStationUtils";
import { UserSettings } from "../../core/game/UserSettings";
import { Controller } from "../Controller";
import {
  ConfirmGhostStructureEvent,
  MobilePlacementTapEvent,
  MouseMoveEvent,
  MouseUpEvent,
} from "../InputHandler";
import { MapRenderer, buildNukeTrajectory } from "../render/gl";
import type { SAMInfo } from "../render/gl/utils/NukeTrajectory";
import type { GhostPreviewData } from "../render/types";
import { TransformHandler } from "../TransformHandler";
import {
  BuildUnitIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../Transport";
import { UIState } from "../UIState";
import { GameView } from "../view";

/** True for nuke types (AtomBomb, HydrogenBomb, ElectricBomb): ghost is preserved after placement so user can place multiple or keep selection (Enter/key confirm). */
export function shouldPreserveGhostAfterBuild(unitType: UnitType): boolean {
  return (
    unitType === UnitType.AtomBomb ||
    unitType === UnitType.HydrogenBomb ||
    unitType === UnitType.ElectricBomb
  );
}

/**
 * Whether a SAM belongs in the nuke trajectory preview's threat set.
 * Mirrors SAMLauncherExecution: a SAM ignores a nuke whose owner it's
 * friendly with (same team OR allied).
 * Teammates are excluded unconditionally — a strike can break an alliance
 * but never a team relationship, so a teammate's SAM never engages.
 * Allied SAMs are excluded unless the strike would betray that ally — the
 * alliance breaks at launch, so their SAMs will engage the nuke.
 * (Own SAMs never threaten; the caller filters those out first.)
 */
export function samThreatensNukePreview(
  samOwnerSmallId: number,
  teammateSmallIds: ReadonlySet<number>,
  allySmallIds: ReadonlySet<number>,
  betrayedSmallIds: ReadonlySet<number>,
): boolean {
  if (teammateSmallIds.has(samOwnerSmallId)) return false;
  return (
    !allySmallIds.has(samOwnerSmallId) || betrayedSmallIds.has(samOwnerSmallId)
  );
}

/**
 * Bresenham line of tiles from `a` to `b`, INCLUDING both endpoints. Must match
 * the sim's WallLineExecution.lineTiles so the drag preview shows exactly what
 * will be built.
 */
function wallLineTiles(game: GameView, a: TileRef, b: TileRef): TileRef[] {
  const tiles: TileRef[] = [];
  let x0 = game.x(a);
  let y0 = game.y(a);
  const x1 = game.x(b);
  const y1 = game.y(b);
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  // Bound the work so a wild off-map cursor can't blow up (map diagonal is ample).
  for (let guard = 0; guard < 4096; guard++) {
    tiles.push(game.ref(x0, y0));
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

export class BuildPreviewController implements Controller {
  /** Current ghost (null when no build type is active). */
  private ghostUnit: { buildableUnit: BuildableUnit } | null = null;
  private readonly connectedAllySmallIds: Set<number> = new Set();
  private readonly mousePos = { x: 0, y: 0 };
  private lastGhostQueryAt: number = 0;
  private pendingConfirm: MouseUpEvent | null = null;

  // Buildable validation runs on the snapped tile under the cursor, but the
  // rendered icon follows the cursor at sub-tile precision so motion is
  // continuous instead of stepping tile-to-tile. cursorLoop re-emits each
  // frame with the current cursor world position.
  private lastGhostData: GhostPreviewData | null = null;

  // Static inputs for the nuke trajectory preview (source silo + threatening
  // SAMs + impassable-terrain blocker). Recomputed in the throttled renderGhost
  // path; cursorLoop rebuilds the Bezier each frame with the live cursor
  // position as the destination so the arc tracks the cursor smoothly instead
  // of snapping tile-to-tile.
  private nukeTrajectoryStatic: {
    srcX: number;
    srcY: number;
    sams: SAMInfo[];
    isBlocked: (x: number, y: number) => boolean;
  } | null = null;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    public uiState: UIState,
    private transformHandler: TransformHandler,
    private view: MapRenderer,
    private userSettings: UserSettings,
  ) {}

  init() {
    this.eventBus.on(MouseMoveEvent, (e) => this.moveGhost(e));
    this.eventBus.on(MouseUpEvent, (e) => this.onMapClick(e));
    this.eventBus.on(ConfirmGhostStructureEvent, () =>
      this.requestConfirmStructure(
        new MouseUpEvent(this.mousePos.x, this.mousePos.y),
      ),
    );
    // Mobile: a tap positions the ghost at the tapped tile (no auto-confirm).
    this.eventBus.on(MobilePlacementTapEvent, (e) =>
      this.onMobilePlacementTap(e),
    );

    // Re-emit the ghost each render frame at the cursor's current world
    // position (sub-tile). Buildable validation still runs on the snapped
    // tile in renderGhost(); this loop just keeps the icon under the cursor
    // so motion is continuous instead of stepping tile-to-tile.
    // The shader treats (tileX + 0.5, tileY + 0.5) as the icon center (so an
    // integer tile coord centers on that tile), so we subtract 0.5 here to
    // place the icon exactly under the cursor.
    const cursorLoop = () => {
      const ghost = this.lastGhostData;
      const traj = this.nukeTrajectoryStatic;
      if (ghost !== null || traj !== null) {
        const w = this.transformHandler.screenToWorldCoordinatesFloat(
          this.mousePos.x,
          this.mousePos.y,
        );
        if (ghost !== null) {
          // The range circle (defense post / SAM / nuke radius) normally
          // follows the cursor, so smooth it the same way as the icon. When
          // upgrading, the circle is anchored to the existing structure's tile
          // (stationary, correctly snapped) — leave it alone in that case.
          const radiusFollowsCursor = !(
            ghost.canUpgrade && ghost.upgradeTargetTile !== null
          );
          this.view.updateGhostPreview({
            ...ghost,
            tileX: w.x - 0.5,
            tileY: w.y - 0.5,
            ...(radiusFollowsCursor
              ? { radiusTileX: w.x - 0.5, radiusTileY: w.y - 0.5 }
              : {}),
          });
        }
        if (traj !== null) {
          // Rebuild the arc with the live cursor as the destination (same
          // tile-center convention as the icon: shader adds +0.5).
          this.view.updateNukeTrajectory(
            buildNukeTrajectory(
              traj.srcX,
              traj.srcY,
              w.x - 0.5,
              w.y - 0.5,
              this.game.height(),
              this.uiState.rocketDirectionUp,
              traj.sams,
              traj.isBlocked,
            ),
          );
        }
      }
      requestAnimationFrame(cursorLoop);
    };
    requestAnimationFrame(cursorLoop);
  }

  tick() {
    // Re-query buildables periodically (world state can change — tiles may
    // become buildable as troops/territory move).
    this.syncGhostState();
    this.renderGhost();
  }

  /**
   * Reconcile our internal ghost state with uiState.ghostStructure. Other
   * UI bits (build menu, key bindings) toggle uiState; we mirror it here.
   */
  private syncGhostState(): void {
    const target = this.uiState.ghostStructure;
    if (this.ghostUnit) {
      if (target === null) {
        this.removeGhostStructure();
      } else if (target !== this.ghostUnit.buildableUnit.type) {
        this.clearGhostStructure();
        this.createGhostStructure(target);
      }
    } else if (target !== null) {
      this.createGhostStructure(target);
    }
  }

  renderGhost() {
    if (!this.ghostUnit) return;

    const now = performance.now();
    if (now - this.lastGhostQueryAt < 50) return;
    this.lastGhostQueryAt = now;
    let tileRef: TileRef | undefined;
    const tile = this.transformHandler.screenToWorldCoordinates(
      this.mousePos.x,
      this.mousePos.y,
    );
    if (this.game.isValidCoord(tile.x, tile.y)) {
      tileRef = this.game.ref(tile.x, tile.y);
      // Impassable terrain is a void — treat hovering over it the same as
      // hovering outside the map (no ghost, no trajectory, no blast circle).
      if (this.game.isImpassable(tileRef)) {
        tileRef = undefined;
      }
    }

    // Check if targeting an ally (for nuke warning visual)
    let targetingAlly = false;
    const myPlayer = this.game.myPlayer();
    const nukeType = this.ghostUnit.buildableUnit.type;
    if (
      tileRef &&
      myPlayer &&
      (nukeType === UnitType.AtomBomb ||
        nukeType === UnitType.HydrogenBomb ||
        nukeType === UnitType.ElectricBomb)
    ) {
      this.connectedAllySmallIds.clear();
      const allies = myPlayer.allies();
      for (let i = 0; i < allies.length; i++) {
        const ally = allies[i];
        if (!ally.isDisconnected()) {
          this.connectedAllySmallIds.add(ally.smallID());
        }
      }

      if (this.connectedAllySmallIds.size > 0) {
        targetingAlly = wouldNukeBreakAlliance({
          game: this.game,
          targetTile: tileRef,
          magnitude: this.game.config().nukeMagnitudes(nukeType),
          allySmallIds: this.connectedAllySmallIds,
          threshold: this.game.config().nukeAllianceBreakThreshold(),
        });
      }
    }

    this.game
      ?.myPlayer()
      ?.buildables(tileRef, [this.ghostUnit?.buildableUnit.type])
      .then((buildables) => {
        if (!this.ghostUnit) {
          this.pendingConfirm = null;
          this.emitGhostPreview(tileRef, targetingAlly);
          return;
        }

        const unit = buildables.find(
          (u) => u.type === this.ghostUnit!.buildableUnit.type,
        );
        if (!unit) {
          Object.assign(this.ghostUnit.buildableUnit, {
            canBuild: false,
            canUpgrade: false,
          });
          this.pendingConfirm = null;
          this.emitGhostPreview(tileRef, targetingAlly);
          return;
        }

        this.ghostUnit.buildableUnit = unit;

        if (this.pendingConfirm !== null) {
          const ev = this.pendingConfirm;
          this.pendingConfirm = null;
          if (this.isGhostReadyForConfirm()) {
            this.createStructure(ev);
          }
        }

        this.emitGhostPreview(tileRef, targetingAlly);
      });
  }

  /**
   * Push a GhostPreviewData snapshot to the WebGL view (StructurePass /
   * RangeCirclePass / RailroadPass / CrosshairPass all read it). null when
   * the ghost can't be placed. smoothLoop interpolates displayed position
   * toward the target tile each frame.
   */
  private emitGhostPreview(
    tileRef: TileRef | undefined,
    targetingAlly: boolean,
  ): void {
    const data = this.buildGhostPreviewData(tileRef, targetingAlly);
    if (data === null) {
      this.lastGhostData = null;
      this.view.updateGhostPreview(null);
    } else {
      this.lastGhostData = data;
    }
    this.updateNukeTrajectoryPreview(tileRef);
    this.updateWallDragPreview(tileRef);
  }

  /**
   * While a wall drag is in progress (uiState.wallDragStart set), preview the
   * whole line of walls from the start tile to the cursor. Pushed to the
   * WallPass as translucent instances; cleared when no drag is active.
   */
  private updateWallDragPreview(endTile: TileRef | undefined): void {
    const start = this.uiState.wallDragStart;
    if (start === null) {
      this.view.updateWallPreview(null);
      return;
    }
    if (endTile === undefined) return; // keep the last line when off-map
    this.view.updateWallPreview({
      tiles: wallLineTiles(this.game, start, endTile),
      ownerID: this.game.myPlayer()?.smallID() ?? 0,
    });
  }

  /**
   * For AtomBomb / HydrogenBomb ghosts, push the Bezier trajectory preview
   * (closest player-owned silo → target, accounting for non-allied SAMs).
   * Cleared whenever the ghost isn't a nuke, has no target, or the player
   * has no silos.
   */
  private updateNukeTrajectoryPreview(tileRef: TileRef | undefined): void {
    if (!this.ghostUnit || tileRef === undefined) {
      this.clearNukeTrajectory();
      return;
    }
    const type = this.ghostUnit.buildableUnit.type;
    if (
      type !== UnitType.AtomBomb &&
      type !== UnitType.HydrogenBomb &&
      type !== UnitType.ElectricBomb
    ) {
      this.clearNukeTrajectory();
      return;
    }
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) {
      this.clearNukeTrajectory();
      return;
    }

    // Mirror PlayerImpl.nukeSpawn (the source NukeExecution actually fires
    // from): only silos that are active, not reloading, and not under
    // construction are eligible, and the nearest is chosen by Manhattan
    // distance. Keeping these in sync prevents the preview arc from
    // originating from a silo the game wouldn't use.
    const silos = myPlayer
      .units(UnitType.MissileSilo)
      .filter(
        (u) => u.isActive() && !u.isInCooldown() && !u.isUnderConstruction(),
      );
    if (silos.length === 0) {
      this.clearNukeTrajectory();
      return;
    }

    const dstX = this.game.x(tileRef);
    const dstY = this.game.y(tileRef);
    let bestSilo = silos[0];
    let bestDist = Infinity;
    for (const s of silos) {
      const sx = this.game.x(s.tile());
      const sy = this.game.y(s.tile());
      const d = Math.abs(sx - dstX) + Math.abs(sy - dstY);
      if (d < bestDist) {
        bestDist = d;
        bestSilo = s;
      }
    }
    const srcX = this.game.x(bestSilo.tile());
    const srcY = this.game.y(bestSilo.tile());

    // Non-friendly SAMs threaten the trajectory; own + teammate + allied SAMs
    // don't — except allies this strike would betray: the alliance breaks at
    // launch (NukeExecution.maybeBreakAlliances), so their SAMs will intercept.
    // Teammates have no such exception (a strike never breaks a team).
    // listNukeBreakAlliance is the same function the sim uses there.
    const teammateIds = new Set<number>();
    for (const p of this.game.players()) {
      if (myPlayer.isOnSameTeam(p)) teammateIds.add(p.smallID());
    }
    const allyIds = new Set<number>();
    for (const a of myPlayer.allies()) allyIds.add(a.smallID());
    const betrayedIds: ReadonlySet<number> =
      allyIds.size > 0
        ? listNukeBreakAlliance({
            game: this.game,
            targetTile: tileRef,
            magnitude: this.game.config().nukeMagnitudes(type),
            threshold: this.game.config().nukeAllianceBreakThreshold(),
          })
        : new Set();
    const sams: SAMInfo[] = [];
    for (const s of this.game.units(UnitType.SAMLauncher)) {
      if (!s.isActive()) continue;
      const owner = s.owner();
      if (owner === myPlayer) continue;
      if (
        !samThreatensNukePreview(
          owner.smallID(),
          teammateIds,
          allyIds,
          betrayedIds,
        )
      ) {
        continue;
      }
      const r = this.game.config().samRange(s.level());
      sams.push({
        x: this.game.x(s.tile()),
        y: this.game.y(s.tile()),
        rangeSq: r * r,
      });
    }

    // Stash the static inputs; cursorLoop rebuilds the Bezier each frame with
    // the live cursor as the destination so the arc tracks smoothly.
    // The isBlocked callback tests impassable terrain so the trajectory turns
    // red with a red X where it would cross impassable terrain (matching the
    // simulation's abort-on-impassable behavior).
    this.nukeTrajectoryStatic = {
      srcX,
      srcY,
      sams,
      isBlocked: (x: number, y: number) => {
        if (!this.game.isValidCoord(x, y)) return false;
        return this.game.isImpassable(this.game.ref(x, y));
      },
    };
  }

  private clearNukeTrajectory(): void {
    this.nukeTrajectoryStatic = null;
    this.view.updateNukeTrajectory(null);
  }

  private buildGhostPreviewData(
    tileRef: TileRef | undefined,
    targetingAlly: boolean,
  ): GhostPreviewData | null {
    if (!this.ghostUnit) return null;
    if (tileRef === undefined) return null;
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return null;

    const u = this.ghostUnit.buildableUnit;

    // Upgrade-target tile — only when upgrading an existing unit.
    let upgradeTargetTile: number | null = null;
    if (u.canUpgrade !== false) {
      upgradeTargetTile = this.game.unit(u.canUpgrade)?.tile() ?? null;
    }

    // Range circle: SAM placement preview shows targetable radius; nuke
    // previews show the outer blast radius at the target tile.
    let rangeRadius = 0;
    switch (u.type) {
      case UnitType.SAMLauncher: {
        const level = this.resolveGhostRangeLevel(u) ?? 1;
        rangeRadius = this.game.config().samRange(level);
        break;
      }
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.ElectricBomb:
        rangeRadius = this.game.config().nukeMagnitudes(u.type).outer;
        break;
      case UnitType.Factory:
        rangeRadius = this.game.config().trainStationMaxRange();
        break;
      case UnitType.DefensePost:
        rangeRadius = this.game.config().defensePostRange();
        break;
      case UnitType.WaterTollStation:
        rangeRadius = WATER_TOLL_STATION_RADIUS;
        break;
      case UnitType.Wall:
        // Shows the auto-connect radius: place within it of another of your
        // walls and a wall line is built between the two.
        rangeRadius = this.game.config().wallConnectRange();
        break;
      case UnitType.OilPump:
        // Shows the pump's radius, colored green/red by whether the tile is a
        // valid oil deposit.
        rangeRadius = this.game.config().oilPumpRadius();
        break;
    }
    let radiusTileX = this.game.x(tileRef);
    let radiusTileY = this.game.y(tileRef);
    if (
      rangeRadius > 0 &&
      u.canUpgrade !== false &&
      upgradeTargetTile !== null
    ) {
      radiusTileX = this.game.x(upgradeTargetTile);
      radiusTileY = this.game.y(upgradeTargetTile);
    }

    // Reflect the Tab+wheel build quantity in the cursor: total cost scales
    // with how many copies a single click will place.
    const quantity = this.multiPlaceCount(u.type);
    const cost = u.cost * BigInt(quantity);
    return {
      ghostType: u.type,
      tileX: this.game.x(tileRef),
      tileY: this.game.y(tileRef),
      radiusTileX,
      radiusTileY,
      canBuild: u.canBuild !== false,
      canUpgrade: u.canUpgrade !== false,
      cost: Number(cost),
      quantity,
      showCost: this.userSettings.cursorCostLabel(),
      canAfford: myPlayer.gold() >= cost,
      ghostRailPaths: u.ghostRailPaths,
      overlappingRailroads: u.overlappingRailroads,
      ownerID: myPlayer.smallID(),
      upgradeTargetTile,
      rangeRadius,
      rangeWarning: targetingAlly,
    };
  }

  private isGhostReadyForConfirm(): boolean {
    if (!this.ghostUnit) return false;
    const bu = this.ghostUnit.buildableUnit;
    return bu.canBuild !== false || bu.canUpgrade !== false;
  }

  // Desktop map click (mouse up). Walls use a two-click drag tool; everything
  // else confirms a placement immediately. The mobile Build button and Enter go
  // through requestConfirmStructure directly (old single-tap wall path).
  private onMapClick(e: MouseUpEvent): void {
    if (this.uiState.ghostStructure === UnitType.Wall) {
      this.handleWallDragClick(e);
      return;
    }
    this.requestConfirmStructure(e);
  }

  private requestConfirmStructure(e: MouseUpEvent): void {
    if (!this.ghostUnit && !this.uiState.ghostStructure) return;
    if (this.isGhostReadyForConfirm()) {
      this.createStructure(e);
    } else {
      this.pendingConfirm = e;
    }
  }

  /**
   * Wall drag-build click handler. First map click on buildable land sets the
   * line start; the second click emits a wall-line build intent from the start
   * to the clicked tile and keeps the wall armed for another line.
   */
  private handleWallDragClick(e: MouseUpEvent): void {
    const tile = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
    if (!this.game.isValidCoord(tile.x, tile.y)) return;
    const tileRef = this.game.ref(tile.x, tile.y);

    if (this.uiState.wallDragStart === null) {
      // First click: anchor the start on placeable land (the sim validates each
      // tile again; this just avoids starting a line out on water).
      if (this.game.isLand(tileRef) && !this.game.isImpassable(tileRef)) {
        this.uiState.wallDragStart = tileRef;
      }
      return;
    }

    // Second click: build the whole line from the start to here.
    this.eventBus.emit(
      new BuildUnitIntentEvent(
        UnitType.Wall,
        tileRef,
        undefined,
        undefined,
        this.uiState.wallDragStart,
      ),
    );
    this.uiState.wallDragStart = null;
    this.view.updateWallPreview(null);
  }

  private createStructure(e: MouseUpEvent) {
    if (!this.ghostUnit) return;
    if (
      this.ghostUnit.buildableUnit.canBuild === false &&
      this.ghostUnit.buildableUnit.canUpgrade === false
    ) {
      this.removeGhostStructure();
      return;
    }
    const tile = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
    if (this.ghostUnit.buildableUnit.canUpgrade !== false) {
      // Tab+wheel quantity also stacks an existing structure: each intent is one
      // level (upgrades are instant, so N in a tick add N levels, gold allowing).
      const count = this.multiPlaceCount(this.ghostUnit.buildableUnit.type);
      for (let i = 0; i < count; i++) {
        this.eventBus.emit(
          new SendUpgradeStructureIntentEvent(
            this.ghostUnit.buildableUnit.canUpgrade,
            this.ghostUnit.buildableUnit.type,
          ),
        );
      }
      this.removeGhostStructure();
    } else if (this.ghostUnit.buildableUnit.canBuild) {
      const unitType = this.ghostUnit.buildableUnit.type;
      const rocketDirectionUp =
        unitType === UnitType.AtomBomb || unitType === UnitType.HydrogenBomb
          ? this.uiState.rocketDirectionUp
          : undefined;
      const tileRef = this.game.ref(tile.x, tile.y);
      // Tab+wheel can raise the build quantity: build the structure and level it
      // straight up to that count (one intent — the sim does the stacking).
      const count = this.multiPlaceCount(unitType);
      this.eventBus.emit(
        new BuildUnitIntentEvent(unitType, tileRef, rocketDirectionUp, count),
      );
      if (!shouldPreserveGhostAfterBuild(unitType)) {
        this.removeGhostStructure();
      }
    } else {
      this.removeGhostStructure();
    }
  }

  private moveGhost(e: MouseMoveEvent) {
    this.mousePos.x = e.x;
    this.mousePos.y = e.y;
  }

  // Mobile tap: move the ghost to the tapped tile and remember it so the
  // bottom-centre "Build" button knows a placement target exists. No confirm.
  private onMobilePlacementTap(e: MobilePlacementTapEvent) {
    this.mousePos.x = e.x;
    this.mousePos.y = e.y;
    const tile = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
    this.uiState.mobilePlacementTile = this.game.isValidCoord(tile.x, tile.y)
      ? this.game.ref(tile.x, tile.y)
      : null;
  }

  private createGhostStructure(type: PlayerBuildableUnitType | null) {
    if (type === null) return;
    if (this.game.myPlayer() === null) return;
    this.ghostUnit = {
      buildableUnit: {
        type,
        canBuild: false,
        canUpgrade: false,
        cost: 0n,
        overlappingRailroads: [],
        ghostRailPaths: [],
        stockpile: 0,
      },
    };
  }

  private clearGhostStructure() {
    this.pendingConfirm = null;
    this.ghostUnit = null;
    this.lastGhostData = null;
    this.uiState.mobilePlacementTile = null;
    this.uiState.wallDragStart = null;
    this.view.updateGhostPreview(null);
    this.view.updateWallPreview(null);
    this.clearNukeTrajectory();
  }

  private removeGhostStructure() {
    this.clearGhostStructure();
    this.uiState.ghostStructure = null;
    this.uiState.buildQuantity = 1;
  }

  /**
   * How many copies of a structure to place per click. Tab+wheel sets
   * uiState.buildQuantity; attack units (nukes / warship) are always single.
   */
  private multiPlaceCount(unitType: UnitType): number {
    switch (unitType) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.MIRV:
      case UnitType.Warship:
        return 1;
      default:
        return Math.max(1, this.uiState.buildQuantity);
    }
  }

  private resolveGhostRangeLevel(
    buildableUnit: BuildableUnit,
  ): number | undefined {
    if (buildableUnit.type !== UnitType.SAMLauncher) return undefined;
    if (buildableUnit.canUpgrade !== false) {
      const existing = this.game.unit(buildableUnit.canUpgrade);
      if (existing) {
        return existing.level() + 1;
      } else {
        console.error("Failed to find existing SAMLauncher for upgrade");
      }
    }
    return 1;
  }
}

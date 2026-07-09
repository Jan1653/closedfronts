import { Game, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

// Toll gate radius — must match WaterTollStationExecution.TOLL_GATE_RADIUS.
const GATE = 2;
// Max sidesteps spent trying to skirt a gate before giving up and passing
// through (paying) — the "detour too long → go through" cutoff.
const MAX_DETOUR = 12;

/**
 * Best-effort, bounded avoidance of enemy/neutral water toll gates for a boat.
 *
 * Each move step the boat asks step(): "I'm about to move to `plannedNext` — is
 * that inside an enemy toll gate, and can I skirt it?" It greedily steers to the
 * gate-free orthogonal neighbour closest to the destination (the toll gate is a
 * small convex disc, so this rounds it toward the goal). A step budget caps the
 * detour: if it can't get clear in MAX_DETOUR steps, or the gate is the only way
 * through (no gate-free neighbour), it returns `plannedNext` and passes through —
 * paying the toll. Own/allied stations are never avoided, and the boat's normal
 * pathfinder re-routes from wherever it ends up, so it can never get stuck.
 */
export class TollAvoidance {
  private budget = 0;
  private readonly scratch: TileRef[] = [0, 0, 0, 0];

  step(
    mg: Game,
    owner: Player,
    boatTile: TileRef,
    plannedNext: TileRef,
    dst: TileRef,
  ): TileRef {
    // Not heading into an enemy gate → normal move; end any detour.
    if (!this.inEnemyGate(mg, owner, plannedNext)) {
      this.budget = 0;
      return plannedNext;
    }
    // Already inside a gate (committed / no room to skirt) → go through.
    if (this.inEnemyGate(mg, owner, boatTile)) {
      return plannedNext;
    }
    // Start / continue a detour, capped so a long or blocked detour falls
    // through to paying the toll.
    if (this.budget <= 0) this.budget = MAX_DETOUR;
    this.budget--;
    if (this.budget <= 0) return plannedNext;
    return this.bestSidestep(mg, owner, boatTile, dst) ?? plannedNext;
  }

  private inEnemyGate(mg: Game, owner: Player, tile: TileRef): boolean {
    for (const { unit } of mg.nearbyUnits(
      tile,
      GATE,
      UnitType.WaterTollStation,
    )) {
      if (!unit.isActive() || unit.isUnderConstruction()) continue;
      const so = unit.owner();
      if (so === owner || so.isFriendly(owner) || so.isOnSameTeam(owner)) {
        continue; // own & allied stations don't toll us → nothing to avoid
      }
      return true;
    }
    return false;
  }

  private bestSidestep(
    mg: Game,
    owner: Player,
    boatTile: TileRef,
    dst: TileRef,
  ): TileRef | null {
    const n = mg.neighbors4(boatTile, this.scratch);
    let best: TileRef | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      const t = this.scratch[i];
      if (!mg.isValidRef(t) || !mg.isWater(t) || mg.isImpassable(t)) continue;
      if (this.inEnemyGate(mg, owner, t)) continue;
      const d = mg.manhattanDist(t, dst);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    return best;
  }
}

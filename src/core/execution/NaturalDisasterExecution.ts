import {
  Execution,
  Game,
  MessageType,
  NaturalDisasterType,
  Player,
  Structures,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { GameUpdateType } from "../game/GameUpdates";
import { PseudoRandom } from "../PseudoRandom";
import { OilExplosionExecution } from "./OilExplosionExecution";

// A structure disabled by a disaster stays down until an Emergency Station
// repairs it ("permanent"): the disable window is pushed far beyond any
// realistic game length.
const PERMANENT_DISABLE_TICKS = 100_000_000;

/**
 * Natural disasters: a single long-lived scheduler that periodically rolls one
 * of the enabled disaster types, announces it ~1 minute ahead (HUD banner via
 * NaturalDisasterUpdate + event-log message), then runs its active phase:
 *
 *  - Drought: no oil is produced game-wide for the (long) duration.
 *  - Flood: a region's structures are disabled until repaired.
 *  - Landslide: like a flood, smaller slab, shorter warning payoff.
 *  - Heatwave: every unprotected oil pump has a 50% total chance to explode
 *    over the duration (protected = in an Emergency Station's radius).
 *
 * Localized disasters slightly prefer the largest player's territory, and an
 * Emergency Station covering the struck spot can avert them entirely.
 */
export class NaturalDisasterExecution implements Execution {
  private mg: Game;
  private random: PseudoRandom;
  private active = true;

  private phase: "idle" | "warning" | "active" = "idle";
  private currentType: NaturalDisasterType | null = null;
  private phaseEndsAt = 0;
  private nextDisasterAt = 0;

  // Region of the current localized disaster.
  private center: TileRef | null = null;
  private radius = 0;

  // Heatwave: per-tick explosion probability in micro-units (0..1e6), chosen
  // so the cumulative chance over the whole duration hits the configured 50%.
  private heatwavePerTickMicro = 0;

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(ticks + 0xd15a);
    if (mg.config().enabledNaturalDisasters().length === 0) {
      this.active = false;
      return;
    }
    this.scheduleNext(ticks);
  }

  tick(ticks: number): void {
    switch (this.phase) {
      case "idle":
        if (ticks >= this.nextDisasterAt) {
          this.startWarning(ticks);
        }
        return;
      case "warning":
        if (ticks >= this.phaseEndsAt) {
          this.activate(ticks);
        }
        return;
      case "active":
        if (this.currentType === NaturalDisasterType.Heatwave) {
          this.tickHeatwave();
        }
        if (ticks >= this.phaseEndsAt) {
          this.finish(ticks);
        }
        return;
    }
  }

  private scheduleNext(now: number): void {
    // Jitter the interval ±33% so disasters don't feel metronomic.
    const base = this.mg.config().disasterIntervalTicks();
    const jitter = this.random.nextInt(-base / 3, base / 3 + 1);
    this.nextDisasterAt = now + base + jitter;
    this.phase = "idle";
    this.currentType = null;
    this.center = null;
    this.radius = 0;
  }

  private startWarning(now: number): void {
    const config = this.mg.config();
    const enabled = config.enabledNaturalDisasters();
    if (enabled.length === 0) {
      this.active = false;
      return;
    }
    const type = enabled[this.random.nextInt(0, enabled.length)];

    // Localized disasters need a target region; an Emergency Station covering
    // the chosen spot can avert the whole event (the station "dampens" it).
    if (
      type === NaturalDisasterType.Flood ||
      type === NaturalDisasterType.Landslide
    ) {
      const center = this.pickTargetTile();
      if (center === null) {
        this.scheduleNext(now);
        return;
      }
      if (
        this.coveredByEmergencyStation(center) &&
        this.random.nextInt(0, 100) < config.emergencyStationAvertPercent()
      ) {
        this.scheduleNext(now);
        return;
      }
      this.center = center;
      this.radius =
        type === NaturalDisasterType.Flood
          ? config.disasterFloodRadius()
          : config.disasterLandslideRadius();
    }

    this.currentType = type;
    this.phase = "warning";
    this.phaseEndsAt = now + config.disasterWarningDurationTicks();
    this.emitUpdate(now, "warning");
    this.mg.displayMessage(
      `events_display.disaster_warning_${type.toLowerCase()}`,
      MessageType.CHAT,
      null,
    );
  }

  private activate(now: number): void {
    const config = this.mg.config();
    const type = this.currentType!;
    this.phase = "active";
    this.phaseEndsAt = now + config.disasterDurationTicks(type);

    switch (type) {
      case NaturalDisasterType.Drought:
        this.mg.setDroughtActive(true);
        break;
      case NaturalDisasterType.Flood:
      case NaturalDisasterType.Landslide:
        this.disableRegionStructures();
        break;
      case NaturalDisasterType.Heatwave: {
        // Per-tick micro-probability p with (1-p)^duration = 1 - total%.
        const duration = config.disasterDurationTicks(type);
        const total = config.heatwavePumpExplosionTotalPercent() / 100;
        const p = 1 - Math.pow(1 - total, 1 / duration);
        this.heatwavePerTickMicro = Math.max(1, Math.round(p * 1_000_000));
        break;
      }
    }
    this.emitUpdate(now, "active");
    this.mg.displayMessage(
      `events_display.disaster_active_${type.toLowerCase()}`,
      MessageType.CHAT,
      null,
    );
  }

  private finish(now: number): void {
    if (this.currentType === NaturalDisasterType.Drought) {
      this.mg.setDroughtActive(false);
    }
    this.emitUpdate(now, "ended");
    this.scheduleNext(now);
  }

  private emitUpdate(now: number, phase: "warning" | "active" | "ended"): void {
    this.mg.addUpdate({
      type: GameUpdateType.NaturalDisaster,
      disaster: this.currentType!,
      phase,
      phaseStartTick: now,
      phaseEndTick: phase === "ended" ? now : this.phaseEndsAt,
      center: this.center ?? undefined,
      radius: this.radius > 0 ? this.radius : undefined,
    });
  }

  // Target for a localized disaster: an owned land tile. Usually a uniformly
  // random player's territory (which already weighs big empires by area), with
  // a slight extra bias toward the largest player.
  private pickTargetTile(): TileRef | null {
    const players = this.mg
      .players()
      .filter((p) => p.isAlive() && p.numTilesOwned() > 0);
    if (players.length === 0) return null;

    let target: Player;
    if (
      this.random.nextInt(0, 100) <
      this.mg.config().disasterBigPlayerBiasPercent()
    ) {
      target = players.reduce((a, b) =>
        b.numTilesOwned() > a.numTilesOwned() ? b : a,
      );
    } else {
      target = players[this.random.nextInt(0, players.length)];
    }

    // Sample a random tile of the target's territory by rejection sampling
    // over the map (bounded attempts, deterministic).
    for (let i = 0; i < 300; i++) {
      const x = this.random.nextInt(0, this.mg.width());
      const y = this.random.nextInt(0, this.mg.height());
      const t = this.mg.ref(x, y);
      if (this.mg.owner(t) === target) return t;
    }
    // Fallback: any structure tile of the target, else give up this round.
    const units = target.units(Structures.types);
    if (units.length > 0) {
      return units[this.random.nextInt(0, units.length)].tile();
    }
    return null;
  }

  private coveredByEmergencyStation(tile: TileRef): boolean {
    const radius = this.mg.config().emergencyStationRadius();
    for (const { unit } of this.mg.nearbyUnits(tile, radius, [
      UnitType.EmergencyStation,
    ])) {
      if (unit.isActive() && !unit.isUnderConstruction() && !unit.isDisabled())
        return true;
    }
    return false;
  }

  // Flood / landslide impact: every finished structure in the region is
  // disabled until an Emergency Station repairs it.
  private disableRegionStructures(): void {
    if (this.center === null) return;
    const until = this.mg.ticks() + PERMANENT_DISABLE_TICKS;
    for (const { unit } of this.mg.nearbyUnits(
      this.center,
      this.radius,
      Structures.types,
    )) {
      if (!unit.isActive() || unit.isUnderConstruction()) continue;
      // Emergency stations themselves ride out the disaster — otherwise the
      // repair mechanic could never recover a struck district.
      if (unit.type() === UnitType.EmergencyStation) continue;
      unit.disableUntil(until);
    }
  }

  private tickHeatwave(): void {
    // Roll each active, unprotected pump once per tick.
    for (const pump of this.allPumps()) {
      if (!pump.isActive() || pump.isUnderConstruction()) continue;
      if (this.coveredByEmergencyStation(pump.tile())) continue;
      if (this.random.nextInt(0, 1_000_000) < this.heatwavePerTickMicro) {
        const tile = pump.tile();
        const level = pump.level();
        pump.delete(true);
        this.mg.addExecution(new OilExplosionExecution(tile, level));
      }
    }
  }

  private allPumps(): Unit[] {
    return this.mg.units(UnitType.OilPump);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

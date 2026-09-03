import { z } from "zod";
import { PlayerView } from "../../client/view";
import { AssetManifest } from "../AssetUrls";
import { DoomsdayClockSpeed } from "../game/DoomsdayClock";
import {
  Difficulty,
  Game,
  GameMode,
  GameType,
  Gold,
  NaturalDisasterType,
  Player,
  PlayerInfo,
  PlayerType,
  ShipClass,
  TerrainType,
  TerraNullius,
  Tick,
  UnitInfo,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import {
  isOilDepositAt,
  OIL_GRADE_PERCENT,
  oilDepositGradeAt,
} from "../game/OilDeposits";
import { UserSettings } from "../game/UserSettings";
import { GameConfig, TeamCountConfig } from "../Schemas";
import { NukeType } from "../StatsSchemas";
import { assertNever, sigmoid, toInt, within } from "../Util";

declare global {
  interface Window {
    BOOTSTRAP_CONFIG?: {
      gitCommit?: string;
      assetManifest?: AssetManifest;
      cdnBase?: string;
      gameEnv?: string;
      numWorkers?: number;
      turnstileSiteKey?: string;
      jwtAudience?: string;
      instanceId?: string;
    };
  }
}

export enum GameEnv {
  Dev,
  Preprod,
  Prod,
}

export function parseGameEnv(value: string | undefined): GameEnv {
  switch (value) {
    case "dev":
      return GameEnv.Dev;
    case "staging":
      return GameEnv.Preprod;
    case "prod":
      return GameEnv.Prod;
    default:
      throw new Error(`unsupported game env: ${value}`);
  }
}

export interface NukeMagnitude {
  inner: number;
  outer: number;
}

const DEFENSE_DEBUFF_MIDPOINT = 150_000;
const DEFENSE_DEBUFF_DECAY_RATE = Math.LN2 / 50000;
const DEFAULT_SPAWN_IMMUNITY_TICKS = 5 * 10;

export const JwksSchema = z.object({
  keys: z
    .object({
      alg: z.literal("EdDSA"),
      crv: z.literal("Ed25519"),
      kty: z.literal("OKP"),
      x: z.string(),
    })
    .array()
    .min(1),
});

/** SAM launcher construction duration in ticks (non-instant-build). */
export const SAM_CONSTRUCTION_TICKS = 30 * 10;

// Doomsday Clock tunables (anti-stall). Off unless enabled in GameConfig.
// Times in seconds. The required map share rises in waves (levels + times in
// DoomsdayClock.ts, chosen by `speed`). A side caught below the bar gets a
// warnSeconds cooldown ("Danger, decay in Xs"), then troops bleed to zero: the
// warn (10s) + the linear drain (~55s from full troops, sooner with fewer troops
// or a shrinking territory) make ~1 minute from caught to wiped out.
const DOOMSDAY_CLOCK_DEFAULTS = {
  enabled: false,
  speed: "normal" as DoomsdayClockSpeed,
  warnSeconds: 10, // cooldown before decay after the bar catches you
  drainStartPercent: 2, // starts bleeding at once (already beats troop income)
  drainMaxPercent: 6,
  drainRampSeconds: 50, // ramps LINEARLY to the max over this long
  // Warships bleed on the same start + ramp but to a much higher ceiling than
  // troops, so a fleet at full attrition sinks in ~2s (50% of a ship's max
  // health per second) instead of riding out the gentle troop rate. Ships only.
  warshipDrainMaxPercent: 50,
};

export class Config {
  private unitInfoCache = new Map<UnitType, UnitInfo>();
  constructor(
    private _gameConfig: GameConfig,
    private _userSettings: UserSettings | null,
    private _isReplay: boolean,
  ) {}

  isReplay(): boolean {
    return this._isReplay;
  }

  traitorDefenseDebuff(): number {
    return 0.5;
  }
  traitorSpeedDebuff(): number {
    return 0.8;
  }
  traitorDuration(): number {
    return 30 * 10; // 30 seconds
  }

  // Doomsday Clock config, resolved against defaults. One read per tick.
  doomsdayClockConfig(): typeof DOOMSDAY_CLOCK_DEFAULTS {
    const c = this._gameConfig.doomsdayClock;
    const d = DOOMSDAY_CLOCK_DEFAULTS;
    return {
      enabled: c?.enabled ?? d.enabled,
      speed: c?.speed ?? d.speed,
      // Drain/warn tuning is internal (not wire-configurable): always defaults.
      warnSeconds: d.warnSeconds,
      drainStartPercent: d.drainStartPercent,
      drainMaxPercent: d.drainMaxPercent,
      drainRampSeconds: d.drainRampSeconds,
      warshipDrainMaxPercent: d.warshipDrainMaxPercent,
    };
  }
  spawnImmunityDuration(): Tick {
    return (
      this._gameConfig.spawnImmunityDuration ?? DEFAULT_SPAWN_IMMUNITY_TICKS
    );
  }
  nationSpawnImmunityDuration(): Tick {
    return DEFAULT_SPAWN_IMMUNITY_TICKS;
  }
  hasExtendedSpawnImmunity(): boolean {
    return this.spawnImmunityDuration() > DEFAULT_SPAWN_IMMUNITY_TICKS;
  }

  gameConfig(): GameConfig {
    return this._gameConfig;
  }

  userSettings(): UserSettings {
    if (this._userSettings === null) {
      throw new Error("userSettings is null");
    }
    return this._userSettings;
  }

  // Housing: every city level raises the troop ceiling by this much. Cities are
  // the main way to grow an army now — raw territory contributes noticeably
  // less than it used to (see maxTroops).
  cityTroopIncrease(): number {
    return 400_000;
  }

  // Weight of raw territory in the troop ceiling. Deliberately below the old
  // 1000 so sprawling without building cities no longer carries an army.
  troopsPerTileWeight(): number {
    return 800;
  }

  falloutDefenseModifier(falloutRatio: number): number {
    // falloutRatio is between 0 and 1
    // So defense modifier is between [5, 2.5]
    return 5 - falloutRatio * 2;
  }
  msPerTick(): number {
    return 100;
  }
  SAMCooldown(): number {
    return 90;
  }
  SiloCooldown(): number {
    return 90;
  }

  // Defense-post radius grows with each upgrade level, up to a hard cap.
  defensePostRange(level: number = 1): number {
    return Math.min(60, 30 + (Math.max(1, level) - 1) * 10);
  }

  // Ticks between grenade bursts. Level 1 is deliberately slow (every 2nd tick,
  // i.e. half the old rate); each upgrade speeds it up to every tick.
  defensePostFireInterval(level: number = 1): number {
    return Math.max(1, level) <= 1 ? 2 : 1;
  }

  // Tiles captured per burst: one per level, capped at level 4 (upgrading past
  // 4 adds nothing). A lone level-1 post now only retakes one tile per burst, so
  // a real attack out-paces it — a small island held by a post can be taken.
  defensePostGrenadesPerBurst(level: number = 1): number {
    return Math.min(4, Math.max(1, level));
  }

  defensePostDefenseBonus(): number {
    // Still far below the old post (which multiplied attacker losses by 5, i.e.
    // ×4 above neutral) but a noticeable step up from the previous ≈×0.67 above
    // neutral. Overlapping posts stack this up to 3× (see attackLogic), so a
    // real cluster bites hard while a lone post is still pushable.
    return 1 + (5 - 1) / 4; // = 2.0
  }

  // Multiplier on attack cost when conquering a walled tile. Walls are meant to
  // be very hard to break through with normal attacks (bombs / defense-post
  // barrages remain the easy answers).
  wallDefenseBonus(): number {
    return 120;
  }

  // A wall's "health": it must be sieged from full down to 0 before an attack can
  // breach it. Higher = walls take longer to break.
  wallMaxHealth(): number {
    return 250;
  }

  // Health a wall regenerates per tick while it is NOT under active siege — this
  // is how the damage "reverts" when the attacker is repelled. A larger
  // standing army garrisons its walls: regen grows (mildly) with the owner's
  // troop count.
  wallRegenPerTick(owner?: Player): number {
    const troops = owner?.troops() ?? 0;
    return Math.min(12, 4 + Math.floor(troops / 80_000));
  }

  // Health a besieging attacker strips from a wall each tick, scaled by the
  // attacking force so a bigger army breaks through faster (and a small one
  // barely dents it — slower with fewer troops). The wall owner's standing
  // army reinforces the wall: damage is divided by (1 + ownerTroops/50k), so
  // a big nation attacking an equally big defender no longer melts walls in
  // seconds, while walls of a small/abandoned player still fall fast.
  // Clamped to a sane band (min 1 so every wall falls eventually).
  wallSiegeDamagePerTick(attackerTroops: number, wallOwner?: Player): number {
    const base = attackerTroops / 1000;
    const defense = 1 + (wallOwner?.troops() ?? 0) / 50_000;
    const dmg = Math.floor(base / defense);
    return Math.max(1, Math.min(20, dmg));
  }

  // Walls can't be stacked/placed densely: a new wall must be at least this many
  // tiles from any existing wall (like other structures keep spacing).
  wallMinSpacing(): number {
    return 3;
  }

  // When a wall is placed within this range (tiles) of another of the player's
  // walls, a wall line is auto-built between the two (free filler segments).
  wallConnectRange(): number {
    return 25;
  }

  defensePostSpeedBonus(): number {
    return 3;
  }

  playerTeams(): TeamCountConfig {
    return this._gameConfig.playerTeams ?? 0;
  }

  spawnNations(): boolean {
    return this._gameConfig.nations !== "disabled";
  }

  isUnitDisabled(unitType: UnitType): boolean {
    return this._gameConfig.disabledUnits?.includes(unitType) ?? false;
  }

  bots(): number {
    return this._gameConfig.bots;
  }
  instantBuild(): boolean {
    return this._gameConfig.instantBuild;
  }
  disableNavMesh(): boolean {
    return this._gameConfig.disableNavMesh ?? false;
  }
  disableAlliances(): boolean {
    return this._gameConfig.disableAlliances ?? false;
  }
  waterNukes(): boolean {
    return this._gameConfig.waterNukes ?? false;
  }
  isRandomSpawn(): boolean {
    return this._gameConfig.randomSpawn;
  }
  infiniteGold(): boolean {
    return this._gameConfig.infiniteGold;
  }
  donateGold(): boolean {
    return this._gameConfig.donateGold;
  }
  infiniteTroops(): boolean {
    return this._gameConfig.infiniteTroops;
  }
  donateTroops(): boolean {
    return this._gameConfig.donateTroops;
  }
  // Gifting oil to allies. Optional in the config; defaults to allowed.
  donateOil(): boolean {
    return this._gameConfig.donateOil ?? true;
  }
  goldMultiplier(): number {
    return this._gameConfig.goldMultiplier ?? 1;
  }
  startingGold(playerInfo: PlayerInfo): Gold {
    if (playerInfo.playerType === PlayerType.Bot) {
      return 0n;
    }
    return this.startingGoldFor(playerInfo);
  }

  trainSpawnRate(numPlayerFactories: number): number {
    // hyperbolic decay, midpoint at 10 factories
    // expected number of trains = numPlayerFactories  / trainSpawnRate(numPlayerFactories)
    // Lower divisor than before => trains run more often, so a rail network of
    // factories pays off much more than it used to.
    return (numPlayerFactories + 10) * 10;
  }
  trainGold(
    rel: "self" | "team" | "ally" | "other",
    citiesVisited: number,
    player: Player | PlayerView,
  ): Gold {
    // No penalty for the first 10 cities.
    citiesVisited = Math.max(0, citiesVisited - 9);
    // Rail freight pays substantially better than it used to — a well-linked
    // factory network is meant to be a real economy, not a side hustle.
    let baseGold: number;
    switch (rel) {
      case "ally":
        baseGold = 60_000;
        break;
      case "team":
      case "other":
        baseGold = 45_000;
        break;
      case "self":
        baseGold = 20_000;
        break;
    }
    const distPenalty = citiesVisited * 5_000;
    const gold = Math.max(10_000, baseGold - distPenalty);
    return toInt(gold * this.goldMultiplierFor(player));
  }

  trainStationMinRange(): number {
    return 15;
  }
  trainStationMaxRange(): number {
    return 110;
  }
  railroadMaxSize(): number {
    return this.trainStationMaxRange() * 1.4142;
  }

  tradeShipGold(dist: number, player: Player | PlayerView): Gold {
    // Sigmoid: concave start, sharp S-curve middle, linear end - heavily punishes trades under range debuff.
    // Trimmed down a notch: sea trade should support an economy, not be one.
    const debuff = this.tradeShipShortRangeDebuff();
    const baseGold =
      60_000 / (1 + Math.exp(-0.03 * (dist - debuff))) + 40 * dist;
    return BigInt(Math.floor(baseGold * this.goldMultiplierFor(player)));
  }

  /**
   * Share (integer percent) of the normal arrival gold a PIRATED trade ship
   * pays out when it reaches the captor's port. Taking someone else's freighter
   * is still worth doing, just not as lucrative as running your own routes.
   */
  capturedTradeShipGoldPercent(): bigint {
    return 65n;
  }

  // Probability of trade ship spawn = 1 / tradeShipSpawnRate
  tradeShipSpawnRate(
    tradeShipSpawnRejections: number,
    numTradeShips: number,
  ): number {
    const decayRate = Math.LN2 / 50;

    // Approaches 0 as numTradeShips increase
    const baseSpawnRate = 1 - sigmoid(numTradeShips, decayRate, 400);

    // Pity timer: increases spawn chance after consecutive rejections
    const rejectionModifier = 1 / (tradeShipSpawnRejections + 1);

    return Math.floor((100 * rejectionModifier) / baseSpawnRate);
  }

  unitInfo(type: UnitType): UnitInfo {
    const cached = this.unitInfoCache.get(type);
    if (cached !== undefined) {
      return cached;
    }

    let info: UnitInfo;
    switch (type) {
      case UnitType.TransportShip:
        info = {
          cost: () => 0n,
        };
        break;
      // Ship prices are all doubled — a navy is a real investment. The one
      // exception is the atomic submarine: already the most expensive thing in
      // the game, it got a bigger hull and heavier torpedoes instead.
      case UnitType.Warship:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(2_000_000, (numUnits + 1) * 500_000),
            UnitType.Warship,
          ),
          maxHealth: 1000,
        };
        break;
      case UnitType.FishingBoat:
        info = {
          cost: this.costWrapper(() => 200_000, UnitType.FishingBoat),
          maxHealth: 120,
        };
        break;
      case UnitType.PatrolBoat:
        info = {
          cost: this.costWrapper(() => 400_000, UnitType.PatrolBoat),
          maxHealth: 300,
        };
        break;
      case UnitType.Submarine:
        info = {
          cost: this.costWrapper(() => 3_000_000, UnitType.Submarine),
          maxHealth: 800,
        };
        break;
      case UnitType.AtomicSubmarine:
        info = {
          cost: this.costWrapper(() => 12_000_000, UnitType.AtomicSubmarine),
          // Price unchanged, but the hull is now more than four times what it
          // was — the atomic sub is the flagship of the fleet, not a slightly
          // better submarine.
          maxHealth: 10_000,
        };
        break;
      case UnitType.Lighthouse:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(1_500_000, (numUnits + 1) * 400_000),
            UnitType.Lighthouse,
          ),
          constructionDuration: this.instantBuild() ? 0 : 5 * 10,
          maxHealth: 1000,
          // Stackable up to level 5: each level widens the scan/support radius
          // enormously (see lighthouseRadius).
          upgradable: true,
        };
        break;
      case UnitType.Shell:
        info = {
          cost: () => 0n,
          damage: 250,
        };
        break;
      case UnitType.SAMMissile:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.Port:
        info = {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(1_000_000, Math.pow(2, numUnits) * 125_000),
            UnitType.Port,
            UnitType.Factory,
          ),
          constructionDuration: this.instantBuild() ? 0 : 5 * 10,
          upgradable: true,
        };
        break;
      // Every bomb costs twice what it used to — ordnance is a decision, not a
      // rotation.
      case UnitType.AtomBomb:
        info = {
          cost: this.nukeCost(1_500_000, UnitType.AtomBomb),
        };
        break;
      case UnitType.HydrogenBomb:
        info = {
          cost: this.nukeCost(10_000_000, UnitType.HydrogenBomb),
        };
        break;
      case UnitType.ElectricBomb:
        // Slightly pricier than an atom bomb (it denies the whole area instead
        // of levelling it).
        info = {
          cost: this.nukeCost(1_800_000, UnitType.ElectricBomb),
        };
        break;
      case UnitType.MIRV:
        info = {
          cost: (game: Game, player: Player) => {
            if (
              player.type() === PlayerType.Human &&
              this.hasInfiniteGoldFor(player)
            ) {
              return 0n;
            }
            return 50_000_000n + game.stats().numMirvsLaunched() * 30_000_000n;
          },
        };
        break;
      case UnitType.MIRVWarhead:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.TradeShip:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.MissileSilo:
        info = {
          cost: this.costWrapper(() => 1_000_000, UnitType.MissileSilo),
          constructionDuration: this.instantBuild() ? 0 : 10 * 10,
          upgradable: true,
        };
        break;
      case UnitType.DefensePost:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(750_000, (numUnits + 1) * 150_000),
            UnitType.DefensePost,
          ),
          constructionDuration: this.instantBuild() ? 0 : 5 * 10,
          upgradable: true,
        };
        break;
      case UnitType.SAMLauncher:
        info = {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(3_000_000, (numUnits + 1) * 1_500_000),
            UnitType.SAMLauncher,
          ),
          constructionDuration: this.instantBuild()
            ? 0
            : SAM_CONSTRUCTION_TICKS,
          upgradable: true,
        };
        break;
      case UnitType.City:
        info = {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(1_000_000, Math.pow(2, numUnits) * 125_000),
            UnitType.City,
          ),
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
          upgradable: true,
        };
        break;
      case UnitType.Factory:
        info = {
          cost: this.costWrapper(
            (numUnits: number) =>
              Math.min(1_000_000, Math.pow(2, numUnits) * 125_000),
            UnitType.Factory,
            UnitType.Port,
          ),
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
          upgradable: true,
        };
        break;
      case UnitType.Train:
        info = {
          cost: () => 0n,
        };
        break;
      case UnitType.WaterTollStation:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(500_000, (numUnits + 1) * 100_000),
            UnitType.WaterTollStation,
          ),
          // Long build: the builder ship has to hold at the strait the whole
          // time (and can be sunk), so a toll station takes real commitment.
          constructionDuration: this.instantBuild() ? 0 : 30 * 10,
          maxHealth: 1000,
        };
        break;
      case UnitType.Wall:
        info = {
          cost: this.costWrapper(() => 20_000, UnitType.Wall),
          constructionDuration: this.instantBuild() ? 0 : 2 * 10,
          // A wall must be sieged down before an attack can breach it (a progress
          // bar shows the damage). Regenerates when the pressure lets up.
          maxHealth: this.wallMaxHealth(),
        };
        break;
      case UnitType.OilPump:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(1_000_000, (numUnits + 1) * 200_000),
            UnitType.OilPump,
          ),
          constructionDuration: this.instantBuild() ? 0 : 3 * 10,
          // Stackable: building on it levels it up (more oil, bigger radius).
          upgradable: true,
        };
        break;
      case UnitType.OilStorage:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(1_000_000, (numUnits + 1) * 150_000),
            UnitType.OilStorage,
          ),
          constructionDuration: this.instantBuild() ? 0 : 3 * 10,
          upgradable: true,
        };
        break;
      case UnitType.EmergencyStation:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(2_000_000, (numUnits + 1) * 400_000),
            UnitType.EmergencyStation,
          ),
          constructionDuration: this.instantBuild() ? 0 : 3 * 10,
        };
        break;
      default:
        assertNever(type);
    }

    this.unitInfoCache.set(type, info);
    return info;
  }

  private hasInfiniteGoldFor(player: Player | PlayerView): boolean {
    if (this.infiniteGold()) return true;
    const hc = this._gameConfig.hostCheats;
    return (hc?.infiniteGold ?? false) && player.isLobbyCreator();
  }

  private hasInfiniteTroopsFor(player: Player | PlayerView): boolean {
    if (this.infiniteTroops()) return true;
    return (
      (this._gameConfig.hostCheats?.infiniteTroops ?? false) &&
      player.isLobbyCreator()
    );
  }

  private hasInfiniteTroopsForInfo(playerInfo: PlayerInfo): boolean {
    if (this.infiniteTroops()) return true;
    return (
      (this._gameConfig.hostCheats?.infiniteTroops ?? false) &&
      playerInfo.isLobbyCreator
    );
  }

  private goldMultiplierFor(player: Player | PlayerView): number {
    const base = this.goldMultiplier();
    const hc = this._gameConfig.hostCheats;
    if (hc?.goldMultiplier && player.isLobbyCreator()) {
      return hc.goldMultiplier;
    }
    return base;
  }

  public conquerGoldAmount(captured: Player): Gold {
    if (
      captured.type() === PlayerType.Bot ||
      captured.type() === PlayerType.Nation
    ) {
      return captured.gold();
    } else {
      return captured.gold() / 2n;
    }
  }

  private startingGoldFor(playerInfo: PlayerInfo): Gold {
    const base = BigInt(this._gameConfig.startingGold ?? 0);
    const hc = this._gameConfig.hostCheats;
    if (hc?.startingGold && playerInfo.isLobbyCreator) {
      return base + BigInt(hc.startingGold);
    }
    return base;
  }

  private costWrapper(
    costFn: (units: number) => number,
    ...types: UnitType[]
  ): (g: Game, p: Player) => bigint {
    return (game: Game, player: Player) => {
      if (
        player.type() === PlayerType.Human &&
        this.hasInfiniteGoldFor(player)
      ) {
        return 0n;
      }
      const numUnits = types.reduce(
        (acc, type) =>
          acc +
          Math.min(player.unitsOwned(type), player.unitsConstructed(type)),
        0,
      );
      return BigInt(costFn(numUnits));
    };
  }

  /**
   * Nuke build cost that is free while the player holds a captured bomb of this
   * type in their Rücksender stockpile (see samCaptureChancePercent). The
   * stockpile is decremented in PlayerImpl.buildUnit when the free bomb is
   * actually launched.
   */
  private nukeCost(
    baseCost: number,
    type: UnitType,
  ): (g: Game, p: Player) => bigint {
    const base = this.costWrapper(() => baseCost, type);
    return (game: Game, player: Player) => {
      if (player.nukeStockpile(type) > 0) return 0n;
      return base(game, player);
    };
  }

  defaultDonationAmount(sender: Player): number {
    return Math.floor(sender.troops() / 3);
  }
  donateCooldown(): Tick {
    return 10 * 10;
  }
  embargoAllCooldown(): Tick {
    return 10 * 10;
  }
  deletionMarkDuration(): Tick {
    return 30 * 10;
  }

  deleteUnitCooldown(): Tick {
    return 30 * 10;
  }
  emojiMessageDuration(): Tick {
    return 5 * 10;
  }
  emojiMessageCooldown(): Tick {
    return 5 * 10;
  }
  quickChatCooldown(): Tick {
    return 3 * 10;
  }
  targetDuration(): Tick {
    return 10 * 10;
  }
  targetCooldown(): Tick {
    return 15 * 10;
  }
  allianceRequestDuration(): Tick {
    return 20 * 10;
  }
  allianceRequestCooldown(): Tick {
    return 30 * 10;
  }
  allianceDuration(): Tick {
    // Host-configurable per game (minutes); default 5 minutes.
    return (this._gameConfig.allianceDuration ?? 5) * 60 * 10;
  }
  temporaryEmbargoDuration(): Tick {
    return 300 * 10; // 5 minutes.
  }
  minDistanceBetweenPlayers(): number {
    return 30;
  }

  percentageTilesOwnedToWin(): number {
    if (this._gameConfig.gameMode === GameMode.Team) {
      return 95;
    }
    return 80;
  }
  armyLimitWarningThreshold(): number {
    return 0.8;
  }
  boatMaxNumber(): number {
    if (this.isUnitDisabled(UnitType.TransportShip)) {
      return 0;
    }
    return 3;
  }
  numSpawnPhaseTurns(): number {
    if (this._gameConfig.gameType === GameType.Singleplayer) {
      return 100;
    }
    if (this.isRandomSpawn()) {
      return 150;
    }
    return 300;
  }
  numBots(): number {
    return this.bots();
  }

  attackLogic(
    gm: Game,
    attackTroops: number,
    attacker: Player,
    defender: Player | TerraNullius,
    tileToConquer: TileRef,
  ): {
    attackerTroopLoss: number;
    defenderTroopLoss: number;
    tilesPerTickUsed: number;
  } {
    let mag;
    let speed;
    const type = gm.terrainType(tileToConquer);
    switch (type) {
      case TerrainType.Plains:
        mag = 80;
        speed = 16.5;
        break;
      case TerrainType.Highland:
        mag = 100;
        speed = 20;
        break;
      case TerrainType.Mountain:
        mag = 120;
        speed = 25;
        break;
      case TerrainType.Impassable:
        throw new Error(`impassable terrain cannot be attacked`);
      default:
        throw new Error(`terrain type ${type} not supported`);
    }
    if (defender.isPlayer()) {
      // Query with the maximum possible defense-post radius, then keep only
      // posts whose own (level-scaled) radius actually reaches this tile.
      // Overlapping posts stack: each reaching post multiplies the attack cost,
      // up to 3 of them. The speed penalty is applied once (not stacked) — only
      // the difficulty stacks. Applying the same multiplier per post makes the
      // result independent of iteration order, so it stays deterministic.
      let stacks = 0;
      for (const dp of gm.nearbyUnits(
        tileToConquer,
        this.defensePostRange(Number.MAX_SAFE_INTEGER),
        UnitType.DefensePost,
      )) {
        const range = this.defensePostRange(dp.unit.level());
        if (dp.unit.owner() === defender && dp.distSquared <= range * range) {
          mag *= this.defensePostDefenseBonus();
          if (stacks === 0) speed *= this.defensePostSpeedBonus();
          if (++stacks >= 3) break;
        }
      }
    }

    if (defender.isPlayer()) {
      // A wall on the exact tile makes it very hard to conquer. (Query range 1
      // then filter to distSquared 0 — a 0-range unit-grid query has a
      // cell-boundary edge case.)
      for (const w of gm.nearbyUnits(tileToConquer, 1, UnitType.Wall)) {
        if (w.distSquared === 0) {
          mag *= this.wallDefenseBonus();
          break;
        }
      }
    }

    if (gm.hasFallout(tileToConquer)) {
      const falloutRatio = gm.numTilesWithFallout() / gm.numLandTiles();
      mag *= this.falloutDefenseModifier(falloutRatio);
      speed *= this.falloutDefenseModifier(falloutRatio);
    }

    if (attacker.isPlayer() && defender.isPlayer()) {
      if (defender.isDisconnected() && attacker.isOnSameTeam(defender)) {
        // No troop loss if defender is disconnected and on same team
        mag = 0;
      }
      if (
        (attacker.type() === PlayerType.Human ||
          attacker.type() === PlayerType.Nation) &&
        defender.type() === PlayerType.Bot
      ) {
        mag *= 0.7;
      }
    }

    if (defender.isPlayer()) {
      const defenseSig =
        1 -
        sigmoid(
          defender.numTilesOwned(),
          DEFENSE_DEBUFF_DECAY_RATE,
          DEFENSE_DEBUFF_MIDPOINT,
        );

      const largeDefenderSpeedDebuff = 0.7 + 0.3 * defenseSig;
      const largeDefenderAttackDebuff = 0.7 + 0.3 * defenseSig;

      let largeAttackBonus = 1;
      if (attacker.numTilesOwned() > 100_000) {
        largeAttackBonus = Math.sqrt(100_000 / attacker.numTilesOwned()) ** 0.7;
      }
      let largeAttackerSpeedBonus = 1;
      if (attacker.numTilesOwned() > 100_000) {
        largeAttackerSpeedBonus = (100_000 / attacker.numTilesOwned()) ** 0.6;
      }

      const defenderTroopLoss = defender.troops() / defender.numTilesOwned();
      const traitorMod = defender.isTraitor() ? this.traitorDefenseDebuff() : 1;
      const currentAttackerLoss =
        within(defender.troops() / attackTroops, 0.6, 2) *
        mag *
        0.8 *
        largeDefenderAttackDebuff *
        largeAttackBonus *
        traitorMod;
      const altAttackerLoss =
        1.3 * defenderTroopLoss * (mag / 100) * traitorMod;
      const attackerTroopLoss =
        0.6 * currentAttackerLoss + 0.4 * altAttackerLoss;

      return {
        attackerTroopLoss,
        defenderTroopLoss,
        // Out of oil, the attack crawls: each tile eats more of the per-tick
        // budget (divide by the attacker's oil speed factor).
        tilesPerTickUsed:
          (within(defender.troops() / (5 * attackTroops), 0.2, 1.5) *
            speed *
            largeDefenderSpeedDebuff *
            largeAttackerSpeedBonus *
            (defender.isTraitor() ? this.traitorSpeedDebuff() : 1)) /
          attacker.oilSpeedFactor(),
      };
    } else {
      return {
        attackerTroopLoss:
          attacker.type() === PlayerType.Bot ? mag / 10 : mag / 5,
        defenderTroopLoss: 0,
        tilesPerTickUsed:
          within((2000 * Math.max(10, speed)) / attackTroops, 5, 100) /
          attacker.oilSpeedFactor(),
      };
    }
  }

  attackTilesPerTick(
    attackTroops: number,
    attacker: Player,
    defender: Player | TerraNullius,
    numAdjacentTilesWithEnemy: number,
  ): number {
    if (defender.isPlayer()) {
      return (
        within(((5 * attackTroops) / defender.troops()) * 2, 0.01, 0.5) *
        numAdjacentTilesWithEnemy *
        3
      );
    } else {
      return numAdjacentTilesWithEnemy * 2;
    }
  }

  boatAttackAmount(attacker: Player, defender: Player | TerraNullius): number {
    return Math.floor(attacker.troops() / 5);
  }

  warshipShellLifetime(): number {
    return 20; // in ticks (one tick is 100ms)
  }

  radiusPortSpawn() {
    return 20;
  }

  tradeShipShortRangeDebuff(): number {
    return 300;
  }

  proximityBonusPortsNb(totalPorts: number) {
    return within(totalPorts / 3, 4, totalPorts);
  }

  attackAmount(attacker: Player, defender: Player | TerraNullius) {
    if (attacker.type() === PlayerType.Bot) {
      return attacker.troops() / 20;
    } else {
      return attacker.troops() / 5;
    }
  }

  startManpower(playerInfo: PlayerInfo): number {
    if (playerInfo.playerType === PlayerType.Bot) {
      return 10_000;
    }
    if (playerInfo.playerType === PlayerType.Nation) {
      switch (this._gameConfig.difficulty) {
        case Difficulty.Easy:
          return 12_500;
        case Difficulty.Medium:
          return 18_750;
        case Difficulty.Hard:
          return 25_000; // Like humans
        case Difficulty.Impossible:
          return 31_250;
        default:
          assertNever(this._gameConfig.difficulty);
      }
    }
    return this.hasInfiniteTroopsForInfo(playerInfo) ? 1_000_000 : 25_000;
  }

  maxTroops(player: Player | PlayerView): number {
    const maxTroops =
      player.type() === PlayerType.Human && this.hasInfiniteTroopsFor(player)
        ? 1_000_000_000
        : 2 *
            (Math.pow(player.numTilesOwned(), 0.6) *
              this.troopsPerTileWeight() +
              50000) +
          player
            .units(UnitType.City)
            .filter((u) => !u.isUnderConstruction())
            .map((city) => city.level())
            .reduce((a, b) => a + b, 0) *
            this.cityTroopIncrease();

    if (player.type() === PlayerType.Bot) {
      return maxTroops / 3;
    }

    if (player.type() === PlayerType.Human) {
      return maxTroops;
    }

    switch (this._gameConfig.difficulty) {
      case Difficulty.Easy:
        return maxTroops * 0.5;
      case Difficulty.Medium:
        return maxTroops * 0.75;
      case Difficulty.Hard:
        return maxTroops * 1; // Like humans
      case Difficulty.Impossible:
        return maxTroops * 1.25;
      default:
        assertNever(this._gameConfig.difficulty);
    }
  }

  // ── Ships (overhaul) ─────────────────────────────────────────────────────

  // Full price per warship hull class. "normal" keeps the dynamic base price;
  // the others are flat. buildUnit charges the base warship cost, the class
  // surcharge is collected on launch (WarshipExecution).
  warshipClassCost(shipClass: ShipClass, player: Player | PlayerView): Gold {
    // Mirror costWrapper: infinite-gold games make every hull free.
    if (
      player.type() === PlayerType.Human &&
      this.hasInfiniteGoldFor(player as Player)
    ) {
      return 0n;
    }
    switch (shipClass) {
      case "small":
        return 300_000n;
      case "normal":
        // costWrapper ignores the Game argument; PlayerView carries the unit
        // counters the wrapper reads, so the client can price this too.
        return this.unitInfo(UnitType.Warship).cost(
          undefined as unknown as Game,
          player as Player,
        );
      case "large":
        return 1_500_000n;
      case "ultra":
        return 10_000_000n;
    }
  }

  // Gold a fishing boat earns each payout, and how often (ticks). Deliberately
  // small — a single boat is a trickle, a whole fleet is an economy.
  fishingBoatIncome(): Gold {
    return 5_000n;
  }

  fishingBoatIncomeIntervalTicks(): Tick {
    return 100;
  }

  // Scan radius of a patrol boat; enemy submarines inside become spotted.
  patrolBoatScanRange(): number {
    return 60;
  }

  // How long (ticks) a spotted submarine stays visible/targetable (~1 min).
  submarineSpottedDurationTicks(): Tick {
    return 600;
  }

  // Patrol boats can only be shot from very close range, so submarines can't
  // snipe the one thing that reveals them from across the map.
  patrolBoatMaxTargetRange(): number {
    return 12;
  }

  // Submarine torpedo tuning: fire cadence and hit chances (percent).
  submarineAttackRate(): Tick {
    return 25;
  }

  // The atomic sub reloads three times as fast as a plain submarine.
  atomicSubmarineAttackRate(): Tick {
    return 8;
  }

  // Torpedo damage multiplier per sub class. The atomic sub's torpedoes hit
  // four times as hard as they used to (1.6 → 6.4), on top of its far bigger
  // hull and its much faster reload.
  atomicSubmarineDamageMultiplier(): number {
    return 6.4;
  }

  submarineHitPercentVsWarship(): number {
    return 55;
  }

  // The atomic sub's fire control is far better: even warships rarely dodge.
  atomicSubmarineHitPercentVsWarship(): number {
    return 90;
  }

  submarineHitPercent(): number {
    return 90;
  }

  // Lighthouse: huge scan/support radius reaching well into the sea, and slow
  // healing for own/team boats inside it. Stackable to level 5 — a maxed
  // lighthouse lights up a whole sea.
  lighthouseRadius(level: number = 1): number {
    return 90 + (Math.min(5, Math.max(1, level)) - 1) * 70; // 90 … 370
  }

  lighthouseHealPerInterval(): number {
    return 5;
  }

  lighthouseHealIntervalTicks(): Tick {
    return 10;
  }

  // Coastal battery: a lighthouse shells enemy ships that come inside its
  // radius. Slower than a warship's guns, but it never has to reload at a port.
  lighthouseShellAttackRate(): Tick {
    return 30;
  }

  // Shell-damage multiplier of a lighthouse battery, growing with its level.
  lighthouseShellDamage(level: number = 1): number {
    return 0.8 + (Math.min(5, Math.max(1, level)) - 1) * 0.4; // 0.8 … 2.4
  }

  // Own/teammate boats inside a lighthouse's radius move this many extra steps
  // per tick — a friendly coast is a fast coast.
  lighthouseSpeedBoostSteps(): number {
    return 1;
  }

  // ── Natural disasters ────────────────────────────────────────────────────

  // Disaster types allowed in this game (host can disable each one).
  enabledNaturalDisasters(): NaturalDisasterType[] {
    const disabled = this._gameConfig.disabledDisasters ?? [];
    return Object.values(NaturalDisasterType).filter(
      (t) => !disabled.includes(t),
    );
  }

  // Lead time between the announcement and the disaster striking (~1 minute).
  disasterWarningDurationTicks(): Tick {
    return 600;
  }

  // Average pause between one disaster ending and the next being announced.
  disasterIntervalTicks(): Tick {
    return 2700; // ~4.5 minutes
  }

  disasterDurationTicks(type: NaturalDisasterType): Tick {
    switch (type) {
      case NaturalDisasterType.Drought:
        return 1800; // 3 minutes — long, so saved-up oil matters
      case NaturalDisasterType.Flood:
        return 900;
      case NaturalDisasterType.Landslide:
        return 450;
      case NaturalDisasterType.Heatwave:
        return 900;
      case NaturalDisasterType.Tsunami:
        return 300; // 30 s — the wave rolls through and is gone
    }
  }

  disasterFloodRadius(): number {
    return 30;
  }

  disasterLandslideRadius(): number {
    return 18;
  }

  // Radius of the tsunami's wave front on open water.
  disasterTsunamiRadius(): number {
    return 70;
  }

  // Total chance (0-100) that a surface ship caught in the tsunami is sunk over
  // the wave's full duration. Submarines are never affected.
  tsunamiShipDestroyTotalPercent(): number {
    return 50;
  }

  // Percent chance (0-100) that an Emergency Station covering the struck
  // region averts a localized disaster entirely — dampens, never immunizes.
  emergencyStationAvertPercent(): number {
    return 35;
  }

  // Percent chance (0-100) that a localized disaster is aimed at the largest
  // player instead of a random spot — the strong feel disasters slightly more
  // often, giving smaller players room.
  disasterBigPlayerBiasPercent(): number {
    return 25;
  }

  // Total chance (0-100) that an unprotected oil pump blows up over the FULL
  // duration of a heatwave.
  heatwavePumpExplosionTotalPercent(): number {
    return 50;
  }

  // Deliberately enormous: three times a level-1 SAM's radius (3 × 70). An
  // Emergency Station is meant to blanket a whole region — you build a handful,
  // not a grid of them.
  emergencyStationRadius(): number {
    return 3 * this.samRange(1); // 210
  }

  // One disabled structure is repaired per this many ticks by each station.
  emergencyStationRepairIntervalTicks(): Tick {
    return 40;
  }

  // ── Oil economy ──────────────────────────────────────────────────────────
  oilProductionPerPump(player: Player | PlayerView): number {
    // Scales with empire size, but deliberately modest so oil stays a real
    // constraint: a pump earns SLOWLY and you rely on several of them (pumps
    // stack) plus careful spending rather than one pump funding everything.
    // Dialled down further so a single pump never floods the tank — you notice
    // oil running low and have to keep building/gifting to keep moving.
    // e.g. 5k tiles → ~18/tick, 50k → ~93/tick, 100k → ~176/tick per pump.
    // This is the BASELINE (deposit grade 3); the actual output of a pump also
    // depends on how rich the ground under it is — see oilProductionForPumpAt.
    return 10 + Math.floor(player.numTilesOwned() / 600);
  }

  /**
   * Oil per tick produced by ONE LEVEL of a pump standing at (x, y). The
   * deposit's grade (1–5, darker = richer) scales the baseline: grade 3 is the
   * baseline, grade 5 pumps twice as much, grade 1 only half. Integer percent
   * math keeps this deterministic.
   */
  oilProductionForPumpAt(
    player: Player | PlayerView,
    x: number,
    y: number,
  ): number {
    const grade = oilDepositGradeAt(x, y);
    const percent = OIL_GRADE_PERCENT[grade] ?? 0;
    return Math.floor((this.oilProductionPerPump(player) * percent) / 100);
  }

  oilConsumptionRate(player: Player | PlayerView): number {
    // The bigger you are, the more oil you burn each tick; cities also each burn
    // a little (they run on fuel — see the troop-rate boost below). Beyond
    // ~15k tiles a steep size surcharge kicks in, so a sprawling late-game
    // empire can no longer out-produce its own upkeep for free — storage and
    // saved-up oil stay relevant all game.
    const tiles = player.numTilesOwned();
    const sizeSurcharge = Math.floor(Math.max(0, tiles - 15_000) / 60);
    return (
      Math.floor(tiles / 100) +
      sizeSurcharge +
      this.builtCityCount(player) * this.cityOilConsumption()
    );
  }

  // Active, finished cities (shared by oil consumption + the fuelled troop
  // boost). Works for both the sim Player and the client's PlayerView.
  private builtCityCount(player: Player | PlayerView): number {
    let n = 0;
    for (const u of player.units(UnitType.City)) {
      if (u.isActive() && !u.isUnderConstruction() && !u.isDisabled()) n++;
    }
    return n;
  }

  // Oil burned per tile conquered. Makes actively growing cost fuel on top of
  // the passive size upkeep, so a war machine has to keep pumping to keep
  // advancing. Rolling over unowned wilderness is cheaper; taking land from
  // another player (nation, bot or human) burns much more. Both rates scale
  // with the army doing the conquering — see oilExpansionSizeFactor.
  oilExpansionCostWilderness(player?: Player): number {
    return 4 * this.oilExpansionSizeFactor(player);
  }

  oilExpansionCostConquest(player?: Player): number {
    return 10 * this.oilExpansionSizeFactor(player);
  }

  // Troops every player has from the start, army or not: maxTroops' constant
  // term (2 * 50_000). Expansion oil is measured from here, so a freshly
  // spawned player really does sit at the bottom of the scale.
  private static readonly EXPANSION_TROOP_FLOOR = 100_000;
  // Troops above that floor per +1 on the factor. Small enough that a
  // late-game army pushes the rate past the old flat scaling.
  private static readonly EXPANSION_TROOPS_PER_STEP = 500_000;

  /**
   * How thirsty attacking is, measured on the ARMY rather than the empire.
   *
   * Starts at a third of the old rate, so early fighting barely touches the
   * tank, and climbs with troop count from there: it passes the old rate at
   * roughly 430k troops and keeps going, so a late-game power with a huge army
   * pays more per tile than it ever did before. Only expansion is affected —
   * passive upkeep is still sized by territory (oilConsumptionRate).
   */
  private oilExpansionSizeFactor(player?: Player): number {
    if (player === undefined) return 1;
    const overFloor = Math.max(
      0,
      player.troops() - Config.EXPANSION_TROOP_FLOOR,
    );
    return 1 / 3 + overFloor / Config.EXPANSION_TROOPS_PER_STEP;
  }

  // A little fuel is burned each time a ship (transport/warship/trade) is
  // launched, so a busy navy actually needs oil.
  oilCostPerShipLaunch(): number {
    return 60;
  }

  // A little fuel is burned each time a train reaches a station on its route.
  oilCostPerTrainStation(): number {
    return 8;
  }

  // Passive oil each city burns per tick (folded into oilConsumptionRate). In
  // return a fuelled empire's cities generate troops slightly faster (see
  // troopIncreaseRate).
  cityOilConsumption(): number {
    return 3;
  }

  // Oil pumps can only sit on an oil deposit. The deposit map is a shared,
  // deterministic function of coordinates (see OilDeposits.isOilDepositAt) so
  // the client's overlay and the simulation always agree.
  isOilDeposit(mg: Game, tile: TileRef): boolean {
    return isOilDepositAt(mg.x(tile), mg.y(tile));
  }

  // Base tank size with no oil storage built. Deliberately small so a pump
  // quickly overflows it — you build oil storage to hold more.
  baseMaxOil(): number {
    return 5000;
  }

  // Extra capacity per oil-storage level. Ten times what it used to be, so a
  // couple of tanks carry you through a 3-minute drought instead of needing a
  // whole tank farm.
  oilStorageBonus(): number {
    return 80_000;
  }

  // Total capacity: the base tank plus every (active, enabled) oil storage's
  // level worth of bonus. Disabled (EMP'd) storage doesn't count. Without a
  // player it's just the base tank.
  maxOil(player?: Player | PlayerView): number {
    if (player === undefined) return this.baseMaxOil();
    let bonus = 0;
    for (const u of player.units(UnitType.OilStorage)) {
      if (u.isActive() && !u.isUnderConstruction() && !u.isDisabled()) {
        bonus += u.level() * this.oilStorageBonus();
      }
    }
    return this.baseMaxOil() + bonus;
  }

  startingOil(): number {
    return this.baseMaxOil();
  }

  // When the tank is full and pumps keep producing, the overflow auto-sells for
  // a trickle of gold: gold earned = floor(excessOil / this divisor). Big number
  // => very little gold, so storage/spending still matters far more than dumping.
  oilSellDivisor(): number {
    return 12;
  }

  // Speed multiplier applied to movement when a player has run out of oil.
  // Very low on purpose: with an empty tank everything (attacks, ships, trains)
  // crawls, so keeping oil flowing really matters.
  oilShortageSpeedFactor(): number {
    return 0.12;
  }

  // Hard ceiling for oilPumpRadius(). Without it a heavily stacked pump blows a
  // crater the size of the whole map — and the crater loop walks r² tiles, so a
  // runaway radius also stalls the tick. Sits below the hydrogen bomb's outer
  // radius of 100 so no pump ever out-blasts the biggest weapon in the game.
  maxOilPumpRadius(): number {
    return 60;
  }

  // The radius an oil pump "pumps" over — also the radius of its explosion when
  // the pump is hit by a bomb. Grows as the pump is stacked/levelled up, capped
  // at maxOilPumpRadius() (reached at level 9).
  oilPumpRadius(level: number = 1): number {
    return Math.min(this.maxOilPumpRadius(), 15 + level * 5);
  }

  // Ticks a sea-build transport ship must hold position on the target tile
  // (after sailing there) before the water structure is finished. It stays
  // vulnerable the whole time; sinking it cancels the build.
  seaBuildTicks(): number {
    return this.instantBuild() ? 0 : 3 * 10;
  }

  // Ticks between movement steps, stretched when the owner is out of oil (so
  // low oil => the unit moves less often => slower).
  oilAdjustedTicksPerMove(baseTicksPerStep: number, player: Player): number {
    return Math.max(1, Math.round(baseTicksPerStep / player.oilSpeedFactor()));
  }

  // Tiles advanced per tick, shrunk when the owner is out of oil (so low oil =>
  // fewer tiles per tick => slower). Used by units that move several tiles at
  // once, like trains. Always at least 1 so a unit never freezes.
  oilAdjustedSpeed(baseSpeed: number, player: Player): number {
    return Math.max(1, Math.round(baseSpeed * player.oilSpeedFactor()));
  }

  troopIncreaseRate(player: Player | PlayerView): number {
    const max = this.maxTroops(player);

    let toAdd = 10 + Math.pow(player.troops(), 0.73) / 4;

    const ratio = 1 - player.troops() / max;
    toAdd *= ratio;

    if (player.type() === PlayerType.Bot) {
      toAdd *= 0.5;
    }

    if (player.type() === PlayerType.Nation) {
      switch (this._gameConfig.difficulty) {
        case Difficulty.Easy:
          toAdd *= 0.9;
          break;
        case Difficulty.Medium:
          toAdd *= 0.95;
          break;
        case Difficulty.Hard:
          toAdd *= 1; // Like humans
          break;
        case Difficulty.Impossible:
          toAdd *= 1.05;
          break;
        default:
          assertNever(this._gameConfig.difficulty);
      }
    }

    // Fuelled cities generate troops a little faster — +1% per built city while
    // you have oil (capped), so keeping oil flowing is worth it. Runs dry → no
    // boost.
    if (player.oil() > 0) {
      toAdd *= 1 + Math.min(this.builtCityCount(player) * 0.01, 0.2);
    }

    return Math.min(player.troops() + toAdd, max) - player.troops();
  }

  goldAdditionRate(player: Player | PlayerView): Gold {
    const multiplier = this.goldMultiplierFor(player);
    let baseRate: bigint;
    if (player.type() === PlayerType.Bot) {
      baseRate = 50n;
    } else {
      baseRate = 100n;
    }
    return BigInt(Math.floor(Number(baseRate) * multiplier));
  }

  nukeMagnitudes(unitType: UnitType): NukeMagnitude {
    switch (unitType) {
      case UnitType.MIRVWarhead:
        return { inner: 12, outer: 18 };
      case UnitType.AtomBomb:
        return { inner: 12, outer: 30 };
      case UnitType.ElectricBomb:
        // Atom-bomb-sized footprint; it disables rather than destroys.
        return { inner: 12, outer: 30 };
      case UnitType.HydrogenBomb:
        return { inner: 80, outer: 100 };
    }
    throw new Error(`Unknown nuke type: ${unitType}`);
  }

  nukeAllianceBreakThreshold(): number {
    return 100;
  }

  // How long (ticks) a structure stays deactivated after an electric bomb hits
  // it — long enough to move in and take the ground. 30 s.
  electricBombDisableTicks(): number {
    return 30 * 10;
  }

  defaultNukeSpeed(): number {
    return 10;
  }

  defaultNukeTargetableRange(): number {
    return 150;
  }

  defaultSamRange(): number {
    return 70;
  }

  samRange(level: number): number {
    // rational growth function (level 1 = 70, level 5 just above hydro range, asymptotically approaches 150)
    return this.maxSamRange() - 480 / (level + 5);
  }

  maxSamRange(): number {
    return 150;
  }

  /**
   * Rücksender: chance (0–100, integer percent) that a SAM launcher of the
   * given level captures an intercepted bomb instead of merely destroying it,
   * banking a free bomb of the same type for the SAM's owner. Atom, hydrogen
   * and electric bombs are all capturable: nothing at level 1, then 25 % at
   * level 2 rising to a guaranteed 100 % at level 5 (+25 %/level). Integer
   * percent keeps the interception roll deterministic across platforms.
   */
  samCaptureChancePercent(nukeType: UnitType, level: number): number {
    if (
      nukeType !== UnitType.AtomBomb &&
      nukeType !== UnitType.HydrogenBomb &&
      nukeType !== UnitType.ElectricBomb
    ) {
      return 0;
    }
    if (level < 2) return 0;
    return Math.min(100, (level - 1) * 25);
  }

  defaultSamMissileSpeed(): number {
    return 12;
  }

  /**
   * Gold an interception costs the SAM's owner. Air defence is no longer free:
   * a launcher only fires if its owner can pay, and the money is taken when the
   * interceptor is launched. MIRV warheads are exempt — a MIRV salvo would
   * otherwise be unaffordable to defend against by design.
   */
  samInterceptCost(nukeType: UnitType): Gold {
    switch (nukeType) {
      case UnitType.AtomBomb:
        return 80_000n;
      case UnitType.HydrogenBomb:
        return 150_000n;
      case UnitType.ElectricBomb:
        return 50_000n;
      default:
        return 0n;
    }
  }

  // Humans can be soldiers, soldiers attacking, soldiers in boat etc.
  nukeDeathFactor(
    nukeType: NukeType,
    humans: number,
    tilesOwned: number,
    maxTroops: number,
  ): number {
    if (nukeType !== UnitType.MIRVWarhead) {
      return (5 * humans) / Math.max(1, tilesOwned);
    }
    const targetTroops = 0.03 * maxTroops;
    const excessTroops = Math.max(0, humans - targetTroops);
    const scalingFactor = 500;

    const steepness = 2;
    const normalizedExcess = excessTroops / maxTroops;
    return scalingFactor * (1 - Math.exp(-steepness * normalizedExcess));
  }

  structureMinDist(): number {
    return 15;
  }

  shellLifetime(): number {
    return 50;
  }

  warshipPatrolRange(): number {
    return 100;
  }

  warshipTargettingRange(): number {
    return 130;
  }

  warshipShellAttackRate(): number {
    return 20;
  }

  warshipDockingRange(): number {
    return 5;
  }

  warshipPortHealingBonusPerLevel(): number {
    return 5;
  }

  /** Health at or below which a warship retreats to repair, as a percent of its
   *  (veterancy-adjusted) max health, so the threshold scales with max health. */
  warshipRetreatHealthPercent(): number {
    return 75;
  }

  warshipPassiveHealing(): number {
    return 1;
  }

  warshipPassiveHealingRange(): number {
    return 150;
  }

  warshipPortSwitchThreshold(): number {
    return 0.75;
  }

  // --- Warship veterancy ---

  /** Maximum veterancy level a warship can reach. */
  warshipMaxVeterancy(): number {
    return 3;
  }

  /** Max-health boost per veterancy level, as an integer percent of base max
   *  health. Integer-only to keep src/core deterministic (no float constants). */
  warshipVeterancyHealthBonus(): number {
    return 20;
  }

  /** Shell-damage boost per veterancy level, as an integer percent of the
   *  rolled damage. Integer-only to keep src/core deterministic. */
  warshipVeterancyShellDamageBonus(): number {
    return 20;
  }

  /** Transport ships a warship must destroy to gain one veterancy level. */
  warshipVeterancyTransportKills(): number {
    return 10;
  }

  /** Trade ships a warship must capture to gain one veterancy level. */
  warshipVeterancyTradeCaptures(): number {
    return 25;
  }

  defensePostShellAttackRate(): number {
    return 100;
  }

  safeFromPiratesCooldownMax(): number {
    return 20;
  }

  defensePostTargettingRange(): number {
    return 75;
  }

  allianceExtensionPromptOffset(): number {
    return 300; // 30 seconds before expiration
  }
}

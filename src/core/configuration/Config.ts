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
  Player,
  PlayerInfo,
  PlayerType,
  TerrainType,
  TerraNullius,
  Tick,
  UnitInfo,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { isOilDepositAt } from "../game/OilDeposits";
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

  cityTroopIncrease(): number {
    return 250_000;
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
    // Deliberately weak — about a sixth of the old strength. The old post
    // multiplied attacker losses by 5 (×4 above neutral); this is only ~×0.67
    // above neutral. Overlapping posts stack this up to 3× (see attackLogic), so
    // a real cluster still bites while a lone post is easy to push through.
    return 1 + (5 - 1) / 6; // ≈ 1.67
  }

  // Multiplier on attack cost when conquering a walled tile. Walls are meant to
  // be very hard to break through with normal attacks (bombs / defense-post
  // barrages remain the easy answers).
  wallDefenseBonus(): number {
    return 50;
  }

  // A wall's "health": it must be sieged from full down to 0 before an attack can
  // breach it. Higher = walls take longer to break.
  wallMaxHealth(): number {
    return 100;
  }

  // Health a wall regenerates per tick while it is NOT under active siege — this
  // is how the damage "reverts" when the attacker is repelled.
  wallRegenPerTick(): number {
    return 2;
  }

  // Health a besieging attacker strips from a wall each tick, scaled by the
  // attacking force so a bigger army breaks through faster (and a small one
  // barely dents it — slower with fewer troops). Clamped to a sane band.
  wallSiegeDamagePerTick(attackerTroops: number): number {
    const dmg = Math.floor(attackerTroops / 1000);
    return Math.max(2, Math.min(20, dmg));
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
    return (numPlayerFactories + 10) * 15;
  }
  trainGold(
    rel: "self" | "team" | "ally" | "other",
    citiesVisited: number,
    player: Player | PlayerView,
  ): Gold {
    // No penalty for the first 10 cities.
    citiesVisited = Math.max(0, citiesVisited - 9);
    let baseGold: number;
    switch (rel) {
      case "ally":
        baseGold = 35_000;
        break;
      case "team":
      case "other":
        baseGold = 25_000;
        break;
      case "self":
        baseGold = 10_000;
        break;
    }
    const distPenalty = citiesVisited * 5_000;
    const gold = Math.max(5000, baseGold - distPenalty);
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
    const debuff = this.tradeShipShortRangeDebuff();
    const baseGold =
      75_000 / (1 + Math.exp(-0.03 * (dist - debuff))) + 50 * dist;
    return BigInt(Math.floor(baseGold * this.goldMultiplierFor(player)));
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
      case UnitType.Warship:
        info = {
          cost: this.costWrapper(
            (numUnits: number) => Math.min(1_000_000, (numUnits + 1) * 250_000),
            UnitType.Warship,
          ),
          maxHealth: 1000,
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
      case UnitType.AtomBomb:
        info = {
          cost: this.nukeCost(750_000, UnitType.AtomBomb),
        };
        break;
      case UnitType.HydrogenBomb:
        info = {
          cost: this.nukeCost(5_000_000, UnitType.HydrogenBomb),
        };
        break;
      case UnitType.ElectricBomb:
        // Slightly pricier than an atom bomb (it denies the whole area instead
        // of levelling it).
        info = {
          cost: this.nukeCost(900_000, UnitType.ElectricBomb),
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
            return 25_000_000n + game.stats().numMirvsLaunched() * 15_000_000n;
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
    return 300 * 10; // 5 minutes.
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
        : 2 * (Math.pow(player.numTilesOwned(), 0.6) * 1000 + 50000) +
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

  // ── Oil economy ──────────────────────────────────────────────────────────
  oilProductionPerPump(player: Player | PlayerView): number {
    // Scales with empire size, but deliberately modest so oil stays a real
    // constraint: a pump earns SLOWLY and you rely on several of them (pumps
    // stack) plus careful spending rather than one pump funding everything.
    // Dialled down further so a single pump never floods the tank — you notice
    // oil running low and have to keep building/gifting to keep moving.
    // e.g. 5k tiles → ~18/tick, 50k → ~93/tick, 100k → ~176/tick per pump.
    return 10 + Math.floor(player.numTilesOwned() / 600);
  }

  oilConsumptionRate(player: Player | PlayerView): number {
    // The bigger you are, the more oil you burn each tick; cities also each burn
    // a little (they run on fuel — see the troop-rate boost below). Kept high
    // enough that passive upkeep noticeably eats into production.
    return (
      Math.floor(player.numTilesOwned() / 100) +
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
  // advancing. Rolling over unowned wilderness is cheap; taking land from
  // another player (nation, bot or human) burns twice as much.
  oilExpansionCostWilderness(): number {
    return 2.5;
  }

  oilExpansionCostConquest(): number {
    return 5;
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

  // Extra capacity per oil-storage level.
  oilStorageBonus(): number {
    return 8000;
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

  // The radius an oil pump "pumps" over — also the radius of its explosion when
  // the pump is hit by a bomb. Grows as the pump is stacked/levelled up.
  oilPumpRadius(level: number = 1): number {
    return 15 + level * 5;
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

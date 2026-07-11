import {
  Difficulty,
  Execution,
  Game,
  GameType,
  Player,
  PlayerInfo,
  PlayerType,
  SpawnArea,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { simpleHash } from "../Util";
import { PlayerExecution } from "./PlayerExecution";
import { TribeExecution } from "./TribeExecution";
import { getSpawnTiles } from "./Util";

type Spawn = { center: TileRef; tiles: TileRef[] };

export class SpawnExecution implements Execution {
  private random: PseudoRandom;
  active: boolean = true;
  private mg: Game;
  private static readonly MAX_SPAWN_TRIES = 1_000;
  // Hard+ bots prefer to start next to an oil deposit: for this many of the
  // spawn tries a candidate is rejected unless a deposit sits within
  // OIL_SPAWN_RADIUS; after that the preference relaxes so a spawn is guaranteed.
  private static readonly OIL_BIAS_TRIES = 700;
  private static readonly OIL_SPAWN_RADIUS = 12;

  constructor(
    gameID: GameID,
    private playerInfo: PlayerInfo,
    public tile?: TileRef,
  ) {
    this.random = new PseudoRandom(
      simpleHash(playerInfo.id) + simpleHash(gameID),
    );
  }

  init(mg: Game, ticks: number) {
    this.mg = mg;
  }

  tick(ticks: number) {
    this.active = false;

    let player: Player | null = null;
    if (this.mg.hasPlayer(this.playerInfo.id)) {
      player = this.mg.player(this.playerInfo.id);
    } else {
      player = this.mg.addPlayer(this.playerInfo);
    }

    // Prevent double/re-rolled spawns: a random-spawn game (players can't
    // re-roll) and a tile-less auto-spawn (the spawn-phase-end fallback) both
    // no-op once the player has already spawned — e.g. if they picked a tile in
    // the meantime.
    if (
      (this.mg.config().isRandomSpawn() || this.tile === undefined) &&
      player.hasSpawned()
    ) {
      return;
    }

    player.tiles().forEach((t) => player.relinquish(t));
    const spawn = this.getSpawn(
      this.mg.config().isRandomSpawn() ? undefined : this.tile,
    );

    if (!spawn) {
      console.warn(`SpawnExecution: cannot spawn ${this.playerInfo.name}`);
      return;
    }

    spawn.tiles.forEach((t) => {
      player.conquer(t);
    });

    if (!player.hasSpawned()) {
      this.mg.addExecution(new PlayerExecution(player));
      if (player.type() === PlayerType.Bot) {
        this.mg.addExecution(new TribeExecution(player));
      }
    }

    player.setSpawnTile(spawn.center);

    if (
      this.mg.config().gameConfig().gameType === GameType.Singleplayer &&
      this.playerInfo.playerType === PlayerType.Human
    ) {
      // In singleplayer, spawn ends when player selects
      // a spawn location.
      this.mg.endSpawnPhase();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }

  private getSpawn(center?: TileRef): Spawn | undefined {
    if (center !== undefined) {
      const tiles = getSpawnTiles(this.mg, center, false);

      if (!tiles.length) {
        return;
      }

      return { center, tiles };
    }

    const spawnArea = this.getTeamSpawnArea();
    let tries = 0;

    while (tries < SpawnExecution.MAX_SPAWN_TRIES) {
      tries++;

      const center = this.randTile(spawnArea);

      if (
        !this.mg.isLand(center) ||
        this.mg.hasOwner(center) ||
        this.mg.isBorder(center)
      ) {
        continue;
      }

      const isOtherPlayerSpawnedNearby = this.mg
        .allPlayers()
        .filter((player) => player.id() !== this.playerInfo.id)
        .some((player) => {
          const spawnTile = player.spawnTile();

          if (spawnTile === undefined) {
            return false;
          }

          return (
            this.mg.manhattanDist(spawnTile, center) <
            this.mg.config().minDistanceBetweenPlayers()
          );
        });

      if (isOtherPlayerSpawnedNearby) {
        continue;
      }

      // Hard+ bots bias toward starting near an oil deposit (with a fallback so
      // they always spawn — see OIL_BIAS_TRIES). Only affects bots at Hard/
      // Impossible; humans and easier difficulties are untouched.
      if (
        tries < SpawnExecution.OIL_BIAS_TRIES &&
        this.preferOilSpawn() &&
        !this.isNearOilDeposit(center)
      ) {
        continue;
      }

      const tiles = getSpawnTiles(this.mg, center, true);
      if (!tiles) {
        // if some of the spawn tile is outside of the land, we want to find another spawn tile
        continue;
      }

      return { center, tiles };
    }

    return;
  }

  private randTile(area?: SpawnArea): TileRef {
    if (area) {
      const x = this.random.nextInt(area.x, area.x + area.width);
      const y = this.random.nextInt(area.y, area.y + area.height);
      return this.mg.ref(x, y);
    }
    const x = this.random.nextInt(0, this.mg.width());
    const y = this.random.nextInt(0, this.mg.height());
    return this.mg.ref(x, y);
  }

  // True for a bot on a Hard/Impossible game — those get the oil spawn bias.
  private preferOilSpawn(): boolean {
    if (this.playerInfo.playerType !== PlayerType.Bot) return false;
    const difficulty = this.mg.config().gameConfig().difficulty;
    return (
      difficulty === Difficulty.Hard || difficulty === Difficulty.Impossible
    );
  }

  // Whether any oil deposit sits within OIL_SPAWN_RADIUS of `center`.
  private isNearOilDeposit(center: TileRef): boolean {
    const r = SpawnExecution.OIL_SPAWN_RADIUS;
    const cx = this.mg.x(center);
    const cy = this.mg.y(center);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (!this.mg.isValidCoord(x, y)) continue;
        if (this.mg.config().isOilDeposit(this.mg, this.mg.ref(x, y))) {
          return true;
        }
      }
    }
    return false;
  }

  private getTeamSpawnArea(): SpawnArea | undefined {
    const player = this.mg.player(this.playerInfo.id);
    const team = player.team();
    if (team === null) {
      return undefined;
    }
    return this.mg.teamSpawnArea(team);
  }
}

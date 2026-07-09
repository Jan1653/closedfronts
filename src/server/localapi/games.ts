import fs from "fs";
import path from "path";
import {
  Difficulty,
  GameMode,
  GameType,
  RankedType,
} from "../../core/game/Game";
import type { AccountStore } from "./store";

// Aggregates finished-game results (fed by the game server's archive() POST to
// /localapi/game/:id) into per-account stats that back the leaderboard and
// player profiles. We store aggregates + lightweight per-game rows only, not
// full turn logs, so the data file stays small (archived-replay is out of
// scope for this stage). Only logged-in players (whose persistentID maps to an
// account) are tracked; anonymous players are ignored.

interface GameRow {
  gameId: string;
  start: string; // ISO
  durationSeconds: number;
  map: string;
  mode: string;
  type: string;
  playerTeams: string | null;
  rankedType: string;
  result: "victory" | "defeat" | "incomplete";
  totalPlayers: number | null;
  username: string;
  clanTag: string | null;
}

interface Bucket {
  w: number;
  l: number;
  t: number;
}

interface PlayerAgg {
  publicId: string;
  username: string;
  clanTag: string | null;
  wins: number;
  losses: number;
  total: number;
  // key: `${gameType}|${gameMode}|${difficulty}`
  buckets: Record<string, Bucket>;
  games: GameRow[]; // most recent first
}

interface IndexData {
  version: 1;
  processed: string[]; // gameIDs already ingested (dedupe)
  players: Record<string, PlayerAgg>; // by publicId
}

const MAX_GAMES_PER_PLAYER = 200;
const MAX_PROCESSED = 5000;

function asDifficulty(v: unknown): Difficulty {
  return Object.values(Difficulty).includes(v as Difficulty)
    ? (v as Difficulty)
    : Difficulty.Medium;
}
function asGameMode(v: unknown): GameMode {
  return Object.values(GameMode).includes(v as GameMode)
    ? (v as GameMode)
    : GameMode.FFA;
}
function asGameType(v: unknown): GameType {
  return Object.values(GameType).includes(v as GameType)
    ? (v as GameType)
    : GameType.Public;
}

// WinnerSchema is ["player", clientID] or ["team", teamName, ...clientIDs].
function winningClientIds(winner: unknown): Set<string> {
  if (!Array.isArray(winner) || winner.length === 0) return new Set();
  if (winner[0] === "player" && typeof winner[1] === "string") {
    return new Set([winner[1]]);
  }
  if (winner[0] === "team") {
    return new Set(winner.slice(2).filter((x) => typeof x === "string"));
  }
  return new Set();
}

export class GamesStore {
  private data: IndexData = { version: 1, processed: [], players: {} };
  private readonly filePath: string;

  constructor(
    filePath: string,
    private readonly accounts: AccountStore,
  ) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      if (parsed?.players && parsed?.processed) {
        this.data = {
          version: 1,
          processed: parsed.processed,
          players: parsed.players,
        };
      }
    } catch {
      // First run / unreadable — start empty.
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data), "utf-8");
    fs.renameSync(tmp, this.filePath);
  }

  // Ingest a finished game record (the archive() payload). Returns true if it
  // was newly recorded, false if a duplicate or unusable.
  ingest(record: unknown): boolean {
    const info = (record as { info?: Record<string, unknown> })?.info;
    if (!info || typeof info.gameID !== "string") return false;
    const gameId = info.gameID;
    if (this.data.processed.includes(gameId)) return false;

    const config = (info.config ?? {}) as Record<string, unknown>;
    const players = Array.isArray(info.players) ? info.players : [];
    const winners = winningClientIds(info.winner);
    const hasWinner = winners.size > 0;

    const gameType = asGameType(config.gameType);
    const gameMode = asGameMode(config.gameMode);
    const difficulty = asDifficulty(config.difficulty);
    const map = typeof config.gameMap === "string" ? config.gameMap : "Unknown";
    const playerTeams =
      config.playerTeams === undefined || config.playerTeams === null
        ? null
        : String(config.playerTeams);
    const rankedType =
      typeof info.rankedType === "string" ? info.rankedType : "";
    const start =
      typeof info.start === "number"
        ? new Date(info.start).toISOString()
        : new Date().toISOString();
    const durationSeconds =
      typeof info.duration === "number"
        ? Math.max(0, Math.round(info.duration))
        : 0;
    const totalPlayers = players.length || null;
    const bucketKey = `${gameType}|${gameMode}|${difficulty}`;

    let recorded = false;
    for (const p of players) {
      const player = p as Record<string, unknown>;
      const persistentID =
        typeof player.persistentID === "string" ? player.persistentID : null;
      if (!persistentID) continue;
      const account = this.accounts.findById(persistentID);
      if (!account) continue; // anonymous / unknown -> not tracked

      const result: GameRow["result"] = !hasWinner
        ? "incomplete"
        : typeof player.clientID === "string" && winners.has(player.clientID)
          ? "victory"
          : "defeat";

      const username =
        typeof player.username === "string" ? player.username : account.email;
      const clanTag =
        typeof player.clanTag === "string" ? player.clanTag : null;

      const agg: PlayerAgg = this.data.players[account.publicId] ?? {
        publicId: account.publicId,
        username,
        clanTag,
        wins: 0,
        losses: 0,
        total: 0,
        buckets: {},
        games: [],
      };
      agg.username = username;
      agg.clanTag = clanTag;
      agg.total += 1;
      if (result === "victory") agg.wins += 1;
      else if (result === "defeat") agg.losses += 1;

      const bucket = agg.buckets[bucketKey] ?? { w: 0, l: 0, t: 0 };
      bucket.t += 1;
      if (result === "victory") bucket.w += 1;
      else if (result === "defeat") bucket.l += 1;
      agg.buckets[bucketKey] = bucket;

      agg.games.unshift({
        gameId,
        start,
        durationSeconds,
        map,
        mode: gameMode,
        type: gameType,
        playerTeams,
        rankedType,
        result,
        totalPlayers,
        username,
        clanTag,
      });
      if (agg.games.length > MAX_GAMES_PER_PLAYER) {
        agg.games.length = MAX_GAMES_PER_PLAYER;
      }
      this.data.players[account.publicId] = agg;
      recorded = true;
    }

    this.data.processed.push(gameId);
    if (this.data.processed.length > MAX_PROCESSED) {
      this.data.processed = this.data.processed.slice(-MAX_PROCESSED);
    }
    this.save();
    return recorded;
  }

  // Aggregate stats for task-locked cosmetics (see CosmeticStats): total games
  // + wins, and per-AI-difficulty games + wins (summed across game types/modes).
  statsFor(publicId: string): {
    games: number;
    wins: number;
    gamesByDifficulty: Record<string, number>;
    winsByDifficulty: Record<string, number>;
  } {
    const agg = this.data.players[publicId];
    const gamesByDifficulty: Record<string, number> = {};
    const winsByDifficulty: Record<string, number> = {};
    if (!agg) return { games: 0, wins: 0, gamesByDifficulty, winsByDifficulty };
    for (const [key, b] of Object.entries(agg.buckets)) {
      const difficulty = key.split("|")[2] ?? "Medium";
      gamesByDifficulty[difficulty] =
        (gamesByDifficulty[difficulty] ?? 0) + b.t;
      winsByDifficulty[difficulty] = (winsByDifficulty[difficulty] ?? 0) + b.w;
    }
    return {
      games: agg.total,
      wins: agg.wins,
      gamesByDifficulty,
      winsByDifficulty,
    };
  }

  // RankedLeaderboardResponse — { "1v1": entries }. On a casual self-hosted
  // server there's no ELO ladder, so this ranks tracked players by wins and
  // derives a simple rating for the elo column.
  leaderboard(page = 1): Record<string, unknown> {
    // We serve the whole (small) board on page 1; later pages are empty so the
    // client's paginated list stops instead of re-requesting the same rows.
    if (page > 1) return { [RankedType.OneVOne]: [] };
    const entries = Object.values(this.data.players)
      .filter((p) => p.total > 0)
      .sort((a, b) => b.wins - a.wins || b.total - a.total)
      .map((p, i) => ({
        rank: i + 1,
        elo: Math.max(0, 1000 + (p.wins - p.losses) * 25),
        peakElo: null,
        wins: p.wins,
        losses: p.losses,
        total: p.total,
        public_id: p.publicId,
        username: p.username,
        clanTag: p.clanTag ?? null,
      }));
    return { [RankedType.OneVOne]: entries };
  }

  // PlayerProfile — { createdAt, stats: PlayerStatsTree }. Counters are sent as
  // strings (BigIntStringSchema). Empty PlayerStats ({}) per leaf is valid.
  playerProfile(publicId: string): Record<string, unknown> | null {
    const agg = this.data.players[publicId];
    const account = this.accounts.findByPublicId(publicId);
    if (!agg && !account) return null;
    const createdAt = account?.createdAt ?? new Date().toISOString();

    const stats: Record<string, Record<string, Record<string, unknown>>> = {};
    for (const [key, b] of Object.entries(agg?.buckets ?? {})) {
      const [type, mode, difficulty] = key.split("|");
      stats[type] ??= {};
      stats[type][mode] ??= {};
      stats[type][mode][difficulty] = {
        wins: String(b.w),
        losses: String(b.l),
        total: String(b.t),
        stats: {},
      };
    }
    return { createdAt, stats };
  }

  // PublicPlayerGamesResponse — { results, nextCursor }. Cursor is an opaque
  // offset into the player's stored game rows.
  playerGames(
    publicId: string,
    cursor?: string,
    limit = 20,
  ): Record<string, unknown> {
    const agg = this.data.players[publicId];
    const rows = agg?.games ?? [];
    const offset = cursor ? parseInt(cursor, 10) || 0 : 0;
    const slice = rows.slice(offset, offset + limit);
    const nextOffset = offset + limit;
    return {
      results: slice,
      nextCursor: nextOffset < rows.length ? String(nextOffset) : null,
    };
  }
}

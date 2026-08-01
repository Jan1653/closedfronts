import {
  Execution,
  Game,
  MessageType,
  PlayerID,
  PlayerInfo,
  PlayerType,
} from "../game/Game";
import { ClientID } from "../Schemas";

/**
 * Adds a player who joined after the game had already started.
 *
 * The server only emits this once the table has voted the applicant in (or the
 * host forced it through), and it arrives in the normal turn stream — so every
 * client runs it on the same tick and ends up with an identical player list.
 * The newcomer owns nothing yet; their client follows up with an ordinary
 * spawn intent to pick a starting tile.
 *
 * A duplicate (e.g. the server retried, or the player already exists) is a
 * no-op, which keeps re-simulation from a replay deterministic.
 */
export class LateJoinExecution implements Execution {
  private active = true;

  constructor(
    private playerID: PlayerID,
    private clientID: ClientID,
    private username: string,
    private clanTag: string | null,
  ) {}

  init(mg: Game, ticks: number): void {
    this.active = false;
    if (mg.hasPlayer(this.playerID)) {
      return;
    }
    const info = new PlayerInfo(
      this.username,
      PlayerType.Human,
      this.clientID,
      this.playerID,
      false, // never the lobby creator — the game was already running
      this.clanTag,
    );
    mg.addPlayer(info);
    mg.displayMessage(
      "events_display.player_joined_late",
      MessageType.ALLIANCE_ACCEPTED,
      null,
      undefined,
      { name: info.displayName },
    );
  }

  tick(): void {}

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}

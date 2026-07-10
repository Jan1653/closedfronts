import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../../core/game/Game";
import { generateID } from "../../../core/Util";
import { getPlayerCosmetics } from "../../Cosmetics";
import { JoinLobbyEvent } from "../../Main";
import { UsernameInput } from "../../UsernameInput";
import { decodePaintBase64 } from "./CustomMapStore";

export interface PlayableCustomMap {
  name: string;
  width: number;
  height: number;
  paint: string; // base64 PaintTile grid
}

/**
 * Start a singleplayer game on a hand-drawn map. The paint grid rides inside
 * config.customMap, so the renderer and the sim worker both compile the same
 * terrain (no map files). Bots scale with land area; custom maps have no
 * nations. Shared by the editor and the community browser — one source of truth
 * for the game-start config. Dispatched on `document`, where Main listens.
 */
export async function playCustomMapSolo(map: PlayableCustomMap): Promise<void> {
  let land = 0;
  try {
    const bytes = decodePaintBase64(map.paint);
    for (let i = 0; i < bytes.length; i++) if (bytes[i] !== 0) land++;
  } catch {
    /* unreadable paint — buildCustomTerrain will reject it downstream */
  }
  const bots = Math.max(3, Math.min(100, Math.floor(land / 400)));

  const usernameInput = document.querySelector(
    "username-input",
  ) as UsernameInput | null;
  const clientID = generateID();
  const gameID = generateID();
  const cosmetics = await getPlayerCosmetics();

  document.dispatchEvent(
    new CustomEvent("join-lobby", {
      detail: {
        gameID,
        gameStartInfo: {
          gameID,
          players: [
            {
              clientID,
              username: usernameInput?.getUsername() ?? "Player",
              clanTag: usernameInput?.getClanTag() ?? null,
              cosmetics,
            },
          ],
          config: {
            // gameMap is ignored while customMap is set, but must be a valid
            // enum value to satisfy the schema.
            gameMap: GameMapType.World,
            gameMapSize: GameMapSize.Normal,
            gameType: GameType.Singleplayer,
            gameMode: GameMode.FFA,
            difficulty: Difficulty.Medium,
            bots,
            infiniteGold: false,
            infiniteTroops: false,
            instantBuild: false,
            randomSpawn: false,
            donateGold: false,
            donateTroops: false,
            nations: "disabled",
            disabledUnits: [],
            customMap: {
              name: map.name,
              width: map.width,
              height: map.height,
              paint: map.paint,
            },
          },
          lobbyCreatedAt: Date.now(),
        },
        source: "singleplayer",
      } satisfies JoinLobbyEvent,
      bubbles: true,
      composed: true,
    }),
  );
}

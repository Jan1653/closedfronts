import { Game, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";

/**
 * Resolve an explicitly requested launch port for a new ship.
 *
 * Normally a ship leaves from whichever of the player's ports sits closest to
 * the tile that was clicked (PlayerImpl.warshipSpawn). When several ports are
 * selected at once, the client spreads a batch across them and names the port
 * each ship should come out of — this validates that request and falls back to
 * the default when it doesn't hold up (port sold, captured, still building, or
 * on a different body of water than the destination).
 *
 * Returns the port's tile, or null to leave the default choice alone.
 */
export function requestedPortSpawn(
  mg: Game,
  owner: Player,
  portTile: TileRef | undefined,
  destination: TileRef,
): TileRef | null {
  if (portTile === undefined) return null;
  if (!mg.isValidRef(portTile)) return null;
  const destComponent = mg.getWaterComponent(destination);
  if (destComponent === null) return null;
  const port = owner
    .units(UnitType.Port)
    .find(
      (p) =>
        p.tile() === portTile &&
        p.isActive() &&
        !p.isUnderConstruction() &&
        mg.hasWaterComponent(p.tile(), destComponent),
    );
  return port === undefined ? null : port.tile();
}

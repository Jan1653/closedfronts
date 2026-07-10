import { PlayerBuildableUnitType } from "../core/game/Game";
import { TileRef } from "../core/game/GameMap";

export interface UIState {
  attackRatio: number;
  ghostStructure: PlayerBuildableUnitType | null;
  rocketDirectionUp: boolean;
  // How many copies of the ghost structure to place per click. Adjusted with
  // Shift + mouse wheel while a build ghost is active; 1 = normal single build.
  buildQuantity: number;
  // Mobile two-step placement: the tile the user tapped to position the build
  // ghost (there is no hover on touch). null until they tap the map. The
  // bottom-centre "Build" button confirms placement here.
  mobilePlacementTile: TileRef | null;
}

import { PlayerBuildableUnitType, ShipClass } from "../core/game/Game";
import { TileRef } from "../core/game/GameMap";

export interface UIState {
  attackRatio: number;
  ghostStructure: PlayerBuildableUnitType | null;
  // Warship hull class armed with the ghost (ships tab); null = normal.
  ghostShipClass: ShipClass | null;
  rocketDirectionUp: boolean;
  // How many copies of the ghost structure to place per click. Adjusted with
  // Shift + mouse wheel while a build ghost is active; 1 = normal single build.
  buildQuantity: number;
  // Mobile placement target: the tile the build ghost will drop on. For most
  // builds it tracks the screen centre (the ghost is anchored there and aimed by
  // panning); walls set it by tap instead. null when the centre is off-map. The
  // bottom-centre "Build" button confirms placement here.
  mobilePlacementTile: TileRef | null;
  // Mobile "select" mode (the touch equivalent of holding Shift): a drag draws a
  // warship selection box instead of panning, and pinch-zoom is disabled, so the
  // camera stays put while multi-selecting. Toggled by the on-screen button.
  mobileSelectMode: boolean;
  // Wall drag-build: the first-clicked (or first-tapped) start tile of a wall
  // line. While set, the next map click/confirm builds the whole line from here
  // to the cursor. null when no wall drag is in progress.
  wallDragStart: TileRef | null;
}

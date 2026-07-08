import { PlayerBuildableUnitType } from "../core/game/Game";

export interface UIState {
  attackRatio: number;
  ghostStructure: PlayerBuildableUnitType | null;
  rocketDirectionUp: boolean;
  // How many copies of the ghost structure to place per click. Adjusted with
  // Shift + mouse wheel while a build ghost is active; 1 = normal single build.
  buildQuantity: number;
}

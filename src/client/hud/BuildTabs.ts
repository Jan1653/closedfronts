/**
 * Shared definitions for the two grouped build tabs — "Ships" and "Bombs".
 *
 * Both tabs collapse several buildables behind one bar button plus a sub-menu,
 * and both remember the last entry the player picked. That memory lives here
 * (not in a component) because three places need it: the desktop
 * <unit-display>, the mobile <mobile-build-bar>, and the InputHandler, which
 * arms the remembered entry straight from a hotkey without opening the tab.
 */

import { assetUrl } from "../../core/AssetUrls";
import {
  PlayerBuildableUnitType,
  ShipClass,
  UnitType,
} from "../../core/game/Game";

const warshipIcon = assetUrl("images/BattleshipIconWhite.svg");
const mirvIcon = assetUrl("images/MIRVIcon.svg");
const hydrogenBombIcon = assetUrl("images/MushroomCloudIconWhite.svg");
const atomBombIcon = assetUrl("images/NukeIconWhite.svg");
const electricBombIcon = assetUrl("images/ElectricBombIconWhite.svg");
const fishingBoatIcon = assetUrl("images/FishingBoatIconWhite.svg");
const patrolBoatIcon = assetUrl("images/PatrolBoatIconWhite.svg");
const submarineIcon = assetUrl("images/SubmarineIconWhite.svg");
const atomicSubmarineIcon = assetUrl("images/AtomicSubmarineIconWhite.svg");

export interface ShipTabEntry {
  type: PlayerBuildableUnitType;
  shipClass: ShipClass | null;
  icon: string;
  key: string;
}

export interface BombTabEntry {
  type: PlayerBuildableUnitType;
  icon: string;
  key: string;
  keybind: string;
  defaultKey: string;
}

/**
 * The ships tab: every buyable ship in one place. The three warship hull
 * classes share UnitType.Warship and differ via shipClass (sent with the build
 * intent).
 */
export const SHIPS: ShipTabEntry[] = [
  {
    type: UnitType.FishingBoat,
    shipClass: null,
    icon: fishingBoatIcon,
    key: "fishing_boat",
  },
  {
    type: UnitType.PatrolBoat,
    shipClass: null,
    icon: patrolBoatIcon,
    key: "patrol_boat",
  },
  {
    type: UnitType.Warship,
    shipClass: "small",
    icon: warshipIcon,
    key: "warship_small",
  },
  {
    type: UnitType.Warship,
    shipClass: "large",
    icon: warshipIcon,
    key: "warship_large",
  },
  {
    type: UnitType.Warship,
    shipClass: "ultra",
    icon: warshipIcon,
    key: "warship_ultra",
  },
  {
    type: UnitType.Submarine,
    shipClass: null,
    icon: submarineIcon,
    key: "submarine",
  },
  {
    type: UnitType.AtomicSubmarine,
    shipClass: null,
    icon: atomicSubmarineIcon,
    key: "atomic_submarine",
  },
];

/**
 * The bombs tab. Order per design: Electric, Atom, Hydrogen, MIRV. Each carries
 * its own build keybind so the sub-menu can show the hotkey (it would otherwise
 * be invisible behind the "Bombs" button).
 */
export const BOMBS: BombTabEntry[] = [
  {
    type: UnitType.ElectricBomb,
    icon: electricBombIcon,
    key: "electric_bomb",
    keybind: "buildElectricBomb",
    defaultKey: "I",
  },
  {
    type: UnitType.AtomBomb,
    icon: atomBombIcon,
    key: "atom_bomb",
    keybind: "buildAtomBomb",
    defaultKey: "8",
  },
  {
    type: UnitType.HydrogenBomb,
    icon: hydrogenBombIcon,
    key: "hydrogen_bomb",
    keybind: "buildHydrogenBomb",
    defaultKey: "9",
  },
  {
    type: UnitType.MIRV,
    icon: mirvIcon,
    key: "mirv",
    keybind: "buildMIRV",
    defaultKey: "0",
  },
];

export const SHIP_TYPES: ReadonlySet<PlayerBuildableUnitType> = new Set(
  SHIPS.map((s) => s.type),
);
export const BOMB_TYPES: ReadonlySet<PlayerBuildableUnitType> = new Set(
  BOMBS.map((b) => b.type),
);

const SELECTED_SHIP_KEY = "unitDisplay.selectedShip";
const SELECTED_BOMB_KEY = "unitDisplay.selectedBomb";

/** Index into SHIPS of the last ship the player picked (0 if none/invalid). */
export function loadSelectedShipIdx(): number {
  const saved = Number(localStorage.getItem(SELECTED_SHIP_KEY));
  return Number.isInteger(saved) && saved >= 0 && saved < SHIPS.length
    ? saved
    : 0;
}

export function saveSelectedShipIdx(idx: number): void {
  try {
    localStorage.setItem(SELECTED_SHIP_KEY, String(idx));
  } catch {
    /* storage unavailable */
  }
}

/** The last bomb the player picked (atom bomb if none/invalid). */
export function loadSelectedBomb(): PlayerBuildableUnitType {
  const saved = localStorage.getItem(SELECTED_BOMB_KEY);
  return BOMBS.find((b) => b.type === saved)?.type ?? UnitType.AtomBomb;
}

export function saveSelectedBomb(type: PlayerBuildableUnitType): void {
  try {
    localStorage.setItem(SELECTED_BOMB_KEY, type);
  } catch {
    /* storage unavailable */
  }
}

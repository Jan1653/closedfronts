import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import {
  BuildableUnit,
  BuildMenus,
  Gold,
  PlayerBuildableUnitType,
  UnitType,
} from "../../../core/game/Game";
import { Controller } from "../../Controller";
import { UIState } from "../../UIState";
import { renderNumber, translateText } from "../../Utils";
import { GameView } from "../../view";
import { flattenedBuildTable } from "./BuildMenu";
import { SHIPS } from "./UnitDisplay";

const goldCoinIcon = assetUrl("images/GoldCoinIcon.svg");

// The four bombs collapse into one "Bombs" button + centred picker (same order
// and remembered selection as the desktop unit-display).
const BOMB_ORDER: PlayerBuildableUnitType[] = [
  UnitType.ElectricBomb,
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
];
const BOMB_SET: ReadonlySet<PlayerBuildableUnitType> = new Set(BOMB_ORDER);
const SELECTED_BOMB_KEY = "unitDisplay.selectedBomb";

// Every ship lives in the "Ships" picker (shared SHIPS list with the desktop
// unit-display), so keep the individual tiles off the bar.
const SHIP_SET: ReadonlySet<PlayerBuildableUnitType> = new Set(
  SHIPS.map((s) => s.type),
);
const SELECTED_SHIP_KEY = "unitDisplay.selectedShip";

/**
 * Mobile-only vertical build bar pinned to the right edge. Tapping an item arms
 * a build (uiState.ghostStructure); the ghost then anchors to the screen centre
 * and the player pans the map under it to aim, confirming with the bottom-centre
 * <mobile-build-controls>. The four bombs open a centred picker instead. Hidden
 * on desktop (the wider unit-display bar handles that).
 */
@customElement("mobile-build-bar")
export class MobileBuildBar extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;

  private playerBuildables: BuildableUnit[] | null = null;

  @state() private selected: PlayerBuildableUnitType | null = null;
  @state() private bombMenuOpen = false;
  @state() private shipsMenuOpen = false;
  @state() private selectedShipIdx: number = (() => {
    const saved = Number(localStorage.getItem(SELECTED_SHIP_KEY));
    return Number.isInteger(saved) && saved >= 0 && saved < SHIPS.length
      ? saved
      : 0;
  })();
  @state() private selectedBomb: PlayerBuildableUnitType =
    (BOMB_SET.has(
      localStorage.getItem(SELECTED_BOMB_KEY) as PlayerBuildableUnitType,
    )
      ? (localStorage.getItem(SELECTED_BOMB_KEY) as PlayerBuildableUnitType)
      : null) ?? UnitType.AtomBomb;

  createRenderRoot() {
    return this;
  }

  tick() {
    const player = this.game?.myPlayer();
    if (!player) return;
    player.buildables(undefined, BuildMenus.types).then((b) => {
      this.playerBuildables = b;
      this.requestUpdate();
    });
    // Keep the highlight in sync with the actual ghost (e.g. cleared after a
    // structure is placed, or by the cancel button).
    if (this.selected !== this.uiState.ghostStructure) {
      this.selected = this.uiState.ghostStructure;
      this.requestUpdate();
    }
    // Close the bomb fly-out once a non-bomb structure gets armed.
    const g = this.uiState.ghostStructure;
    if (this.bombMenuOpen && g !== null && !BOMB_SET.has(g)) {
      this.bombMenuOpen = false;
      this.requestUpdate();
    }
  }

  private cost(type: UnitType): bigint {
    return this.playerBuildables?.find((u) => u.type === type)?.cost ?? 0n;
  }

  // Arming a build has no tile yet, so gate by affordability + prerequisites
  // (mirrors the desktop <unit-display>) — NOT the sim's tile-dependent
  // `canBuild`, which is always false without a tile and greyed everything out.
  private canBuild(type: UnitType): boolean {
    if (this.game?.config().isUnitDisabled(type)) return false;
    const player = this.game?.myPlayer();
    const gold = player?.gold() ?? 0n;
    switch (type) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.ElectricBomb:
      case UnitType.MIRV:
        // Only a FINISHED silo enables bombs — greyed while it's still building.
        return (
          this.cost(type) <= gold &&
          (player
            ?.units(UnitType.MissileSilo)
            .some((u) => !u.isUnderConstruction()) ??
            false)
        );
      case UnitType.Warship:
      case UnitType.FishingBoat:
      case UnitType.PatrolBoat:
      case UnitType.Submarine:
      case UnitType.AtomicSubmarine:
      case UnitType.WaterTollStation:
        // All ships and the toll station need a FINISHED port (ships launch
        // from one), so grey them out until a port is built.
        return (
          this.cost(type) <= gold &&
          (player?.units(UnitType.Port).some((u) => !u.isUnderConstruction()) ??
            false)
        );
      default:
        return this.cost(type) <= gold;
    }
  }

  // Full price of a ships-picker entry (warship hull classes are flat-priced).
  private shipCost(entry: (typeof SHIPS)[number]): Gold {
    if (entry.type === UnitType.Warship && entry.shipClass !== null) {
      const player = this.game?.myPlayer();
      if (player) {
        return this.game.config().warshipClassCost(entry.shipClass, player);
      }
    }
    return this.cost(entry.type);
  }

  private canBuildShip(entry: (typeof SHIPS)[number]): boolean {
    const player = this.game?.myPlayer();
    return (
      this.canBuild(entry.type) &&
      this.shipCost(entry) <= (player?.gold() ?? 0n)
    );
  }

  private onTap(type: PlayerBuildableUnitType) {
    if (this.uiState.ghostStructure === type) {
      this.uiState.ghostStructure = null; // tap again to disarm
    } else {
      if (!this.canBuild(type)) return;
      this.uiState.ghostStructure = type;
      this.uiState.buildQuantity = 1;
      this.uiState.mobilePlacementTile = null;
    }
    this.selected = this.uiState.ghostStructure;
    this.requestUpdate();
  }

  private isBombArmed(): boolean {
    const g = this.uiState.ghostStructure;
    return g !== null && BOMB_SET.has(g);
  }

  private toggleBombMenu() {
    this.bombMenuOpen = !this.bombMenuOpen;
    this.requestUpdate();
  }

  private selectBomb(type: PlayerBuildableUnitType) {
    this.selectedBomb = type;
    try {
      localStorage.setItem(SELECTED_BOMB_KEY, type);
    } catch {
      /* storage unavailable */
    }
    if (this.canBuild(type)) {
      this.uiState.ghostStructure = type;
      this.uiState.buildQuantity = 1;
      this.uiState.mobilePlacementTile = null;
      this.selected = type;
    }
    this.bombMenuOpen = false;
    this.requestUpdate();
  }

  private renderTile(
    type: UnitType,
    icon: string,
    key: string | undefined,
    active: boolean,
    onClick: () => void,
  ) {
    const enabled = this.canBuild(type);
    return html`
      <button
        class="relative w-11 h-11 shrink-0 flex items-center justify-center rounded-md border transition-colors ${active
          ? "border-sky-300 bg-sky-400/20 ring-1 ring-sky-300"
          : "border-slate-500"} ${enabled ? "" : "opacity-40"}"
        title=${key ? translateText(key) : ""}
        @click=${onClick}
      >
        <img
          src=${icon}
          alt=${key ?? ""}
          width="24"
          height="24"
          class="-mt-1"
        />
        <span
          class="absolute bottom-0 inset-x-0 text-[9px] leading-none text-center font-bold tabular-nums text-yellow-300 bg-black/55 rounded-b-md py-px"
          >${renderNumber(this.cost(type))}</span
        >
      </button>
    `;
  }

  render() {
    const player = this.game?.myPlayer();
    if (
      !this.game ||
      !player ||
      this.game.inSpawnPhase() ||
      !player.isAlive()
    ) {
      return null;
    }

    const cfg = this.game.config();
    const items = flattenedBuildTable.filter(
      (i) =>
        !cfg.isUnitDisabled(i.unitType) &&
        !BOMB_SET.has(i.unitType) &&
        !SHIP_SET.has(i.unitType),
    );
    const shipItems = SHIPS.map((s, idx) => ({ ...s, idx })).filter(
      (s) => !cfg.isUnitDisabled(s.type),
    );
    const bombItems = BOMB_ORDER.map((t) =>
      flattenedBuildTable.find((i) => i.unitType === t),
    ).filter((i) => i !== undefined && !cfg.isUnitDisabled(i.unitType)) as {
      unitType: PlayerBuildableUnitType;
      icon: string;
      key?: string;
    }[];

    return html`
      <div
        class="lg:hidden flex flex-col gap-1 max-h-[80vh] overflow-y-auto overflow-x-hidden p-1 rounded-l-lg bg-gray-800/92 backdrop-blur-sm shadow-lg pointer-events-auto"
      >
        ${items.map((item) =>
          this.renderTile(
            item.unitType,
            item.icon,
            item.key,
            this.selected === item.unitType,
            () => this.onTap(item.unitType),
          ),
        )}
        ${shipItems.length > 0 ? this.renderShipsButton(shipItems) : null}
        ${bombItems.length > 0 ? this.renderBombButton(bombItems) : null}
      </div>
      ${this.bombMenuOpen && bombItems.length > 0
        ? this.renderBombPicker(bombItems)
        : null}
      ${this.shipsMenuOpen && shipItems.length > 0
        ? this.renderShipsPicker(shipItems)
        : null}
    `;
  }

  private renderBombButton(
    bombItems: {
      unitType: PlayerBuildableUnitType;
      icon: string;
      key?: string;
    }[],
  ) {
    const armed = this.isBombArmed();
    // Bombs need a finished missile silo; grey the whole button out until then
    // so it's clear (rather than "nothing happens") the bombs aren't unlocked.
    const unlocked = bombItems.some((b) => this.canBuild(b.unitType));
    const sel =
      bombItems.find((b) => b.unitType === this.selectedBomb) ?? bombItems[0];
    return html`
      <button
        class="relative w-11 h-11 shrink-0 flex items-center justify-center rounded-md border transition-colors ${armed ||
        this.bombMenuOpen
          ? "border-sky-300 bg-sky-400/20 ring-1 ring-sky-300"
          : "border-slate-500"} ${unlocked ? "" : "opacity-40"}"
        title=${translateText("unit_type.bombs")}
        @click=${() => {
          if (unlocked) this.toggleBombMenu();
        }}
      >
        <img src=${sel.icon} width="24" height="24" class="-mt-1" />
        <span
          class="absolute bottom-0 inset-x-0 text-[8px] leading-none text-center font-bold text-white bg-black/55 rounded-b-md py-px truncate"
          >${translateText("unit_type.bombs")}</span
        >
      </button>
    `;
  }

  // Centred bomb chooser (opened by the "Bombs" button). A full-screen overlay
  // instead of a cramped side fly-out — each bomb shows its name + price, greyed
  // when it can't be built. Tapping one arms it (then pan-to-place + Build).
  private renderBombPicker(
    bombItems: {
      unitType: PlayerBuildableUnitType;
      icon: string;
      key?: string;
    }[],
  ) {
    return html`
      <div
        class="lg:hidden fixed inset-0 z-[300] flex items-center justify-center bg-black/50 pointer-events-auto"
        @click=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) {
            this.bombMenuOpen = false;
            this.requestUpdate();
          }
        }}
      >
        <div
          class="flex flex-col gap-2 p-3 rounded-xl bg-gray-800/95 backdrop-blur-sm shadow-2xl max-w-[92vw]"
        >
          <div class="text-white font-bold text-center text-sm">
            ${translateText("build_menu.select_bomb")}
          </div>
          <div class="flex flex-wrap justify-center gap-2">
            ${bombItems.map((b) => this.renderBombCard(b))}
          </div>
        </div>
      </div>
    `;
  }

  private selectShip(idx: number) {
    this.selectedShipIdx = idx;
    try {
      localStorage.setItem(SELECTED_SHIP_KEY, String(idx));
    } catch {
      /* storage unavailable */
    }
    const entry = SHIPS[idx];
    if (this.canBuildShip(entry)) {
      this.uiState.ghostStructure = entry.type;
      this.uiState.ghostShipClass = entry.shipClass;
      this.uiState.buildQuantity = 1;
      this.uiState.mobilePlacementTile = null;
      this.selected = entry.type;
    }
    this.shipsMenuOpen = false;
    this.requestUpdate();
  }

  private renderShipsButton(shipItems: ((typeof SHIPS)[number] & { idx: number })[]) {
    const armed =
      this.uiState.ghostStructure !== null &&
      SHIP_SET.has(this.uiState.ghostStructure);
    // Ships need a finished port; grey the whole button out until then.
    const unlocked = shipItems.some((s) => this.canBuild(s.type));
    const sel =
      shipItems.find((s) => s.idx === this.selectedShipIdx) ?? shipItems[0];
    return html`
      <button
        class="relative w-11 h-11 shrink-0 flex items-center justify-center rounded-md border transition-colors ${armed ||
        this.shipsMenuOpen
          ? "border-sky-300 bg-sky-400/20 ring-1 ring-sky-300"
          : "border-slate-500"} ${unlocked ? "" : "opacity-40"}"
        title=${translateText("unit_type.ships")}
        @click=${() => {
          if (unlocked) {
            this.shipsMenuOpen = !this.shipsMenuOpen;
            this.requestUpdate();
          }
        }}
      >
        <img src=${sel.icon} width="24" height="24" class="-mt-1" />
        <span
          class="absolute bottom-0 inset-x-0 text-[8px] leading-none text-center font-bold text-white bg-black/55 rounded-b-md py-px truncate"
          >${translateText("unit_type.ships")}</span
        >
      </button>
    `;
  }

  // Centred ship chooser (like the bomb picker): every buyable ship with name
  // + price, greyed when it can't be built. Tapping one arms it.
  private renderShipsPicker(
    shipItems: ((typeof SHIPS)[number] & { idx: number })[],
  ) {
    return html`
      <div
        class="lg:hidden fixed inset-0 z-[300] flex items-center justify-center bg-black/50 pointer-events-auto"
        @click=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) {
            this.shipsMenuOpen = false;
            this.requestUpdate();
          }
        }}
      >
        <div
          class="flex flex-col gap-2 p-3 rounded-xl bg-gray-800/95 backdrop-blur-sm shadow-2xl max-w-[92vw]"
        >
          <div class="text-white font-bold text-center text-sm">
            ${translateText("build_menu.select_ship")}
          </div>
          <div class="flex flex-wrap justify-center gap-2">
            ${shipItems.map((s) => {
              const enabled = this.canBuildShip(s);
              const active = this.selectedShipIdx === s.idx;
              return html`
                <button
                  class="relative w-24 flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors ${active
                    ? "border-sky-300 bg-sky-400/20"
                    : "border-slate-500 bg-slate-700/40"} ${enabled
                    ? ""
                    : "opacity-40"}"
                  @click=${() => this.selectShip(s.idx)}
                >
                  <img src=${s.icon} width="34" height="34" />
                  <span
                    class="text-white text-xs font-semibold text-center leading-tight"
                    >${translateText("unit_type." + s.key)}</span
                  >
                  <span
                    class="flex items-center gap-1 text-yellow-300 text-xs font-bold tabular-nums"
                  >
                    <img
                      src=${goldCoinIcon}
                      width="11"
                      height="11"
                    />${renderNumber(this.shipCost(s))}
                  </span>
                </button>
              `;
            })}
          </div>
        </div>
      </div>
    `;
  }

  private renderBombCard(b: {
    unitType: PlayerBuildableUnitType;
    icon: string;
    key?: string;
  }) {
    const enabled = this.canBuild(b.unitType);
    const active = this.selectedBomb === b.unitType;
    return html`
      <button
        class="relative w-24 flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors ${active
          ? "border-sky-300 bg-sky-400/20"
          : "border-slate-500 bg-slate-700/40"} ${enabled ? "" : "opacity-40"}"
        @click=${() => this.selectBomb(b.unitType)}
      >
        <img src=${b.icon} width="34" height="34" />
        <span
          class="text-white text-xs font-semibold text-center leading-tight"
          >${b.key ? translateText(b.key) : ""}</span
        >
        <span
          class="flex items-center gap-1 text-yellow-300 text-xs font-bold tabular-nums"
        >
          <img src=${goldCoinIcon} width="11" height="11" />${renderNumber(
            this.cost(b.unitType),
          )}
        </span>
      </button>
    `;
  }
}

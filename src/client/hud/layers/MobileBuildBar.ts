import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import {
  BuildableUnit,
  BuildMenus,
  PlayerBuildableUnitType,
  UnitType,
} from "../../../core/game/Game";
import { Controller } from "../../Controller";
import { UIState } from "../../UIState";
import { renderNumber, translateText } from "../../Utils";
import { GameView } from "../../view";
import { flattenedBuildTable } from "./BuildMenu";

// The four bombs collapse into one "Bombs" button + fly-out (same order and
// remembered selection as the desktop unit-display).
const BOMB_ORDER: PlayerBuildableUnitType[] = [
  UnitType.ElectricBomb,
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
];
const BOMB_SET: ReadonlySet<PlayerBuildableUnitType> = new Set(BOMB_ORDER);
const SELECTED_BOMB_KEY = "unitDisplay.selectedBomb";

/**
 * Mobile-only vertical build bar pinned to the right edge. Tapping an item arms
 * a build (uiState.ghostStructure); the player then taps the map to position
 * the ghost and confirms with the bottom-centre <mobile-build-controls>. Hidden
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
      case UnitType.WaterTollStation:
        // Both need a FINISHED port (a toll station must be reachable by boat
        // from one), so grey them out until a port is built — like the warship.
        return (
          this.cost(type) <= gold &&
          (player?.units(UnitType.Port).some((u) => !u.isUnderConstruction()) ??
            false)
        );
      default:
        return this.cost(type) <= gold;
    }
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
      (i) => !cfg.isUnitDisabled(i.unitType) && !BOMB_SET.has(i.unitType),
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
        class="lg:hidden flex flex-col gap-1 max-h-[70vh] overflow-y-auto p-1 rounded-l-lg bg-gray-800/92 backdrop-blur-sm shadow-lg pointer-events-auto"
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
        ${bombItems.length > 0 ? this.renderBombButton(bombItems) : null}
      </div>
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
    const sel =
      bombItems.find((b) => b.unitType === this.selectedBomb) ?? bombItems[0];
    return html`
      <div class="relative shrink-0">
        <button
          class="relative w-11 h-11 flex items-center justify-center rounded-md border transition-colors ${armed ||
          this.bombMenuOpen
            ? "border-sky-300 bg-sky-400/20 ring-1 ring-sky-300"
            : "border-slate-500"}"
          title=${translateText("unit_type.bombs")}
          @click=${() => this.toggleBombMenu()}
        >
          <img src=${sel.icon} width="24" height="24" class="-mt-1" />
          <span
            class="absolute bottom-0 inset-x-0 text-[8px] leading-none text-center font-bold text-white bg-black/55 rounded-b-md py-px truncate"
            >${translateText("unit_type.bombs")}</span
          >
        </button>
        ${this.bombMenuOpen
          ? html`<div
              class="absolute right-full top-0 mr-1 flex flex-col gap-1 p-1 rounded-md bg-gray-800/95 backdrop-blur-sm shadow-lg"
            >
              ${bombItems.map((b) =>
                this.renderTile(
                  b.unitType,
                  b.icon,
                  b.key,
                  this.selectedBomb === b.unitType,
                  () => this.selectBomb(b.unitType),
                ),
              )}
            </div>`
          : null}
      </div>
    `;
  }
}

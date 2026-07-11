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
        return (
          this.cost(type) <= gold &&
          (player?.units(UnitType.MissileSilo).length ?? 0) > 0
        );
      case UnitType.Warship:
        return (
          this.cost(type) <= gold &&
          (player?.units(UnitType.Port).length ?? 0) > 0
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

    const items = flattenedBuildTable.filter(
      (i) => !this.game.config().isUnitDisabled(i.unitType),
    );

    return html`
      <div
        class="lg:hidden flex flex-col gap-1 max-h-[70vh] overflow-y-auto p-1 rounded-l-lg bg-gray-800/92 backdrop-blur-sm shadow-lg pointer-events-auto"
      >
        ${items.map((item) => {
          const enabled = this.canBuild(item.unitType);
          const active = this.selected === item.unitType;
          return html`
            <button
              class="relative w-11 h-11 shrink-0 flex items-center justify-center rounded-md border transition-colors ${active
                ? "border-sky-300 bg-sky-400/20 ring-1 ring-sky-300"
                : "border-slate-500"} ${enabled ? "" : "opacity-40"}"
              title=${item.key ? translateText(item.key) : ""}
              @click=${() => this.onTap(item.unitType)}
            >
              <img
                src=${item.icon}
                alt=${item.key ?? ""}
                width="24"
                height="24"
                class="-mt-1"
              />
              <span
                class="absolute bottom-0 inset-x-0 text-[9px] leading-none text-center font-bold tabular-nums text-yellow-300 bg-black/55 rounded-b-md py-px"
                >${renderNumber(this.cost(item.unitType))}</span
              >
            </button>
          `;
        })}
      </div>
    `;
  }
}

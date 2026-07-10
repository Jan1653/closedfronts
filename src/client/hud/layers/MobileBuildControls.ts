import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import { Controller } from "../../Controller";
import { ConfirmGhostStructureEvent } from "../../InputHandler";
import { UIState } from "../../UIState";
import { translateText } from "../../Utils";
import { GameView } from "../../view";

const MAX_QUANTITY = 25;

// Nukes / warship are always single (matches BuildPreviewController.multiPlaceCount).
const SINGLE_ONLY: ReadonlySet<UnitType> = new Set<UnitType>([
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.ElectricBomb,
  UnitType.MIRV,
  UnitType.Warship,
]);

/**
 * Mobile-only bottom-centre controls shown while a build is armed
 * (uiState.ghostStructure). Lets the player pick a quantity, then confirm
 * ("Build") placement at the tapped tile or cancel. Hidden on desktop, where a
 * click places directly.
 */
@customElement("mobile-build-controls")
export class MobileBuildControls extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;

  @state() private active = false;
  @state() private hasTile = false;
  @state() private quantity = 1;

  createRenderRoot() {
    return this;
  }

  tick() {
    const active =
      this.uiState?.ghostStructure !== null &&
      this.uiState?.ghostStructure !== undefined;
    const hasTile =
      this.uiState?.mobilePlacementTile !== null &&
      this.uiState?.mobilePlacementTile !== undefined;
    const quantity = this.uiState?.buildQuantity ?? 1;
    if (
      active !== this.active ||
      hasTile !== this.hasTile ||
      quantity !== this.quantity
    ) {
      this.active = active;
      this.hasTile = hasTile;
      this.quantity = quantity;
      this.requestUpdate();
    }
  }

  private adjust(delta: number) {
    this.uiState.buildQuantity = Math.max(
      1,
      Math.min(MAX_QUANTITY, (this.uiState.buildQuantity ?? 1) + delta),
    );
    this.quantity = this.uiState.buildQuantity;
    this.requestUpdate();
  }

  private confirmBuild() {
    if (!this.hasTile) return;
    // Confirms at the ghost's current position (set by the map tap).
    this.eventBus.emit(new ConfirmGhostStructureEvent());
  }

  private cancel() {
    this.uiState.ghostStructure = null;
    this.uiState.mobilePlacementTile = null;
  }

  render() {
    if (!this.active) return null;
    const type = this.uiState.ghostStructure;
    const countable = type !== null && !SINGLE_ONLY.has(type);
    const buildLabel = translateText("mobile_build.build");

    return html`
      <div
        class="lg:hidden pointer-events-auto flex items-center gap-2 px-2 py-2 rounded-t-xl bg-gray-800/95 backdrop-blur-sm shadow-lg"
        translate="no"
      >
        ${countable
          ? html`
              <div class="flex items-center gap-1.5">
                <button
                  class="w-9 h-9 rounded-md bg-slate-700 text-white text-xl leading-none"
                  @click=${() => this.adjust(-1)}
                  aria-label="less"
                >
                  −
                </button>
                <span class="text-white font-bold w-8 text-center"
                  >×${this.quantity}</span
                >
                <button
                  class="w-9 h-9 rounded-md bg-slate-700 text-white text-xl leading-none"
                  @click=${() => this.adjust(1)}
                  aria-label="more"
                >
                  +
                </button>
              </div>
            `
          : ""}
        <button
          class="px-4 h-10 rounded-lg bg-slate-700 text-white font-semibold"
          @click=${() => this.cancel()}
        >
          ${translateText("common.cancel")}
        </button>
        <button
          class="px-5 h-10 rounded-lg font-semibold ${this.hasTile
            ? "bg-sky-500 text-white"
            : "bg-slate-600 text-slate-400"}"
          ?disabled=${!this.hasTile}
          @click=${() => this.confirmBuild()}
        >
          ${buildLabel}
        </button>
      </div>
    `;
  }
}

import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { UIState } from "../../UIState";
import { translateText } from "../../Utils";
import { GameView } from "../../view";

/**
 * Mobile-only "Select" toggle (top-right). Turns on the touch equivalent of
 * holding Shift: a drag draws a warship selection box (multi-select) instead of
 * panning, and pinch-zoom is disabled, so the camera stays put. Reads/writes
 * uiState.mobileSelectMode (InputHandler honours it). Hidden on desktop.
 */
@customElement("mobile-select-button")
export class MobileSelectButton extends LitElement implements Controller {
  public game: GameView;
  public uiState: UIState;

  @state() private active = false;

  createRenderRoot() {
    return this;
  }

  tick() {
    const active = this.uiState?.mobileSelectMode ?? false;
    if (active !== this.active) {
      this.active = active;
      this.requestUpdate();
    }
  }

  private toggle() {
    this.uiState.mobileSelectMode = !this.uiState.mobileSelectMode;
    this.active = this.uiState.mobileSelectMode;
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

    return html`
      <button
        class="lg:hidden pointer-events-auto px-3 py-2 rounded-lg text-sm font-semibold shadow-lg backdrop-blur-sm transition-colors ${this
          .active
          ? "bg-sky-500 text-white ring-2 ring-sky-300"
          : "bg-gray-800/92 text-white"}"
        aria-pressed=${this.active}
        @click=${() => this.toggle()}
      >
        ${translateText("mobile_select.select")}
      </button>
    `;
  }
}

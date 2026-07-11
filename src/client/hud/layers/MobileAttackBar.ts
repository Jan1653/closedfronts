import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import { Controller } from "../../Controller";
import { UIState } from "../../UIState";
import { renderTroops } from "../../Utils";
import { GameView } from "../../view";

const swordIcon = assetUrl("images/SwordIcon.svg");

/**
 * Mobile-only attack-ratio control pinned to the left edge (mirrors the
 * right-edge <mobile-build-bar>). A big vertical slider is far easier to drag on
 * touch than the tiny bottom-row slider it replaces. Reads/writes
 * uiState.attackRatio (0–1) — the single source of truth the sim reads. Hidden
 * on desktop, where the control panel keeps its own slider.
 */
@customElement("mobile-attack-bar")
export class MobileAttackBar extends LitElement implements Controller {
  public game: GameView;
  public uiState: UIState;

  @state() private percent = 20;
  @state() private troops = 0;

  createRenderRoot() {
    return this;
  }

  tick() {
    const player = this.game?.myPlayer();
    if (!player) return;
    const ratio = this.uiState?.attackRatio ?? 0.2;
    const percent = Math.round(ratio * 100);
    const troops = Math.floor(player.troops() * ratio);
    if (percent !== this.percent || troops !== this.troops) {
      this.percent = percent;
      this.troops = troops;
      this.requestUpdate();
    }
  }

  private onInput(e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    this.uiState.attackRatio = Math.max(0.01, Math.min(1, v / 100));
    this.percent = v;
    const player = this.game?.myPlayer();
    if (player) this.troops = Math.floor(player.troops() * (v / 100));
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
      <div
        class="lg:hidden pointer-events-auto flex flex-col items-center gap-1 px-1.5 py-2 rounded-r-lg bg-gray-800/92 backdrop-blur-sm shadow-lg"
        translate="no"
      >
        <span
          class="w-10 text-center text-white text-sm font-bold tabular-nums leading-none"
          >${this.percent}%</span
        >
        <input
          type="range"
          min="1"
          max="100"
          .value=${String(this.percent)}
          @input=${(e: Event) => this.onInput(e)}
          class="accent-aquarius cursor-pointer"
          style="writing-mode: vertical-lr; direction: rtl; width: 1.75rem; height: 9rem;"
          aria-label="attack ratio"
        />
        <img
          src=${swordIcon}
          alt=""
          aria-hidden="true"
          width="14"
          height="14"
          style="filter: brightness(0) invert(1)"
        />
        <span
          class="w-10 text-center truncate text-white text-[10px] font-bold tabular-nums leading-none"
          >${renderTroops(this.troops)}</span
        >
      </div>
    `;
  }
}

import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { NaturalDisasterType } from "../../../core/game/Game";
import { NaturalDisasterUpdate } from "../../../core/game/GameUpdates";
import { Controller } from "../../Controller";
import { translateText } from "../../Utils";
import { GameView } from "../../view";

// Per-type banner accents: emoji + bar color.
const DISASTER_STYLE: Record<string, { emoji: string; bar: string }> = {
  [NaturalDisasterType.Drought]: { emoji: "🌵", bar: "#eab308" },
  [NaturalDisasterType.Flood]: { emoji: "💧", bar: "#3b82f6" },
  [NaturalDisasterType.Landslide]: { emoji: "⛰️", bar: "#a16207" },
  [NaturalDisasterType.Heatwave]: { emoji: "🔥", bar: "#ef4444" },
  [NaturalDisasterType.Tsunami]: { emoji: "🌊", bar: "#0ea5e9" },
};

/**
 * Top-center banner for natural disasters: shows the announcement (~1 minute
 * warning) and the running disaster, each with a progress bar draining toward
 * the phase end. Compact enough for phones (fixed top-center, max-w, wraps).
 */
@customElement("natural-disaster-display")
export class NaturalDisasterDisplay extends LitElement implements Controller {
  public game: GameView;

  private current: NaturalDisasterUpdate | null = null;

  createRenderRoot() {
    // Top-center by default, but <player-info-overlay> — the box naming the
    // country you clicked — sits in exactly the same spot (500px wide, centred
    // from sm up) and the banner covered it. Once the viewport is wide enough
    // to hold both, the banner steps to the right of that box instead of on
    // top of it; below that width there is no room beside it, so it stays
    // centred.
    this.className = [
      "fixed top-[14px] z-[1100] pointer-events-none w-max",
      "left-1/2 -translate-x-1/2 max-w-[min(92vw,420px)]",
      "min-[950px]:left-[calc(50%_+_262px)] min-[950px]:translate-x-0",
      "min-[950px]:max-w-[min(420px,calc(50vw_-_274px))]",
    ].join(" ");
    return this;
  }

  init() {}

  tick() {
    if (!this.game) return;
    const next = this.game.naturalDisaster();
    if (next !== this.current) {
      this.current = next;
      this.requestUpdate();
    } else if (next !== null) {
      // Progress bar drains every tick.
      this.requestUpdate();
    }
  }

  render() {
    const d = this.current;
    if (d === null) return html``;

    const style = DISASTER_STYLE[d.disaster] ?? { emoji: "⚠️", bar: "#f59e0b" };
    const name = translateText(`disaster.${d.disaster.toLowerCase()}`);
    const phaseLabel =
      d.phase === "warning"
        ? translateText("disaster.incoming")
        : translateText("disaster.active");

    const total = Math.max(1, d.phaseEndTick - d.phaseStartTick);
    const remaining = Math.max(0, d.phaseEndTick - this.game.ticks());
    const frac = Math.min(1, Math.max(0, remaining / total));
    const secondsLeft = Math.ceil(remaining / 10);

    const warning = d.phase === "warning";
    return html`
      <div
        class="flex flex-col gap-1 px-4 py-2 rounded-xl border shadow-lg [text-shadow:0_1px_2px_rgba(0,0,0,0.95)] ${warning
          ? "bg-amber-950/55 border-amber-400/50"
          : "bg-red-950/55 border-red-400/50"}"
      >
        <div class="flex items-center gap-2 text-white">
          <span class="text-lg leading-none">${style.emoji}</span>
          <span class="text-sm font-bold uppercase tracking-wider"
            >${name}</span
          >
          <span
            class="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${warning
              ? "bg-amber-400/20 text-amber-200"
              : "bg-red-400/20 text-red-200 animate-pulse"}"
            >${phaseLabel}</span
          >
          <span class="ml-auto text-xs tabular-nums text-white/80"
            >${Math.floor(secondsLeft / 60)}:${String(
              secondsLeft % 60,
            ).padStart(2, "0")}</span
          >
        </div>
        <div class="h-1.5 w-full rounded-full bg-white/15 overflow-hidden">
          <div
            class="h-full rounded-full transition-[width] duration-150 ease-linear"
            style="width: ${frac * 100}%; background-color: ${style.bar};"
          ></div>
        </div>
      </div>
    `;
  }
}

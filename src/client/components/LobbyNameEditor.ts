import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  validateUsername,
} from "../../core/validations/username";
import { translateText } from "../Utils";

/**
 * Compact "change your name" control shown inside a lobby (host + join modals),
 * so a player can rename while sitting in the lobby — on mobile and desktop.
 *
 * On save it dispatches a bubbling "lobby-rename" DOM event; Main applies it by
 * re-joining with the new identity (the server updates the name before the game
 * starts and rebroadcasts the lobby) and persists it for future games.
 */
@customElement("lobby-name-editor")
export class LobbyNameEditor extends LitElement {
  @state() private value = "";
  @state() private error = "";
  @state() private saved = false;

  /** Names of the OTHER players in the lobby (self excluded), so a rename can't
   * collide with a name already in use. Compared case-insensitively. */
  @property({ attribute: false }) existingNames: string[] = [];

  createRenderRoot() {
    return this; // light DOM so Tailwind classes apply
  }

  // The player's own current name — always allowed to keep, so the collision
  // check never blocks re-saving your own name.
  private originalName = "";

  connectedCallback() {
    super.connectedCallback();
    try {
      this.value = localStorage.getItem("username") ?? "";
    } catch {
      this.value = "";
    }
    this.originalName = this.value;
  }

  private onInput(e: Event) {
    this.value = (e.target as HTMLInputElement).value;
    this.error = "";
    this.saved = false;
  }

  private save() {
    const name = this.value.trim();
    const result = validateUsername(name);
    if (!result.isValid) {
      this.error = result.error ?? "";
      this.saved = false;
      return;
    }
    const lower = name.toLowerCase();
    if (
      lower !== this.originalName.trim().toLowerCase() &&
      this.existingNames.some((n) => n.trim().toLowerCase() === lower)
    ) {
      this.error = translateText("lobby.name_taken");
      this.saved = false;
      return;
    }
    document.dispatchEvent(
      new CustomEvent("lobby-rename", {
        detail: { name },
        bubbles: true,
        composed: true,
      }),
    );
    this.error = "";
    this.saved = true;
  }

  render() {
    return html`
      <div class="flex flex-col gap-1.5">
        <label class="text-sm font-medium text-white/70">
          ${translateText("lobby.your_name")}
        </label>
        <div class="flex gap-2">
          <input
            type="text"
            .value=${this.value}
            @input=${this.onInput}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") this.save();
            }}
            minlength=${MIN_USERNAME_LENGTH}
            maxlength=${MAX_USERNAME_LENGTH}
            class="flex-1 min-w-0 px-3 py-2 rounded-lg bg-transparent border border-white/10 text-white placeholder-white/40 focus:outline-none focus:border-malibu-blue/50 transition-all"
          />
          <button
            type="button"
            @click=${this.save}
            class="shrink-0 px-4 py-2 rounded-lg bg-malibu-blue/80 hover:bg-malibu-blue text-white font-bold cursor-pointer transition-colors"
          >
            ${translateText("lobby.save_name")}
          </button>
        </div>
        ${this.error
          ? html`<span class="text-red-400 text-xs">${this.error}</span>`
          : this.saved
            ? html`<span class="text-green-400 text-xs"
                >${translateText("lobby.name_saved")}</span
              >`
            : ""}
      </div>
    `;
  }
}

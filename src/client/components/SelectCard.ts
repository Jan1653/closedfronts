import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../Utils";
import { CARD_LABEL_CLASS, cardClass, INPUT_CLASS } from "./InputCardStyles";

export interface SelectCardOption {
  value: string;
  /** Translation key for the option's label. */
  labelKey: string;
}

/**
 * Lobby card holding a dropdown — the pick-one counterpart to input-card
 * (a number) and toggle-input-card (on/off plus a number). Used for game rules
 * that are a choice out of a few named settings rather than a value or a flag.
 * Highlights while it is on anything other than its default.
 */
@customElement("select-card")
export class SelectCard extends LitElement {
  @property({ attribute: false }) labelKey = "";
  @property({ attribute: false }) selectId?: string;
  @property({ attribute: false }) options: SelectCardOption[] = [];
  @property({ attribute: false }) value = "";
  /** Value considered "unchanged"; anything else lights the card up. */
  @property({ attribute: false }) defaultValue = "";
  // Named selectAriaLabel, not ariaLabel: HTMLElement already declares that one
  // as string | null and a differently typed override doesn't compile.
  @property({ attribute: false }) selectAriaLabel?: string;
  @property({ attribute: false }) onSelect?: (value: string) => void;

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div class="${cardClass(this.value !== this.defaultValue)}">
        <div
          class="w-full h-full p-3 flex flex-col items-center justify-between gap-2"
        >
          <div class="h-[30px] my-1"></div>

          <span class="${CARD_LABEL_CLASS} text-center text-white">
            ${translateText(this.labelKey)}
          </span>
        </div>

        <div class="absolute left-3 right-3 top-1/2 -translate-y-1/2 z-10">
          <select
            id=${this.selectId ?? nothing}
            class=${INPUT_CLASS}
            aria-label=${this.selectAriaLabel ?? nothing}
            .value=${this.value}
            @change=${(e: Event) =>
              this.onSelect?.((e.target as HTMLSelectElement).value)}
          >
            ${this.options.map(
              (o) => html`
                <option value=${o.value} ?selected=${o.value === this.value}>
                  ${translateText(o.labelKey)}
                </option>
              `,
            )}
          </select>
        </div>
      </div>
    `;
  }
}

import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";

/**
 * The guided tutorial on the home screen.
 *
 * Deliberately NOT the same thing as the help modal: help is a reference (the
 * full key list, a table of every building), this walks a new player through
 * the game in the order they will meet it — what to do first, then what each
 * system is for and how the systems feed each other.
 *
 * Content lives entirely in the language files under `tutorial.*`; this file
 * only holds the running order. Adding a section means adding a `<chapter>_<id>_h`
 * heading key plus a `_b` body key and listing the id here.
 */

interface Chapter {
  id: string;
  icon: string;
  sections: string[];
}

const CHAPTERS: readonly Chapter[] = [
  {
    id: "basics",
    icon: "🎯",
    sections: ["spawn", "troops", "expand", "limit"],
  },
  {
    id: "combat",
    icon: "⚔️",
    sections: ["ratio", "front", "defense", "conquest"],
  },
  { id: "economy", icon: "💰", sections: ["city", "port", "trade", "fishing"] },
  { id: "oil", icon: "🛢️", sections: ["pump", "storage", "use"] },
  {
    id: "mining",
    icon: "⛏️",
    sections: ["resources", "mine", "factory", "export"],
  },
  {
    id: "navy",
    icon: "🚢",
    sections: ["transport", "warship", "sub", "scout"],
  },
  { id: "defense", icon: "🛡️", sections: ["post", "wall", "sam", "support"] },
  { id: "nukes", icon: "☢️", sections: ["silo", "bombs", "mirv", "defend"] },
  {
    id: "diplomacy",
    icon: "🤝",
    sections: ["alliance", "pact", "help", "betray", "talk"],
  },
  {
    id: "hazards",
    icon: "🌋",
    sections: ["disasters", "doomsday", "immunity", "modes"],
  },
  {
    id: "controls",
    icon: "🖱️",
    sections: ["camera", "overlays", "fleet", "quantity"],
  },
];

@customElement("tutorial-modal")
export class TutorialModal extends BaseModal {
  protected routerName = "tutorial";

  @state() private current = 0;

  private select(index: number) {
    this.current = Math.min(Math.max(index, 0), CHAPTERS.length - 1);
    // Jump the reading pane back to the top; without this, picking a later
    // chapter drops you into the middle of it wherever the last one was
    // scrolled to.
    this.renderRoot.querySelector("#tutorial-body")?.scrollTo({ top: 0 });
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("tutorial.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  private renderChapterButton(chapter: Chapter, index: number) {
    const active = index === this.current;
    return html`<button
      class="flex items-center gap-2 shrink-0 lg:w-full text-left px-3 py-2 rounded-lg border transition-colors cursor-pointer ${active
        ? "bg-malibu-blue/20 border-malibu-blue/50 text-white"
        : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white"}"
      @click=${() => this.select(index)}
      aria-current=${active ? "step" : "false"}
    >
      <span aria-hidden="true">${chapter.icon}</span>
      <span
        class="text-sm font-semibold whitespace-nowrap lg:whitespace-normal"
      >
        ${translateText(`tutorial.ch_${chapter.id}_title`)}
      </span>
    </button>`;
  }

  protected renderBody() {
    const chapter = CHAPTERS[this.current];
    const isFirst = this.current === 0;
    const isLast = this.current === CHAPTERS.length - 1;

    return html`
      <div class="flex flex-col lg:flex-row gap-4 px-4 py-3 h-full min-h-0">
        <!-- Chapter list: a scrolling strip on phones, a sidebar from lg up -->
        <nav
          class="shrink-0 lg:w-60 flex flex-col gap-2 min-h-0"
          aria-label=${translateText("tutorial.chapters")}
        >
          <p
            class="hidden lg:block text-xs uppercase tracking-widest text-white/40 px-1"
          >
            ${translateText("tutorial.chapters")}
          </p>
          <div
            class="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-y-auto lg:overflow-x-hidden pb-1 custom-scrollbar"
          >
            ${CHAPTERS.map((c, i) => this.renderChapterButton(c, i))}
          </div>
        </nav>

        <!-- Reading pane -->
        <div
          id="tutorial-body"
          class="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1"
        >
          <header class="border-b border-white/10 pb-3 mb-4">
            <p class="text-xs uppercase tracking-widest text-malibu-blue/80">
              ${translateText("tutorial.progress", {
                current: String(this.current + 1),
                total: String(CHAPTERS.length),
              })}
            </p>
            <h2 class="text-2xl font-bold text-white mt-1">
              <span aria-hidden="true" class="mr-2">${chapter.icon}</span>
              ${translateText(`tutorial.ch_${chapter.id}_title`)}
            </h2>
            <p class="text-white/70 mt-2 leading-relaxed">
              ${translateText(`tutorial.ch_${chapter.id}_lead`)}
            </p>
          </header>

          <div class="flex flex-col gap-5">
            ${chapter.sections.map(
              (section) => html`
                <section>
                  <h3 class="text-base font-semibold text-blue-100">
                    ${translateText(`tutorial.ch_${chapter.id}_${section}_h`)}
                  </h3>
                  <p class="text-sm text-white/70 leading-relaxed mt-1">
                    ${translateText(`tutorial.ch_${chapter.id}_${section}_b`)}
                  </p>
                </section>
              `,
            )}
          </div>

          ${isLast
            ? html`<p
                class="mt-6 text-xs text-white/40 border-t border-white/10 pt-3"
              >
                ${translateText("tutorial.more_help")}
              </p>`
            : null}

          <div
            class="flex items-center justify-between gap-3 mt-6 pt-4 border-t border-white/10"
          >
            <button
              class="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm font-semibold text-white/80 enabled:hover:bg-white/10 enabled:cursor-pointer disabled:opacity-30"
              ?disabled=${isFirst}
              @click=${() => this.select(this.current - 1)}
            >
              ${translateText("tutorial.prev")}
            </button>
            <button
              class="px-4 py-2 rounded-lg bg-malibu-blue/20 border border-malibu-blue/50 text-sm font-semibold text-white enabled:hover:bg-malibu-blue/30 enabled:cursor-pointer disabled:opacity-30"
              ?disabled=${isLast}
              @click=${() => this.select(this.current + 1)}
            >
              ${translateText("tutorial.next")}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

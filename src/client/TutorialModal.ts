import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../client/Utils";
import { GameStyle } from "../core/game/Game";
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
 * It follows the game-style switch: reading it in OpenFront style hides the
 * chapters and sections describing units and economies that style removes, so
 * the tutorial never teaches something the chosen ruleset does not have.
 *
 * Content lives entirely in the language files under `tutorial.*`; this file
 * only holds the running order and which parts belong to which style.
 */

interface Section {
  id: string;
  /** Describes something only this fork has, so OpenFront style hides it. */
  closedFrontsOnly?: boolean;
}

interface Chapter {
  id: string;
  icon: string;
  closedFrontsOnly?: boolean;
  sections: Section[];
}

const CHAPTERS: readonly Chapter[] = [
  {
    id: "basics",
    icon: "🎯",
    sections: [
      { id: "spawn" },
      { id: "troops" },
      { id: "expand" },
      { id: "limit" },
    ],
  },
  {
    id: "combat",
    icon: "⚔️",
    sections: [
      { id: "ratio" },
      { id: "front" },
      { id: "defense" },
      { id: "conquest" },
    ],
  },
  {
    id: "economy",
    icon: "💰",
    sections: [
      { id: "city" },
      { id: "port" },
      { id: "trade" },
      { id: "fishing", closedFrontsOnly: true },
    ],
  },
  {
    id: "oil",
    icon: "🛢️",
    closedFrontsOnly: true,
    sections: [{ id: "pump" }, { id: "storage" }, { id: "use" }],
  },
  {
    id: "mining",
    icon: "⛏️",
    closedFrontsOnly: true,
    sections: [
      { id: "resources" },
      { id: "mine" },
      { id: "factory" },
      { id: "export" },
    ],
  },
  {
    id: "navy",
    icon: "🚢",
    sections: [
      { id: "transport" },
      { id: "warship" },
      { id: "sub", closedFrontsOnly: true },
      { id: "scout", closedFrontsOnly: true },
    ],
  },
  {
    id: "defense",
    icon: "🛡️",
    sections: [
      { id: "post" },
      { id: "wall", closedFrontsOnly: true },
      { id: "sam" },
      { id: "support", closedFrontsOnly: true },
    ],
  },
  {
    id: "nukes",
    icon: "☢️",
    sections: [
      { id: "silo" },
      { id: "bombs" },
      { id: "electric", closedFrontsOnly: true },
      { id: "mirv" },
      { id: "defend" },
    ],
  },
  {
    id: "diplomacy",
    icon: "🤝",
    sections: [
      { id: "alliance" },
      { id: "pact" },
      { id: "help" },
      { id: "betray" },
      { id: "talk" },
    ],
  },
  {
    id: "hazards",
    icon: "🌋",
    sections: [
      { id: "disasters", closedFrontsOnly: true },
      { id: "doomsday" },
      { id: "immunity" },
      { id: "modes" },
    ],
  },
  {
    id: "controls",
    icon: "🖱️",
    sections: [
      { id: "camera" },
      { id: "overlays" },
      { id: "resourcemaps", closedFrontsOnly: true },
      { id: "fleet" },
      { id: "quantity" },
    ],
  },
];

@customElement("tutorial-modal")
export class TutorialModal extends BaseModal {
  protected routerName = "tutorial";

  @state() private current = 0;
  @state() private viewStyle: GameStyle = GameStyle.ClosedFronts;

  /** Chapters the chosen style actually has. */
  private get chapters(): Chapter[] {
    if (this.viewStyle === GameStyle.ClosedFronts) return [...CHAPTERS];
    return CHAPTERS.filter((c) => !c.closedFrontsOnly);
  }

  private sectionsOf(chapter: Chapter): Section[] {
    if (this.viewStyle === GameStyle.ClosedFronts) return chapter.sections;
    return chapter.sections.filter((s) => !s.closedFrontsOnly);
  }

  private select(index: number) {
    this.current = Math.min(Math.max(index, 0), this.chapters.length - 1);
    // Jump the reading pane back to the top; without this, picking a later
    // chapter drops you into the middle of it wherever the last one was
    // scrolled to.
    this.renderRoot.querySelector("#tutorial-body")?.scrollTo({ top: 0 });
  }

  private setStyle(style: GameStyle) {
    if (this.viewStyle === style) return;
    // Chapter count shrinks in OpenFront style, so an index from the longer
    // list can point past the end.
    const readingId = this.chapters[this.current]?.id;
    this.viewStyle = style;
    const sameChapter = this.chapters.findIndex((c) => c.id === readingId);
    this.current = sameChapter >= 0 ? sameChapter : 0;
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("tutorial.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  private renderStyleSwitch() {
    return html`<div
      class="flex gap-1 p-1 rounded-lg bg-white/5 border border-white/10"
      role="group"
      aria-label=${translateText("game_style.title")}
    >
      ${[GameStyle.ClosedFronts, GameStyle.OpenFront].map((style) => {
        const active = this.viewStyle === style;
        const key =
          style === GameStyle.OpenFront ? "openfront" : "closedfronts";
        return html`<button
          class="px-3 py-1 rounded-md text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${active
            ? "bg-malibu-blue/30 text-white"
            : "text-white/50 hover:text-white/80"}"
          aria-pressed=${active}
          @click=${() => this.setStyle(style)}
        >
          ${translateText(`game_style.${key}`)}
        </button>`;
      })}
    </div>`;
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
      ${chapter.closedFrontsOnly && this.viewStyle === GameStyle.ClosedFronts
        ? html`<span
            class="ml-auto text-[10px] text-amber-300/70 shrink-0"
            title=${translateText("game_style.only_closedfronts")}
            >◆</span
          >`
        : null}
    </button>`;
  }

  protected renderBody() {
    const chapters = this.chapters;
    const chapter = chapters[this.current] ?? chapters[0];
    const isFirst = this.current === 0;
    const isLast = this.current === chapters.length - 1;

    return html`
      <div class="flex flex-col lg:flex-row gap-4 px-4 py-3 h-full min-h-0">
        <!-- Chapter list: a scrolling strip on phones, a sidebar from lg up -->
        <nav
          class="shrink-0 lg:w-60 flex flex-col gap-2 min-h-0"
          aria-label=${translateText("tutorial.chapters")}
        >
          <div class="hidden lg:block">${this.renderStyleSwitch()}</div>
          <p
            class="hidden lg:block text-xs uppercase tracking-widest text-white/40 px-1 pt-1"
          >
            ${translateText("tutorial.chapters")}
          </p>
          <div
            class="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-y-auto lg:overflow-x-hidden pb-1 custom-scrollbar"
          >
            ${chapters.map((c, i) => this.renderChapterButton(c, i))}
          </div>
          <div class="lg:hidden">${this.renderStyleSwitch()}</div>
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
                total: String(chapters.length),
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
            ${this.sectionsOf(chapter).map(
              (section) => html`
                <section>
                  <h3 class="text-base font-semibold text-blue-100">
                    ${translateText(
                      `tutorial.ch_${chapter.id}_${section.id}_h`,
                    )}
                  </h3>
                  <p class="text-sm text-white/70 leading-relaxed mt-1">
                    ${translateText(
                      `tutorial.ch_${chapter.id}_${section.id}_b`,
                    )}
                  </p>
                </section>
              `,
            )}
          </div>

          ${isLast
            ? html`<div
                class="mt-6 text-xs text-white/40 border-t border-white/10 pt-3 space-y-1"
              >
                <p>${translateText("tutorial.more_help")}</p>
                ${this.viewStyle === GameStyle.ClosedFronts
                  ? html`<p>
                      <span aria-hidden="true" class="text-amber-300/70"
                        >◆</span
                      >
                      ${translateText("game_style.tutorial_hint")}
                    </p>`
                  : null}
              </div>`
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

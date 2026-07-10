import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  browseCommunityMaps,
  CommunityMapSummary,
  getCommunityMap,
  getMyCommunityMaps,
  likeCommunityMap,
} from "../../Api";
import { getAuthHeader } from "../../Auth";
import { translateText } from "../../Utils";
import { BaseModal } from "../BaseModal";
import { modalHeader } from "../ui/ModalHeader";
import { decodePaintBase64, saveCustomMap } from "./CustomMapStore";
import { playCustomMapSolo } from "./playCustomMap";

type Filter = "likes" | "new" | "mine";

@customElement("community-maps-modal")
export class CommunityMapsModal extends BaseModal {
  @state() private filter: Filter = "likes";
  @state() private maps: CommunityMapSummary[] = [];
  @state() private loading = false;
  @state() private notice: string | null = null;
  @state() private noticeError = false;
  private noticeTimer: number | null = null;

  constructor() {
    super();
    this.id = "page-community-maps";
  }

  protected modalConfig() {
    return { maxWidth: "1000px" };
  }

  protected override onOpen(): void {
    void this.load();
  }

  protected renderHeaderSlot(): TemplateResult {
    return modalHeader({
      title: translateText("community_maps.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  private async load() {
    this.loading = true;
    try {
      if (this.filter === "mine") {
        this.maps = await getMyCommunityMaps();
      } else {
        const page = await browseCommunityMaps({
          sort: this.filter,
          limit: 48,
        });
        this.maps = page?.results ?? [];
      }
    } finally {
      this.loading = false;
    }
  }

  private setFilter(f: Filter) {
    if (this.filter === f) return;
    this.filter = f;
    void this.load();
  }

  private showNotice(msg: string, isError: boolean) {
    if (this.noticeTimer) window.clearTimeout(this.noticeTimer);
    this.notice = msg;
    this.noticeError = isError;
    this.noticeTimer = window.setTimeout(() => {
      this.notice = null;
      this.noticeTimer = null;
    }, 3000);
  }

  private async toggleLike(m: CommunityMapSummary) {
    if ((await getAuthHeader()) === "") {
      this.showNotice(translateText("community_maps.login_required"), true);
      return;
    }
    const res = await likeCommunityMap(m.id, !m.likedByMe);
    if (!res) return;
    this.maps = this.maps.map((x) =>
      x.id === m.id
        ? { ...x, likeCount: res.likeCount, likedByMe: res.likedByMe }
        : x,
    );
  }

  private async addToMine(m: CommunityMapSummary) {
    const detail = await getCommunityMap(m.id);
    if (!detail) {
      this.showNotice(translateText("community_maps.error"), true);
      return;
    }
    saveCustomMap({
      name: detail.name,
      width: detail.width,
      height: detail.height,
      paint: decodePaintBase64(detail.paint),
    });
    this.showNotice(translateText("community_maps.added"), false);
  }

  private async play(m: CommunityMapSummary) {
    const detail = await getCommunityMap(m.id);
    if (!detail) {
      this.showNotice(translateText("community_maps.error"), true);
      return;
    }
    void playCustomMapSolo(detail);
    this.close();
  }

  private renderTab(f: Filter, label: string): TemplateResult {
    const active = this.filter === f;
    return html`<button
      type="button"
      @click=${() => this.setFilter(f)}
      class="px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all active:scale-95 ${active
        ? "bg-malibu-blue/20 text-white shadow-[var(--shadow-malibu-blue-soft)]"
        : "text-white/60 hover:text-white"}"
    >
      ${label}
    </button>`;
  }

  private renderCard(m: CommunityMapSummary): TemplateResult {
    return html`
      <div
        class="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="text-sm font-bold text-white truncate">${m.name}</div>
            <div class="text-[10px] text-white/40">${m.width}×${m.height}</div>
          </div>
          <button
            type="button"
            @click=${() => this.toggleLike(m)}
            class="shrink-0 flex items-center gap-1 rounded-full px-2 py-1 text-xs transition-colors ${m.likedByMe
              ? "bg-red-500/20 text-red-300"
              : "bg-white/10 text-white/70 hover:bg-white/20"}"
            title=${translateText("community_maps.like")}
          >
            <span>${m.likedByMe ? "♥" : "♡"}</span>
            <span class="tabular-nums">${m.likeCount}</span>
          </button>
        </div>
        <div class="grid grid-cols-2 gap-2 mt-1">
          <button
            @click=${() => this.play(m)}
            class="rounded-lg px-3 py-2 text-xs font-semibold bg-green-600 hover:bg-green-500 transition-colors"
          >
            ${translateText("map_editor.play")}
          </button>
          <button
            @click=${() => this.addToMine(m)}
            class="rounded-lg px-3 py-2 text-xs bg-white/10 hover:bg-white/20 transition-colors"
          >
            ${translateText("community_maps.add")}
          </button>
        </div>
      </div>
    `;
  }

  protected renderBody(): TemplateResult {
    return html`
      <div class="custom-scrollbar p-4 lg:p-6 flex flex-col gap-4 text-white">
        <div
          role="tablist"
          class="flex gap-2 rounded-xl border border-white/10 bg-black/20 p-1 self-start"
        >
          ${this.renderTab(
            "likes",
            translateText("community_maps.tab_popular"),
          )}
          ${this.renderTab("new", translateText("community_maps.tab_new"))}
          ${this.renderTab("mine", translateText("community_maps.tab_mine"))}
        </div>

        ${this.loading
          ? this.renderLoadingSpinner()
          : this.maps.length === 0
            ? html`<p class="text-sm text-white/40 py-8 text-center">
                ${translateText(
                  this.filter === "mine"
                    ? "community_maps.empty_mine"
                    : "community_maps.empty",
                )}
              </p>`
            : html`<div
                class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3"
              >
                ${this.maps.map((m) => this.renderCard(m))}
              </div>`}
        ${this.notice
          ? html`<p
              class="text-xs ${this.noticeError
                ? "text-red-400"
                : "text-green-400"}"
            >
              ${this.notice}
            </p>`
          : null}
      </div>
    `;
  }
}

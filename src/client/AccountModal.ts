import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ClientEnv } from "src/client/ClientEnv";
import { PlayerStatsTree, UserMeResponse } from "../core/ApiSchemas";
import { Cosmetics } from "../core/CosmeticSchemas";
import { deleteAvatar, fetchPlayerById, getUserMe, uploadAvatar } from "./Api";
import { loginAccount, logOut, registerAccount } from "./Auth";
import "./components/baseComponents/stats/DiscordUserHeader";
import "./components/baseComponents/stats/PlayerGameHistoryView";
import type { PlayerGameHistoryCache } from "./components/baseComponents/stats/PlayerGameHistoryView";
import "./components/baseComponents/stats/PlayerStatsTable";
import "./components/baseComponents/stats/PlayerStatsTree";
import { BaseModal } from "./components/BaseModal";
import "./components/CopyButton";
import "./components/CurrencyDisplay";
import "./components/Difficulties";
import "./components/FriendsList";
import "./components/SubscriptionPanel";
import { modalHeader } from "./components/ui/ModalHeader";
import { fetchCosmetics } from "./Cosmetics";
import { translateText } from "./Utils";

@customElement("account-modal")
export class AccountModal extends BaseModal {
  protected routerName = "account";

  @state() private email: string = "";
  @state() private password: string = "";
  @state() private authError: string = "";
  @state() private authBusy: boolean = false;
  @state() private isLoadingUser: boolean = false;
  @state() private avatarBusy: boolean = false;
  @state() private avatarError: string = "";

  private userMeResponse: UserMeResponse | null = null;
  private statsTree: PlayerStatsTree | null = null;
  // Preserves the Games tab's accumulated list + cursor across tab switches.
  private gameHistoryCache: PlayerGameHistoryCache | null = null;
  private cosmetics: Cosmetics | null = null;

  constructor() {
    super();

    document.addEventListener("userMeResponse", (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail) {
        const previousPublicId = this.userMeResponse?.player?.publicId;
        this.userMeResponse = customEvent.detail as UserMeResponse;
        // Reset whenever the player identity changes (login, or switching to a
        // different account) so stats/history from the previous player don't
        // linger.
        if (this.userMeResponse?.player?.publicId !== previousPublicId) {
          this.statsTree = null;
          this.gameHistoryCache = null;
          this.requestUpdate();
        }
      } else {
        this.statsTree = null;
        this.gameHistoryCache = null;
        this.requestUpdate();
      }
    });
  }

  private hasAnyStats(): boolean {
    if (!this.statsTree) return false;
    // Check if statsTree has any data
    return (
      Object.keys(this.statsTree).length > 0 &&
      Object.values(this.statsTree).some(
        (gameTypeStats) =>
          gameTypeStats && Object.keys(gameTypeStats).length > 0,
      )
    );
  }

  protected renderHeaderSlot() {
    const isLoggedIn = !!this.userMeResponse?.user;
    const publicId = this.userMeResponse?.player?.publicId ?? "";
    const displayId = publicId || translateText("account_modal.not_found");
    return modalHeader({
      title: translateText("account_modal.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
      rightContent:
        isLoggedIn && !this.isLoadingUser
          ? html`
              <div class="flex items-center gap-2">
                <span
                  class="text-xs text-blue-400 font-bold uppercase tracking-wider"
                  >${translateText("account_modal.public_player_id")}</span
                >
                <copy-button
                  .lobbyId=${publicId}
                  .copyText=${publicId}
                  .displayText=${displayId}
                ></copy-button>
              </div>
            `
          : undefined,
    });
  }

  private isLinkedAccount(): boolean {
    const me = this.userMeResponse?.user;
    return !!(me?.discord ?? me?.google ?? me?.email);
  }

  protected modalConfig() {
    if (this.isLoadingUser || !this.isLinkedAccount()) {
      return {};
    }
    return {
      tabs: [
        { key: "account", label: translateText("account_modal.tab_account") },
        { key: "stats", label: translateText("account_modal.tab_stats") },
        { key: "games", label: translateText("account_modal.tab_games") },
        { key: "friends", label: translateText("account_modal.tab_friends") },
      ],
    };
  }

  protected renderBody(tab: string) {
    if (this.isLoadingUser) {
      return this.renderLoadingSpinner(
        translateText("account_modal.fetching_account"),
      );
    }
    if (!this.isLinkedAccount()) {
      return html`<div class="custom-scrollbar mr-1">
        ${this.renderLoginOptions()}
      </div>`;
    }
    return html`
      <div class="custom-scrollbar mr-1">
        <div class="p-6">${this.renderTab(tab)}</div>
      </div>
    `;
  }

  private renderTab(tab: string): TemplateResult {
    switch (tab) {
      case "stats":
        return this.renderStatsTab();
      case "games":
        return this.renderGamesTab();
      case "friends":
        return this.renderFriendsTab();
      default:
        return this.renderAccountTab();
    }
  }

  private renderFriendsTab(): TemplateResult {
    const myPublicId = this.userMeResponse?.player?.publicId ?? "";
    return html`<friends-list .myPublicId=${myPublicId}></friends-list>`;
  }

  private renderAvatar(): TemplateResult {
    const url = this.userMeResponse?.player?.avatarUrl;
    return html`
      <div class="flex flex-col items-center gap-2">
        <div
          class="w-24 h-24 rounded-full overflow-hidden bg-white/10 border border-white/15 flex items-center justify-center"
        >
          ${url
            ? html`<img
                src=${url}
                alt="Avatar"
                class="w-full h-full object-cover"
              />`
            : html`<svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-12 h-12 text-white/30"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path
                  d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z"
                />
              </svg>`}
        </div>
        <div class="flex gap-2 items-center">
          <label
            class="cursor-pointer px-3 py-1.5 rounded-lg bg-malibu-blue/80 hover:bg-malibu-blue text-white text-sm font-bold transition-colors ${this
              .avatarBusy
              ? "opacity-60 pointer-events-none"
              : ""}"
          >
            ${this.avatarBusy
              ? translateText("account_modal.avatar_uploading")
              : translateText("account_modal.avatar_upload")}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              class="hidden"
              @change=${this.handleAvatarFile}
            />
          </label>
          ${url
            ? html`<button
                @click=${this.handleAvatarRemove}
                ?disabled=${this.avatarBusy}
                class="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white/70 text-sm transition-colors"
              >
                ${translateText("account_modal.avatar_remove")}
              </button>`
            : ""}
        </div>
        ${this.avatarError
          ? html`<span class="text-red-400 text-xs">${this.avatarError}</span>`
          : ""}
      </div>
    `;
  }

  private async downscaleImage(file: File, size = 128): Promise<string> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => reject(new Error("read"));
      fr.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("decode"));
      i.src = dataUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("ctx");
    // Cover-crop to a centered square so the whole tile is filled.
    const scale = Math.max(size / img.width, size / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    return canvas.toDataURL("image/jpeg", 0.85);
  }

  private async handleAvatarFile(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      this.avatarError = translateText("account_modal.avatar_invalid");
      this.requestUpdate();
      return;
    }
    // Guard against loading an absurdly large source file into memory (the
    // downscale bounds the uploaded size; the server enforces its own cap).
    if (file.size > 10 * 1024 * 1024) {
      this.avatarError = translateText("account_modal.avatar_too_large");
      this.requestUpdate();
      return;
    }
    this.avatarBusy = true;
    this.avatarError = "";
    this.requestUpdate();
    try {
      const dataUrl = await this.downscaleImage(file);
      const result = await uploadAvatar(dataUrl);
      if ("error" in result) {
        this.avatarError = translateText(
          result.error === "image_too_large"
            ? "account_modal.avatar_too_large"
            : "account_modal.avatar_failed",
        );
      } else {
        const me = await getUserMe();
        if (me) this.userMeResponse = me;
      }
    } catch {
      this.avatarError = translateText("account_modal.avatar_invalid");
    }
    this.avatarBusy = false;
    this.requestUpdate();
  }

  private async handleAvatarRemove(): Promise<void> {
    this.avatarBusy = true;
    this.avatarError = "";
    this.requestUpdate();
    await deleteAvatar();
    const me = await getUserMe();
    if (me) this.userMeResponse = me;
    this.avatarBusy = false;
    this.requestUpdate();
  }

  private renderAccountTab(): TemplateResult {
    return html`
      <div class="flex flex-col gap-6">
        <div class="bg-white/5 rounded-xl border border-white/10 p-6">
          <div class="flex flex-col items-center gap-4">
            <div
              class="text-xs text-white/40 uppercase tracking-widest font-bold border-b border-white/5 pb-2 px-8"
            >
              ${translateText("account_modal.connected_as")}
            </div>
            ${this.renderAvatar()}
            <div class="flex items-center gap-8 justify-center flex-wrap">
              <discord-user-header
                .data=${this.userMeResponse?.user?.discord ?? null}
              ></discord-user-header>
              ${this.renderLoggedInAs()}
            </div>
          </div>
        </div>
        ${this.renderSubscriptionPanel()}
      </div>
    `;
  }

  private renderStatsTab(): TemplateResult {
    if (!this.hasAnyStats()) {
      return this.renderEmptyState(
        "📊",
        translateText("account_modal.no_stats"),
      );
    }
    return html`
      <div class="bg-white/5 rounded-xl border border-white/10 p-6">
        <h3 class="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <span class="text-blue-400">📊</span>
          ${translateText("account_modal.stats_overview")}
        </h3>
        <player-stats-tree-view
          .statsTree=${this.statsTree}
        ></player-stats-tree-view>
      </div>
    `;
  }

  private renderGamesTab(): TemplateResult {
    const publicId = this.userMeResponse?.player?.publicId ?? "";
    if (!publicId) {
      return this.renderEmptyState(
        "🎮",
        translateText("account_modal.no_games"),
      );
    }
    return html`
      <player-game-history-view
        .publicId=${publicId}
        .cachedState=${this.gameHistoryCache?.publicId === publicId
          ? this.gameHistoryCache
          : null}
        @history-updated=${(e: CustomEvent<PlayerGameHistoryCache>) => {
          this.gameHistoryCache = e.detail;
        }}
        @view-game=${(e: CustomEvent<{ gameId: string }>) =>
          void this.viewGame(e.detail.gameId)}
      ></player-game-history-view>
    `;
  }

  private renderEmptyState(icon: string, message: string): TemplateResult {
    return html`
      <div
        class="bg-white/5 rounded-xl border border-white/10 p-12 flex flex-col items-center justify-center text-center"
      >
        <div class="text-4xl mb-3">${icon}</div>
        <p class="text-white/60 text-sm">${message}</p>
      </div>
    `;
  }

  private renderSubscriptionPanel(): TemplateResult | "" {
    const sub = this.userMeResponse?.player?.subscription;
    if (!sub) return "";
    const cosmetic = this.cosmetics?.subscriptions?.[sub.tier] ?? null;
    return html`<subscription-panel
      .sub=${sub}
      .cosmetic=${cosmetic}
    ></subscription-panel>`;
  }

  private renderCurrency(): TemplateResult {
    const currency = this.userMeResponse?.player?.currency;
    if (!currency) return html``;

    return html`
      <currency-display
        .hard=${currency.hard}
        .soft=${currency.soft}
      ></currency-display>
    `;
  }

  private renderLoggedInAs(): TemplateResult {
    const me = this.userMeResponse?.user;
    const accountName = me?.email ?? me?.google?.email ?? "";
    return html`
      <div class="flex flex-col items-center gap-3 w-full">
        ${accountName
          ? html`<div class="text-white text-lg font-medium">
              ${translateText("account_modal.linked_account", {
                account_name: accountName,
              })}
            </div>`
          : ""}
        ${this.renderCurrency()} ${this.renderLogoutButton()}
      </div>
    `;
  }

  private async viewGame(gameId: string): Promise<void> {
    this.close();
    const encodedGameId = encodeURIComponent(gameId);
    const newUrl = `/${ClientEnv.workerPath(gameId)}/game/${encodedGameId}`;

    history.pushState({ join: gameId }, "", newUrl);
    window.dispatchEvent(
      new CustomEvent("join-changed", { detail: { gameId: encodedGameId } }),
    );
  }

  private renderLogoutButton(): TemplateResult {
    return html`
      <o-button
        variant="danger"
        size="md"
        translationKey="account_modal.log_out"
        @click=${this.handleLogout}
      ></o-button>
    `;
  }

  private renderLoginOptions() {
    return html`
      <div class="flex items-center justify-center p-6 min-h-full">
        <div
          class="w-full max-w-md bg-white/5 rounded-2xl border border-white/10 p-8"
        >
          <div class="text-center mb-8">
            <div
              class="w-16 h-16 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-white/10 shadow-inner"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-8 h-8 text-blue-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                <polyline points="10 17 15 12 10 7"></polyline>
                <line x1="15" y1="12" x2="3" y2="12"></line>
              </svg>
            </div>
            <p class="text-white/50 text-sm font-medium">
              ${translateText("account_modal.sign_in_desc")}
            </p>
            ${this.renderCurrency()}
          </div>

          <div class="space-y-4">
            <div class="relative group">
              <input
                type="email"
                id="email"
                name="email"
                autocomplete="email"
                .value="${this.email}"
                @input="${this.handleEmailInput}"
                class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-malibu-blue/50 focus:border-malibu-blue/50 transition-all font-medium hover:bg-white/10"
                placeholder="${translateText(
                  "account_modal.email_placeholder",
                )}"
                required
              />
            </div>
            <div class="relative group">
              <input
                type="password"
                id="password"
                name="password"
                autocomplete="current-password"
                .value="${this.password}"
                @input="${this.handlePasswordInput}"
                @keydown="${this.handleAuthKeydown}"
                class="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-malibu-blue/50 focus:border-malibu-blue/50 transition-all font-medium hover:bg-white/10"
                placeholder="${translateText(
                  "account_modal.password_placeholder",
                )}"
                required
              />
            </div>
            ${this.authError
              ? html`<p class="text-red-400 text-sm text-center">
                  ${this.authError}
                </p>`
              : ""}
            <o-button
              variant="primary"
              width="block"
              size="md"
              ?disable=${this.authBusy}
              translationKey="account_modal.sign_in_button"
              @click=${this.handleLogin}
            ></o-button>
            <o-button
              variant="ghost"
              width="block"
              size="md"
              ?disable=${this.authBusy}
              translationKey="account_modal.register_button"
              @click=${this.handleRegister}
            ></o-button>
          </div>

          <div class="mt-8 text-center border-t border-white/10 pt-6">
            <button
              @click="${this.handleLogout}"
              class="text-[10px] font-bold text-white/20 hover:text-red-400 transition-colors uppercase tracking-widest pb-0.5"
            >
              ${translateText("account_modal.clear_session")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private handleEmailInput(e: Event) {
    this.email = (e.target as HTMLInputElement).value;
    this.authError = "";
  }

  private handlePasswordInput(e: Event) {
    this.password = (e.target as HTMLInputElement).value;
    this.authError = "";
  }

  private handleAuthKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") void this.handleLogin();
  }

  private async handleLogin(): Promise<void> {
    await this.submitAuth("login");
  }

  private async handleRegister(): Promise<void> {
    await this.submitAuth("register");
  }

  private async submitAuth(mode: "login" | "register"): Promise<void> {
    if (this.authBusy) return;
    const email = this.email.trim();
    if (!email || !this.password) {
      this.authError = translateText("account_modal.enter_email_and_password");
      return;
    }
    this.authBusy = true;
    this.authError = "";
    const result =
      mode === "login"
        ? await loginAccount(email, this.password)
        : await registerAccount(email, this.password);
    this.authBusy = false;
    if (result.ok) {
      // Reload so the app picks up the new session (mirrors handleLogout).
      window.location.reload();
      return;
    }
    this.authError = this.authErrorMessage(result.error);
    this.requestUpdate();
  }

  private authErrorMessage(code: string): string {
    switch (code) {
      case "email_taken":
        return translateText("account_modal.error_email_taken");
      case "invalid_credentials":
        return translateText("account_modal.error_invalid_credentials");
      case "invalid_email":
        return translateText("account_modal.error_invalid_email");
      case "invalid_password":
        return translateText("account_modal.error_invalid_password");
      default:
        return translateText("account_modal.error_auth_failed");
    }
  }

  protected onOpen(_args?: Record<string, unknown>): void {
    this.isLoadingUser = true;

    void fetchCosmetics().then((cosmetics) => {
      this.cosmetics = cosmetics;
      this.requestUpdate();
    });

    void getUserMe()
      .then((userMe) => {
        if (userMe) {
          this.userMeResponse = userMe;
          if (this.userMeResponse?.player?.publicId) {
            this.loadPlayerProfile(this.userMeResponse.player.publicId);
          }
        }
        this.isLoadingUser = false;
        this.requestUpdate();
      })
      .catch((err) => {
        console.warn("Failed to fetch user info in AccountModal.open():", err);
        this.isLoadingUser = false;
        this.requestUpdate();
      });
    this.requestUpdate();
  }

  protected onClose(): void {
    this.dispatchEvent(
      new CustomEvent("close", { bubbles: true, composed: true }),
    );
  }

  private async handleLogout() {
    await logOut();
    this.close();
    // Refresh the page after logout to update the UI state
    window.location.reload();
  }

  private async loadPlayerProfile(publicId: string): Promise<void> {
    try {
      const data = await fetchPlayerById(publicId);
      if (!data) {
        this.requestUpdate();
        return;
      }

      this.statsTree = data.stats;

      this.requestUpdate();
    } catch (err) {
      console.warn("Failed to load player data:", err);
      this.requestUpdate();
    }
  }
}

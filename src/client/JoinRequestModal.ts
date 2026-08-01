import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ServerJoinRequestMessage } from "../core/Schemas";
import { translateText } from "./Utils";

/** Fired by ClientGameRunner when the server sends a join_request update. */
export const JOIN_REQUEST_EVENT = "join-request-update";
/** Fired by this modal when the player votes; Transport sends it on. */
export const JOIN_VOTE_EVENT = "join-vote";

export interface JoinVoteDetail {
  applicantClientID: string;
  approve: boolean;
  force?: boolean;
}

/**
 * Late join: the ballot everyone already in the game sees when somebody asks
 * to join mid-match, and the waiting screen the applicant sees.
 *
 * Deliberately a plain DOM modal rather than a HUD layer: the applicant has no
 * game running yet, so there is no HUD to hang it off.
 */
@customElement("join-request-modal")
export class JoinRequestModal extends LitElement {
  @state() private request: ServerJoinRequestMessage | null = null;
  // Set once we've voted, so the buttons don't invite a second ballot.
  @state() private voted = false;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener(
      JOIN_REQUEST_EVENT,
      this.onRequest as EventListener,
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener(
      JOIN_REQUEST_EVENT,
      this.onRequest as EventListener,
    );
  }

  private onRequest = (e: CustomEvent<ServerJoinRequestMessage>): void => {
    const msg = e.detail;
    if (msg.resolved !== "pending") {
      // Approved or rejected — the prompt has served its purpose. The
      // applicant's client gets a start message right after an approval.
      this.request = null;
      this.voted = false;
      this.requestUpdate();
      return;
    }
    if (this.request?.applicantClientID !== msg.applicantClientID) {
      this.voted = false;
    }
    this.request = msg;
    this.requestUpdate();
  };

  private vote(approve: boolean, force = false): void {
    const req = this.request;
    if (req === null) return;
    this.voted = true;
    window.dispatchEvent(
      new CustomEvent<JoinVoteDetail>(JOIN_VOTE_EVENT, {
        detail: {
          applicantClientID: req.applicantClientID,
          approve,
          force,
        },
      }),
    );
    // A no closes the prompt immediately; a yes keeps it up showing the tally.
    if (!approve) this.request = null;
    this.requestUpdate();
  }

  render() {
    const req = this.request;
    if (req === null) return html``;

    return html`
      <div
        class="fixed inset-0 z-[1200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      >
        <div
          class="flex flex-col gap-3 p-5 rounded-xl border border-slate-500 bg-gray-900/95 shadow-2xl max-w-[92vw] w-[420px] text-white"
        >
          ${req.isApplicant
            ? html`
                <div class="text-lg font-bold text-center">
                  ${translateText("late_join.waiting_title")}
                </div>
                <div class="text-sm text-gray-300 text-center">
                  ${translateText("late_join.waiting_body")}
                </div>
                <div class="text-center text-yellow-300 font-bold tabular-nums">
                  ${req.votesFor} / ${req.votesNeeded}
                </div>
              `
            : html`
                <div class="text-lg font-bold text-center">
                  ${translateText("late_join.vote_title", {
                    name: req.username,
                  })}
                </div>
                <div class="text-sm text-gray-300 text-center">
                  ${translateText("late_join.vote_body")}
                </div>
                <div class="text-center text-yellow-300 font-bold tabular-nums">
                  ${req.votesFor} / ${req.votesNeeded}
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <button
                    class="px-3 py-2 rounded bg-slate-600 hover:bg-slate-500 disabled:opacity-50"
                    ?disabled=${this.voted}
                    @click=${() => this.vote(false)}
                  >
                    ${translateText("late_join.reject")}
                  </button>
                  <button
                    class="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 font-semibold disabled:opacity-50"
                    ?disabled=${this.voted}
                    @click=${() => this.vote(true)}
                  >
                    ${translateText("late_join.approve")}
                  </button>
                </div>
                ${req.canForce
                  ? html`<button
                      class="px-3 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold"
                      title=${translateText("late_join.force_title")}
                      @click=${() => this.vote(true, true)}
                    >
                      ${translateText("late_join.force")}
                    </button>`
                  : null}
              `}
        </div>
      </div>
    `;
  }
}

import { Execution, Game, Gold, MessageType, Player } from "../../game/Game";
import { GameImpl } from "../../game/GameImpl";

/**
 * Offer a non-aggression pact to another player, with the gold penalty the
 * offering side proposes. One-shot: the offer lands in the recipient's pending
 * list and this execution ends.
 */
export class PactRequestExecution implements Execution {
  private active = true;

  constructor(
    private requestor: Player,
    private recipientID: string,
    private penalty: Gold,
  ) {}

  init(mg: Game, ticks: number): void {
    this.active = false;
    if (!mg.hasPlayer(this.recipientID)) {
      console.warn(`PactRequestExecution: unknown player ${this.recipientID}`);
      return;
    }
    const recipient = mg.player(this.recipientID);
    if (!this.requestor.canSendPactRequest(recipient)) {
      return;
    }
    (mg as GameImpl).createPactRequest(this.requestor, recipient, this.penalty);
  }

  tick(): void {}

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

/** Accept or reject a pending pact offer. */
export class PactReplyExecution implements Execution {
  private active = true;

  constructor(
    private recipient: Player,
    private requestorID: string,
    private accepted: boolean,
  ) {}

  init(mg: Game, ticks: number): void {
    this.active = false;
    if (!mg.hasPlayer(this.requestorID)) {
      return;
    }
    const requestor = mg.player(this.requestorID);
    const request = this.recipient
      .incomingPactRequests()
      .find((r) => r.requestor() === requestor);
    if (request === undefined) {
      return;
    }
    if (this.accepted) {
      request.accept();
      mg.displayMessage(
        "events_display.pact_accepted",
        MessageType.ALLIANCE_ACCEPTED,
        requestor.id(),
        undefined,
        { name: this.recipient.displayName() },
      );
    } else {
      request.reject();
    }
  }

  tick(): void {}

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

/**
 * Walk away from a pact. The breaker immediately pays the agreed penalty to
 * the other side (as much of it as they have), and both are free to take each
 * other's land again.
 */
export class BreakPactExecution implements Execution {
  private active = true;

  constructor(
    private breaker: Player,
    private otherID: string,
  ) {}

  init(mg: Game, ticks: number): void {
    this.active = false;
    if (!mg.hasPlayer(this.otherID)) {
      return;
    }
    const other = mg.player(this.otherID);
    const pact = this.breaker.nonAggressionPactWith(other);
    if (pact === null) {
      return;
    }
    this.breaker.breakNonAggressionPact(pact);
  }

  tick(): void {}

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

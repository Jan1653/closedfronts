import {
  Gold,
  NonAggressionPact,
  NonAggressionPactRequest,
  Player,
  Tick,
} from "./Game";
import { GameImpl } from "./GameImpl";

/**
 * A live non-aggression pact. Immutable apart from being detached when broken
 * — the penalty is fixed when both sides agree to it, so neither can quietly
 * lower the price of betraying the other later.
 */
export class NonAggressionPactImpl implements NonAggressionPact {
  constructor(
    private readonly a: Player,
    private readonly b: Player,
    private readonly penalty_: Gold,
    private readonly createdAt_: Tick,
    private readonly id_: number,
  ) {}

  id(): number {
    return this.id_;
  }

  other(player: Player): Player {
    return this.a === player ? this.b : this.a;
  }

  penalty(): Gold {
    return this.penalty_;
  }

  createdAt(): Tick {
    return this.createdAt_;
  }
}

/** A pending pact offer. The penalty travels with the offer. */
export class NonAggressionPactRequestImpl implements NonAggressionPactRequest {
  private status_: "pending" | "accepted" | "rejected" = "pending";

  constructor(
    private requestor_: Player,
    private recipient_: Player,
    private penalty_: Gold,
    private tickCreated: Tick,
    private game: GameImpl,
  ) {}

  status(): "pending" | "accepted" | "rejected" {
    return this.status_;
  }

  requestor(): Player {
    return this.requestor_;
  }

  recipient(): Player {
    return this.recipient_;
  }

  penalty(): Gold {
    return this.penalty_;
  }

  createdAt(): Tick {
    return this.tickCreated;
  }

  accept(): void {
    if (this.status_ !== "pending") return;
    this.status_ = "accepted";
    this.game.acceptPactRequest(this);
  }

  reject(): void {
    if (this.status_ !== "pending") return;
    this.status_ = "rejected";
    this.game.rejectPactRequest(this);
  }
}

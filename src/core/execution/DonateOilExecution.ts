import { Execution, Game, Player, PlayerID } from "../game/Game";

/**
 * Gifts oil from an allied player to another. Mirrors DonateGoldExecution but
 * for the oil resource: the recipient only takes what fits under their own oil
 * cap. A null amount defaults to a third of the sender's current oil.
 */
export class DonateOilExecution implements Execution {
  private recipient: Player;
  private oil: number;
  private mg: Game;
  private active = true;

  constructor(
    private sender: Player,
    private recipientID: PlayerID,
    oilNum: number | null,
  ) {
    this.oil = oilNum ?? -1;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (!mg.hasPlayer(this.recipientID)) {
      console.warn(
        `DonateOilExecution recipient ${this.recipientID} not found`,
      );
      this.active = false;
      return;
    }
    this.recipient = mg.player(this.recipientID);
    if (this.oil < 0) this.oil = Math.floor(this.sender.oil() / 3);
  }

  tick(ticks: number): void {
    if (
      !this.sender.canDonateOil(this.recipient) ||
      !this.sender.donateOil(this.recipient, this.oil)
    ) {
      console.warn(
        `cannot send oil from ${this.sender.name()} to ${this.recipient.name()}`,
      );
    }
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

import { OilDepositAmount } from "../../core/game/OilDeposits";
import { SelectCardOption } from "./SelectCard";

/**
 * Choices for the "oil deposits" game rule, shared by the single-player and
 * host lobbies so both offer exactly the same wording. The values are the
 * GameConfig field; the labels live under `oil_deposits.*` in the language
 * files rather than under either modal's own namespace.
 */
export const OIL_DEPOSIT_OPTIONS: SelectCardOption[] = (
  ["scarce", "normal", "rich", "abundant"] satisfies OilDepositAmount[]
).map((value) => ({ value, labelKey: `oil_deposits.${value}` }));

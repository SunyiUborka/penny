import { splitEqually } from '../currency/split.js';
import { computeSettlementInputSchema } from '../schemas/settlement.js';

/**
 * @typedef {{ payerId: string, baseAmountMinor: number, sharedWithIds: string[] }} SettlementExpense
 * @typedef {{ personId: string, paidMinor: number, owedMinor: number, balanceMinor: number }} Balance
 * @typedef {{ fromId: string, toId: string, amountMinor: number }} Transfer
 */

/**
 * Kiszámolja az esemény résztvevőinek egyenlegét és a szükséges utalásokat.
 *
 * balanceMinor = kifizetett − rá eső rész. A balance-ok összege pontosan 0.
 * A transzfereket mohó algoritmus minimalizálja: minden lépésben a legnagyobb
 * adóst párosítja a legnagyobb hitelezővel. Azonos egyenlegek esetén a
 * személy-azonosító szerinti rendezés biztosítja a determinisztikus kimenetet.
 * Nulla egyenlegű résztvevő nem szerepel transzferben.
 *
 * @param {{ participantIds: string[], expenses: SettlementExpense[] }} input
 * @returns {{ balances: Balance[], transfers: Transfer[] }}
 */
export function computeSettlement(input) {
  const { participantIds, expenses } = computeSettlementInputSchema.parse(input);

  const paidMinor = new Map(participantIds.map((id) => [id, 0]));
  const owedMinor = new Map(participantIds.map((id) => [id, 0]));

  for (const expense of expenses) {
    paidMinor.set(expense.payerId, paidMinor.get(expense.payerId) + expense.baseAmountMinor);

    const shares = splitEqually({
      amountMinor: expense.baseAmountMinor,
      participantIds: expense.sharedWithIds,
    });
    for (const share of shares) {
      owedMinor.set(share.personId, owedMinor.get(share.personId) + share.shareMinor);
    }
  }

  const balances = participantIds.map((personId) => ({
    personId,
    paidMinor: paidMinor.get(personId),
    owedMinor: owedMinor.get(personId),
    balanceMinor: paidMinor.get(personId) - owedMinor.get(personId),
  }));

  const transfers = computeTransfers(balances);

  return { balances, transfers };
}

/**
 * @param {Balance[]} balances
 * @returns {Transfer[]}
 */
function computeTransfers(balances) {
  const debtors = balances
    .filter((balance) => balance.balanceMinor < 0)
    .map((balance) => ({ personId: balance.personId, remainingMinor: -balance.balanceMinor }));
  const creditors = balances
    .filter((balance) => balance.balanceMinor > 0)
    .map((balance) => ({ personId: balance.personId, remainingMinor: balance.balanceMinor }));

  const transfers = [];

  while (debtors.length > 0 && creditors.length > 0) {
    sortByAmountDescThenId(debtors);
    sortByAmountDescThenId(creditors);

    const debtor = debtors[0];
    const creditor = creditors[0];
    const amountMinor = Math.min(debtor.remainingMinor, creditor.remainingMinor);

    transfers.push({ fromId: debtor.personId, toId: creditor.personId, amountMinor });

    debtor.remainingMinor -= amountMinor;
    creditor.remainingMinor -= amountMinor;

    if (debtor.remainingMinor === 0) {
      debtors.shift();
    }
    if (creditor.remainingMinor === 0) {
      creditors.shift();
    }
  }

  return transfers;
}

/**
 * @param {{ personId: string, remainingMinor: number }[]} entries
 */
function sortByAmountDescThenId(entries) {
  entries.sort((a, b) => {
    if (a.remainingMinor !== b.remainingMinor) {
      return b.remainingMinor - a.remainingMinor;
    }
    return a.personId < b.personId ? -1 : 1;
  });
}

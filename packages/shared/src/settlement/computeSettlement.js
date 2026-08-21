import { splitEqually } from '../currency/split.js';
import { computeSettlementInputSchema } from '../schemas/settlement.js';

/**
 * @typedef {{ baseAmountMinor: number, sharedWithIds: string[] }} SettlementPart
 * @typedef {{ payerId: string, baseAmountMinor: number, sharedWithIds: string[], items?: SettlementPart[] }} SettlementExpense
 * @typedef {{ fromId: string, toId: string, baseAmountMinor: number, date?: Date, createdAt?: Date }} SettlementPayment
 * @typedef {{ personId: string, paidMinor: number, owedMinor: number, settledMinor: number, balanceMinor: number }} Balance
 * @typedef {{ fromId: string, toId: string, amountMinor: number, creditedMinor: number, remainingMinor: number }} Transfer
 * @typedef {{ creditedMinor: number, roundingMinor: number }} PaymentCredit
 */

/**
 * Kiszámolja az esemény résztvevőinek egyenlegét, a fizetési jegyzéket és a
 * kiegyenlítések beszámítását.
 *
 * A jegyzék (`transfers`) **kizárólag a kiadásokból** számol: a mohó
 * párosítás bemenete a `paidMinor − owedMinor` egyenleg, a kiegyenlítések
 * NÉLKÜL. Ez szándékos, és ez a kiegyenlítés-funkció lényege: egy fizetés
 * csak a saját sorát rendezi, a többi páros összege nem mozdul tőle. Ha a
 * jegyzék a kiegyenlítésekkel korrigált egyenlegből számolna, egy 7 800
 * helyett átadott 8 000 Ft (vagy bármely részfizetés) átrendezné a többi sort
 * is — pontosan azt, amit a felhasználó nem akar látni.
 *
 * A balance-ok összege pontosan 0, és ha a jegyzék minden sora rendezett,
 * minden egyenleg 0.
 *
 * Tételes számlánál a felosztás tételenként történik: minden tétel a saját
 * osztozói között oszlik egyenlően. A fizető „kifizette" oldala változatlanul
 * a kiadás `baseAmountMinor`-ja — a bemeneti séma követeli meg, hogy ez a
 * tételek alapösszegeinek összege legyen.
 *
 * @param {{ participantIds: string[], expenses: SettlementExpense[], payments?: SettlementPayment[] }} input
 * @returns {{ balances: Balance[], transfers: Transfer[], paymentCredits: PaymentCredit[], unmatchedCreditMinor: number }}
 */
export function computeSettlement(input) {
  const { participantIds, expenses, payments } = computeSettlementInputSchema.parse(input);

  const paidMinor = new Map(participantIds.map((id) => [id, 0]));
  const owedMinor = new Map(participantIds.map((id) => [id, 0]));

  for (const expense of expenses) {
    paidMinor.set(expense.payerId, paidMinor.get(expense.payerId) + expense.baseAmountMinor);

    // A tétel nélküli kiadás EGY implicit tétel — így nincs két kódág, és a
    // mai (egyenlő felosztású) viselkedés szó szerint ugyanez a számítás.
    const parts = expense.items ?? [
      { baseAmountMinor: expense.baseAmountMinor, sharedWithIds: expense.sharedWithIds },
    ];

    for (const part of parts) {
      const shares = splitEqually({
        amountMinor: part.baseAmountMinor,
        participantIds: part.sharedWithIds,
      });
      for (const share of shares) {
        owedMinor.set(share.personId, owedMinor.get(share.personId) + share.shareMinor);
      }
    }
  }

  const expenseBalanceMinor = new Map(
    participantIds.map((id) => [id, paidMinor.get(id) - owedMinor.get(id)]),
  );

  const plan = computePlan(participantIds, expenseBalanceMinor);
  const { transfers, paymentCredits, unmatchedCreditMinor } = applyPayments(plan, payments);

  // Az egyenlegbe a BESZÁMÍTOTT összeg kerül, nem a teljes átadott: a
  // túlfizetés kerekítés, ami dokumentált (a szelvényen), de az elszámoláshoz
  // nem tartozik. Enélkül egy 7 800 helyett átadott 8 000 Ft után a jegyzék
  // minden sora rendezett lenne, mégis maradna ±200 Ft egyenleg — a
  // felhasználó pedig egy kifizetett jegyzék mellett látna tartozást.
  //
  // A kiegyenlítés a fizetőnek jóváír, a kedvezményezettnek terhel; a
  // „kifizette" oldalhoz nem ér hozzá, mert a pénz nem a csoportra ment el,
  // csak két résztvevő között mozdult.
  const settledMinor = new Map(participantIds.map((id) => [id, 0]));
  payments.forEach((payment, index) => {
    const creditedMinor = paymentCredits[index].creditedMinor;
    settledMinor.set(payment.fromId, settledMinor.get(payment.fromId) + creditedMinor);
    settledMinor.set(payment.toId, settledMinor.get(payment.toId) - creditedMinor);
  });

  const balances = participantIds.map((personId) => ({
    personId,
    paidMinor: paidMinor.get(personId),
    owedMinor: owedMinor.get(personId),
    settledMinor: settledMinor.get(personId),
    balanceMinor: expenseBalanceMinor.get(personId) + settledMinor.get(personId),
  }));

  return { balances, transfers, paymentCredits, unmatchedCreditMinor };
}

/**
 * A fizetési jegyzék: mohó párosítás a KIADÁS-egyenlegekre (kifizette − rá
 * eső rész), a kiegyenlítések figyelmen kívül hagyásával. Minden lépésben a
 * legnagyobb adóst párosítja a legnagyobb hitelezővel; azonos egyenlegek
 * esetén a személy-azonosító szerinti rendezés biztosítja a determinisztikus
 * kimenetet. Nulla egyenlegű résztvevő nem szerepel benne.
 *
 * @param {string[]} participantIds
 * @param {Map<string, number>} expenseBalanceMinor kifizette − rá eső rész
 * @returns {{ fromId: string, toId: string, amountMinor: number }[]}
 */
function computePlan(participantIds, expenseBalanceMinor) {
  const debtors = participantIds
    .filter((personId) => expenseBalanceMinor.get(personId) < 0)
    .map((personId) => ({ personId, remainingMinor: -expenseBalanceMinor.get(personId) }));
  const creditors = participantIds
    .filter((personId) => expenseBalanceMinor.get(personId) > 0)
    .map((personId) => ({ personId, remainingMinor: expenseBalanceMinor.get(personId) }));

  const rows = [];

  while (debtors.length > 0 && creditors.length > 0) {
    sortByAmountDescThenId(debtors);
    sortByAmountDescThenId(creditors);

    const debtor = debtors[0];
    const creditor = creditors[0];
    const amountMinor = Math.min(debtor.remainingMinor, creditor.remainingMinor);

    rows.push({ fromId: debtor.personId, toId: creditor.personId, amountMinor });

    debtor.remainingMinor -= amountMinor;
    creditor.remainingMinor -= amountMinor;

    if (debtor.remainingMinor === 0) {
      debtors.shift();
    }
    if (creditor.remainingMinor === 0) {
      creditors.shift();
    }
  }

  return rows;
}

/**
 * Beszámítja a kiegyenlítéseket a jegyzék soraiba. Egy szelvény csak a SAJÁT
 * párosának sorába számíthat be, legfeljebb a sor összegéig — a fölötte lévő
 * rész kerekítés (túlfizetés), ami az egyenlegekben már bent van, de a
 * jegyzékben nincs hova mennie.
 *
 * A szelvények a dátumuk (majd `createdAt`-jük) szerint növekvő sorrendben
 * számítanak be: a régebbi tölti fel előbb a sort. Ez azért kell, mert a
 * szerver és a kliens ugyanezt a függvényt futtatja, más-más rendezésben
 * tartott listával — a beszámítás eredménye nem függhet ettől.
 *
 * A `paymentCredits` a BEMENETI sorrendet követi, hogy a hívó a saját
 * listájával párba tudja állítani.
 *
 * @param {{ fromId: string, toId: string, amountMinor: number }[]} plan
 * @param {SettlementPayment[]} payments
 */
function applyPayments(plan, payments) {
  const rows = plan.map((row) => ({ ...row, creditedMinor: 0 }));
  const rowByPair = new Map(rows.map((row) => [pairKey(row.fromId, row.toId), row]));

  const credits = payments.map(() => ({ creditedMinor: 0, roundingMinor: 0 }));
  let unmatchedCreditMinor = 0;

  const chronological = payments
    .map((payment, index) => ({ payment, index }))
    .sort((a, b) => comparePayments(a, b));

  for (const { payment, index } of chronological) {
    const row = rowByPair.get(pairKey(payment.fromId, payment.toId));
    const capacityMinor = row ? row.amountMinor - row.creditedMinor : 0;
    const creditedMinor = Math.min(payment.baseAmountMinor, capacityMinor);
    if (row) {
      row.creditedMinor += creditedMinor;
    }
    const roundingMinor = payment.baseAmountMinor - creditedMinor;
    credits[index] = { creditedMinor, roundingMinor };
    unmatchedCreditMinor += roundingMinor;
  }

  return {
    transfers: rows.map((row) => ({
      ...row,
      remainingMinor: row.amountMinor - row.creditedMinor,
    })),
    paymentCredits: credits,
    unmatchedCreditMinor,
  };
}

/**
 * @param {string} fromId
 * @param {string} toId
 */
function pairKey(fromId, toId) {
  return `${fromId}>${toId}`;
}

/**
 * Dátum, majd rögzítési idő szerint növekvő; ha egyik sincs megadva, a
 * bemeneti sorrend dönt (stabil marad).
 */
function comparePayments(a, b) {
  const byDate = time(a.payment.date) - time(b.payment.date);
  if (byDate !== 0) {
    return byDate;
  }
  const byCreatedAt = time(a.payment.createdAt) - time(b.payment.createdAt);
  if (byCreatedAt !== 0) {
    return byCreatedAt;
  }
  return a.index - b.index;
}

/**
 * @param {Date | undefined} value
 * @returns {number}
 */
function time(value) {
  return value ? value.getTime() : 0;
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

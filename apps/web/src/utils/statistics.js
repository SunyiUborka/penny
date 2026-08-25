import { splitEqually } from '@filler/shared';
import { computeEventSettlement } from './settlement.js';

const UNCATEGORISED = { id: null, name: 'Nincs kategória', color: null };

/**
 * @param {string | Date} value
 * @returns {string} ÉÉÉÉ-HH-NN
 */
function dateKey(value) {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * @param {object} expense
 * @returns {Array<{ categoryId: string | null, baseAmountMinor: number }>}
 */
function categoryShares(expense) {
  const ids = expense.categoryIds ?? [];
  if (ids.length === 0) {
    return [{ categoryId: null, baseAmountMinor: expense.baseAmountMinor }];
  }
  if (ids.length === 1) {
    return [{ categoryId: ids[0], baseAmountMinor: expense.baseAmountMinor }];
  }
  return splitEqually({ amountMinor: expense.baseAmountMinor, participantIds: ids }).map(
    (share) => ({ categoryId: share.personId, baseAmountMinor: share.shareMinor }),
  );
}

/**
 * @param {Array<{ date: string, baseAmountMinor: number }>} sums
 * @returns {Array<{ date: string, baseAmountMinor: number }>} hézagmentes napsor
 */
function fillDayGaps(sums) {
  if (sums.length === 0) {
    return [];
  }
  const byDate = new Map(sums.map((row) => [row.date, row.baseAmountMinor]));
  const keys = [...byDate.keys()].sort();
  const days = [];
  const cursor = new Date(`${keys[0]}T00:00:00`);
  const last = new Date(`${keys[keys.length - 1]}T00:00:00`);
  while (cursor <= last) {
    const key = dateKey(cursor);
    days.push({ date: key, baseAmountMinor: byDate.get(key) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/**
 * @param {{ event: object, expenses: object[], categories: object[], payments: object[] }} input
 */
export function computeEventStatistics(input) {
  const { event, expenses, categories, payments } = input;

  const totalBaseMinor = expenses.reduce((sum, expense) => sum + expense.baseAmountMinor, 0);

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const buckets = new Map();
  expenses.forEach((expense) => {
    categoryShares(expense).forEach((share) => {
      const key = share.categoryId ?? '';
      const bucket = buckets.get(key) ?? { baseAmountMinor: 0, expenseCount: 0 };
      bucket.baseAmountMinor += share.baseAmountMinor;
      bucket.expenseCount += 1;
      buckets.set(key, bucket);
    });
  });

  const categoryRows = [...buckets.entries()]
    .map(([key, bucket]) => {
      const category = key === '' ? UNCATEGORISED : (categoryById.get(key) ?? UNCATEGORISED);
      return {
        id: category.id,
        name: category.name,
        color: category.color,
        baseAmountMinor: bucket.baseAmountMinor,
        expenseCount: bucket.expenseCount,
        share: totalBaseMinor === 0 ? 0 : bucket.baseAmountMinor / totalBaseMinor,
      };
    })
    .sort((a, b) => b.baseAmountMinor - a.baseAmountMinor);

  const daySums = new Map();
  expenses.forEach((expense) => {
    const key = dateKey(expense.date);
    daySums.set(key, (daySums.get(key) ?? 0) + expense.baseAmountMinor);
  });
  const days = fillDayGaps(
    [...daySums.entries()].map(([date, baseAmountMinor]) => ({ date, baseAmountMinor })),
  );

  const currencySums = new Map();
  expenses.forEach((expense) => {
    const row = currencySums.get(expense.currency) ?? {
      currency: expense.currency,
      amountMinor: 0,
      baseAmountMinor: 0,
      expenseCount: 0,
    };
    row.amountMinor += expense.amountMinor;
    row.baseAmountMinor += expense.baseAmountMinor;
    row.expenseCount += 1;
    currencySums.set(expense.currency, row);
  });
  const currencies = [...currencySums.values()].sort(
    (a, b) => b.baseAmountMinor - a.baseAmountMinor,
  );

  const settlement = computeEventSettlement({ event, expenses, payments });
  const people = (settlement?.balances ?? []).map((balance) => ({
    personId: balance.personId,
    paidMinor: balance.paidMinor,
    owedMinor: balance.owedMinor,
  }));

  const largest = expenses.reduce(
    (best, expense) =>
      best === null || expense.baseAmountMinor > best.baseAmountMinor ? expense : best,
    null,
  );

  return {
    totalBaseMinor,
    expenseCount: expenses.length,
    averageBaseMinor: expenses.length === 0 ? 0 : Math.round(totalBaseMinor / expenses.length),
    largest:
      largest === null
        ? null
        : { description: largest.description, baseAmountMinor: largest.baseAmountMinor },
    dayCount: days.length,
    dailyAverageBaseMinor: days.length === 0 ? 0 : Math.round(totalBaseMinor / days.length),
    categories: categoryRows,
    people,
    days,
    currencies,
    hasPending: expenses.some((expense) => expense.pending === true),
  };
}

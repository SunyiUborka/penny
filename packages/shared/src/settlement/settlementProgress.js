/**
 * @typedef {'nothing' | 'open' | 'settled' | 'unknown'} SettlementStatus
 * @typedef {{ status: SettlementStatus, openBaseAmountMinor: number }} SettlementProgress
 */

/** @type {Record<string, SettlementStatus>} */
export const SETTLEMENT_STATUS = {
  NOTHING: 'nothing',
  OPEN: 'open',
  SETTLED: 'settled',
  UNKNOWN: 'unknown',
};

/** @type {SettlementProgress} */
export const UNKNOWN_SETTLEMENT_PROGRESS = {
  status: SETTLEMENT_STATUS.UNKNOWN,
  openBaseAmountMinor: 0,
};

/**
 * @param {{ remainingMinor: number }[]} transfers a `computeSettlement` jegyzéke
 * @returns {SettlementProgress}
 */
export function settlementProgressOf(transfers) {
  if (transfers.length === 0) {
    return { status: SETTLEMENT_STATUS.NOTHING, openBaseAmountMinor: 0 };
  }
  const openBaseAmountMinor = transfers.reduce((sum, transfer) => sum + transfer.remainingMinor, 0);
  return {
    status: openBaseAmountMinor > 0 ? SETTLEMENT_STATUS.OPEN : SETTLEMENT_STATUS.SETTLED,
    openBaseAmountMinor,
  };
}

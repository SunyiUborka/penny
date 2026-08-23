import { formatMoney, SETTLEMENT_CURRENCY, SETTLEMENT_STATUS } from '@filler/shared';

/**
 * @typedef {{ key: 'active' | 'due' | 'settled' | 'archived', label: string, title: string }} EventStatusBadge
 */

/**
 * @param {{ archived: boolean, settlement?: { status: string, openBaseAmountMinor: number } | null }} event
 * @returns {EventStatusBadge}
 */
export function eventStatusBadge(event) {
  if (!event.archived) {
    return {
      key: 'active',
      label: 'Aktív',
      title: 'Aktív esemény: kiadás felvehető, szerkeszthető és törölhető.',
    };
  }

  const status = event.settlement?.status;

  if (status === SETTLEMENT_STATUS.OPEN) {
    const open = formatMoney({
      amountMinor: event.settlement.openBaseAmountMinor,
      currency: SETTLEMENT_CURRENCY,
    });
    return {
      key: 'due',
      label: 'Rendezésre vár',
      title: `Letudott esemény, de még ${open} rendezésre vár.`,
    };
  }

  if (status === SETTLEMENT_STATUS.SETTLED || status === SETTLEMENT_STATUS.NOTHING) {
    return {
      key: 'settled',
      label: 'Kiegyenlítve',
      title: 'Letudott esemény, nincs rendezésre váró tartozás.',
    };
  }

  return {
    key: 'archived',
    label: 'Archivált',
    title: 'Letudott esemény; az elszámolás állapota nem ismert.',
  };
}

/**
 * @param {EventStatusBadge} badge
 * @returns {string}
 */
export function eventStatusStampClass(badge) {
  if (badge.key === 'due') {
    return 'stamp--due';
  }
  if (badge.key === 'settled') {
    return 'stamp--settle';
  }
  return 'stamp--muted';
}

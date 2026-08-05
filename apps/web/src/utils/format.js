const dateFormatter = new Intl.DateTimeFormat('hu-HU', { dateStyle: 'medium' });

/**
 * @param {string | Date | null | undefined} value
 * @returns {string}
 */
export function formatDate(value) {
  if (!value) {
    return '—';
  }
  return dateFormatter.format(new Date(value));
}

/**
 * Egy Date/ISO stringet a `<input type="date">` által elvárt ÉÉÉÉ-HH-NN
 * formátumra alakít.
 * @param {string | Date | null | undefined} value
 * @returns {string}
 */
export function toDateInputValue(value) {
  if (!value) {
    return '';
  }
  return new Date(value).toISOString().slice(0, 10);
}

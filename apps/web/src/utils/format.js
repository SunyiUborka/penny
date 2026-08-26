const dateFormatter = new Intl.DateTimeFormat('hu-HU', { dateStyle: 'medium' });
const dateWithoutYearFormatter = new Intl.DateTimeFormat('hu-HU', {
  month: '2-digit',
  day: '2-digit',
});

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
 * @param {string | Date | null | undefined} value
 * @returns {string}
 */
export function formatDateWithoutYear(value) {
  if (!value) {
    return '—';
  }
  return dateWithoutYearFormatter.format(new Date(value));
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

/**
 * @returns {string} a mai nap ÉÉÉÉ-HH-NN alakban, helyi idő szerint
 */
export function todayLocalDateString() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * @param {string} rate
 * @returns {string}
 */
export function roundRate(rate) {
  return String(Math.round(Number(rate) * 100) / 100);
}

const STORAGE_KEY = 'filler-theme';

/**
 * Az induláskor tárolt preferenciát azonnal alkalmazza, mielőtt az app
 * felrenderelődik, hogy ne legyen "villanás" a rossz témával.
 */
export function initTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') {
    document.documentElement.dataset.theme = stored;
  }
}

/**
 * @returns {'light' | 'dark'}
 */
export function getTheme() {
  if (document.documentElement.dataset.theme === 'dark') {
    return 'dark';
  }
  if (document.documentElement.dataset.theme === 'light') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * @returns {'light' | 'dark'} az új, aktív téma
 */
export function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem(STORAGE_KEY, next);
  return next;
}

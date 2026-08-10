const STORAGE_KEY = 'filler-theme';

/**
 * A status bar színe telepített appban (standalone mód): a --paper-raised két
 * értéke. A <meta name="theme-color"> tartalmát ehhez igazítjuk, hogy a status
 * bar és az App.vue fejléce egy színű legyen.
 */
const THEME_COLORS = { light: '#f7f7f2', dark: '#222f28' };

/**
 * Az induláskor tárolt preferenciát azonnal alkalmazza, mielőtt az app
 * felrenderelődik, hogy ne legyen "villanás" a rossz témával.
 */
export function initTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') {
    document.documentElement.dataset.theme = stored;
  }
  applyThemeColor();
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
 * A <meta name="theme-color"> tartalmát az aktív témához igazítja. A meta a
 * betöltéskor a világos értéket tartalmazza (lásd index.html); ez a függvény
 * onnantól tartja szinkronban.
 */
function applyThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', THEME_COLORS[getTheme()]);
  }
}

/**
 * @returns {'light' | 'dark'} az új, aktív téma
 */
export function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem(STORAGE_KEY, next);
  applyThemeColor();
  return next;
}

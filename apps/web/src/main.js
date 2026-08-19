import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router/index.js';
import { initTheme } from './utils/theme.js';
import { initNativeRuntime } from './native/runtime.js';
import { isNativeApp } from './utils/platform.js';
import './assets/theme.css';

/**
 * A mount előtt meg kell várni a natív runtime-ot: a router guard rögtön
 * hitelesítést kérdez a szervertől, ehhez pedig már a helyes bázis-URL kell.
 */
async function bootstrap() {
  initTheme();
  await initNativeRuntime();

  const app = createApp(App);
  app.use(createPinia());
  app.use(router);
  app.mount('#app');
}

bootstrap().catch((error) => {
  console.error('Az app indítása nem sikerült:', error);
});

// Service worker csak a böngészős produkciós buildben: fejlesztői módban a
// Vite HMR-jével akadna össze, a natív appban pedig felesleges — ott a
// WebView helyi fájlokról tölt.
if (import.meta.env.PROD && !isNativeApp() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('A service worker regisztrációja nem sikerült:', error);
    });
  });
}

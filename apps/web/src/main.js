import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router/index.js';
import { initTheme } from './utils/theme.js';
import { isNativeApp } from './utils/platform.js';
import { initNativeRuntime } from './native/runtime.js';
import './assets/theme.css';

initTheme();

/**
 * Aszinkron indítás: a natív token betöltésének be kell fejeződnie, mielőtt
 * a router első navigációja lefut és meghívja a `checkAuth`-ot — különben az
 * első kérés token nélkül menne ki, és a felhasználót visszadobná a
 * bejelentkezésre a meglévő tokene ellenére.
 *
 * Ha az `initNativeRuntime` elbukik (pl. a Preferences olvasása hibázik), az
 * app akkor is mountoljon: token nélkül, bejelentkezést kérve — üres, fehér
 * képernyő nem megengedett kimenet.
 * @returns {Promise<void>}
 */
async function bootstrap() {
  try {
    await initNativeRuntime();
  } catch (error) {
    console.error('A natív indulási teendők nem sikerültek:', error);
  }

  const app = createApp(App);

  app.use(createPinia());
  app.use(router);
  app.mount('#app');

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
}

bootstrap().catch((error) => {
  console.error('Az alkalmazás indítása sikertelen:', error);
});

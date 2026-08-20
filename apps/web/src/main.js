import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router/index.js';
import { initTheme } from './utils/theme.js';
import { isNativeApp } from './utils/platform.js';
import { initNativeRuntime } from './native/runtime.js';
import { startAutoSync } from './offline/sync.js';
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

  // A szinkron-motort csak a Pinia beillesztése (és a mountolás) UTÁN
  // indítjuk: az outbox számlálóit egy Pinia store tartja, egy korábbi
  // hívás "nincs aktív Pinia" hibával bukna. A szinkron a böngészőben is
  // fut, nem csak natívban — ott is aktív a sorbanállítás (lásd
  // `offline/outbox.js`), ott is fel kell tölteni, amint van kapcsolat.
  //
  // Szándékosan nem várjuk meg (`await` nélkül): az induló szinkron
  // hálózati kéréseket indíthat, ez pedig nem torlaszolhatja el az utána
  // következő teendőket — legfőképp a lenti service worker regisztrációt,
  // ami a `load` eseményre vár. Ha az induló szinkron addig tartana, amíg a
  // `load` már lefutott, a feliratkozás lemaradna, és a service worker
  // csendben nem települne/frissülne abban a munkamenetben. A hibát csak
  // naplózzuk: sem az app mountolását, sem az utána következő teendőket nem
  // akaszthatja meg — a sorbanállított elemek a következő hálózat- vagy
  // előtérbe-kerülés-eseményig egyszerűen várnak.
  startAutoSync().catch((error) => {
    console.error('A szinkron-motor indítása nem sikerült:', error);
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
}

bootstrap().catch((error) => {
  console.error('Az alkalmazás indítása sikertelen:', error);
});

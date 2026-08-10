import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router/index.js';
import { initTheme } from './utils/theme.js';
import './assets/theme.css';

initTheme();

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.mount('#app');

// Service worker csak produkciós buildben: fejlesztői módban összeakadna a
// Vite HMR-jével. A regisztráció a load esemény után fut, hogy ne versenyezzen
// az app első renderelésével.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('A service worker regisztrációja nem sikerült:', error);
    });
  });
}

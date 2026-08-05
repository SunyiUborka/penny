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

import { createRouter, createWebHistory } from 'vue-router';
import EventsListView from '../views/EventsListView.vue';
import EventDetailView from '../views/EventDetailView.vue';
import SettingsView from '../views/SettingsView.vue';
import SyncView from '../views/SyncView.vue';
import LoginView from '../views/LoginView.vue';
import { useAuthStore } from '../stores/auth.js';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView, meta: { requiresAuth: false } },
    { path: '/', name: 'events', component: EventsListView, meta: { requiresAuth: true } },
    {
      path: '/events/:id/:tab(kiadasok|elszamolas)?',
      name: 'event-detail',
      component: EventDetailView,
      meta: { requiresAuth: true },
    },
    { path: '/settings', name: 'settings', component: SettingsView, meta: { requiresAuth: true } },
    { path: '/sync', name: 'sync', component: SyncView, meta: { requiresAuth: true } },
  ],
});

router.beforeEach(async (to) => {
  const authStore = useAuthStore();

  if (!authStore.checked) {
    try {
      await authStore.checkAuth();
    } catch {
      // Ide már csak a szerver VÁLASZA (pl. 5xx) vagy egy megtört
      // kontraktus juthat: az átvitel-szintű hibát (offline eset) maga a
      // `checkAuth` kezeli, és ha ezen az eszközön már volt sikeres
      // hitelesítés, hitelesítettnek is jelöli magát — enélkül minden
      // offline hidegindulás ide, majd a bejelentkezésre esett, ahonnan
      // offline nincs kiút (lásd a végső review C2 pontját). Amit itt
      // elkapunk, azt a guard alább nem hitelesítettként kezeli.
    }
  }

  if (to.name === 'login') {
    return authStore.authenticated ? { path: '/' } : true;
  }

  if (to.meta.requiresAuth !== false && !authStore.authenticated) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }

  return true;
});

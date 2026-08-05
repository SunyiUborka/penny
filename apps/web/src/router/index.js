import { createRouter, createWebHistory } from 'vue-router';
import EventsListView from '../views/EventsListView.vue';
import EventDetailView from '../views/EventDetailView.vue';
import SettingsView from '../views/SettingsView.vue';
import LoginView from '../views/LoginView.vue';
import { useAuthStore } from '../stores/auth.js';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView, meta: { requiresAuth: false } },
    { path: '/', name: 'events', component: EventsListView, meta: { requiresAuth: true } },
    {
      path: '/events/:id',
      name: 'event-detail',
      component: EventDetailView,
      meta: { requiresAuth: true },
    },
    { path: '/settings', name: 'settings', component: SettingsView, meta: { requiresAuth: true } },
  ],
});

router.beforeEach(async (to) => {
  const authStore = useAuthStore();

  if (!authStore.checked) {
    try {
      await authStore.checkAuth();
    } catch {
      // A checkAuth hívás sikertelensége (pl. hálózati hiba) nem
      // hitelesítettként kezelendő, a guard alább erre reagál.
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

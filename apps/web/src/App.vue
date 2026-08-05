<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth.js';
import { getTheme, toggleTheme } from './utils/theme.js';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const showNav = computed(() => route.name !== 'login');
const theme = ref(getTheme());
const mobileMenuOpen = ref(false);

watch(
  () => route.fullPath,
  () => {
    mobileMenuOpen.value = false;
  },
);

function handleToggleTheme() {
  theme.value = toggleTheme();
}

async function handleLogout() {
  await authStore.logout();
  router.push({ name: 'login' });
}
</script>

<template>
  <header v-if="showNav" class="app-nav">
    <router-link to="/" class="app-nav__mark">Fillér</router-link>
    <button
      type="button"
      class="app-nav__menu-toggle"
      aria-label="Menü megnyitása"
      :aria-expanded="mobileMenuOpen"
      @click="mobileMenuOpen = !mobileMenuOpen"
    >
      {{ mobileMenuOpen ? '✕' : '☰' }}
    </button>
    <nav class="app-nav__tabs" :class="{ 'is-open': mobileMenuOpen }">
      <router-link to="/" class="app-nav__tab">Események</router-link>
      <router-link to="/settings" class="app-nav__tab">Beállítások</router-link>
    </nav>
    <button
      type="button"
      class="app-nav__theme-toggle"
      :aria-label="theme === 'dark' ? 'Váltás világos módra' : 'Váltás sötét módra'"
      @click="handleToggleTheme"
    >
      {{ theme === 'dark' ? '☀' : '☾' }}
    </button>
    <button type="button" class="app-nav__logout" @click="handleLogout">Kilépés</button>
  </header>
  <router-view />
</template>

<style scoped>
.app-nav {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-4) var(--space-6);
  border-bottom: 2px solid var(--ink);
  background: var(--paper-raised);
}

.app-nav__mark {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 1.35rem;
  letter-spacing: 0.01em;
  color: var(--ink);
  text-decoration: none;
}

.app-nav__tabs {
  display: flex;
  gap: var(--space-6);
  flex: 1;
}

.app-nav__menu-toggle {
  display: none;
  font-size: 1.05rem;
  line-height: 1;
  background: none;
  border: 1.5px solid var(--rule-strong);
  color: var(--ink-soft);
  padding: 0.3em 0.6em;
  border-radius: 2px;
  cursor: pointer;
}

.app-nav__menu-toggle:hover {
  border-color: var(--brass);
  color: var(--brass);
}

.app-nav__tab {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-soft);
  text-decoration: none;
  padding-bottom: 0.35rem;
  border-bottom: 2px solid transparent;
}

.app-nav__tab:hover {
  color: var(--ink);
}

.app-nav__tab.router-link-exact-active {
  color: var(--forint);
  border-bottom-color: var(--forint);
}

.app-nav__theme-toggle {
  font-size: 1.05rem;
  line-height: 1;
  background: none;
  border: 1.5px solid var(--rule-strong);
  color: var(--ink-soft);
  padding: 0.3em 0.6em;
  border-radius: 2px;
  cursor: pointer;
}

.app-nav__theme-toggle:hover {
  border-color: var(--brass);
  color: var(--brass);
}

.app-nav__logout {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: none;
  border: 1.5px solid var(--rule-strong);
  color: var(--ink-soft);
  padding: 0.4em 0.8em;
  border-radius: 2px;
  cursor: pointer;
}

.app-nav__logout:hover {
  border-color: var(--stamp);
  color: var(--stamp);
}

@media (max-width: 640px) {
  .app-nav {
    flex-wrap: wrap;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
  }

  .app-nav__mark {
    order: 1;
    flex: 1;
  }

  .app-nav__menu-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    order: 2;
  }

  .app-nav__theme-toggle {
    order: 3;
  }

  .app-nav__logout {
    order: 4;
  }

  .app-nav__tabs {
    display: none;
    order: 5;
    flex: 0 0 100%;
    flex-direction: column;
    gap: var(--space-1);
  }

  .app-nav__tabs.is-open {
    display: flex;
  }

  .app-nav__tab {
    padding: 0.5em 0;
    border-bottom: 1px solid var(--rule);
  }
}
</style>

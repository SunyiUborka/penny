<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';
import { useOfflineStore } from '../stores/offline.js';
import {
  DEFAULT_API_BASE,
  getApiBase,
  getApiBaseOverride,
  normalizeApiBase,
} from '../api/baseUrl.js';
import { pingServer } from '../api/ping.js';
import { clearApiBase, saveApiBase } from '../native/apiBase.js';
import { clearOfflineData } from '../offline/db.js';
import { refreshCounts } from '../offline/outbox.js';
import { isNativeApp } from '../utils/platform.js';

const password = ref('');
const authStore = useAuthStore();
const offlineStore = useOfflineStore();
const route = useRoute();
const router = useRouter();

const canChooseServer = isNativeApp();
const serverOpen = ref(false);
const serverMode = ref(getApiBaseOverride() === null ? 'default' : 'custom');
const customBase = ref(getApiBaseOverride() ?? '');
const serverBusy = ref(false);
const serverError = ref('');
const pingResult = ref(null);
const activeBase = ref(getApiBase());

const targetBase = computed(() =>
  serverMode.value === 'default' ? DEFAULT_API_BASE : normalizeApiBase(customBase.value),
);

const pingLabel = computed(() => {
  if (pingResult.value === null) {
    return '';
  }
  if (pingResult.value.ok) {
    return 'A szerver elérhető.';
  }
  if (pingResult.value.reason === 'timeout') {
    return 'A szerver nem válaszolt 5 másodpercen belül.';
  }
  if (pingResult.value.reason === 'status') {
    return `A cím válaszol, de hibával: HTTP ${pingResult.value.statusCode}.`;
  }
  if (pingResult.value.reason === 'not-filler') {
    return 'A cím válaszol, de nem Fillér-szerver.';
  }
  return 'A szerver nem érhető el ezen a címen.';
});

function validateTarget() {
  if (serverMode.value === 'default') {
    return '';
  }
  if (!targetBase.value) {
    return 'Add meg a szerver címét.';
  }
  if (!/^https:\/\//.test(targetBase.value)) {
    return 'Csak https:// cím adható meg: az Android nem engedi a titkosítatlan forgalmat.';
  }
  return '';
}

async function checkServer() {
  serverError.value = validateTarget();
  if (serverError.value) {
    return;
  }
  serverBusy.value = true;
  pingResult.value = null;
  try {
    pingResult.value = await pingServer(targetBase.value);
  } finally {
    serverBusy.value = false;
  }
}

async function applyServer() {
  serverError.value = validateTarget();
  if (serverError.value) {
    return;
  }
  if (targetBase.value !== activeBase.value) {
    const pending = offlineStore.pendingCount + offlineStore.failedCount;
    const warning =
      pending > 0
        ? `Szerverváltás: a helyi másolat és a munkamenet törlődik, és ezzel ${pending} még fel nem töltött tétel is elveszik. Folytatod?`
        : 'Szerverváltás: a helyi másolat és a munkamenet törlődik. Folytatod?';
    if (!window.confirm(warning)) {
      return;
    }
  }

  serverBusy.value = true;
  pingResult.value = null;
  try {
    if (serverMode.value === 'default') {
      await clearApiBase();
    } else {
      await saveApiBase(targetBase.value);
    }
    await authStore.resetLocalSession();
    await clearOfflineData();
    await refreshCounts();
    activeBase.value = getApiBase();
    pingResult.value = await pingServer(activeBase.value);
  } catch (error) {
    serverError.value = 'A szerver címét nem sikerült elmenteni.';
    console.error('A szerver címének mentése nem sikerült:', error);
  } finally {
    serverBusy.value = false;
  }
}

onMounted(() => {
  // A bejelentkezés semmilyen cache-elt olvasást nem mutat — kijelentkezés
  // után tehát nem maradhat itt az előző képernyő kulcsairól szóló offline
  // sáv (lásd `stores/offline.js` `setVisibleKeys`).
  offlineStore.setVisibleKeys([]);
});

async function handleSubmit() {
  const success = await authStore.login(password.value);
  if (success) {
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
    router.push(redirect);
  }
}
</script>

<template>
  <main class="login">
    <div class="login__card receipt">
      <span class="eyebrow">Közös kassza</span>
      <h1 class="login__mark">Fillér</h1>
      <p class="login__tagline">Lépj be a közös elszámoláshoz.</p>
      <hr class="login__rule" />
      <form @submit.prevent="handleSubmit">
        <div class="field">
          <label for="password">Jelszó</label>
          <input
            id="password"
            v-model="password"
            type="password"
            name="password"
            autocomplete="current-password"
            required
            :disabled="authStore.isLoggingIn"
          />
        </div>
        <p v-if="authStore.loginError" class="field-error" role="alert">
          {{ authStore.loginError }}
        </p>
        <button
          type="submit"
          class="btn btn--primary login__submit"
          :disabled="authStore.isLoggingIn"
        >
          {{ authStore.isLoggingIn ? 'Belépés…' : 'Belépés' }}
        </button>
      </form>

      <section v-if="canChooseServer" class="login__server">
        <button
          type="button"
          class="login__server-toggle"
          :aria-expanded="serverOpen"
          @click="serverOpen = !serverOpen"
        >
          Szerver: {{ serverMode === 'default' ? 'alapértelmezett' : 'egyéni' }}
          <span aria-hidden="true">{{ serverOpen ? '▴' : '▾' }}</span>
        </button>

        <div v-if="serverOpen" class="login__server-panel">
          <p class="login__server-current">{{ activeBase }}</p>

          <label class="login__server-option">
            <input v-model="serverMode" type="radio" value="default" :disabled="serverBusy" />
            <span>
              Alapértelmezett
              <small>{{ DEFAULT_API_BASE }}</small>
            </span>
          </label>

          <label class="login__server-option">
            <input v-model="serverMode" type="radio" value="custom" :disabled="serverBusy" />
            <span>Egyéni cím</span>
          </label>

          <div v-if="serverMode === 'custom'" class="field login__server-field">
            <label for="server-url">Szerver címe (https)</label>
            <input
              id="server-url"
              v-model="customBase"
              type="url"
              inputmode="url"
              autocapitalize="off"
              autocomplete="off"
              spellcheck="false"
              placeholder="https://sajat-domain.hu/api"
              :disabled="serverBusy"
            />
          </div>

          <div class="login__server-actions">
            <button
              type="button"
              class="btn btn--ghost btn--small"
              :disabled="serverBusy"
              @click="checkServer"
            >
              {{ serverBusy ? 'Ellenőrzés…' : 'Kapcsolat ellenőrzése' }}
            </button>
            <button
              type="button"
              class="btn btn--small"
              :disabled="serverBusy"
              @click="applyServer"
            >
              Mentés
            </button>
          </div>

          <p v-if="serverError" role="alert" class="field-error">{{ serverError }}</p>
          <p
            v-else-if="pingLabel"
            class="login__server-status"
            :class="{ 'is-ok': pingResult?.ok }"
            role="status"
          >
            {{ pingLabel }}
          </p>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.login__server {
  margin-top: var(--space-6);
  padding-top: var(--space-4);
  border-top: 1px solid var(--rule);
  text-align: left;
}

.login__server-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  width: 100%;
  background: none;
  border: none;
  padding: 0;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-soft);
  cursor: pointer;
}

.login__server-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.login__server-current {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--ink-soft);
  overflow-wrap: anywhere;
  margin: 0;
}

.login__server-option {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  font-size: 0.9rem;
}

.login__server-option input {
  accent-color: var(--forint);
  margin-top: 0.2em;
}

.login__server-option small {
  display: block;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--ink-soft);
  overflow-wrap: anywhere;
}

.login__server-field {
  margin-bottom: 0;
}

.login__server-actions {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.login__server-status {
  font-size: 0.82rem;
  color: var(--stamp);
  margin: 0;
}

.login__server-status.is-ok {
  color: var(--forint);
}

.login {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  padding: var(--space-4);
}

.login__card {
  width: min(360px, 100%);
  padding-top: var(--space-8);
  text-align: center;
  animation: print-in 0.32s ease-out;
}

@keyframes print-in {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.login__mark {
  font-size: 2.25rem;
  margin: 0.15em 0 0.35em;
}

.login__tagline {
  color: var(--ink-soft);
  margin: 0 0 var(--space-6);
  font-size: 0.95rem;
}

.login__rule {
  border: none;
  border-top: 2px dashed var(--rule);
  margin: 0 0 var(--space-6);
}

.login form {
  text-align: left;
}

.login__submit {
  width: 100%;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: var(--space-2);
}
</style>

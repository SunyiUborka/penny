<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

const password = ref('');
const authStore = useAuthStore();
const route = useRoute();
const router = useRouter();

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
    </div>
  </main>
</template>

<style scoped>
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

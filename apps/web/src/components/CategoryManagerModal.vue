<script setup>
import { ref } from 'vue';
import { CATEGORY_COLORS } from '@filler/shared';
import CategoryTag from './CategoryTag.vue';
import { useCategoriesStore } from '../stores/categories.js';
import { useExpensesStore } from '../stores/expenses.js';

const props = defineProps({
  eventId: { type: String, required: true },
  readOnly: { type: Boolean, required: false, default: false },
});

const emit = defineEmits(['close']);

const categoriesStore = useCategoriesStore();
const expensesStore = useExpensesStore();

const busyId = ref('');
const actionError = ref('');
const newName = ref('');
const creating = ref(false);

function usageCount(categoryId) {
  return expensesStore.expenses.filter((expense) => expense.categoryIds?.includes(categoryId))
    .length;
}

async function run(id, action) {
  busyId.value = id;
  actionError.value = '';
  try {
    await action();
  } catch (error) {
    actionError.value = error?.message ?? 'A művelet nem sikerült.';
  } finally {
    busyId.value = '';
  }
}

function rename(category, name) {
  const trimmed = name.trim();
  if (!trimmed || trimmed === category.name) {
    return;
  }
  run(category.id, () => categoriesStore.updateCategory(category.id, { name: trimmed }));
}

function recolor(category, color) {
  if (color === category.color) {
    return;
  }
  run(category.id, () => categoriesStore.updateCategory(category.id, { color }));
}

function remove(category) {
  const used = usageCount(category.id);
  const suffix =
    used === 0
      ? ''
      : ` A(z) „${category.name}” ${used} kiadáson szerepel — törlés után lekerül róluk.`;
  if (!window.confirm(`Biztosan törlöd a(z) „${category.name}” kategóriát?${suffix}`)) {
    return;
  }
  run(category.id, () => categoriesStore.deleteCategory(category.id));
}

async function create() {
  const name = newName.value.trim();
  if (!name || creating.value) {
    return;
  }
  creating.value = true;
  actionError.value = '';
  try {
    await categoriesStore.createCategory(props.eventId, {
      name,
      color: categoriesStore.nextColor,
    });
    newName.value = '';
  } catch (error) {
    actionError.value = error?.message ?? 'A kategória létrehozása nem sikerült.';
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <div class="modal-backdrop" role="presentation" @click.self="emit('close')">
    <div
      class="modal receipt category-manager"
      role="dialog"
      aria-modal="true"
      aria-labelledby="category-manager-title"
    >
      <button type="button" class="modal-close" aria-label="Bezárás" @click="emit('close')">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path
            d="M4 4l8 8M12 4l-8 8"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
        </svg>
      </button>
      <span class="eyebrow">Esemény</span>
      <h2 id="category-manager-title">Kategóriák</h2>
      <p v-if="readOnly" class="field-hint">Az esemény archivált: a kategóriái csak olvashatók.</p>

      <p v-if="actionError" role="alert" class="field-error">{{ actionError }}</p>

      <p v-if="categoriesStore.categories.length === 0" class="field-hint">
        Még nincs kategória. Vedd fel az elsőt alul.
      </p>

      <ul class="category-manager__list">
        <li v-for="category in categoriesStore.categories" :key="category.id">
          <CategoryTag :name="category.name" :color="category.color" />
          <input
            :value="category.name"
            type="text"
            class="input-line category-manager__name"
            maxlength="32"
            :aria-label="`${category.name} neve`"
            :disabled="readOnly || busyId === category.id"
            @change="rename(category, $event.target.value)"
          />
          <span class="category-manager__colors">
            <button
              v-for="color in CATEGORY_COLORS"
              :key="color"
              type="button"
              class="category-manager__swatch"
              :class="{ 'is-active': color === category.color }"
              :style="{ '--cat-color': `var(--cat-${color})` }"
              :aria-label="`${category.name} színe: ${color}`"
              :aria-pressed="color === category.color"
              :disabled="readOnly || busyId === category.id"
              @click="recolor(category, color)"
            />
          </span>
          <button
            type="button"
            class="btn btn--danger btn--small"
            :disabled="readOnly || busyId === category.id"
            @click="remove(category)"
          >
            Törlés
          </button>
        </li>
      </ul>

      <form v-if="!readOnly" class="category-manager__create" @submit.prevent="create">
        <input
          v-model="newName"
          type="text"
          class="input-line"
          placeholder="Új kategória neve"
          maxlength="32"
          aria-label="Új kategória neve"
          :disabled="creating"
        />
        <button type="submit" class="btn btn--primary btn--small" :disabled="creating">
          {{ creating ? 'Felvétel…' : '+ Felvétel' }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.category-manager__list {
  list-style: none;
  margin: 0 0 var(--space-4);
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.category-manager__list li {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.category-manager__name {
  flex: 1;
  min-width: 8rem;
}

.category-manager__colors {
  display: flex;
  gap: var(--space-1);
}

.category-manager__swatch {
  width: 1.1rem;
  height: 1.1rem;
  padding: 0;
  border: 1px solid var(--rule);
  border-radius: 2px;
  background: var(--cat-color);
  cursor: pointer;
}

.category-manager__swatch.is-active {
  outline: 2px solid var(--ink);
  outline-offset: 1px;
}

.category-manager__create {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
</style>

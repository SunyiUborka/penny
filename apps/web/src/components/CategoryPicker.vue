<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import CategoryTag from './CategoryTag.vue';
import { useCategoriesStore } from '../stores/categories.js';
import { useOfflineStore } from '../stores/offline.js';

const props = defineProps({
  modelValue: { type: Array, required: true },
  eventId: { type: String, required: true },
  disabled: { type: Boolean, required: false, default: false },
});

const emit = defineEmits(['update:modelValue']);

const categoriesStore = useCategoriesStore();
const offlineStore = useOfflineStore();

const rootRef = ref(null);
const inputRef = ref(null);
const open = ref(false);
const query = ref('');
const highlighted = ref(0);
const creating = ref(false);
const createError = ref('');

const selected = computed(() =>
  props.modelValue.map((id) => categoriesStore.byId(id)).filter(Boolean),
);

function normalize(value) {
  return value
    .trim()
    .toLocaleLowerCase('hu')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

const matches = computed(() => {
  const needle = normalize(query.value);
  if (!needle) {
    return categoriesStore.categories;
  }
  return categoriesStore.categories.filter((category) => normalize(category.name).includes(needle));
});

const hasExactMatch = computed(() =>
  categoriesStore.categories.some(
    (category) => normalize(category.name) === normalize(query.value),
  ),
);

const canCreate = computed(
  () => query.value.trim().length > 0 && !hasExactMatch.value && !offlineStore.stale,
);

const optionCount = computed(() => matches.value.length + (canCreate.value ? 1 : 0));

function openPanel() {
  if (props.disabled) {
    return;
  }
  open.value = true;
  highlighted.value = 0;
  nextTick(() => inputRef.value?.focus());
}

function closePanel() {
  open.value = false;
  query.value = '';
  createError.value = '';
}

function toggle(id) {
  const next = props.modelValue.includes(id)
    ? props.modelValue.filter((item) => item !== id)
    : [...props.modelValue, id];
  emit('update:modelValue', next);
}

function remove(id) {
  emit(
    'update:modelValue',
    props.modelValue.filter((item) => item !== id),
  );
}

async function createFromQuery() {
  const name = query.value.trim();
  if (!name || creating.value) {
    return;
  }
  creating.value = true;
  createError.value = '';
  try {
    const category = await categoriesStore.createCategory(props.eventId, {
      name,
      color: categoriesStore.nextColor,
    });
    emit('update:modelValue', [...props.modelValue, category.id]);
    query.value = '';
    highlighted.value = 0;
  } catch (error) {
    createError.value = error?.message ?? 'Offline nem hozható létre új kategória.';
  } finally {
    creating.value = false;
  }
}

function activate(index) {
  if (index < matches.value.length) {
    toggle(matches.value[index].id);
    return;
  }
  if (canCreate.value) {
    createFromQuery();
  }
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    if (open.value) {
      event.stopPropagation();
      closePanel();
    }
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (!open.value) {
      openPanel();
      return;
    }
    highlighted.value = optionCount.value === 0 ? 0 : (highlighted.value + 1) % optionCount.value;
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    highlighted.value =
      optionCount.value === 0 ? 0 : (highlighted.value - 1 + optionCount.value) % optionCount.value;
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    activate(highlighted.value);
    return;
  }
  if (event.key === 'Backspace' && query.value === '' && props.modelValue.length > 0) {
    remove(props.modelValue[props.modelValue.length - 1]);
  }
}

function onDocumentPointerDown(event) {
  if (open.value && rootRef.value && !rootRef.value.contains(event.target)) {
    closePanel();
  }
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown));
</script>

<template>
  <div ref="rootRef" class="cat-picker" @keydown="onKeydown">
    <div
      class="cat-picker__control"
      :class="{ 'is-open': open, 'is-disabled': disabled }"
      role="combobox"
      aria-label="Kategória"
      :aria-expanded="open"
      aria-haspopup="listbox"
      aria-controls="cat-picker-list"
      tabindex="0"
      @click="openPanel"
      @focus="openPanel"
    >
      <CategoryTag
        v-for="category in selected"
        :key="category.id"
        :name="category.name"
        :color="category.color"
        small
      >
        <button
          type="button"
          class="cat-picker__remove"
          :aria-label="`${category.name} levétele`"
          :disabled="disabled"
          @click.stop="remove(category.id)"
        >
          ×
        </button>
      </CategoryTag>
      <input
        v-if="open"
        ref="inputRef"
        v-model="query"
        type="text"
        class="cat-picker__input"
        aria-label="Kategória keresése"
        :disabled="disabled"
        @click.stop
      />
      <span v-else-if="selected.length === 0" class="cat-picker__placeholder">Nincs kategória</span>
      <span class="cat-picker__caret" aria-hidden="true">▾</span>
    </div>

    <ul
      v-if="open"
      id="cat-picker-list"
      class="cat-picker__list"
      role="listbox"
      aria-multiselectable="true"
    >
      <li
        v-for="(category, index) in matches"
        :key="category.id"
        role="option"
        :aria-selected="modelValue.includes(category.id)"
        class="cat-picker__option"
        :class="{ 'is-highlighted': highlighted === index }"
        @mouseenter="highlighted = index"
        @click="toggle(category.id)"
      >
        <CategoryTag :name="category.name" :color="category.color" />
        <span v-if="modelValue.includes(category.id)" class="cat-picker__check" aria-hidden="true">
          ✓
        </span>
      </li>
      <li
        v-if="canCreate"
        role="option"
        :aria-selected="false"
        class="cat-picker__option cat-picker__create"
        :class="{ 'is-highlighted': highlighted === matches.length }"
        @mouseenter="highlighted = matches.length"
        @click="createFromQuery"
      >
        {{ creating ? 'Létrehozás…' : `+ Új kategória: „${query.trim()}”` }}
      </li>
      <li v-if="offlineStore.stale && query.trim() && !hasExactMatch" class="cat-picker__hint">
        Offline nem hozható létre új kategória.
      </li>
      <li v-else-if="matches.length === 0 && !canCreate" class="cat-picker__hint">
        Nincs még kategória. Írd be az elsőt.
      </li>
    </ul>

    <p v-if="createError" role="alert" class="field-error">{{ createError }}</p>
  </div>
</template>

<style scoped>
.cat-picker {
  position: relative;
}

.cat-picker__control {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-1);
  min-height: 2.6rem;
  padding: 0.35em 0.6em;
  border-bottom: 2px solid var(--rule);
  cursor: text;
}

.cat-picker__control.is-open,
.cat-picker__control:focus {
  border-bottom-color: var(--forint);
  outline: none;
}

.cat-picker__control.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cat-picker__input {
  flex: 1;
  min-width: 4rem;
  border: none;
  background: transparent;
  color: var(--ink);
  font-family: var(--font-body);
  font-size: 1rem;
  outline: none;
}

.cat-picker__placeholder {
  flex: 1;
  color: var(--ink-soft);
  font-size: 0.9rem;
}

.cat-picker__caret {
  color: var(--ink-soft);
  font-size: 0.8rem;
}

.cat-picker__remove {
  border: none;
  background: none;
  padding: 0;
  color: inherit;
  font-size: 1em;
  line-height: 1;
  cursor: pointer;
}

.cat-picker__list {
  position: absolute;
  z-index: 20;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  max-height: 14rem;
  overflow-y: auto;
  margin: 0;
  padding: var(--space-1);
  list-style: none;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: 3px;
  box-shadow: 0 6px 18px rgb(0 0 0 / 12%);
}

.cat-picker__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-radius: 2px;
  cursor: pointer;
}

.cat-picker__option.is-highlighted {
  background: var(--forint-soft);
}

.cat-picker__check {
  color: var(--forint);
}

.cat-picker__create {
  font-size: 0.85rem;
  color: var(--forint);
}

.cat-picker__hint {
  padding: var(--space-1) var(--space-2);
  font-size: 0.8rem;
  color: var(--ink-soft);
}
</style>

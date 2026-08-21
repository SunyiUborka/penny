<script setup>
import { onMounted, onUnmounted, ref } from 'vue';

const props = defineProps({
  label: { type: String, required: false, default: 'További műveletek' },
});

const open = ref(false);
const rootRef = ref(null);

function close() {
  open.value = false;
}

function handlePointerDown(event) {
  if (open.value && rootRef.value && !rootRef.value.contains(event.target)) {
    close();
  }
}

function handleKeydown(event) {
  if (event.key === 'Escape' && open.value) {
    close();
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', handlePointerDown);
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener('pointerdown', handlePointerDown);
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <span ref="rootRef" class="row-menu" @click.stop>
    <button
      type="button"
      class="row-menu__toggle"
      :aria-label="props.label"
      :aria-expanded="open"
      aria-haspopup="true"
      @click="open = !open"
    >
      <svg viewBox="0 0 4 16" width="4" height="16" aria-hidden="true" focusable="false">
        <circle cx="2" cy="3" r="1.6" fill="currentColor" />
        <circle cx="2" cy="8" r="1.6" fill="currentColor" />
        <circle cx="2" cy="13" r="1.6" fill="currentColor" />
      </svg>
    </button>
    <span v-if="open" class="row-menu__panel" @click="close">
      <slot />
    </span>
  </span>
</template>

<style scoped>
.row-menu {
  position: relative;
  display: inline-flex;
  flex: none;
}

.row-menu__toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  background: none;
  border: 1px solid transparent;
  border-radius: 3px;
  color: var(--ink-soft);
  cursor: pointer;
}

@media (hover: hover) and (pointer: fine) {
  .row-menu__toggle:hover {
    border-color: var(--rule);
    color: var(--ink);
  }
}

.row-menu__toggle[aria-expanded='true'] {
  border-color: var(--rule);
  color: var(--ink);
  background: var(--paper);
}

.row-menu__panel {
  position: absolute;
  top: calc(100% + 2px);
  right: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 9.5rem;
  padding: var(--space-2);
  background: var(--paper-raised);
  border: 1px solid var(--rule-strong);
  border-radius: 3px;
  box-shadow: 0 8px 16px rgb(0 0 0 / 18%);
}

.row-menu__panel :slotted(.btn) {
  width: 100%;
  text-align: left;
}
</style>

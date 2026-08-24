<script setup>
import { computed } from 'vue';

const props = defineProps({
  name: { type: String, required: true },
  color: { type: String, required: true },
  small: { type: Boolean, required: false, default: false },
});

const style = computed(() => ({ '--cat-color': `var(--cat-${props.color})` }));
</script>

<template>
  <span class="cat-tag" :class="{ 'cat-tag--sm': small }" :style="style">
    <span class="cat-tag__name">{{ name }}</span>
    <slot />
  </span>
</template>

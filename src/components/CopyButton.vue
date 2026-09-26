<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{ text: string; label?: string }>();
const done = ref(false);

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.text);
    done.value = true;
    setTimeout(() => (done.value = false), 1500);
  } catch {
    done.value = false;
  }
}
</script>

<template>
  <button type="button" class="copy" @click="copy">{{ done ? 'Copied' : (label ?? 'Copy') }}</button>
</template>

<style scoped>
.copy {
  padding: 0.2rem 0.75rem;
  font-size: 0.85rem;
  border-width: 1.5px;
}
</style>

<script setup lang="ts">
import { computed } from 'vue';
import { ping, readLog, session } from '../session';

const isCatCard = computed(() => session.known?.kind === 'catcard');
</script>

<template>
  <section class="diag" aria-labelledby="diag-title">
    <h2 id="diag-title">Connection</h2>
    <div class="grid">
      <div class="block">
        <p class="help">Send 16 random bytes and check the device echoes them back unchanged.</p>
        <button type="button" :disabled="session.busy" @click="ping">Ping the device</button>
        <ol v-if="session.pings.length" class="pings">
          <li v-for="p in session.pings" :key="p.at.getTime()" :data-ok="p.ok">
            <span class="mono">{{ p.ms.toFixed(1) }} ms</span>
            <span>{{ p.ok ? 'echo matched' : 'echo differed' }}</span>
          </li>
        </ol>
      </div>

      <div v-if="isCatCard" class="block">
        <p class="help">Read the device's diagnostic log. It never contains your PIN or seed.</p>
        <button type="button" :disabled="session.busy" @click="readLog">Read the log</button>
        <template v-if="session.log">
          <p v-if="session.log.wrapped" class="note">The log filled up and wrapped, so its oldest lines are gone.</p>
          <pre class="log mono">{{ session.log.text || '(empty)' }}</pre>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.diag {
  display: grid;
  gap: 1rem;
  border-top: 1.5px solid var(--line);
  padding-top: 2rem;
}

h2 {
  font-size: 1.5rem;
  font-weight: 720;
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 20rem) minmax(0, 1fr);
  gap: 2rem clamp(2rem, 6vw, 5rem);
}

.block {
  display: grid;
  gap: 0.75rem;
  align-content: start;
  justify-items: start;
}

.help,
.note {
  color: var(--muted);
}

.pings {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.2rem;
}

.pings li {
  display: flex;
  gap: 1rem;
}

.pings li[data-ok='false'] {
  color: var(--hazard);
}

.log {
  justify-self: stretch;
  margin: 0;
  max-height: 24rem;
  overflow: auto;
  padding: 0.9rem 1rem;
  background: var(--surface);
  border: 1.5px solid var(--line);
  border-radius: 8px;
  font-size: 0.85rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

@media (max-width: 720px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>

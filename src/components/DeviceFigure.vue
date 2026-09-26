<script setup lang="ts">
import { computed } from 'vue';
import { hexId } from '../protocol/device';
import { session } from '../session';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '×', '0', '✓'];

const lines = computed<string[]>(() => {
  const s = session;
  if (s.phase === 'connecting') return ['hello?', '', ''];
  if (s.restarted && s.phase !== 'ready') return ['installing', s.restartTarget === 'coldcard' ? 'update...' : 'catcard...', ''];
  if (s.phase !== 'ready' || !s.info) return ['no device', '', ''];
  if (s.info.kind === 'catcard') {
    const id = s.info.identify;
    const st = id.blank ? 'needs setup' : id.unlocked ? 'unlocked' : 'locked';
    return [`catcard ${id.board}`, id.version, st];
  }
  const v = s.info.version;
  return [`coldcard ${v.hardware ?? ''}`.trim(), v.version, v.edge ? 'edge build' : ''];
});

const plugged = computed(() => session.phase === 'ready' || session.phase === 'connecting');
const tone = computed(() => (session.phase === 'ready' ? (session.known?.kind ?? 'none') : 'none'));
</script>

<template>
  <figure class="figure" :data-tone="tone" :data-plugged="plugged">
    <svg viewBox="0 0 200 330" role="img" :aria-label="`Device screen: ${lines.filter(Boolean).join(', ')}`">
      <g class="cable">
        <path d="M100 0 V 22" />
        <rect class="plug" x="88" y="18" width="24" height="18" rx="3" />
      </g>
      <rect class="body" x="10" y="40" width="180" height="284" rx="20" />
      <rect class="screen" x="26" y="58" width="148" height="90" rx="6" />
      <g class="screen-text">
        <text v-for="(l, i) in lines" :key="i" x="36" :y="84 + i * 24">{{ l }}</text>
      </g>
      <g class="keys">
        <g v-for="(k, i) in KEYS" :key="k" :transform="`translate(${30 + (i % 3) * 50}, ${170 + Math.floor(i / 3) * 36})`">
          <rect width="40" height="26" rx="7" />
          <text x="20" y="18">{{ k }}</text>
        </g>
      </g>
    </svg>
    <figcaption v-if="session.known">
      {{ session.productName || session.known.label }}
      <span class="mono">{{ hexId(session.vendorId) }}:{{ hexId(session.productId) }}</span>
    </figcaption>
  </figure>
</template>

<style scoped>
.figure {
  margin: 0;
  display: grid;
  gap: 0.75rem;
  justify-items: center;
}

svg {
  width: 100%;
  height: auto;
  overflow: visible;
}

.body {
  fill: var(--surface);
  stroke: var(--line);
  stroke-width: 3;
  stroke-dasharray: 10 8;
  transition: stroke 300ms ease;
}

[data-tone='catcard'] .body,
[data-tone='coldcard'] .body {
  stroke-dasharray: none;
}

[data-tone='catcard'] .body {
  stroke: var(--cat);
}

[data-tone='coldcard'] .body {
  stroke: var(--ink);
}

.cable path {
  stroke: var(--muted);
  stroke-width: 6;
  stroke-linecap: round;
  fill: none;
}

.cable {
  transform: translateY(-16px);
  transition: transform 450ms cubic-bezier(0.3, 1.4, 0.5, 1);
}

[data-plugged='true'] .cable {
  transform: translateY(8px);
}

.plug {
  fill: var(--muted);
}

.screen {
  fill: var(--screen);
}

.screen-text text {
  font-family: var(--mono-font);
  font-size: 13px;
  fill: #52615a;
}

[data-tone='catcard'] .screen-text text,
[data-tone='coldcard'] .screen-text text {
  fill: var(--screen-ink);
}

.keys rect {
  fill: var(--paper);
  stroke: var(--line);
  stroke-width: 1.5;
}

.keys text {
  font-family: var(--display-font);
  font-size: 14px;
  font-weight: 600;
  text-anchor: middle;
  fill: var(--muted);
}

figcaption {
  color: var(--muted);
  font-size: 0.95rem;
  text-align: center;
}

figcaption .mono {
  margin-left: 0.4rem;
}
</style>

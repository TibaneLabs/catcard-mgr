<script setup lang="ts">
import { computed } from 'vue';
import { CAP_NAMES } from '../protocol/catcard';
import { refresh, session } from '../session';

const NETWORKS: Record<string, string> = { BTC: 'Bitcoin mainnet', XTN: 'Bitcoin testnet', XRT: 'Bitcoin regtest' };

const catcard = computed(() => (session.info?.kind === 'catcard' ? session.info.identify : null));
const coldcard = computed(() => (session.info?.kind === 'coldcard' ? session.info : null));

const capabilities = computed(() => {
  const c = catcard.value;
  if (!c) return [];
  return CAP_NAMES.map((cap) => ({ ...cap, present: (c.caps & cap.bit) !== 0 }));
});

const hazards = computed(() => capabilities.value.filter((c) => c.hazard && c.present));

const lockState = computed(() => {
  const c = catcard.value;
  if (!c) return '';
  if (c.blank) return 'No PIN has been set yet. Set one up on the device to start using it.';
  if (c.unlocked) return 'Unlocked. The PIN has been entered on the device.';
  return 'Locked. Enter your PIN on the device.';
});

const time = computed(() => session.identifiedAt?.toLocaleTimeString() ?? '');
</script>

<template>
  <div class="identity">
    <template v-if="catcard">
      <h1>CatCard {{ catcard.board }}</h1>
      <p class="state" :data-state="catcard.blank ? 'blank' : catcard.unlocked ? 'unlocked' : 'locked'">{{ lockState }}</p>

      <div v-if="hazards.length" class="hazard" role="note">
        <h2>This is a bench build</h2>
        <p>
          It accepts {{ hazards.map((h) => h.name.toLowerCase()).join(', ') }} over USB. Any page or program allowed to use
          this device can act on it. Do not store a seed that protects real funds on it.
        </p>
      </div>

      <dl class="facts">
        <div>
          <dt>Firmware</dt>
          <dd class="mono">{{ catcard.version || 'not reported' }}</dd>
        </div>
        <div>
          <dt>Board</dt>
          <dd class="mono">{{ catcard.board || 'not reported' }}</dd>
        </div>
        <div>
          <dt>USB protocol</dt>
          <dd class="mono">v{{ catcard.protocol }}</dd>
        </div>
      </dl>

      <h2 class="sub">What this firmware accepts over USB</h2>
      <ul class="caps">
        <li v-for="c in capabilities" :key="c.bit" :data-present="c.present" :data-hazard="c.hazard ?? false">
          <span class="mark" aria-hidden="true">{{ c.present ? '●' : '○' }}</span>
          <span>
            <strong>{{ c.name }}</strong>
            <span class="sr">{{ c.present ? 'available' : 'not available' }}.</span>
            {{ c.description }}
          </span>
        </li>
      </ul>
    </template>

    <template v-else-if="coldcard">
      <h1>Coldcard {{ coldcard.version.hardware ?? '' }}</h1>
      <p class="state">Running stock Coldcard firmware.</p>

      <dl class="facts">
        <div>
          <dt>Firmware</dt>
          <dd class="mono">
            {{ coldcard.version.version || 'not reported' }}
            <span v-if="coldcard.version.edge" class="tag">Edge</span>
          </dd>
        </div>
        <div>
          <dt>Built</dt>
          <dd class="mono">{{ coldcard.version.date || 'not reported' }}</dd>
        </div>
        <div v-if="coldcard.version.bootloader">
          <dt>Bootloader</dt>
          <dd class="mono">{{ coldcard.version.bootloader }}</dd>
        </div>
        <div v-if="coldcard.chain">
          <dt>Network</dt>
          <dd>{{ NETWORKS[coldcard.chain] ?? coldcard.chain }}</dd>
        </div>
      </dl>

      <details class="raw">
        <summary>Version reply as sent by the device</summary>
        <pre class="mono">{{ coldcard.version.lines.join('\n') }}</pre>
      </details>
    </template>

    <div class="row">
      <button type="button" :disabled="session.busy" @click="refresh">Identify again</button>
      <span class="when">Identified at {{ time }}</span>
    </div>
  </div>
</template>

<style scoped>
.identity {
  display: grid;
  gap: 1.25rem;
}

h1 {
  font-size: clamp(2.2rem, 5vw, 3.4rem);
  font-weight: 780;
  letter-spacing: -0.025em;
}

.state {
  font-size: 1.15rem;
  padding-left: 0.9rem;
  border-left: 4px solid var(--muted);
}

.state[data-state='unlocked'] {
  border-color: var(--ok);
}

.state[data-state='blank'] {
  border-color: var(--cat);
}

.hazard {
  border: 2px solid var(--hazard);
  border-radius: 10px;
  padding: 0.9rem 1.1rem;
  display: grid;
  gap: 0.35rem;
}

.hazard h2 {
  font-size: 1.15rem;
  color: var(--hazard);
}

.facts {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: 1rem 2rem;
  padding: 1rem 0;
  border-top: 1.5px solid var(--line);
  border-bottom: 1.5px solid var(--line);
}

dt {
  color: var(--muted);
  font-size: 0.9rem;
}

dd {
  margin: 0.15rem 0 0;
  font-size: 1.2rem;
  overflow-wrap: anywhere;
}

.tag {
  font-family: var(--body-font);
  font-size: 0.8rem;
  font-weight: 700;
  margin-left: 0.4rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: var(--cat);
  color: #1a1206;
}

.sub {
  font-size: 1.2rem;
  font-weight: 700;
}

.caps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.55rem;
}

.caps li {
  display: grid;
  grid-template-columns: 1.2rem 1fr;
  gap: 0.5rem;
  color: var(--muted);
}

.caps li[data-present='true'] {
  color: var(--ink);
}

.caps li[data-present='true'] .mark {
  color: var(--ok);
}

.caps li[data-present='true'][data-hazard='true'] .mark {
  color: var(--hazard);
}

.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.raw summary {
  cursor: pointer;
  color: var(--muted);
}

.raw pre {
  margin: 0.5rem 0 0;
  padding: 0.8rem 1rem;
  background: var(--surface);
  border-radius: 8px;
  overflow-x: auto;
}

.row {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.when {
  color: var(--muted);
  font-size: 0.9rem;
}
</style>

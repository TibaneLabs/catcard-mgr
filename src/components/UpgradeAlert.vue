<script setup lang="ts">
import { computed } from 'vue';
import { urgentUpgrade } from '../firmware/advisory';
import { openPanel } from '../panels';
import { session } from '../session';

const version = computed(() => (session.info?.kind === 'coldcard' ? session.info.version.version : ''));
const advisory = computed(() => urgentUpgrade(version.value));
</script>

<template>
  <section v-if="advisory" class="alert" role="alert" aria-labelledby="alert-title">
    <div class="inner">
      <h1 id="alert-title">Upgrade this Coldcard now</h1>
      <p class="lead">
        Coldcard firmware {{ version }} has a serious flaw. Wallet seeds it generates on the device are far weaker than
        they should be, and someone else may be able to find them. Coinkite fixed it in {{ advisory.fixedIn }}.
      </p>
      <ol>
        <li>
          <strong>Upgrade the firmware today,</strong> to the official Coldcard {{ advisory.fixedIn }} or later, or to
          CatCard.
        </li>
        <li>
          <strong>If this wallet's seed was generated on this Coldcard, it is still weak after the upgrade.</strong>
          Once upgraded, create a new seed and move your funds to it.
        </li>
      </ol>
      <div class="actions">
        <button type="button" class="solid" @click="openPanel('coldcard-update')">Upgrade to official Coldcard firmware</button>
        <button type="button" class="ghost" @click="openPanel('catcard-switch')">Switch to CatCard</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.alert {
  background: #b3261e;
  color: #fff;
  border-bottom: 6px solid #7a1812;
}

.inner {
  max-width: 72rem;
  margin: 0 auto;
  padding: clamp(1.5rem, 4vw, 2.75rem) clamp(1rem, 4vw, 2.5rem);
  display: grid;
  gap: 1rem;
}

h1 {
  font-size: clamp(2.2rem, 6vw, 4rem);
  font-weight: 800;
  letter-spacing: -0.025em;
  line-height: 1.02;
}

.lead {
  font-size: clamp(1.1rem, 2vw, 1.3rem);
  max-width: 44em;
}

ol {
  margin: 0;
  padding-left: 1.4rem;
  display: grid;
  gap: 0.5rem;
  font-size: 1.1rem;
  max-width: 44em;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

button {
  font-size: 1.05rem;
  padding: 0.75rem 1.4rem;
  border: 2px solid #fff;
}

.solid {
  background: #fff;
  color: #7a1812;
}

.ghost {
  background: transparent;
  color: #fff;
}

.solid:hover:not(:disabled),
.ghost:hover:not(:disabled) {
  background: #7a1812;
  border-color: #fff;
  color: #fff;
}

:focus-visible {
  outline-color: #fff;
}
</style>

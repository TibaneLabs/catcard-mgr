<script setup lang="ts">
import { computed, ref } from 'vue';
import { CHAIN_NAMES, FORMAT_NAMES, HostRefused, pathText, requestAddresses, STAGE_TEXT } from '../protocol/hostwallet';
import { hostCall, session, setAddresses } from '../session';
import CopyButton from './CopyButton.vue';

const asking = ref(false);
const stage = ref<number | null>(null);
const error = ref<string | null>(null);

const groups = computed(() => {
  const a = session.addresses;
  if (!a) return [];
  const byChain = new Map<number, typeof a.entries>();
  for (const e of a.entries) byChain.set(e.chain, [...(byChain.get(e.chain) ?? []), e]);
  return [...byChain.entries()].map(([chain, entries]) => ({ chain, name: CHAIN_NAMES[chain] ?? `Chain ${chain}`, entries }));
});

async function ask(): Promise<void> {
  error.value = null;
  asking.value = true;
  stage.value = null;
  try {
    setAddresses(await requestAddresses(hostCall, { onStage: (s) => (stage.value = s) }));
  } catch (err) {
    error.value = err instanceof HostRefused || err instanceof Error ? err.message : String(err);
  } finally {
    asking.value = false;
  }
}
</script>

<template>
  <div class="addresses">
    <h3>Addresses</h3>
    <p v-if="!session.addresses" class="hint">
      The CatCard asks you which account and which coins to share. Signing works only for the accounts you share here.
    </p>
    <button v-if="!asking" type="button" :class="session.addresses ? '' : 'primary'" @click="ask">
      {{ session.addresses ? 'Ask again' : 'Ask for addresses' }}
    </button>
    <p v-else class="waiting" role="status">
      Answer on the CatCard: pick the account and the coins to share.
      <span v-if="stage !== null" class="stage">Right now, {{ STAGE_TEXT[stage] }}.</span>
    </p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <template v-if="session.addresses">
      <p class="meta">
        Wallet fingerprint <span class="mono">{{ session.addresses.fingerprint }}</span>, account {{ session.addresses.account }}.
      </p>
      <div v-for="g in groups" :key="g.chain" class="chain">
        <h4>{{ g.name }}</h4>
        <dl>
          <div v-for="e in g.entries" :key="`${e.format}-${e.address}`" class="entry">
            <dt>{{ FORMAT_NAMES[e.format] ?? `Format ${e.format}` }}</dt>
            <dd>
              <span class="mono addr">{{ e.address }}</span>
              <CopyButton :text="e.address" />
              <span class="path mono">{{ pathText(e.addressPath) }}</span>
              <template v-if="e.xpub">
                <span class="mono xpub">{{ e.xpub }}</span>
                <CopyButton :text="e.xpub" label="Copy extended key" />
                <span class="path mono">account {{ pathText(e.accountPath) }}</span>
              </template>
            </dd>
          </div>
        </dl>
      </div>
      <p class="hint">The first receive address of each account is shown as a check. Wallet software derives the rest from the extended key.</p>
    </template>
  </div>
</template>

<style scoped>
.addresses {
  display: grid;
  gap: 0.9rem;
  justify-items: start;
  width: 100%;
}

h3 {
  font-size: 1.2rem;
}

h4 {
  font-size: 1.05rem;
  margin: 0 0 0.4rem;
  font-family: var(--display-font);
}

.hint,
.meta,
.stage {
  color: var(--muted);
}

.waiting {
  font-weight: 700;
  display: grid;
  gap: 0.2rem;
}

.stage {
  font-weight: 400;
}

.chain {
  width: 100%;
  padding-top: 0.75rem;
  border-top: 1.5px solid var(--line);
}

dl {
  margin: 0;
  display: grid;
  gap: 0.75rem;
}

.entry {
  display: grid;
  grid-template-columns: minmax(9rem, 14rem) 1fr;
  gap: 0.25rem 1rem;
}

dt {
  color: var(--muted);
}

dd {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 0.6rem;
  align-items: center;
  min-width: 0;
}

.addr,
.xpub {
  overflow-wrap: anywhere;
  min-width: 0;
}

.xpub {
  font-size: 0.8rem;
  color: var(--muted);
}

.path {
  flex-basis: 100%;
  font-size: 0.8rem;
  color: var(--muted);
}

.error {
  border-left: 4px solid var(--hazard);
  padding: 0.5rem 0.9rem;
  color: var(--hazard);
  background: var(--surface);
}

@media (max-width: 720px) {
  .entry {
    grid-template-columns: 1fr;
  }
}
</style>

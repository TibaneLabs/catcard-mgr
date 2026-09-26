<script setup lang="ts">
import { computed, ref } from 'vue';
import { caps } from '../protocol/catcard';
import type { PendingPairing } from '../protocol/catcard';
import { codeText } from '../protocol/ncry';
import { session, setPaired, startPairing, unpair } from '../session';
import AddressList from './AddressList.vue';
import SignRequest from './SignRequest.vue';

type Step = 'idle' | 'starting' | 'compare' | 'waiting' | 'mismatch';

const step = ref<Step>('idle');
const error = ref<string | null>(null);
const pending = ref<PendingPairing | null>(null);
let stop: AbortController | null = null;

const id = computed(() => (session.info?.kind === 'catcard' ? session.info.identify : null));
const supported = computed(() => !!id.value && (id.value.caps & caps.PAIRING) !== 0 && (id.value.caps & caps.HOST_WALLET) !== 0);
const code = computed(() => (pending.value ? codeText(pending.value.code) : ''));

async function pair(): Promise<void> {
  error.value = null;
  step.value = 'starting';
  try {
    pending.value = await startPairing();
    step.value = 'compare';
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    step.value = 'idle';
  }
}

async function codesMatch(): Promise<void> {
  const p = pending.value;
  if (!p) return;
  step.value = 'waiting';
  stop = new AbortController();
  try {
    setPaired(await p.confirm({ signal: stop.signal }));
    step.value = 'idle';
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    step.value = 'idle';
  } finally {
    pending.value = null;
    stop = null;
  }
}

async function codesDiffer(): Promise<void> {
  await pending.value?.abort();
  pending.value = null;
  step.value = 'mismatch';
}

function cancel(): void {
  stop?.abort();
}
</script>

<template>
  <section v-if="id" class="hw" aria-labelledby="hw-title">
    <h2 id="hw-title">Addresses and signing</h2>

    <p v-if="!supported" class="hint">
      This CatCard's firmware cannot share addresses or sign for a computer. Update it to a version that can.
    </p>

    <template v-else-if="!session.paired">
      <p class="intro">
        Pair this computer with the CatCard first. Both screens show the same six-digit code, and you check that they
        match. Pairing lasts until the CatCard is unplugged or this page is reloaded.
      </p>

      <button v-if="step === 'idle' || step === 'starting'" class="primary" type="button" :disabled="step === 'starting' || !id.unlocked" @click="pair">
        Pair with this CatCard
      </button>
      <p v-if="!id.unlocked && step === 'idle'" class="hint">Unlock the CatCard with its PIN first.</p>

      <div v-if="step === 'compare' || step === 'waiting'" class="pairing">
        <p class="label">Pairing code</p>
        <p class="code mono" aria-live="polite">{{ code }}</p>
        <template v-if="step === 'compare'">
          <p class="question">Does the CatCard show exactly this code?</p>
          <div class="row">
            <button class="primary" type="button" @click="codesMatch">The codes match</button>
            <button type="button" @click="codesDiffer">They are different</button>
          </div>
        </template>
        <template v-else>
          <p class="question">Now accept the code on the CatCard.</p>
          <button type="button" @click="cancel">Cancel pairing</button>
        </template>
      </div>

      <div v-if="step === 'mismatch'" class="mismatch" role="alert">
        <h3>Pairing stopped</h3>
        <p>
          A different code means something between this computer and the CatCard may be relaying the connection. Unplug the
          CatCard, check the cable and anything it passes through, then try again.
        </p>
        <button type="button" @click="step = 'idle'">Try again</button>
      </div>
    </template>

    <template v-else>
      <p class="paired">
        Paired for this connection.
        <button type="button" class="link" @click="unpair">Forget this pairing</button>
      </p>
      <AddressList />
      <SignRequest v-if="session.addresses" />
    </template>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.hw {
  display: grid;
  gap: 1.1rem;
  justify-items: start;
  border-top: 1.5px solid var(--line);
  padding-top: 2rem;
}

h2 {
  font-size: 1.5rem;
  font-weight: 720;
}

h3 {
  font-size: 1.15rem;
}

.intro,
.hint {
  color: var(--muted);
  max-width: 44em;
}

.pairing {
  display: grid;
  gap: 0.6rem;
  justify-items: start;
  padding: 1.25rem 1.5rem;
  border: 2px solid var(--cat);
  border-radius: 12px;
  background: var(--surface);
}

.label {
  color: var(--muted);
}

.code {
  font-size: clamp(2.6rem, 8vw, 4rem);
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 1;
}

.question {
  font-size: 1.1rem;
  font-weight: 700;
}

.row {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.mismatch {
  display: grid;
  gap: 0.5rem;
  justify-items: start;
  border-left: 4px solid var(--hazard);
  padding-left: 1rem;
  max-width: 44em;
}

.mismatch h3 {
  color: var(--hazard);
}

.paired {
  display: flex;
  gap: 1rem;
  align-items: baseline;
  flex-wrap: wrap;
  padding-left: 0.9rem;
  border-left: 4px solid var(--ok);
}

.link {
  border: 0;
  padding: 0;
  background: none;
  color: var(--cat-text);
  text-decoration: underline;
  font-weight: 400;
  border-radius: 0;
}

.link:hover:not(:disabled) {
  background: none;
  color: var(--ink);
}

.error {
  border-left: 4px solid var(--hazard);
  padding: 0.5rem 0.9rem;
  color: var(--hazard);
  background: var(--surface);
}
</style>

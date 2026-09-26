<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  Chain,
  CHAIN_NAMES,
  HostRefused,
  isUnder,
  pathText,
  requestSignature,
  SIGNING_CHAINS,
  STAGE_TEXT,
  type SignResult,
} from '../protocol/hostwallet';
import { hostCall, session } from '../session';
import { readPsbt, walletKeys } from '../wallet/psbt';
import CopyButton from './CopyButton.vue';

type Step = 'edit' | 'uploading' | 'review' | 'done';

const chain = ref<number>(Chain.Bitcoin);
const text = ref('');
const fileBytes = ref<Uint8Array | null>(null);
const fileName = ref('');
const step = ref<Step>('edit');
const upload = ref({ sent: 0, total: 0 });
const stage = ref<number | null>(null);
const error = ref<string | null>(null);
const result = ref<SignResult | null>(null);

const shared = computed(() => session.addresses?.entries ?? []);
const chains = computed(() => SIGNING_CHAINS.filter((c) => shared.value.some((e) => e.chain === c)));
watch(
  chains,
  (cs) => {
    if (!cs.includes(chain.value as (typeof SIGNING_CHAINS)[number]) && cs[0]) chain.value = cs[0];
  },
  { immediate: true },
);

const PLACEHOLDER: Record<number, string> = {
  [Chain.Bitcoin]: 'Paste a PSBT as base64 or hex, or choose a .psbt file',
  [Chain.Ethereum]: 'Paste the unsigned transaction as hex (0x…), or choose a file',
  [Chain.Solana]: 'Paste the transaction or message as base64 or hex, or choose a file',
};

function decodeText(t: string): Uint8Array | null {
  const s = t.replace(/\s+/g, '');
  if (!s) return null;
  const hex = s.replace(/^0x/i, '');
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) return Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16));
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(s)) {
    try {
      return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    } catch {
      return null;
    }
  }
  return null;
}

/** The transaction bytes and the keys to list, or why not. */
const plan = computed<{ tx: Uint8Array; keys: number[][]; note: string } | { problem: string } | null>(() => {
  const raw = fileBytes.value;
  const t = text.value.trim();
  if (!raw && !t) return null;
  const mine = shared.value.filter((e) => e.chain === chain.value);
  try {
    if (chain.value === Chain.Bitcoin) {
      const psbt = readPsbt(raw ?? t);
      const fp = session.addresses?.fingerprint ?? '';
      const k = walletKeys(psbt, fp);
      const keys = k.paths.filter((p) => mine.some((e) => isUnder(p, e.accountPath)));
      if (!keys.length) return { problem: 'No input of this PSBT belongs to the accounts the CatCard shared. Share the right account, or check the PSBT.' };
      const skipped = k.paths.length - keys.length;
      const notes = [`${keys.length} key${keys.length > 1 ? 's' : ''} of this wallet will sign.`];
      if (skipped) notes.push(`${skipped} other key${skipped > 1 ? 's' : ''} of this wallet belong${skipped > 1 ? '' : 's'} to accounts not shared, and will not sign.`);
      if (k.foreignInputs) notes.push(`${k.foreignInputs} input${k.foreignInputs > 1 ? 's are' : ' is'} not from this wallet.`);
      return { tx: psbt, keys, note: notes.join(' ') };
    }
    const tx = raw ?? decodeText(t);
    if (!tx) return { problem: chain.value === Chain.Ethereum ? 'Give the transaction as hex.' : 'Give the transaction as base64 or hex.' };
    const entry = mine[0];
    if (!entry) return { problem: `The CatCard did not share a ${CHAIN_NAMES[chain.value]} account.` };
    return { tx, keys: [[...entry.addressPath]], note: `Signs with ${entry.address}.` };
  } catch (err) {
    return { problem: err instanceof Error ? err.message : String(err) };
  }
});

async function onFile(ev: Event): Promise<void> {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  fileName.value = f.name;
  const bytes = new Uint8Array(await f.arrayBuffer());
  // A text file holding hex or base64 is read as text; anything else as raw bytes.
  const asText = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (chain.value !== Chain.Bitcoin && /^[\s0-9a-zA-Z+/=x]+$/.test(asText) && decodeText(asText)) {
    fileBytes.value = decodeText(asText);
  } else {
    fileBytes.value = bytes;
  }
  text.value = '';
}

function clearFile(): void {
  fileBytes.value = null;
  fileName.value = '';
}

async function sign(): Promise<void> {
  const p = plan.value;
  if (!p || 'problem' in p) return;
  error.value = null;
  result.value = null;
  step.value = 'uploading';
  upload.value = { sent: 0, total: 0 };
  stage.value = null;
  try {
    result.value = await requestSignature(hostCall, chain.value, p.keys, p.tx, {
      onUpload: (u) => (upload.value = u),
      onQueued: () => (step.value = 'review'),
      onStage: (s) => (stage.value = s),
    });
    step.value = 'done';
  } catch (err) {
    error.value = err instanceof HostRefused || err instanceof Error ? err.message : String(err);
    step.value = 'edit';
  }
}

function again(): void {
  result.value = null;
  text.value = '';
  clearFile();
  step.value = 'edit';
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const toB64 = (b: Uint8Array) => {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
};

function save(bytes: Uint8Array, name: string, type = 'application/octet-stream'): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function saveTxn(tx: Uint8Array): void {
  save(new TextEncoder().encode(toHex(tx)), `${baseName.value}.txn`, 'text/plain');
}

const baseName = computed(() => (fileName.value ? fileName.value.replace(/\.[^.]+$/, '') : 'transaction'));
</script>

<template>
  <div class="sign">
    <h3>Sign a transaction</h3>
    <p class="hint">You review every transaction on the CatCard before it signs. Only the accounts shared above can sign.</p>

    <fieldset class="fields" :disabled="step !== 'edit'">
      <div v-if="chains.length > 1" class="chains" role="radiogroup" aria-label="Coin">
        <label v-for="c in chains" :key="c">
          <input v-model="chain" type="radio" name="sign-chain" :value="c" @change="clearFile" />
          {{ CHAIN_NAMES[c] }}
        </label>
      </div>
      <p v-else-if="chains.length === 1" class="hint">Coin: {{ CHAIN_NAMES[chains[0]!] }}</p>
      <p v-else class="hint">The CatCard shared no coin it can sign for here: Bitcoin, Ethereum or Solana.</p>

      <template v-if="chains.length">
        <textarea v-if="!fileBytes" v-model="text" rows="4" :placeholder="PLACEHOLDER[chain]" spellcheck="false" class="mono" />
        <p v-else class="file">
          <span class="mono">{{ fileName }}</span>
          <button type="button" class="small" @click="clearFile">Remove</button>
        </p>
        <label class="picker">
          <input type="file" @change="onFile" />
          <span>Choose a file</span>
        </label>
      </template>
    </fieldset>

    <template v-if="plan">
      <p v-if="'problem' in plan" class="problem">{{ plan.problem }}</p>
      <div v-else class="plan">
        <p>{{ plan.note }}</p>
        <ul class="keys mono">
          <li v-for="k in plan.keys" :key="k.join('/')">{{ pathText(k) }}</li>
        </ul>
        <button v-if="step === 'edit'" class="primary" type="button" @click="sign">Send to the CatCard for review</button>
      </div>
    </template>

    <p v-if="step === 'uploading'" role="status">Sending {{ upload.sent.toLocaleString() }} of {{ upload.total.toLocaleString() }} bytes…</p>
    <p v-if="step === 'review'" class="waiting" role="status">
      Review it on the CatCard, then approve or refuse there.
      <span v-if="stage !== null" class="stage">Right now, {{ STAGE_TEXT[stage] }}.</span>
    </p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <div v-if="step === 'done' && result" class="result">
      <template v-if="result.kind === 'bitcoin'">
        <h4>Signed</h4>
        <p v-if="result.networkTx.length">Every input is signed. The transaction is complete and ready to broadcast.</p>
        <p v-else>Not every input is signed yet. Pass the signed PSBT on to the other signers, or back to your wallet software.</p>
        <div class="row">
          <button class="primary" type="button" @click="save(result.psbt, `${baseName}-signed.psbt`)">Save the signed PSBT</button>
          <CopyButton :text="toB64(result.psbt)" label="Copy the PSBT as base64" />
        </div>
        <div v-if="result.networkTx.length" class="row">
          <button type="button" @click="saveTxn(result.networkTx)">Save the final transaction</button>
          <CopyButton :text="toHex(result.networkTx)" label="Copy the transaction as hex" />
        </div>
      </template>
      <template v-else-if="result.kind === 'evm'">
        <h4>Signed</h4>
        <p class="mono out">0x{{ toHex(result.tx) }}</p>
        <CopyButton :text="`0x${toHex(result.tx)}`" label="Copy the signed transaction" />
      </template>
      <template v-else>
        <h4>Signed</h4>
        <p>{{ result.signatures.length }} signature{{ result.signatures.length === 1 ? '' : 's' }} added.</p>
        <p class="mono out">{{ toB64(result.tx) }}</p>
        <CopyButton :text="toB64(result.tx)" label="Copy the signed transaction as base64" />
      </template>
      <button type="button" @click="again">Sign another</button>
    </div>
  </div>
</template>

<style scoped>
.sign {
  display: grid;
  gap: 0.9rem;
  justify-items: start;
  width: 100%;
  max-width: 46rem;
  padding-top: 1.5rem;
  border-top: 1.5px solid var(--line);
}

h3 {
  font-size: 1.2rem;
}

h4 {
  font-size: 1.05rem;
  font-family: var(--display-font);
  margin: 0;
}

.hint,
.stage {
  color: var(--muted);
}

.fields {
  border: 0;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.75rem;
  width: 100%;
  justify-items: start;
}

.chains {
  display: flex;
  gap: 1.2rem;
  flex-wrap: wrap;
}

.chains label {
  display: flex;
  gap: 0.45rem;
  align-items: baseline;
  cursor: pointer;
}

input[type='radio'] {
  accent-color: var(--cat);
}

textarea {
  width: 100%;
  font-size: 0.85rem;
  padding: 0.6rem 0.75rem;
  border-radius: 8px;
  border: 1.5px solid var(--line);
  background: var(--surface);
  color: var(--ink);
  resize: vertical;
}

.picker {
  position: relative;
  cursor: pointer;
  border: 1.5px solid var(--ink);
  border-radius: 999px;
  padding: 0.4rem 1rem;
  font-weight: 700;
}

.picker input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.picker:focus-within {
  outline: 3px solid var(--cat);
  outline-offset: 2px;
}

.file {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  overflow-wrap: anywhere;
}

.small {
  padding: 0.2rem 0.75rem;
  font-size: 0.85rem;
}

.plan {
  display: grid;
  gap: 0.6rem;
  justify-items: start;
}

.keys {
  margin: 0;
  padding-left: 1.2rem;
  font-size: 0.9rem;
}

.problem {
  color: var(--hazard);
}

.waiting {
  font-weight: 700;
  display: grid;
  gap: 0.2rem;
}

.stage {
  font-weight: 400;
}

.result {
  display: grid;
  gap: 0.75rem;
  justify-items: start;
  width: 100%;
  border-left: 4px solid var(--ok);
  padding-left: 1rem;
}

.row {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  align-items: center;
}

.out {
  font-size: 0.8rem;
  overflow-wrap: anywhere;
  max-height: 8rem;
  overflow: auto;
}

.error {
  border-left: 4px solid var(--hazard);
  padding: 0.5rem 0.9rem;
  color: var(--hazard);
  background: var(--surface);
}
</style>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { urgentUpgrade } from '../firmware/advisory';
import { panelRequest } from '../panels';
import { caps } from '../protocol/catcard';
import { COINKITE_FINGERPRINT, COINKITE_SIGNER } from '../firmware/coinkite-key';
import {
  boardsFor,
  compareVersions,
  downloadStock,
  loadSignedList,
  type NamedBoard,
  type SignedList,
} from '../firmware/coldcard-archive';
import { session } from '../session';
import InstallSteps from './InstallSteps.vue';

const MODELS: { label: string; hardware: string }[] = [
  { label: 'Mk3', hardware: 'mk3' },
  { label: 'Mk4', hardware: 'mk4' },
  { label: 'Mk5', hardware: 'mk5' },
  { label: 'Q1', hardware: 'q1' },
];

const open = ref(false);
const error = ref<string | null>(null);
const list = ref<SignedList | null>(null);
const showEdge = ref(false);
const chosenModel = ref<string | null>(null);
const chosenFile = ref('');

/** On a Coldcard this updates it; on a CatCard it goes back to official firmware. */
const onCatCard = computed(() => session.info?.kind === 'catcard');
const canInstall = computed(() => session.info?.kind !== 'catcard' || (session.info.identify.caps & caps.UPGRADE) !== 0);
const info = computed(() => (session.info?.kind === 'coldcard' ? session.info.version : null));
const reported = computed(() =>
  (session.info?.kind === 'coldcard' ? session.info.version.hardware : session.info?.kind === 'catcard' ? session.info.identify.board : null)?.toLowerCase() ?? null,
);
const reportedBoards = computed(() => (reported.value ? boardsFor(reported.value) : []));
const model = computed(() => (reportedBoards.value.length ? reported.value : chosenModel.value));
const boards = computed<NamedBoard[]>(() => (model.value ? boardsFor(model.value) : []));
const installed = computed(() => info.value?.version ?? '');

const choices = computed(() => (list.value?.images ?? []).filter((i) => boards.value.includes(i.board) && (showEdge.value || !i.edge)));
const image = computed(() => choices.value.find((i) => i.file === chosenFile.value) ?? null);

function pickDefault(): void {
  // The newest stable build for this model, unless the current choice still fits.
  if (choices.value.some((i) => i.file === chosenFile.value)) return;
  chosenFile.value = (choices.value.find((i) => !i.edge) ?? choices.value[0])?.file ?? '';
}

function label(i: { version: string; built: string; edge: boolean }): string {
  const tags = [i.edge ? 'Edge' : '', installed.value && compareVersions(i.version, installed.value) === 0 && i.edge === installed.value.endsWith('X') ? 'installed' : '']
    .filter(Boolean)
    .join(', ');
  return `${i.version}, built ${i.built.slice(0, 10)}${tags ? ` (${tags})` : ''}`;
}

const notes = computed(() => {
  const i = image.value;
  if (!i) return [];
  const out: string[] = [];
  const weak = urgentUpgrade(i.version);
  if (weak) out.push(`This version generates weak wallet seeds. Coinkite fixed that in ${weak.fixedIn}. Pick ${weak.fixedIn} or later.`);
  if (onCatCard.value) {
    if (i.edge) out.push("Edge builds are Coinkite's experimental releases. They are signed, but meant for testing.");
    return out;
  }
  if (!installed.value) return out;
  const cmp = compareVersions(i.version, installed.value);
  if (cmp < 0) out.push(`This is older than the installed ${installed.value}. The Coldcard may refuse to go back to it.`);
  if (cmp === 0 && !i.edge === !installed.value.endsWith('X')) out.push('This version is already installed.');
  if (i.edge) out.push('Edge builds are Coinkite\'s experimental releases. They are signed, but meant for testing.');
  return out;
});

const signedAt = computed(() => list.value?.signedAt?.toISOString().slice(0, 10) ?? '');
const fingerprint = COINKITE_FINGERPRINT.toUpperCase().replace(/(.{4})/g, '$1 ').trim();
const signer = (n: number) => (n === 0 ? 'the published developer key, not Coinkite' : `Coinkite release key ${n}`);
const agreements = ['I have this wallet\'s seed words written down, in case anything goes wrong during the update.'];

async function start(): Promise<void> {
  error.value = null;
  open.value = true;
  if (list.value) return;
  try {
    list.value = await loadSignedList();
    pickDefault();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

const root = ref<HTMLElement | null>(null);
watch(panelRequest, async (r) => {
  if (r?.name !== 'coldcard-update') return;
  await start();
  await nextTick();
  root.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
</script>

<template>
  <section ref="root" class="update" aria-labelledby="update-title">
    <h2 id="update-title">{{ onCatCard ? 'Return to official Coldcard firmware' : 'Update the Coldcard firmware' }}</h2>
    <p v-if="onCatCard" class="intro">
      Replace CatCard with an official Coldcard release, checked against the list of files Coinkite signs. The CatCard
      shows what it received and installs nothing until you approve it there.
    </p>
    <p v-else class="intro">Install an official Coldcard release, checked against the list of files Coinkite signs.</p>

    <p v-if="!canInstall" class="hint">This CatCard cannot take a firmware over USB.</p>
    <button v-else-if="!open" class="primary" type="button" @click="start">Choose a Coldcard version</button>

    <template v-else-if="list">
      <p class="signed">
        Coinkite's signed file list checked<span v-if="signedAt">, signed {{ signedAt }}</span>. Key {{ COINKITE_SIGNER }},
        fingerprint <span class="mono">{{ fingerprint }}</span>.
      </p>

      <fieldset class="choices" :disabled="session.installing">
        <div v-if="!reportedBoards.length" class="field">
          <span class="legend">Hardware</span>
          <p class="hint">This device did not report its model. Pick the one printed on it.</p>
          <div class="options">
            <label v-for="m in MODELS" :key="m.hardware">
              <input v-model="chosenModel" type="radio" name="cc-model" :value="m.hardware" @change="pickDefault" />
              {{ m.label }}
            </label>
          </div>
        </div>

        <div v-if="model" class="field">
          <label for="cc-version">Version</label>
          <select id="cc-version" v-model="chosenFile">
            <option v-for="i in choices" :key="i.file" :value="i.file">{{ label(i) }}</option>
          </select>
          <label class="edge">
            <input v-model="showEdge" type="checkbox" @change="pickDefault" />
            Show Edge builds, Coinkite's experimental releases
          </label>
        </div>
      </fieldset>

      <InstallSteps
        v-if="image"
        :key="image.file"
        :file-name="image.file"
        :file-size="null"
        :fetch-image="(progress) => downloadStock(image!, progress)"
        checksum-text="matches Coinkite's signed list"
        :signer-text="signer"
        :agreements="agreements"
        :notes="notes"
        target="coldcard"
        install-label="Install this version"
      />
    </template>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.update {
  display: grid;
  gap: 1.1rem;
  justify-items: start;
  border-top: 1.5px solid var(--line);
  padding-top: 2rem;
  max-width: 46rem;
}

h2 {
  font-size: 1.5rem;
  font-weight: 720;
}

.intro,
.hint,
.signed {
  color: var(--muted);
}

.signed .mono {
  overflow-wrap: anywhere;
}

.choices {
  border: 0;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 1.2rem;
  justify-items: start;
  width: 100%;
}

.field {
  display: grid;
  gap: 0.45rem;
  justify-items: start;
}

.legend,
.field > label[for] {
  font-weight: 700;
}

.options {
  display: grid;
  gap: 0.3rem;
}

.options label,
.edge {
  display: flex;
  gap: 0.55rem;
  align-items: baseline;
  cursor: pointer;
}

input[type='radio'],
input[type='checkbox'] {
  accent-color: var(--cat);
  transform: translateY(0.1em);
}

select {
  font: inherit;
  max-width: 100%;
  padding: 0.4rem 0.6rem;
  border-radius: 8px;
  border: 1.5px solid var(--line);
  background: var(--surface);
  color: var(--ink);
}

.error {
  border-left: 4px solid var(--hazard);
  padding: 0.5rem 0.9rem;
  color: var(--hazard);
  background: var(--surface);
}
</style>

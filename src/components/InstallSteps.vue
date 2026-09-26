<script setup lang="ts">
/**
 * The part of a firmware install that is the same whatever the firmware: download and
 * check, show what was checked, collect the agreements, send it, report progress.
 * The parent chooses the file; give this a new `key` when the choice changes, so a
 * checked image and its agreements never carry over to another file.
 */
import { computed, ref } from 'vue';
import { parseDfu } from '../firmware/dfu';
import { checkImage, compatibleHardware, parseHeader, type FirmwareHeader } from '../firmware/header';
import type { InstallProgress } from '../firmware/install';
import { installImage, session, type InstallTarget } from '../session';

const props = defineProps<{
  fileName: string;
  fileSize: number | null;
  /** Downloads the .dfu and checks it against its trusted checksum. */
  fetchImage: (onProgress: (got: number, total: number | null) => void) => Promise<Uint8Array>;
  checksumText: string;
  signerText: (pubkeyNum: number) => string;
  /** Each one is a checkbox that must be ticked before installing. */
  agreements: string[];
  /** Shown beside the checked image, before the agreements. */
  notes?: string[];
  target: InstallTarget;
  installLabel: string;
}>();

type Step = 'ready' | 'checking' | 'checked' | 'installing' | 'sent';

const step = ref<Step>('ready');
const error = ref<string | null>(null);
const download = ref<{ got: number; total: number | null }>({ got: 0, total: props.fileSize });
const checked = ref<{ image: Uint8Array; header: FirmwareHeader; problems: string[] } | null>(null);
const ticks = ref<boolean[]>(props.agreements.map(() => false));
const progress = ref<InstallProgress | null>(null);

const hardware = computed(() =>
  session.info?.kind === 'coldcard' ? session.info.version.hardware : session.info?.kind === 'catcard' ? session.info.identify.board : null,
);
const device = computed(() => (session.known?.kind === 'catcard' ? 'CatCard' : 'Coldcard'));
const allTicked = computed(() => ticks.value.every(Boolean));
const kb = (n: number) => `${Math.round(n / 1024).toLocaleString()} KB`;

async function check(): Promise<void> {
  error.value = null;
  step.value = 'checking';
  try {
    const bytes = await props.fetchImage((got, total) => (download.value = { got, total }));
    const { image } = parseDfu(bytes);
    const header = parseHeader(image);
    checked.value = { image, header, problems: checkImage(image, header, hardware.value) };
    step.value = 'checked';
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    step.value = 'ready';
  }
}

async function install(): Promise<void> {
  const c = checked.value;
  if (!c || c.problems.length || !allTicked.value) return;
  error.value = null;
  step.value = 'installing';
  progress.value = { stage: 'upload', sent: 0, total: c.image.length };
  try {
    await installImage(props.target, c.image, c.header.raw, (p) => (progress.value = p));
    step.value = 'sent';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error.value = /Nothing was installed/.test(msg)
      ? msg
      : `The install stopped: ${msg.replace(/\.$/, '')}. Nothing was installed. Check the ${device.value}'s screen, then try again.`;
    step.value = 'checked';
  }
}

const downloadText = computed(() =>
  download.value.total ? `Downloading ${kb(download.value.got)} of ${kb(download.value.total)}` : `Downloading ${kb(download.value.got)}`,
);

const stageText = computed(() => {
  const p = progress.value;
  if (!p) return '';
  switch (p.stage) {
    case 'upload':
      return `Sending ${kb(p.sent)} of ${kb(p.total)}. Keep the ${device.value} plugged in.`;
    case 'verify':
      return `Checking what the ${device.value} received. Keep it plugged in.`;
    case 'trailer':
      return 'Sending the signature header. Keep it plugged in.';
    case 'inspect':
      return 'The CatCard is checking the image it received.';
    case 'approve': {
      const notes = [p.offer?.older ? 'The CatCard notes this is older than the firmware it runs.' : '', p.offer && !p.offer.verified ? 'The CatCard does not recognise the key this image is signed with.' : '']
        .filter(Boolean)
        .join(' ');
      return `Approve the install on the CatCard's screen, or refuse it there.${notes ? ` ${notes}` : ''}`;
    }
    case 'reboot':
      return `The ${device.value} is restarting to install.`;
  }
  return '';
});
const percent = computed(() => (progress.value ? Math.round((progress.value.sent / Math.max(1, progress.value.total)) * 100) : 0));
const waitingOnPerson = computed(() => progress.value?.stage === 'approve');
</script>

<template>
  <div class="steps">
    <p class="file">
      <span class="mono">{{ fileName }}</span>
      <span v-if="fileSize">{{ kb(fileSize) }}</span>
    </p>

    <button v-if="step === 'ready' || step === 'checking'" class="primary" type="button" :disabled="step === 'checking'" @click="check">
      {{ step === 'checking' ? downloadText : 'Download and check' }}
    </button>

    <div v-if="checked && (step === 'checked' || step === 'installing')" class="checked">
      <h3>{{ checked.problems.length ? 'This image cannot be installed' : 'Image checked' }}</h3>
      <dl class="facts">
        <div>
          <dt>Firmware</dt>
          <dd class="mono">{{ checked.header.version }}</dd>
        </div>
        <div>
          <dt>Built</dt>
          <dd class="mono">{{ checked.header.built }}</dd>
        </div>
        <div>
          <dt>Runs on</dt>
          <dd>{{ compatibleHardware(checked.header.hwCompat).join(', ') || 'any' }}</dd>
        </div>
        <div>
          <dt>Signed with</dt>
          <dd>{{ signerText(checked.header.pubkeyNum) }}</dd>
        </div>
        <div>
          <dt>Checksum</dt>
          <dd>{{ checksumText }}</dd>
        </div>
      </dl>
      <ul v-if="checked.problems.length" class="problems">
        <li v-for="p in checked.problems" :key="p">{{ p }}</li>
      </ul>

      <template v-else>
        <ul v-if="notes?.length" class="notes">
          <li v-for="n in notes" :key="n">{{ n }}</li>
        </ul>
        <p class="hint">The {{ device }} must be unlocked with its PIN, and left on its main menu, while the image is sent.</p>
        <label v-for="(a, i) in agreements" :key="a" class="agree">
          <input v-model="ticks[i]" type="checkbox" :disabled="step === 'installing'" />
          <span>{{ a }}</span>
        </label>
        <button v-if="step === 'checked'" class="primary" type="button" :disabled="!allTicked" @click="install">
          {{ installLabel }}
        </button>
      </template>
    </div>

    <div v-if="step === 'installing'" class="progress" role="status" aria-live="polite">
      <div v-if="!waitingOnPerson" class="bar"><div class="fill" :style="{ width: `${percent}%` }" /></div>
      <p :class="{ ask: waitingOnPerson }">{{ stageText }}</p>
    </div>

    <div v-if="step === 'sent'" class="sent" role="status">
      <h3>Sent. The {{ device }} is restarting to install it.</h3>
      <p>Watch its screen and follow what it asks.</p>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.steps {
  display: grid;
  gap: 1rem;
  justify-items: start;
  width: 100%;
}

h3 {
  font-size: 1.15rem;
  font-weight: 700;
}

.hint {
  color: var(--muted);
}

.file {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  color: var(--muted);
  overflow-wrap: anywhere;
}

.checked {
  display: grid;
  gap: 1rem;
  justify-items: start;
  width: 100%;
}

.facts {
  margin: 0;
  width: 100%;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 0.9rem 2rem;
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
}

.problems {
  margin: 0;
  color: var(--hazard);
}

.notes {
  margin: 0;
  padding-left: 1.2rem;
  color: var(--cat-text);
}

.agree {
  display: flex;
  gap: 0.55rem;
  align-items: baseline;
  cursor: pointer;
}

input[type='checkbox'] {
  accent-color: var(--cat);
  transform: translateY(0.1em);
}

.progress {
  width: 100%;
  display: grid;
  gap: 0.5rem;
}

.bar {
  height: 0.7rem;
  border-radius: 999px;
  background: var(--surface);
  border: 1.5px solid var(--line);
  overflow: hidden;
}

.fill {
  height: 100%;
  background: var(--cat);
  transition: width 200ms linear;
}

.ask {
  font-weight: 700;
  font-size: 1.1rem;
}

.sent {
  display: grid;
  gap: 0.5rem;
  border-left: 4px solid var(--ok);
  padding-left: 1rem;
}

.error {
  border-left: 4px solid var(--hazard);
  padding: 0.5rem 0.9rem;
  color: var(--hazard);
  background: var(--surface);
}
</style>

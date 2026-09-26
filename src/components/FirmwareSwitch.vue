<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  BOARD_LABELS,
  boardFor,
  downloadImage,
  loadReleases,
  pickImage,
  sha256,
  type Board,
  type FirmwareImage,
  type FirmwareRelease,
} from '../firmware/catalog';
import { parseDfu } from '../firmware/dfu';
import { checkImage, compatibleHardware, parseHeader, type FirmwareHeader } from '../firmware/header';
import type { InstallProgress } from '../protocol/coldcard';
import { runInstall, session } from '../session';

type Step = 'offer' | 'choose' | 'checking' | 'checked' | 'installing' | 'sent';

const step = ref<Step>('offer');
const error = ref<string | null>(null);
const releases = ref<FirmwareRelease[] | null>(null);
const releaseTag = ref('');
const chosenBoard = ref<Board | null>(null);
const bitcoinOnly = ref(true);
const games = ref(false);
const download = ref({ got: 0, total: 0 });
const checked = ref<{ image: Uint8Array; header: FirmwareHeader; file: FirmwareImage; problems: string[] } | null>(null);
const agreed = ref(false);
const acceptedRisk = ref(false);
const progress = ref<InstallProgress | null>(null);

const hardware = computed(() => (session.info?.kind === 'coldcard' ? session.info.version.hardware : null));
const detectedBoard = computed(() => boardFor(hardware.value));
const board = computed<Board | null>(() => detectedBoard.value ?? chosenBoard.value);
const release = computed(() => releases.value?.find((r) => r.tag === releaseTag.value) ?? null);
const image = computed(() => (release.value && board.value ? pickImage(release.value, board.value, bitcoinOnly.value, games.value) : null));

const kb = (n: number) => `${Math.round(n / 1024).toLocaleString()} KB`;

async function open(): Promise<void> {
  error.value = null;
  step.value = 'choose';
  if (releases.value) return;
  try {
    releases.value = await loadReleases();
    releaseTag.value = releases.value[0]?.tag ?? '';
    if (!releaseTag.value) error.value = 'No CatCard release is available yet.';
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

// A different choice invalidates a checked image.
watch([releaseTag, board, bitcoinOnly, games], () => {
  if (step.value === 'checked') step.value = 'choose';
  checked.value = null;
  agreed.value = false;
  acceptedRisk.value = false;
});

async function check(): Promise<void> {
  const file = image.value;
  if (!file) return;
  error.value = null;
  step.value = 'checking';
  download.value = { got: 0, total: file.size };
  try {
    const bytes = await downloadImage(file, (got, total) => (download.value = { got, total }));
    const { image: img } = parseDfu(bytes);
    const header = parseHeader(img);
    const problems = checkImage(img, header, hardware.value);
    checked.value = { image: img, header, file, problems };
    step.value = 'checked';
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    step.value = 'choose';
  }
}

async function install(): Promise<void> {
  const c = checked.value;
  if (!c || c.problems.length || !agreed.value || !acceptedRisk.value) return;
  error.value = null;
  step.value = 'installing';
  progress.value = { stage: 'upload', sent: 0, total: c.image.length };
  try {
    await runInstall((cc) => cc.installFirmware(c.image, c.header.raw, sha256, (p) => (progress.value = p)));
    step.value = 'sent';
  } catch (err) {
    error.value = `The install stopped: ${err instanceof Error ? err.message : String(err)}. Nothing was installed. Check the Coldcard's screen, then try again.`;
    step.value = 'checked';
  }
}

const stageText = computed(() => {
  const p = progress.value;
  if (!p) return '';
  switch (p.stage) {
    case 'upload':
      return `Sending ${kb(p.sent)} of ${kb(p.total)}`;
    case 'verify':
      return 'Checking what the Coldcard received';
    case 'trailer':
      return 'Sending the signature header';
    case 'reboot':
      return 'Asking the Coldcard to restart and install';
  }
  return '';
});
const percent = computed(() => (progress.value ? Math.round((progress.value.sent / progress.value.total) * 100) : 0));
</script>

<template>
  <section class="switch" aria-labelledby="switch-title">
    <h2 id="switch-title">Switch this Coldcard to CatCard</h2>
    <p class="intro">
      CatCard is open-source firmware for Coldcard hardware. Installing it replaces the Coldcard firmware on this device.
    </p>

    <button v-if="step === 'offer'" class="primary" type="button" @click="open">Choose a CatCard version</button>

    <template v-else>
      <ul class="warnings">
        <li class="severe">
          <strong>Installing CatCard can permanently break this Coldcard.</strong> A Coldcard is designed to lock itself
          up for good when anything looks even slightly wrong, and nobody can repair it after that. Only continue with a
          device you can afford to lose.
        </li>
        <li>CatCard is early software. Do not keep funds on a device running it.</li>
        <li>Write down this wallet's seed words before you start, and keep them whatever happens.</li>
        <li>
          The Coldcard will show a red light and a warning screen each time it starts, because CatCard is not signed by the
          maker. That is expected.
        </li>
        <li>To go back, install stock firmware from CatCard's upgrade screen, over USB or from a microSD card.</li>
      </ul>

      <fieldset v-if="releases && step !== 'sent'" class="choices" :disabled="step === 'checking' || step === 'installing'">
        <div v-if="releases.length > 1" class="field">
          <label for="rel">Version</label>
          <select id="rel" v-model="releaseTag">
            <option v-for="r in releases" :key="r.tag" :value="r.tag">
              {{ r.name }}{{ r.prerelease ? ' (pre-release)' : '' }}
            </option>
          </select>
        </div>
        <p v-else-if="release">
          Version: <strong>{{ release.name }}</strong>{{ release.prerelease ? ', a pre-release.' : '.' }}
          <a :href="release.url" target="_blank" rel="noopener">Release notes</a>
        </p>

        <div class="field">
          <span class="legend">Hardware</span>
          <p v-if="detectedBoard">This Coldcard reports itself as {{ hardware }}. The {{ BOARD_LABELS[detectedBoard] }} image will be used.</p>
          <template v-else>
            <p class="hint">This Coldcard did not report its model. Pick the one printed on it.</p>
            <div class="options">
              <label v-for="(label, b) in BOARD_LABELS" :key="b">
                <input v-model="chosenBoard" type="radio" name="board" :value="b" />
                {{ label }}
              </label>
            </div>
          </template>
        </div>

        <div class="field">
          <span class="legend">Coins</span>
          <div class="options">
            <label>
              <input v-model="bitcoinOnly" type="radio" name="chains" :value="true" />
              Bitcoin only
            </label>
            <label>
              <input v-model="bitcoinOnly" type="radio" name="chains" :value="false" />
              Bitcoin and other chains, including Ethereum and Solana
            </label>
          </div>
        </div>

        <div class="field">
          <span class="legend">Games</span>
          <div class="options">
            <label>
              <input v-model="games" type="radio" name="games" :value="false" />
              Leave the games out
            </label>
            <label>
              <input v-model="games" type="radio" name="games" :value="true" />
              Include the games
            </label>
          </div>
        </div>

        <p v-if="image" class="file">
          <span class="mono">{{ image.file }}</span>
          <span>{{ kb(image.size) }}</span>
        </p>
        <p v-else-if="release && board" class="hint">This release has no image for that combination.</p>

        <button v-if="step === 'choose' || step === 'checking'" class="primary" type="button" :disabled="!image || step === 'checking'" @click="check">
          {{ step === 'checking' ? `Downloading ${kb(download.got)} of ${kb(download.total)}` : 'Download and check' }}
        </button>
      </fieldset>

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
            <dd>{{ checked.header.pubkeyNum === 0 ? 'the published developer key' : `key ${checked.header.pubkeyNum}` }}</dd>
          </div>
          <div>
            <dt>Checksum</dt>
            <dd>matches GitHub's</dd>
          </div>
        </dl>
        <ul v-if="checked.problems.length" class="problems">
          <li v-for="p in checked.problems" :key="p">{{ p }}</li>
        </ul>

        <template v-else>
          <p class="hint">The Coldcard must be unlocked with its PIN, and left on its main menu, while the image is sent.</p>
          <label class="agree">
            <input v-model="agreed" type="checkbox" :disabled="step === 'installing'" />
            I have written down my seed words, and I understand CatCard is not ready to hold funds.
          </label>
          <label class="agree">
            <input v-model="acceptedRisk" type="checkbox" :disabled="step === 'installing'" />
            <span>
              I accept that installing CatCard may make this Coldcard permanently unusable. I install it at my own risk.
              Tibane Labs and the people behind CatCard are not responsible for any Coldcard that is lost, damaged or
              made unusable, or for anything stored on it.
            </span>
          </label>
          <button v-if="step === 'checked'" class="primary" type="button" :disabled="!agreed || !acceptedRisk" @click="install">
            Install CatCard
          </button>
        </template>
      </div>

      <div v-if="step === 'installing'" class="progress" role="status" aria-live="polite">
        <div class="bar"><div class="fill" :style="{ width: `${percent}%` }" /></div>
        <p>{{ stageText }}. Keep the Coldcard plugged in.</p>
      </div>

      <div v-if="step === 'sent'" class="sent" role="status">
        <h3>Sent. The Coldcard is restarting to install CatCard.</h3>
        <p>
          Watch its screen and follow what it asks. When CatCard starts, connect it here again. It appears under a new name,
          so the browser will ask for permission once more.
        </p>
      </div>
    </template>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.switch {
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

h3 {
  font-size: 1.15rem;
  font-weight: 700;
}

.intro,
.hint {
  color: var(--muted);
}

.warnings .severe {
  color: var(--hazard);
}

.warnings {
  margin: 0;
  padding: 0.9rem 1.1rem 0.9rem 2.2rem;
  border-left: 4px solid var(--cat);
  background: var(--surface);
  display: grid;
  gap: 0.35rem;
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
  gap: 0.35rem;
}

.legend,
.field > label {
  font-weight: 700;
}

.options {
  display: grid;
  gap: 0.3rem;
}

.options label,
.agree {
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
  padding: 0.4rem 0.6rem;
  border-radius: 8px;
  border: 1.5px solid var(--line);
  background: var(--surface);
  color: var(--ink);
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

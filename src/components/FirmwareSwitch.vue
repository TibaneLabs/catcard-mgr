<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { panelRequest } from '../panels';
import { caps } from '../protocol/catcard';
import { BOARD_LABELS, boardFor, downloadImage, loadReleases, pickImage, type Board, type FirmwareRelease } from '../firmware/catalog';
import { session } from '../session';
import InstallSteps from './InstallSteps.vue';

const open = ref(false);
const error = ref<string | null>(null);
const releases = ref<FirmwareRelease[] | null>(null);
const releaseTag = ref('');
const chosenBoard = ref<Board | null>(null);
const bitcoinOnly = ref(true);
const games = ref(false);

/** On a CatCard this panel updates CatCard; on a Coldcard it replaces the stock firmware. */
const onCatCard = computed(() => session.info?.kind === 'catcard');
const canInstall = computed(() => session.info?.kind !== 'catcard' || (session.info.identify.caps & caps.UPGRADE) !== 0);
const hardware = computed(() =>
  session.info?.kind === 'coldcard' ? session.info.version.hardware : session.info?.kind === 'catcard' ? session.info.identify.board : null,
);
const running = computed(() => (session.info?.kind === 'catcard' ? session.info.identify.version : ''));
const detectedBoard = computed(() => boardFor(hardware.value));
const board = computed<Board | null>(() => detectedBoard.value ?? chosenBoard.value);
const release = computed(() => releases.value?.find((r) => r.tag === releaseTag.value) ?? null);
const image = computed(() => (release.value && board.value ? pickImage(release.value, board.value, bitcoinOnly.value, games.value) : null));

const agreements = computed(() =>
  onCatCard.value
    ? ['I have written down my seed words, and I understand CatCard is not ready to hold funds.']
    : [
        'I have written down my seed words, and I understand CatCard is not ready to hold funds.',
        'I accept that installing CatCard may make this Coldcard permanently unusable. I install it at my own risk. Tibane Labs and the people behind CatCard are not responsible for any Coldcard that is lost, damaged or made unusable, or for anything stored on it.',
      ],
);
const signer = (n: number) => (n === 0 ? 'the published developer key' : `key ${n}`);

async function start(): Promise<void> {
  error.value = null;
  open.value = true;
  if (releases.value) return;
  try {
    releases.value = await loadReleases();
    releaseTag.value = releases.value[0]?.tag ?? '';
    if (!releaseTag.value) error.value = 'No CatCard release is available yet.';
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

const root = ref<HTMLElement | null>(null);
watch(panelRequest, async (r) => {
  if (r?.name !== 'catcard-switch') return;
  await start();
  await nextTick();
  root.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
</script>

<template>
  <section ref="root" class="switch" aria-labelledby="switch-title">
    <h2 id="switch-title">{{ onCatCard ? 'Update CatCard' : 'Switch this Coldcard to CatCard' }}</h2>
    <p v-if="onCatCard" class="intro">
      Install another CatCard release. This one runs {{ running || 'an unknown version' }}. The CatCard shows what it
      received and installs nothing until you approve it there.
    </p>
    <p v-else class="intro">
      CatCard is open-source firmware for Coldcard hardware. Installing it replaces the Coldcard firmware on this device.
    </p>

    <p v-if="!canInstall" class="hint">This CatCard cannot take a firmware over USB.</p>
    <button v-else-if="!open" class="primary" type="button" @click="start">Choose a CatCard version</button>

    <template v-else>
      <ul v-if="onCatCard" class="warnings">
        <li>CatCard is early software. Do not keep funds on a device running it.</li>
        <li>Write down this wallet's seed words before you start, and keep them whatever happens.</li>
      </ul>
      <ul v-else class="warnings">
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

      <fieldset v-if="releases" class="choices" :disabled="session.installing">
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
          <p v-if="detectedBoard">This {{ onCatCard ? 'CatCard' : 'Coldcard' }} reports itself as {{ hardware }}. The {{ BOARD_LABELS[detectedBoard] }} image will be used.</p>
          <template v-else>
            <p class="hint">This device did not report its model. Pick the one printed on it.</p>
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

        <p v-if="!image && release && board" class="hint">This release has no image for that combination.</p>
      </fieldset>

      <InstallSteps
        v-if="image"
        :key="image.file"
        :file-name="image.file"
        :file-size="image.size"
        :fetch-image="(progress) => downloadImage(image!, progress)"
        checksum-text="matches GitHub's"
        :signer-text="signer"
        :agreements="agreements"
        target="catcard"
        :install-label="onCatCard ? 'Install this version' : 'Install CatCard'"
      />
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

.options label {
  display: flex;
  gap: 0.55rem;
  align-items: baseline;
  cursor: pointer;
}

input[type='radio'] {
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











.error {
  border-left: 4px solid var(--hazard);
  padding: 0.5rem 0.9rem;
  color: var(--hazard);
  background: var(--surface);
}
</style>

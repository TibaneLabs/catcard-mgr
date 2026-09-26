<script setup lang="ts">
import { onMounted } from 'vue';
import logo from './assets/catcard-icon.svg';
import DeviceFigure from './components/DeviceFigure.vue';
import IdentityPanel from './components/IdentityPanel.vue';
import DiagnosticsPanel from './components/DiagnosticsPanel.vue';
import FirmwareSwitch from './components/FirmwareSwitch.vue';
import Unsupported from './components/Unsupported.vue';
import { connect, disconnect, reconnectGranted, session } from './session';

onMounted(() => {
  void reconnectGranted();
});
</script>

<template>
  <header class="bar">
    <div class="brand">
      <img :src="logo" alt="" width="36" height="36" />
      <span>CatCard Manager</span>
    </div>
    <button v-if="session.phase === 'ready'" type="button" @click="disconnect">Disconnect</button>
  </header>

  <main>
    <Unsupported v-if="!session.supported" />
    <template v-else>
      <section class="stage">
        <DeviceFigure />
        <div class="stage-text">
          <template v-if="session.phase === 'ready' && session.info">
            <IdentityPanel />
          </template>
          <template v-else-if="session.phase === 'connecting'">
            <h1>Talking to your {{ session.known?.label ?? 'device' }}…</h1>
            <p class="lede">Asking it who it is. If the device is asleep or locked on a screen, wake it up.</p>
          </template>
          <template v-else-if="session.restarted">
            <h1>Your Coldcard is installing CatCard</h1>
            <p class="lede">
              Follow what its screen asks. When CatCard has started, connect it here. The browser will ask for permission
              again, because the device now has a new name.
            </p>
            <button class="primary big" type="button" @click="connect">Connect CatCard</button>
          </template>
          <template v-else>
            <h1>Plug in your CatCard or Coldcard</h1>
            <p class="lede">
              Connect it by USB, then choose it from the list your browser shows. This page talks to the device directly
              from your browser. Nothing is sent anywhere else.
            </p>
            <button class="primary big" type="button" @click="connect">Connect a device</button>
          </template>
          <p v-if="session.error" class="error" role="alert">{{ session.error }}</p>
        </div>
      </section>

      <FirmwareSwitch v-if="session.phase === 'ready' && session.known?.kind === 'coldcard'" />
      <DiagnosticsPanel v-if="session.phase === 'ready'" />
    </template>
  </main>

  <footer class="foot">
    <p>
      Works in Chrome, Edge, Opera and Brave on desktop, which support WebHID.
      <a href="https://github.com/TibaneLabs/catcard-mgr">Source on GitHub</a>
    </p>
  </footer>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem clamp(1rem, 4vw, 2.5rem);
  border-bottom: 1.5px solid var(--line);
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-family: var(--display-font);
  font-weight: 700;
  font-size: 1.2rem;
}

main {
  max-width: 72rem;
  margin: 0 auto;
  padding: clamp(1.5rem, 5vw, 4rem) clamp(1rem, 4vw, 2.5rem);
  display: grid;
  gap: 3rem;
}

.stage {
  display: grid;
  grid-template-columns: minmax(12rem, 20rem) 1fr;
  gap: clamp(2rem, 6vw, 5rem);
  align-items: start;
}

.stage-text {
  display: grid;
  gap: 1.25rem;
  align-content: start;
  max-width: 40rem;
}

h1 {
  font-size: clamp(2rem, 4.5vw, 3.2rem);
  font-weight: 750;
  letter-spacing: -0.02em;
}

.lede {
  font-size: 1.15rem;
  color: var(--muted);
  max-width: 34em;
}

.big {
  justify-self: start;
  padding: 0.75rem 1.6rem;
  font-size: 1.05rem;
}

.error {
  border-left: 4px solid var(--hazard);
  padding: 0.5rem 0.9rem;
  color: var(--hazard);
  background: var(--surface);
}

.foot {
  border-top: 1.5px solid var(--line);
  padding: 1.25rem clamp(1rem, 4vw, 2.5rem);
  color: var(--muted);
  font-size: 0.9rem;
}

.foot p {
  max-width: 72rem;
  margin: 0 auto;
}

.foot a {
  margin-left: 0.5rem;
}

@media (max-width: 720px) {
  .stage {
    grid-template-columns: 1fr;
  }
  .stage :deep(.figure) {
    max-width: 14rem;
    margin: 0 auto;
  }
}
</style>

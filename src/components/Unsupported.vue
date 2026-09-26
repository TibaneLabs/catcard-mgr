<template>
  <section class="unsupported">
    <h1>This browser cannot reach USB devices</h1>
    <p>
      CatCard Manager talks to your device with WebHID, which only Chromium-based desktop browsers provide: Chrome, Edge,
      Opera and Brave. Firefox and Safari do not support it.
    </p>
    <p>Open this page in one of those browsers. The page must be served over HTTPS, or from localhost.</p>
  </section>
</template>

<style scoped>
.unsupported {
  display: grid;
  gap: 1rem;
  max-width: 40rem;
}

h1 {
  font-size: clamp(2rem, 4.5vw, 3rem);
  font-weight: 750;
  letter-spacing: -0.02em;
}

p {
  font-size: 1.1rem;
  color: var(--muted);
}
</style>

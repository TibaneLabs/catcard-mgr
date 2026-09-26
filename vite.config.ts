import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// GitHub Pages serves a project site under `/<repo>/`; the workflow sets BASE_PATH to
// that. Locally, and on a custom domain, the app lives at the root.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [vue()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});

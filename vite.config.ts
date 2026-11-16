import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { forge } from './forge/server/plugin';

export default defineConfig({
  // The forge plugin applies to the dev server only, and forge/index.html is
  // not a build input, so `vite build` produces the game alone.
  plugins: [svelte(), forge()],
  base: './',
  // Port 5600 belongs to this repository. Port 5173 belongs to the old
  // repository. strictPort makes a busy port an error instead of a silent move
  // to another port.
  server: { port: 5600, strictPort: true },
  preview: { port: 5601, strictPort: true },
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});

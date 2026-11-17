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
    // Two projects. `unit` is every test file but the offline budgets, in
    // parallel workers. `budget` is tests/budgets.test.ts alone: its cases
    // measure wall-clock time, so they do not share the processor with other
    // test files. `npm test` runs one project after the other.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/budgets.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'budget',
          include: ['tests/budgets.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});

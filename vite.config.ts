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
    // Five projects. `unit` is every test file but the offline budgets, the
    // speed test and the John climbs, in parallel workers. `budget`,
    // `budget-world` and `speed` are one file each: their cases measure
    // wall-clock time, so they do not share the processor with other test
    // files. `speed` holds catch-up to a share of the old build's time
    // (docs/PERFORMANCE.md section 5); it starts one Node process per
    // attempt, one after the other. `john` runs the headless
    // climbs, whose load made timed unit cases time out when they ran in
    // parallel, and the outcome digests of John's climbs. `npm test` runs one
    // project after the other.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts'],
          exclude: [
            'tests/budgets.test.ts',
            'tests/budgetsWorld.test.ts',
            'tests/speed.test.ts',
            'tests/john.test.ts',
            'tests/outcome.test.ts',
          ],
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
      {
        extends: true,
        test: {
          name: 'budget-world',
          include: ['tests/budgetsWorld.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'speed',
          include: ['tests/speed.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'john',
          include: ['tests/john.test.ts', 'tests/outcome.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});

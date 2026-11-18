// Runs the offline budget runs (tests/budgetRuns.ts) and John's climbs, and
// prints each one's wall-clock time and outcome digest as JSON. Used to
// record the digests of `tests/outcome.test.ts` and to profile catch-up:
//
//   npx vite-node scripts/budget-runs.ts                     all six runs and John 42, 7, 1234
//   npx vite-node scripts/budget-runs.ts -- floor6 world4    named runs only
//   npx vite-node scripts/budget-runs.ts -- john             John only
//   node --cpu-prof --cpu-prof-dir=<dir> node_modules/vite-node/vite-node.mjs scripts/budget-runs.ts -- world6
//
// This only prints.

import { performance } from 'node:perf_hooks';
import { digestOf, RUN_NAMES, RUNS, type RunName } from '../tests/budgetRuns';
import { johnDigest, JOHN_SEEDS } from '../tests/johnDigest';

const args = process.argv.slice(2).filter((a) => a !== '--');
const names = args.length ? args : [...RUN_NAMES, 'john'];

for (const name of names) {
  if (name === 'john') {
    for (const seed of JOHN_SEEDS) {
      const started = performance.now();
      const digest = johnDigest(seed);
      const ms = Math.round(performance.now() - started);
      console.log(JSON.stringify({ run: `john${seed}`, ms, digest }));
    }
    continue;
  }
  if (!(RUN_NAMES as string[]).includes(name)) throw new Error(`unknown run "${name}"`);
  const result = RUNS[name as RunName]();
  console.log(JSON.stringify({ run: name, ms: Math.round(result.ms), casts: result.casts, digest: digestOf(result.envelope) }));
}

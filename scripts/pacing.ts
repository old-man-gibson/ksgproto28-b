// Sends John (tests/john.ts) up floors 0 to 6, headless, and prints a
// per-floor table for each climb: when each stretch finished, the knockouts,
// the boss tries, the level and the gold. Port of the old `scripts/pacing.ts`
// (band 1 and band 2 only). This only prints.
//
//   npm run pacing                                  John (skip), seeds 42, 7, 1234, through floor 6
//   npm run pacing -- --seeds 1,2,3                 other seeds
//   npm run pacing -- --weapons skip,sword          rack picks instead of the skip
//   npm run pacing -- --through 3                   band 1 only
//   npm run pacing -- --attentive                   explore first

import { performance } from 'node:perf_hooks';
import { climbTable, runJohn } from '../tests/john';

const args = process.argv.slice(2);
const list = (flag: string, fallback: string) => {
  const i = args.indexOf(flag);
  return (i >= 0 && args[i + 1] ? args[i + 1] : fallback).split(',').filter(Boolean);
};
const seeds = list('--seeds', '42,7,1234').map(Number);
const weapons = list('--weapons', 'skip');
const through = Number(list('--through', '6')[0]);
const attentive = args.includes('--attentive');

for (const seed of seeds) {
  for (const weapon of weapons) {
    const started = performance.now();
    const r = runJohn({ seed, weapon, through, attentive });
    const ms = Math.round(performance.now() - started);
    console.log(`\n${climbTable(r)}\n(${ms} ms of wall clock)`);
  }
}

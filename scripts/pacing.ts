// Sends John (tests/john.ts) up floors 0 to 10, headless, and prints a
// per-floor table for each climb: when each stretch finished, the knockouts,
// the boss tries, the level and the gold. Port of the old `scripts/pacing.ts`
// (bands 1 to 3: run 1, the prestige, run 2 to floor 10). This only prints.
//
//   npm run pacing                                  John (skip), seeds 42, 7, 1234, through floor 6
//   npm run pacing -- --seeds 1,2,3                 other seeds
//   npm run pacing -- --weapons skip,sword          rack picks instead of the skip
//   npm run pacing -- --through 3                   band 1 only
//   npm run pacing -- --attentive                   explore first
//   npm run pacing -- --through 10                  the prestige, run 2: floors 1 to 6 again, band 3's wards
//   npm run pacing -- --through 10 --wards 10,9,8,7 band 3's wards in this order (default 7,8,9,10)
//   npm run pacing -- --through 10 --cap 120        a floor past 6 still open after 120 minutes of game
//                                                   time is a wall (default 240); past it John takes the
//                                                   debug skip and later floors read "measured after skip"

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
const wards = list('--wards', '7,8,9,10').map(Number);
const capMinutes = Number(list('--cap', '240')[0]);

for (const seed of seeds) {
  for (const weapon of weapons) {
    const started = performance.now();
    const r = runJohn({ seed, weapon, through, attentive, wards, floorCap: capMinutes * 60 * 10 });
    const ms = Math.round(performance.now() - started);
    console.log(`\n${climbTable(r)}\n(${ms} ms of wall clock)`);
  }
}

// Sends John (tests/john.ts) up floors 0 to 17, headless, and prints a
// per-floor table for each climb: when each stretch finished, the knockouts,
// the boss tries, the level and the gold. Port of the old `scripts/pacing.ts`
// (bands 1 to 6: run 1, the prestige, run 2 to floor 10, the siege of floor
// 11, run 3 to the harbor's floor 14, the festival's floors 15 and 16 and the
// Malgeri Crossing, floor 17). This only prints.
//
//   npm run pacing                                  John (skip), seeds 42, 7, 1234, through floor 6
//   npm run pacing -- --seeds 1,2,3                 other seeds
//   npm run pacing -- --weapons skip,sword          rack picks instead of the skip
//   npm run pacing -- --through 3                   band 1 only
//   npm run pacing -- --attentive                   explore first
//   npm run pacing -- --through 10                  the prestige, run 2: floors 1 to 6 again, band 3's wards
//   npm run pacing -- --through 10 --wards 10,9,8,7 band 3's wards in this order (default 7,8,9,10)
//   npm run pacing -- --through 11                  and the siege of floor 11, which ends run 2, then run 3
//                                                   to floor 11 of the harbor
//   npm run pacing -- --through 14                  run 3 to floor 14, the harbor's final mission
//   npm run pacing -- --through 14 --side navy      the harbor side John signs with (default merchants)
//   npm run pacing -- --through 15                  run 3 to floor 15, the festival's dark room
//   npm run pacing -- --through 16                  run 3 to floor 16, the festival's royale
//   npm run pacing -- --through 17                  run 3 to floor 17, the Malgeri Crossing; prints a
//                                                   floor 17 line: the peak's and the gate's tries, the
//                                                   calm minutes and the fights against calm lines
//   npm run pacing -- --through 17 --malgeri-calm   floor 17 arranged under a calm: the clock jumps to the
//                                                   range's next calm and John's den is the open east ridge
//   npm run pacing -- --through 10 --cap 120        a floor past 6 still open after 120 minutes of game
//                                                   time is a wall (default 240); past it John takes the
//                                                   debug skip and later floors read "measured after skip"

import { performance } from 'node:perf_hooks';
import { climbTable, clock, runJohn } from '../tests/john';

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
const side = list('--side', 'merchants')[0];
const calmAtMalgeri = args.includes('--malgeri-calm');

for (const seed of seeds) {
  for (const weapon of weapons) {
    const started = performance.now();
    const r = runJohn({ seed, weapon, through, attentive, wards, side, calmAtMalgeri, floorCap: capMinutes * 60 * 10 });
    const ms = Math.round(performance.now() - started);
    console.log(`\n${climbTable(r)}`);
    // Floor 17 (the old pacing's line): the two bosses told apart, and the calm lines.
    if (r.done.floor17 !== null) {
      const m = r.malgeri;
      const gateTries = r.bossTries.floor17 - m.peakFights;
      const gateLost = r.bossLost.floor17 - m.peakLost;
      const calmMin = (n: number) => `${(n / 600).toFixed(0)}m`;
      console.log(
        `  floor 17: ${clock((r.done.floor17 ?? 0) - (r.done.floor16 ?? 0))} on the floor, ${r.knockouts.floor17} knockouts, left at level ${r.levels.floor17}; ` +
          `peak ${m.peakFights} tries/${m.peakLost} lost, gate ${gateTries} tries/${gateLost} lost; ` +
          `calm: ${calmMin(m.inSpell)} of the stay inside a calm spell, ${calmMin(m.underOpenSky)} under the open sky, ` +
          `${m.calmFights} fights against calm lines, ${m.calmFights - m.calmLost} won`,
      );
    }
    console.log(`(${ms} ms of wall clock)`);
  }
}

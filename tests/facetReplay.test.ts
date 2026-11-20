import { describe, expect, it } from 'vitest';
import { CORE } from '../src/systems/facet';

// Skipped without the Facet core (docs/SETUP.md); tests/facet.test.ts says so.
import { catchUp } from '../src/kernel';
import { systems } from '../src/systems';
import { holding, intoFight } from './facetHelpers';
import { makeGame } from './helpers';

/**
 * With an ability held, the game stays a replay: a run split by a save and a
 * load, and the same run through catch-up, end on the same state as the run
 * in one piece (docs/KERNEL.md section 4). The core attaches again after the
 * load; nothing it keeps outside the save may change the outcome.
 */
describe.skipIf(!CORE)('Facet on: determinism', () => {
  for (const ability of ['little_moons', 'bramble', 'solar_charge', 'calorie_burn', 'weakest_weapon_master']) {
    it(`${ability}: a save and a load in the middle change nothing`, () => {
      const whole = holding(ability, { weapon: true });
      intoFight(whole);
      const start = JSON.parse(JSON.stringify(whole.save(0)));
      for (let t = 0; t < 3_000; t++) whole.tick();

      const split = makeGame({ seed: 1 });
      expect(split.load(JSON.parse(JSON.stringify(start))).ok).toBe(true);
      for (let t = 0; t < 1_500; t++) split.tick();
      const middle = JSON.parse(JSON.stringify(split.save(0)));
      const resumed = makeGame({ seed: 2 });
      expect(resumed.load(middle).ok).toBe(true);
      for (let t = 0; t < 1_500; t++) resumed.tick();

      expect(resumed.snapshot()).toEqual(whole.snapshot());
    }, 30_000);
  }

  it('catch-up equals running in place', () => {
    const live = holding('little_moons', { weapon: true });
    intoFight(live);
    const envelope = JSON.parse(JSON.stringify(live.save(0)));
    const caught = catchUp({ systems, envelope, ticks: 2_000, now: 0 });
    for (let t = 0; t < 2_000; t++) live.tick();
    const back = makeGame({ seed: 3 });
    expect(back.load(caught).ok).toBe(true);
    expect(back.snapshot()).toEqual(live.snapshot());
  }, 30_000);
});

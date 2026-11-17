/**
 * Offline budget with fights. The old build's catch-up cost was mostly
 * combat. This runs 8 hours (288,000 ticks) of a hunt at a floor 1 table
 * through `runHeadless` and holds it to a budget set from a measurement
 * (docs/KERNEL.md section 8).
 *
 * The run: a new character with the rusty sword hunts the Vermin Hall table
 * of floor 1 with no fight limit, with the rest rule at 50%. A defeat turns
 * the hunt off (the knockout is the world port's), so the hunt command is
 * sent again every 60 seconds; it changes nothing while a hunt is on.
 */
import { describe, expect, it } from 'vitest';
import { runHeadless, type Modifier, type ScheduledCommand } from '../src/kernel';
import { hunt, setHuntRest, type EncounterSite } from '../src/systems/combat';
import { watchStatKey } from '../src/systems/martial';
import { spellCast } from '../src/systems/spellcraft';
import { combatOf, counterOf, SITES, skipsOf } from './combatHelpers';
import { equip, makeGame, setMods } from './helpers';

/**
 * Measured on 2026-11-17: 3,931 ms alone, 7,126 ms inside the full test run
 * (three 8-hour runs in parallel workers), for 9,673 kills and no defeat.
 */
const FIGHT_EIGHT_HOUR_BUDGET_MS = 12000;
const TICKS = 288_000;

const floorOne: EncounterSite = { ...SITES.f1_storerooms, fightLimit: undefined };

/**
 * Spine port 5: the Tunnels of floor 6 (goblin, hobgoblin, firetongue, witch
 * doctor, groups of up to three). Budget set from the measurement in
 * docs/KERNEL.md section 8.
 */
const CASTER_EIGHT_HOUR_BUDGET_MS = 20000;
const floorSix: EncounterSite = { ...SITES.f6_tunnels };
const FLOOR_SIX_CHARACTER: Modifier[] = [
  { stat: 'stats/maxHp', kind: 'add', value: 900 },
  { stat: 'stats/damage', kind: 'add', value: 45 },
  { stat: 'stats/armor', kind: 'add', value: 12 },
];

describe('offline catch-up with fights', () => {
  it(`simulates 8 hours of hunting a floor 1 table within ${FIGHT_EIGHT_HOUR_BUDGET_MS} ms`, () => {
    const g = makeGame({ seed: 9 });
    equip(g, 1);
    const commands: ScheduledCommand[] = [{ at: 0, command: setHuntRest({ at: 0.5, toFull: true }) }];
    for (let at = 0; at < TICKS; at += 600) commands.push({ at, command: hunt({ site: floorOne }) });

    const started = performance.now();
    runHeadless(g, { ticks: TICKS, commands });
    const elapsed = performance.now() - started;

    // The run fought for the 8 hours: thousands of kills, and a fight or a hunt at the end.
    const kills = counterOf(g, 'kills');
    console.log(`8 hours of fights: ${elapsed.toFixed(0)} ms, ${kills} kills, ${counterOf(g, 'defeats')} defeats`);
    expect(kills).toBeGreaterThan(1000);
    expect(combatOf(g).hunting).toBe(true);
    expect(g.staleStats()).toEqual([]);
    expect(elapsed, `8 hours took ${elapsed.toFixed(0)} ms`).toBeLessThan(FIGHT_EIGHT_HOUR_BUDGET_MS);
    // The test's own time limit is above the budget, so the budget is what fails.
  }, FIGHT_EIGHT_HOUR_BUDGET_MS * 3);

  it(`simulates 8 hours of hunting a floor 6 table with casters within ${CASTER_EIGHT_HOUR_BUDGET_MS} ms`, () => {
    const g = makeGame({ seed: 9 });
    equip(g, 1);
    // A character that holds floor 6: the old climb arrives there with trained
    // attributes, skills and gear the spine does not grant yet. The probe
    // stands in for them.
    setMods(g, FLOOR_SIX_CHARACTER);
    let casts = 0;
    g.onEvent((event) => {
      if (event.type === spellCast.type) casts += 1;
    });
    const commands: ScheduledCommand[] = [{ at: 0, command: setHuntRest({ at: 0.5, toFull: true }) }];
    for (let at = 0; at < TICKS; at += 600) commands.push({ at, command: hunt({ site: floorSix }) });

    const started = performance.now();
    runHeadless(g, { ticks: TICKS, commands });
    const elapsed = performance.now() - started;

    const kills = counterOf(g, 'kills');
    const techniques = ['gather', 'hamstring', 'dirty_stab', 'lunge', 'pocket_sand']
      .map((id) => counterOf(g, watchStatKey(id)))
      .reduce((a, b) => a + b, 0);
    console.log(
      `8 hours of floor 6 fights: ${elapsed.toFixed(0)} ms, ${kills} kills, ${counterOf(g, 'defeats')} defeats, ${casts} casts, ${techniques} techniques`,
    );
    // The run fought the table, and the casters and the hobgoblins used their rotations.
    expect(kills).toBeGreaterThan(1000);
    expect(counterOf(g, 'kills:goblin_witch_doctor')).toBeGreaterThan(0);
    expect(counterOf(g, 'kills:goblin_firetongue')).toBeGreaterThan(0);
    expect(casts).toBeGreaterThan(1000);
    expect(techniques).toBeGreaterThan(1000);
    expect(skipsOf(g, 'combat/rotation').filter((reason) => reason.includes('no system has registered'))).toEqual([]);
    expect(g.staleStats()).toEqual([]);
    expect(elapsed, `8 hours took ${elapsed.toFixed(0)} ms`).toBeLessThan(CASTER_EIGHT_HOUR_BUDGET_MS);
  }, CASTER_EIGHT_HOUR_BUDGET_MS * 3);
});

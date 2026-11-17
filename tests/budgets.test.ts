/**
 * The offline budgets: four runs of 8 hours (288,000 ticks), each held to a
 * wall-clock limit set from a measurement (docs/KERNEL.md section 8).
 *
 * This file is the vitest project `budget`. It runs alone, after the other
 * test files (`npm test` runs the project `unit`, then this one), and its
 * four cases run one after another. A limit here is on the simulation, not
 * on how many other test files share the processor: inside the parallel run
 * the same cases took up to three times as long and failed under load.
 *
 * - No fight, no condition: catch-up of a new game.
 * - A condition held: a timerless bleed, which deals damage on every tick.
 * - Fights at floor 1: a new character with the rusty sword hunts the Vermin
 *   Hall table with no fight limit, with the rest rule at 50%. A defeat turns
 *   the hunt off (the knockout is the world port's), so the hunt command is
 *   sent again every 60 seconds; it changes nothing while a hunt is on.
 * - Fights at floor 6: the Tunnels, with the firetongue and the witch doctor.
 */
import { describe, expect, it } from 'vitest';
import {
  catchUp,
  createKernel,
  OFFLINE_CAP_MS,
  offlineTicks,
  PLAYER,
  runHeadless,
  type Modifier,
  type ScheduledCommand,
} from '../src/kernel';
import { systems } from '../src/systems';
import { hunt, setHuntRest, type EncounterSite } from '../src/systems/combat';
import { buyStep } from '../src/systems/counter';
import { applyStatus, type StatusesState } from '../src/systems/statuses';
import { watchStatKey } from '../src/systems/martial';
import { spellCast } from '../src/systems/spellcraft';
import { combatOf, counterOf, SITES, skipsOf } from './combatHelpers';
import { ask, equip, makeGame, probe, setMods } from './helpers';

/**
 * Measured on 2026-11-17: 3,931 ms alone, 7,126 ms inside the full test run
 * (three 8-hour runs in parallel workers), for 9,673 kills and no defeat.
 * Spine port 5, same day: 4,104 ms alone, 8,781 ms inside the full run, the
 * same 9,673 kills.
 */
const FIGHT_EIGHT_HOUR_BUDGET_MS = 12000;
const TICKS = 288_000;

const floorOne: EncounterSite = { ...SITES.f1_storerooms, fightLimit: undefined };

/**
 * Spine port 5: the Tunnels of floor 6 (goblin, hobgoblin, firetongue, witch
 * doctor, groups of up to three). Measured on 2026-11-17: 11,500 to 12,400 ms
 * alone, 11,700 ms inside the full test run, for 11,231 kills, 1 defeat,
 * 1,954 casts and 1,615 techniques (docs/KERNEL.md section 8).
 */
const CASTER_EIGHT_HOUR_BUDGET_MS = 20000;
const floorSix: EncounterSite = { ...SITES.f6_tunnels };
const FLOOR_SIX_CHARACTER: Modifier[] = [
  { stat: 'stats/maxHp', kind: 'add', value: 900 },
  { stat: 'stats/damage', kind: 'add', value: 45 },
  { stat: 'stats/armor', kind: 'add', value: 12 },
];

/**
 * No fight, no condition. Raised from 2,000 in spine port 4: the combat
 * system adds a tick and three event handlers. Measured 929 ms alone then,
 * 918 ms alone in spine port 5.
 */
const EIGHT_HOUR_BUDGET_MS = 3000;

/**
 * The same span with a condition that deals damage on every tick: a
 * timerless bleed, which sends four events per tick. Measured 2,650 ms alone
 * on 2026-11-16 (1,450 ms with a condition that only changes stats), 3,650 ms
 * alone in spine port 5.
 */
const HELD_EIGHT_HOUR_BUDGET_MS = 8000;

describe('offline catch-up', () => {
  it(`simulates 8 hours of ticks within ${EIGHT_HOUR_BUDGET_MS} ms`, () => {
    const ticks = offlineTicks(OFFLINE_CAP_MS);
    expect(ticks).toBe(288_000);
    const kernel = createKernel({ systems, seed: 9 });
    kernel.tick(200);
    kernel.dispatch(buyStep({ stepId: 'small_step' }));
    const envelope = kernel.save(0);

    const started = performance.now();
    const result = catchUp({ systems, envelope, ticks, now: OFFLINE_CAP_MS });
    const elapsed = performance.now() - started;

    console.log(`8 hours, no fight: ${elapsed.toFixed(0)} ms`);
    expect((result.kernel.data as { tick: number }).tick).toBe(200 + ticks);
    expect(elapsed, `8 hours took ${elapsed.toFixed(0)} ms`).toBeLessThan(EIGHT_HOUR_BUDGET_MS);
    // The test's own time limit is above the budget, so the budget is what fails.
  }, EIGHT_HOUR_BUDGET_MS * 5);
});

describe('offline catch-up with a condition held', () => {
  it(`simulates 8 hours of a bleeding character within ${HELD_EIGHT_HOUR_BUDGET_MS} ms`, () => {
    const g = makeGame({ seed: 9 });
    ask(g, applyStatus, { entity: PLAYER, app: { id: 'bleeding', intensity: 2 } });
    ask(g, applyStatus, { entity: PLAYER, app: { id: 'tainted', intensity: 2, duration: 'permanent' } });
    const envelope = g.save(0);
    const started = performance.now();
    const result = catchUp({ systems: [...systems, probe], envelope, ticks: 288_000, now: 0 });
    const elapsed = performance.now() - started;
    console.log(`8 hours, a bleed held: ${elapsed.toFixed(0)} ms`);
    expect((result.slices.statuses.data as unknown as StatusesState).held[PLAYER].map((h) => h.id)).toEqual(['bleeding', 'tainted']);
    expect(elapsed, `8 hours took ${elapsed.toFixed(0)} ms`).toBeLessThan(HELD_EIGHT_HOUR_BUDGET_MS);
  }, HELD_EIGHT_HOUR_BUDGET_MS * 3);
});

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

/**
 * The offline budgets: four runs of 8 hours (288,000 ticks), each held to a
 * wall-clock limit set from a measurement (docs/KERNEL.md section 8). The
 * runs are in `tests/budgetRuns.ts`.
 *
 * This file is the vitest project `budget`. It runs alone, after the other
 * test files (`npm test` runs the project `unit`, then this one), and its
 * four cases run one after another. A limit here is on the simulation, not
 * on how many other test files share the processor: inside the parallel run
 * the same cases took up to three times as long and failed under load.
 *
 * - No fight, no condition: catch-up of a new game.
 * - A condition held: a timerless poison, which deals damage on every tick.
 * - Fights at floor 1: a new character with the rusty sword hunts the Vermin
 *   Hall table with no fight limit, with the rest rule at 50%. A defeat turns
 *   the hunt off, so the hunt command is sent again every 60 seconds; it
 *   changes nothing while a hunt is on.
 * - Fights at floor 6: the Tunnels, with the firetongue and the witch doctor.
 * - Two more runs, through the world system, are in
 *   `tests/budgetsWorld.test.ts`: one file would run past the 60 seconds
 *   vitest gives a worker to answer.
 *
 * Each run also compares its outcome digest with the one recorded on `main`
 * before the catch-up work (`tests/outcomeDigests.ts`).
 */
import { describe, expect, it } from 'vitest';
import { PLAYER } from '../src/kernel';
import type { StatusesState } from '../src/systems/statuses';
import { watchStatKey } from '../src/systems/martial';
import { digestOf, RUNS } from './budgetRuns';
import { combatOf, counterOf, skipsOf } from './combatHelpers';
import { RUN_DIGESTS } from './outcomeDigests';

/** No fight, no condition. Port 6: 1,231 to 1,242 ms alone. Catch-up work: 1,293 to 1,331 ms. */
const EIGHT_HOUR_BUDGET_MS = 2200;
/** A timerless poison held. Port 6: 4,952 to 5,003 ms alone. Catch-up work: 4,857 ms. */
const HELD_EIGHT_HOUR_BUDGET_MS = 8250;
/** Floor 1 table sent to combat. Port 6: 5,237 to 5,368 ms alone, 9,673 kills. Catch-up work: 4,554 to 4,621 ms. */
const FIGHT_EIGHT_HOUR_BUDGET_MS = 7700;
/** Floor 6 Tunnels sent to combat. Port 6: 14,368 to 14,899 ms alone, 11,328 kills. Catch-up work: 9,386 to 9,777 ms; pass 2 8,853 to 8,917 ms. */
const CASTER_EIGHT_HOUR_BUDGET_MS = 14850;

describe('offline catch-up', () => {
  it(`simulates 8 hours of ticks within ${EIGHT_HOUR_BUDGET_MS} ms`, () => {
    const { ms, envelope } = RUNS.idle();
    console.log(`8 hours, no fight: ${ms.toFixed(0)} ms`);
    expect((envelope.kernel.data as { tick: number }).tick).toBe(200 + 288_000);
    expect(digestOf(envelope)).toEqual(RUN_DIGESTS.idle);
    expect(ms, `8 hours took ${ms.toFixed(0)} ms`).toBeLessThan(EIGHT_HOUR_BUDGET_MS);
    // The test's own time limit is above the budget, so the budget is what fails.
  }, EIGHT_HOUR_BUDGET_MS * 5);
});

describe('offline catch-up with a condition held', () => {
  // A bleed ends at the first knockout, because the forced rest tends it. A
  // poison with no timer is not removed by rest: it deals damage on every
  // tick for the 8 hours and knocks the character out again each time the
  // recovery ends.
  it(`simulates 8 hours of a poisoned character within ${HELD_EIGHT_HOUR_BUDGET_MS} ms`, () => {
    const { ms, envelope } = RUNS.poison();
    console.log(`8 hours, a poison held: ${ms.toFixed(0)} ms`);
    expect((envelope.slices.statuses.data as unknown as StatusesState).held[PLAYER].map((h) => h.id)).toEqual(['poison', 'tainted']);
    expect(digestOf(envelope)).toEqual(RUN_DIGESTS.poison);
    expect(ms, `8 hours took ${ms.toFixed(0)} ms`).toBeLessThan(HELD_EIGHT_HOUR_BUDGET_MS);
  }, HELD_EIGHT_HOUR_BUDGET_MS * 3);
});

describe('offline catch-up with fights', () => {
  it(`simulates 8 hours of hunting a floor 1 table within ${FIGHT_EIGHT_HOUR_BUDGET_MS} ms`, () => {
    const { ms, kernel, envelope } = RUNS.floor1();
    const g = kernel!;
    // The run fought for the 8 hours: thousands of kills, and a fight or a hunt at the end.
    const kills = counterOf(g, 'kills');
    console.log(`8 hours of fights: ${ms.toFixed(0)} ms, ${kills} kills, ${counterOf(g, 'defeats')} defeats`);
    expect(kills).toBeGreaterThan(1000);
    expect(combatOf(g).hunting).toBe(true);
    expect(g.staleStats()).toEqual([]);
    expect(digestOf(envelope)).toEqual(RUN_DIGESTS.floor1);
    expect(ms, `8 hours took ${ms.toFixed(0)} ms`).toBeLessThan(FIGHT_EIGHT_HOUR_BUDGET_MS);
  }, FIGHT_EIGHT_HOUR_BUDGET_MS * 3);

  it(`simulates 8 hours of hunting a floor 6 table with casters within ${CASTER_EIGHT_HOUR_BUDGET_MS} ms`, () => {
    // A character that holds floor 6: the old climb arrives there with trained
    // attributes, skills and gear the spine does not grant yet. The probe
    // stands in for them.
    const { ms, kernel, envelope, casts } = RUNS.floor6();
    const g = kernel!;
    const kills = counterOf(g, 'kills');
    const techniques = ['gather', 'hamstring', 'dirty_stab', 'lunge', 'pocket_sand']
      .map((id) => counterOf(g, watchStatKey(id)))
      .reduce((a, b) => a + b, 0);
    console.log(
      `8 hours of floor 6 fights: ${ms.toFixed(0)} ms, ${kills} kills, ${counterOf(g, 'defeats')} defeats, ${casts} casts, ${techniques} techniques`,
    );
    // The run fought the table, and the casters and the hobgoblins used their rotations.
    expect(kills).toBeGreaterThan(1000);
    expect(counterOf(g, 'kills:goblin_witch_doctor')).toBeGreaterThan(0);
    expect(counterOf(g, 'kills:goblin_firetongue')).toBeGreaterThan(0);
    expect(casts).toBeGreaterThan(1000);
    expect(techniques).toBeGreaterThan(1000);
    expect(skipsOf(g, 'combat/rotation').filter((reason) => reason.includes('no system has registered'))).toEqual([]);
    expect(g.staleStats()).toEqual([]);
    expect(digestOf(envelope)).toEqual(RUN_DIGESTS.floor6);
    expect(ms, `8 hours took ${ms.toFixed(0)} ms`).toBeLessThan(CASTER_EIGHT_HOUR_BUDGET_MS);
  }, CASTER_EIGHT_HOUR_BUDGET_MS * 3);
});

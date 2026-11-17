/**
 * The offline budgets of the world system (spine port 6): two runs of 8
 * hours (288,000 ticks) through the hunt activity at a real spot, with
 * travel, weather, the knockout and its return live. No command is sent
 * after the first two. The vitest project `budget-world`, run after
 * `budget`: with the four runs of `tests/budgets.test.ts` one worker would
 * run past the 60 seconds vitest gives it to answer.
 *
 * - The Woods Edge of floor 4 (open sky, dynamic levels), a new character
 *   with the rusty sword.
 * - The Tunnels of floor 6, the probe character of the floor 6 budget.
 */
import { describe, expect, it } from 'vitest';
import { runHeadless, type Modifier } from '../src/kernel';
import { setHuntRest } from '../src/systems/combat';
import { selectActivity, type WorldState } from '../src/systems/world';
import { counterOf } from './combatHelpers';
import { equip, makeGame, patch, setMods, slice } from './helpers';

const TICKS = 288_000;

/** The character of the floor 6 budget in `tests/budgets.test.ts`. */
const FLOOR_SIX_CHARACTER: Modifier[] = [
  { stat: 'stats/maxHp', kind: 'add', value: 900 },
  { stat: 'stats/damage', kind: 'add', value: 45 },
  { stat: 'stats/armor', kind: 'add', value: 12 },
];

/**
 * Spine port 6. The character stands at a real spot and the hunt is the hunt
 * activity of the world system. A knockout throws the character to the haven
 * of the floor; the knockout system walks it back.
 */
// Measured on 2026-11-17: floor 4 18,900 to 19,700 ms alone (22,600 ms with other test runs on the machine),
// floor 6 18,600 to 19,600 ms alone.
const WORLD_FLOOR_FOUR_BUDGET_MS = 30000;
const WORLD_FLOOR_SIX_BUDGET_MS = 30000;

function standAt(g: ReturnType<typeof makeGame>, spot: string, known: string[]): void {
  patch(g, (slices) => {
    const w = slices.world as WorldState;
    w.spot = spot;
    w.discovered = ['ascent_foot', ...known];
    w.safeSpots = { nearest: known[0], unconditional: known[0] };
  });
}

describe('offline catch-up through the world system', () => {
  it(`simulates 8 hours of the hunt activity at the Woods Edge of floor 4 within ${WORLD_FLOOR_FOUR_BUDGET_MS} ms`, () => {
    const g = makeGame({ seed: 9 });
    equip(g, 1);
    standAt(g, 'f4_woods_edge', ['f4_treeline', 'f4_woods_edge']);
    expect(g.dispatch(setHuntRest({ at: 0.5, toFull: true })).ok).toBe(true);
    expect(g.dispatch(selectActivity({ activity: 'hunt' })).ok).toBe(true);

    const started = performance.now();
    runHeadless(g, { ticks: TICKS });
    const elapsed = performance.now() - started;

    const kills = counterOf(g, 'kills');
    const w = slice<WorldState>(g, 'world');
    console.log(
      `8 hours, world, floor 4 Woods Edge: ${elapsed.toFixed(0)} ms, ${kills} kills, ${counterOf(g, 'defeats')} defeats, at ${w.spot}, activity ${w.activity}`,
    );
    expect(kills).toBeGreaterThan(100);
    // The character is never left idle: it hunts, walks or recovers.
    expect(w.activity === 'hunt' || w.travel !== null || w.recovering).toBe(true);
    expect(g.staleStats()).toEqual([]);
    expect(elapsed, `8 hours took ${elapsed.toFixed(0)} ms`).toBeLessThan(WORLD_FLOOR_FOUR_BUDGET_MS);
  }, WORLD_FLOOR_FOUR_BUDGET_MS * 3);

  it(`simulates 8 hours of the hunt activity at the Tunnels of floor 6 within ${WORLD_FLOOR_SIX_BUDGET_MS} ms`, () => {
    const g = makeGame({ seed: 9 });
    equip(g, 1);
    setMods(g, FLOOR_SIX_CHARACTER);
    standAt(g, 'f6_tunnels', ['f6_warren_mouth', 'f6_tunnels']);
    expect(g.dispatch(setHuntRest({ at: 0.5, toFull: true })).ok).toBe(true);
    expect(g.dispatch(selectActivity({ activity: 'hunt' })).ok).toBe(true);

    const started = performance.now();
    runHeadless(g, { ticks: TICKS });
    const elapsed = performance.now() - started;

    const kills = counterOf(g, 'kills');
    const w = slice<WorldState>(g, 'world');
    console.log(
      `8 hours, world, floor 6 Tunnels: ${elapsed.toFixed(0)} ms, ${kills} kills, ${counterOf(g, 'defeats')} defeats, at ${w.spot}, activity ${w.activity}`,
    );
    expect(kills).toBeGreaterThan(1000);
    expect(w.activity === 'hunt' || w.travel !== null || w.recovering).toBe(true);
    expect(g.staleStats()).toEqual([]);
    expect(elapsed, `8 hours took ${elapsed.toFixed(0)} ms`).toBeLessThan(WORLD_FLOOR_SIX_BUDGET_MS);
  }, WORLD_FLOOR_SIX_BUDGET_MS * 3);
});

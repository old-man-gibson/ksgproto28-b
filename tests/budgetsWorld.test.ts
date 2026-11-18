/**
 * The offline budgets of the world system (spine port 6): two runs of 8
 * hours (288,000 ticks) through the hunt activity at a real spot, with
 * travel, weather, the knockout and its return live. No command is sent
 * after the first two. The vitest project `budget-world`, run after
 * `budget`. The runs are in `tests/budgetRuns.ts`.
 *
 * - The Woods Edge of floor 4 (open sky, dynamic levels), a new character
 *   with the rusty sword.
 * - The Tunnels of floor 6, the probe character of the floor 6 budget.
 *
 * Each run also compares its outcome digest with the one recorded on `main`
 * before the catch-up work (`tests/outcomeDigests.ts`).
 */
import { describe, expect, it } from 'vitest';
import type { WorldState } from '../src/systems/world';
import { digestOf, RUNS } from './budgetRuns';
import { counterOf } from './combatHelpers';
import { slice } from './helpers';
import { RUN_DIGESTS } from './outcomeDigests';

/**
 * Port 6, measured on 2026-11-17: floor 4 18,900 to 19,700 ms alone, floor 6
 * 18,600 to 19,600 ms alone; budget 30,000 ms each. After the catch-up work
 * (docs/KERNEL.md section 8): floor 4 9,157 to 9,515 ms, floor 6 9,297 to
 * 9,649 ms. Pass 2: floor 4 8,597 to 8,662 ms, floor 6 8,578 to 8,817 ms.
 * Budget about 1.5 times that.
 */
const WORLD_FLOOR_FOUR_BUDGET_MS = 14300;
const WORLD_FLOOR_SIX_BUDGET_MS = 14300;

describe('offline catch-up through the world system', () => {
  it(`simulates 8 hours of the hunt activity at the Woods Edge of floor 4 within ${WORLD_FLOOR_FOUR_BUDGET_MS} ms`, () => {
    const { ms, kernel, envelope } = RUNS.world4();
    const g = kernel!;
    const kills = counterOf(g, 'kills');
    const w = slice<WorldState>(g, 'world');
    console.log(
      `8 hours, world, floor 4 Woods Edge: ${ms.toFixed(0)} ms, ${kills} kills, ${counterOf(g, 'defeats')} defeats, at ${w.spot}, activity ${w.activity}`,
    );
    expect(kills).toBeGreaterThan(100);
    // The character is never left idle: it hunts, walks or recovers.
    expect(w.activity === 'hunt' || w.travel !== null || w.recovering).toBe(true);
    expect(g.staleStats()).toEqual([]);
    expect(digestOf(envelope)).toEqual(RUN_DIGESTS.world4);
    expect(ms, `8 hours took ${ms.toFixed(0)} ms`).toBeLessThan(WORLD_FLOOR_FOUR_BUDGET_MS);
  }, WORLD_FLOOR_FOUR_BUDGET_MS * 3);

  it(`simulates 8 hours of the hunt activity at the Tunnels of floor 6 within ${WORLD_FLOOR_SIX_BUDGET_MS} ms`, () => {
    const { ms, kernel, envelope } = RUNS.world6();
    const g = kernel!;
    const kills = counterOf(g, 'kills');
    const w = slice<WorldState>(g, 'world');
    console.log(
      `8 hours, world, floor 6 Tunnels: ${ms.toFixed(0)} ms, ${kills} kills, ${counterOf(g, 'defeats')} defeats, at ${w.spot}, activity ${w.activity}`,
    );
    expect(kills).toBeGreaterThan(1000);
    expect(w.activity === 'hunt' || w.travel !== null || w.recovering).toBe(true);
    expect(g.staleStats()).toEqual([]);
    expect(digestOf(envelope)).toEqual(RUN_DIGESTS.world6);
    expect(ms, `8 hours took ${ms.toFixed(0)} ms`).toBeLessThan(WORLD_FLOOR_SIX_BUDGET_MS);
  }, WORLD_FLOOR_SIX_BUDGET_MS * 3);
});

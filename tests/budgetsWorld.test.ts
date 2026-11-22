/**
 * The offline budgets of the world system (spine port 6, and step 4 port
 * C3): three runs of 8 hours (288,000 ticks) through the hunt activity at a
 * real spot, with
 * travel, weather, the knockout and its return live. No command is sent
 * after the first two. The vitest project `budget-world`, run after
 * `budget`. The runs are in `tests/budgetRuns.ts`.
 *
 * - The Woods Edge of floor 4 (open sky, dynamic levels), a new character
 *   with the rusty sword.
 * - The Tunnels of floor 6, the probe character of the floor 6 budget.
 * - The roadstead of floor 11, a convoy water, through `catchUp` (step 4
 *   port C3): the sea resolves every leg on its offline path.
 *
 * The festival (step 4 port C4) has no run: catch-up stops while it holds
 * the player (kernel decision 35), and tests/festival.test.ts checks that.
 *
 * Each run also compares its outcome digest with the one recorded on `main`
 * before the catch-up work (`tests/outcomeDigests.ts`).
 */
import { describe, expect, it } from 'vitest';
import { SEA_CRATES_OFFLINE, SEA_CRATES_WON } from '../src/systems/sea';
import type { WorldState } from '../src/systems/world';
import { digestOf, RUNS } from './budgetRuns';
import { counterOf } from './combatHelpers';
import { makeGame, slice } from './helpers';
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
/**
 * Step 4 port C3: 8 hours at floor 11's roadstead through `catchUp`, the
 * probe's harbor character, about 11,000 kills. The budget of the other two
 * world runs, which it costs about as much as.
 */
const WORLD_SEA_BUDGET_MS = 14300;

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

  it(`simulates 8 hours of the hunt activity at floor 11's roadstead, a convoy water, within ${WORLD_SEA_BUDGET_MS} ms of catch-up`, () => {
    const { ms, envelope } = RUNS.worldSea();
    const g = makeGame();
    expect(g.load(envelope).ok).toBe(true);
    const kills = counterOf(g, 'kills');
    const w = slice<WorldState>(g, 'world');
    const offline = counterOf(g, SEA_CRATES_OFFLINE);
    console.log(
      `8 hours, world, floor 11 roadstead (catch-up): ${ms.toFixed(0)} ms, ${kills} kills, ${counterOf(g, 'defeats')} defeats, ` +
        `${offline} crates offline, at ${w.spot}, activity ${w.activity}`,
    );
    expect(kills).toBeGreaterThan(1000);
    expect(w.activity === 'hunt' || w.travel !== null || w.recovering).toBe(true);
    // Catch-up: every leg the player was present for paid offline, none to crates won.
    expect(offline).toBeGreaterThan(0);
    expect(counterOf(g, SEA_CRATES_WON)).toBe(0);
    expect(g.staleStats()).toEqual([]);
    expect(digestOf(envelope)).toEqual(RUN_DIGESTS.worldSea);
    expect(ms, `8 hours took ${ms.toFixed(0)} ms`).toBeLessThan(WORLD_SEA_BUDGET_MS);
  }, WORLD_SEA_BUDGET_MS * 3);
});

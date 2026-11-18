/**
 * Port of old `tests/cooking.test.ts`. Changed only where the call shape
 * changed: the game is a kernel (`makeGame`), stock and skill are set with
 * `patch`, reads go through `benchReadsOf(reads(g))`.
 *
 * - `previewCook(state, placement, disc?, duration?)`,
 *   `dishQuality(state, ...)` and `dishQualityRange(state, ...)` take
 *   `benchReadsOf(reads(g))` in place of the state.
 * - `cook(state, bus, placement, disc?, duration?)` is the request
 *   `cooking/cook { discipline, placement, duration }`.
 * - `startBenchWork(state, bus, id, placement, opts)` is the command
 *   `benches/start`; `state.benchWork` is the `benches` slice's `job`.
 *   `benchJobTicks(state, disc, placement, duration)` takes craft speed in
 *   place of the state.
 * - `useConsumable(state, bus, id, q)` is the command `consumables/use`;
 *   `canUse`, `cooldownLeft` and `heldConsumables` take reads and the
 *   slice. The old cooldown case advanced `totalTicks` by 200; here the
 *   check is read 200 ticks later without ticking.
 * - `g.selectActivity('rest_home')` is the command `world/select-activity`
 *   with the kitchen's own job (`job_pans`).
 * - The old file stood on the shelved `my_home` and walked to
 *   `hamlet_square`. Here the run stands at `granary_kitchens` (stove and
 *   cutting board) and walks to `granary_gate`.
 * - The old dish case wrote `ticksLeft` on the held condition; here the
 *   statuses slice is patched.
 */
import { describe, expect, it } from 'vitest';
import { PLAYER, type Kernel } from '../src/kernel';
import { benchJobTicks, benchPace, DISCIPLINES, startBench, type BenchesState, type DisciplineDef, type Placement } from '../src/systems/benches';
import { benchReadsOf, cookRequest, dishQuality, dishQualityRange, previewCook } from '../src/systems/cooking';
import { canUse, cooldownLeft, heldConsumables, useConsumable, type ConsumablesState } from '../src/systems/consumables';
import { gradesHeld, qualityRank, type MaterialsState, type QualityTier } from '../src/systems/materials';
import { availableMax, poolHooks } from '../src/systems/resources';
import type { SkillsState } from '../src/systems/skills';
import { statBlockOf } from '../src/systems/stats';
import { applyStatus, heldOf, type StatusesState } from '../src/systems/statuses';
import { selectActivity } from '../src/systems/world';
import { hpOf, setPool } from './combatHelpers';
import { ask, makeGame, patch, reads, slice } from './helpers';
import { worldOf } from './worldHelpers';

const fresh = (seed = 1) => makeGame({ seed });
const at = (id: string, quality: QualityTier) => ({ id, quality });

/** Add units of a graded material. The old `grantGraded(state, id, q, n)`. */
function grantGraded(g: Kernel, id: string, q: QualityTier, n: number) {
  patch(g, (slices) => {
    const m = slices.materials as MaterialsState;
    m.stock[id] ??= {};
    m.stock[id][q] = (m.stock[id][q] ?? 0) + n;
  });
}
const setCooking = (g: Kernel, level: number) => patch(g, (slices) => (slices.skills.skills.cooking = { level, xp: 0 }));
const stockOf = (g: Kernel, id: string, q: QualityTier) => slice<MaterialsState>(g, 'materials').stock[id]?.[q] ?? 0;
const heldTotal = (g: Kernel, id: string) => gradesHeld(slice<MaterialsState>(g, 'materials'), id).reduce((s, e) => s + e.qty, 0);
const br = (g: Kernel) => benchReadsOf(reads(g));
const preview = (g: Kernel, placement: Placement, disc?: DisciplineDef, duration?: number) => previewCook(br(g), placement, disc, duration);
const cook = (g: Kernel, placement: Placement, disc: DisciplineDef = DISCIPLINES.cooking, duration?: number) =>
  ask(g, cookRequest, { discipline: disc.id, placement, ...(duration !== undefined ? { duration } : {}) });
const use = (g: Kernel, id: string, quality: QualityTier) => g.dispatch(useConsumable({ id, quality }));
const held = (g: Kernel) => heldOf(slice<StatusesState>(g, 'statuses'), PLAYER);
const findStatus = (g: Kernel, id: string) => held(g).find((s) => s.id === id);
const hasStatus = (g: Kernel, id: string) => !!findStatus(g, id);
const stats = (g: Kernel) => statBlockOf(reads(g));
const cons = (g: Kernel) => slice<ConsumablesState>(g, 'consumables');
const job = (g: Kernel) => slice<BenchesState>(g, 'benches').job;
const cookingXp = (g: Kernel) => slice<SkillsState>(g, 'skills').skills.cooking?.xp ?? 0;
const setSpot = (g: Kernel, spot: string) => patch(g, (slices) => (slices.world.spot = spot));

/** Stock a kitchen and make the cook competent enough to be predictable. */
function kitchen(g: Kernel, level = 1) {
  patch(g, (slices) => {
    for (const id of [
      'raw_meat', 'wild_onion', 'cave_mushroom', 'common_herb', 'river_fish', 'rock_salt',
      'rough_flour', 'forest_berries', 'bird_egg', 'wild_honey',
    ]) {
      slices.materials.stock[id] ??= {};
      for (const q of ['f', 'c', 'a', 's'] as QualityTier[]) slices.materials.stock[id][q] = (slices.materials.stock[id][q] ?? 0) + 5;
    }
    slices.skills.skills.cooking = { level, xp: 0 };
  });
}

const pot = (main: [string, QualityTier], second: [string, QualityTier], extra: Placement = {}): Placement => ({
  main: at(...main),
  second: at(...second),
  ...extra,
});

describe('what comes out of the pot', () => {
  it('the combination picks the dish, not a recipe list', () => {
    const g = fresh();
    kitchen(g);
    // Meat + vegetable is a stew; mushroom + herb is a broth. Same two slots.
    expect(preview(g, pot(['raw_meat', 'c'], ['wild_onion', 'c'])).outcome?.id).toBe('stew');
    expect(preview(g, pot(['cave_mushroom', 'c'], ['common_herb', 'c'])).outcome?.id).toBe('broth');
    // Fish and salt form no named pot dish — skewers live at the grill now.
    expect(preview(g, pot(['river_fish', 'c'], ['rock_salt', 'c'])).outcome?.id).toBe('ration');
  });

  it('the most specific match wins', () => {
    const g = fresh();
    kitchen(g, 20);
    const plain = pot(['raw_meat', 'a'], ['wild_onion', 'a']);
    const seasoned = pot(['raw_meat', 'a'], ['wild_onion', 'a'], { seasoning: at('rock_salt', 'a') });
    expect(preview(g, plain).outcome?.id).toBe('stew');
    expect(preview(g, seasoned).outcome?.id).toBe('feast');
  });

  it('a feast is gated on both the cook and the basket', () => {
    const g = fresh();
    kitchen(g, 20);
    // The right shape, but poor ingredients: it falls back rather than refusing.
    const poor = pot(['raw_meat', 'f'], ['wild_onion', 'f'], { seasoning: at('rock_salt', 'f') });
    expect(preview(g, poor).outcome?.id).not.toBe('feast');

    // The right basket, but an unskilled cook.
    setCooking(g, 1);
    const good = pot(['raw_meat', 'a'], ['wild_onion', 'a'], { seasoning: at('rock_salt', 'a') });
    expect(preview(g, good).outcome?.id).not.toBe('feast');
  });

  it('anything edible produces SOMETHING — a bad basket is a bad dish', () => {
    const g = fresh();
    kitchen(g);
    const odd = pot(['rock_salt', 'c'], ['rock_salt', 'c']);
    const check = preview(g, odd);
    expect(check.ok).toBe(true);
    expect(check.outcome?.id).toBe('ration');
  });

  it('a basket of pure refuse is a mess, whatever else it would have matched', () => {
    const g = fresh();
    kitchen(g);
    expect(preview(g, pot(['raw_meat', 'c'], ['wild_onion', 'c'])).outcome?.id).toBe('stew');
    expect(preview(g, pot(['raw_meat', 'f'], ['wild_onion', 'f'])).outcome?.id).toBe('mess');
  });

  it('two slots of one material at one grade need two in stock', () => {
    const g = fresh();
    setCooking(g, 1);
    grantGraded(g, 'raw_meat', 'd', 1);
    const doubled = pot(['raw_meat', 'd'], ['raw_meat', 'd']);
    const check = preview(g, doubled);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/1 Raw Meat of that grade; this layout uses 2/);

    grantGraded(g, 'raw_meat', 'd', 1);
    expect(preview(g, doubled).ok).toBe(true);
    expect(cook(g, doubled)).not.toBeNull();
    expect(stockOf(g, 'raw_meat', 'd')).toBe(0);
  });

  it('needs both starting slots filled', () => {
    const g = fresh();
    kitchen(g);
    expect(preview(g, { main: at('raw_meat', 'c') }).reason).toMatch(/Added Midway/);
  });

  it('widens as the cook improves', () => {
    const g = fresh();
    kitchen(g);
    // The third ingredient needs Cooking 8.
    const three = pot(['raw_meat', 'c'], ['wild_onion', 'c'], { third: at('common_herb', 'c') });
    expect(preview(g, three).ok).toBe(false);

    setCooking(g, 8);
    expect(preview(g, three).ok).toBe(true);
  });
});

describe('the kitchen is several benches on one skill', () => {
  const GRILL = DISCIPLINES.grilling;
  const OVEN = DISCIPLINES.baking;
  const COUNTER = DISCIPLINES.assembling;

  it('the grill is happy with a single fine ingredient', () => {
    const g = fresh();
    kitchen(g);
    expect(preview(g, { main: at('river_fish', 'c') }, GRILL).outcome?.id).toBe('skewer');
    expect(preview(g, { main: at('raw_meat', 'c') }, GRILL).outcome?.id).toBe('steak');
  });

  it('wheat becomes bread becomes lunch — products are ingredients', () => {
    const g = fresh();
    kitchen(g);

    const loaf = cook(g, { main: at('rough_flour', 'c'), second: at('rough_flour', 'c') }, OVEN)!;
    expect(loaf.dish).toBe('rustic_loaf');

    const steak = cook(g, { main: at('raw_meat', 'c') }, GRILL)!;
    expect(steak.dish).toBe('seared_steak');

    const lunch = preview(g, { main: at('rustic_loaf', loaf.quality), second: at('seared_steak', steak.quality) }, COUNTER);
    expect(lunch.outcome?.id).toBe('sandwich');
  });

  it('the hot benches refuse cooked food', () => {
    const g = fresh();
    kitchen(g);
    grantGraded(g, 'rustic_loaf', 'c', 1);
    const check = preview(g, pot(['rustic_loaf', 'c'], ['wild_onion', 'c']));
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/does not belong/);
  });

  it('the counter tells raw dishes from cooked ones', () => {
    const g = fresh();
    kitchen(g);
    const cold = preview(g, pot(['wild_onion', 'c'], ['cave_mushroom', 'c']), COUNTER);
    expect(cold.outcome?.id).toBe('salad');
    expect(preview(g, pot(['wild_onion', 'c'], ['cave_mushroom', 'c'])).outcome?.id).toBe('ration');
  });

  it('the oven climbs from loaf to pie to cake as the baker learns', () => {
    const g = fresh();
    kitchen(g);
    const pie = preview(g, pot(['rough_flour', 'c'], ['forest_berries', 'c']), OVEN);
    expect(pie.outcome?.id).toBe('pie');

    const tin = pot(['rough_flour', 'c'], ['bird_egg', 'c'], { sweetening: at('wild_honey', 'c') });
    expect(preview(g, tin, OVEN).outcome?.id).not.toBe('cake');
    setCooking(g, 12);
    expect(preview(g, tin, OVEN).outcome?.id).toBe('cake');
  });

  it('every cooking bench pays the one cooking skill', () => {
    const g = fresh();
    kitchen(g);
    const before = cookingXp(g);
    cook(g, { main: at('raw_meat', 'c') }, GRILL);
    expect(cookingXp(g)).toBeGreaterThan(before);
  });
});

describe('the cutting board', () => {
  const BOARD = DISCIPLINES.preparing;
  const lay = (id: string, q: QualityTier, tech: string): Placement => ({
    board: at(id, q),
    technique: at(tech, 'c'),
  });

  it('preps an ingredient into its variant and spends the whole one', () => {
    const g = fresh();
    kitchen(g);
    const before = stockOf(g, 'wild_onion', 'c');
    const done = cook(g, lay('wild_onion', 'c', 'sliced'), BOARD)!;
    expect(done.dish).toBe('wild_onion_sliced');
    expect(stockOf(g, 'wild_onion', 'c')).toBe(before - 1);
    expect(stockOf(g, 'wild_onion_sliced', done.quality)).toBe(1);
  });

  it('no knife exceeds the ingredient — the cut grade is capped', () => {
    const g = fresh();
    kitchen(g, 50);
    const done = cook(g, lay('wild_onion', 'f', 'sliced'), BOARD)!;
    expect(done.quality).toBe('f');
  });

  it('techniques are knowledge, gated by the skill', () => {
    const g = fresh();
    kitchen(g, 1);
    const check = preview(g, lay('wild_onion', 'c', 'julienned'), BOARD);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/Cooking 10/);
  });

  it('a cut cannot be cut again', () => {
    const g = fresh();
    kitchen(g);
    grantGraded(g, 'wild_onion_sliced', 'c', 1);
    const check = preview(g, lay('wild_onion_sliced', 'c', 'sliced'), BOARD);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/does not belong/);
  });

  it('a prepped ingredient is still itself — a diced onion still makes stew', () => {
    const g = fresh();
    kitchen(g);
    grantGraded(g, 'wild_onion_diced', 'c', 1);
    expect(preview(g, pot(['raw_meat', 'c'], ['wild_onion_diced', 'c'])).outcome?.id).toBe('stew');
  });
});

describe('uniformity: the cut grade is predictability', () => {
  it('perfect cuts preview exact; mid cuts preview a range', () => {
    const g = fresh();
    kitchen(g, 5);
    grantGraded(g, 'wild_onion_diced', 's', 2);
    grantGraded(g, 'wild_onion_diced', 'c', 2);

    const exact = preview(g, pot(['wild_onion_diced', 's'], ['wild_onion_diced', 's']));
    expect(exact.qualityHigh).toBeUndefined();

    const spread = preview(g, pot(['wild_onion_diced', 'c'], ['wild_onion_diced', 'c']));
    expect(spread.qualityHigh).toBeDefined();
    expect(qualityRank(spread.qualityHigh!)).toBeGreaterThan(qualityRank(spread.quality!));
  });

  it('the cooked dish lands inside the previewed range', () => {
    const g = fresh();
    kitchen(g);
    grantGraded(g, 'wild_onion_diced', 'c', 3);
    const placement = pot(['raw_meat', 'a'], ['wild_onion_diced', 'c']);
    const { min, max } = dishQualityRange(br(g), placement);
    const done = cook(g, placement)!;
    expect(qualityRank(done.quality)).toBeGreaterThanOrEqual(qualityRank(min));
    expect(qualityRank(done.quality)).toBeLessThanOrEqual(qualityRank(max));
  });

  it('the favored cut is worth real grades on the right bench', () => {
    const g = fresh();
    kitchen(g);
    grantGraded(g, 'wild_onion_diced', 'b', 2);
    const placement = pot(['wild_onion_diced', 'b'], ['wild_onion_diced', 'b']);
    const stove = dishQualityRange(br(g), placement, DISCIPLINES.cooking);
    const oven = dishQualityRange(br(g), placement, DISCIPLINES.baking);
    expect(qualityRank(stove.min)).toBeGreaterThan(qualityRank(oven.min));
  });
});

describe('the stove cooks in time', () => {
  const STOVE = DISCIPLINES.cooking;

  it('WHEN an ingredient enters matters — julienne goes in late or goes to waste', () => {
    const g = fresh();
    kitchen(g, 8);
    grantGraded(g, 'wild_onion_julienned', 's', 2);

    const early: Placement = {
      main: at('raw_meat', 'c'),
      second: at('wild_onion_julienned', 's'),
      third: at('cave_mushroom', 'c'),
    };
    const late: Placement = {
      main: at('raw_meat', 'c'),
      second: at('cave_mushroom', 'c'),
      third: at('wild_onion_julienned', 's'),
    };
    const scorched = dishQualityRange(br(g), early, STOVE);
    const bright = dishQualityRange(br(g), late, STOVE);
    expect(qualityRank(bright.min)).toBeGreaterThan(qualityRank(scorched.min));
  });

  it('the duration is a dial — the same layout simmered longer is a different dish', () => {
    const g = fresh();
    kitchen(g);
    grantGraded(g, 'wild_onion_julienned', 's', 2);
    const placement = pot(['raw_meat', 'c'], ['wild_onion_julienned', 's']);
    const quick = dishQualityRange(br(g), placement, STOVE, 8);
    const braise = dishQualityRange(br(g), placement, STOVE, 16);
    expect(qualityRank(quick.min)).toBeGreaterThan(qualityRank(braise.min));
  });

  it('seasoning stands outside time', () => {
    const g = fresh();
    kitchen(g);
    const placement = pot(['raw_meat', 'c'], ['wild_onion', 'c'], { seasoning: at('rock_salt', 'c') });
    expect(dishQualityRange(br(g), placement, STOVE, 8).min).toBe(dishQualityRange(br(g), placement, STOVE, 16).min);
  });
});

describe('bench runs: prepping on the clock', () => {
  const board = (id: string, q: QualityTier, tech: string): Placement => ({
    board: at(id, q),
    technique: at(tech, 'c'),
  });
  const start = (g: Kernel, discipline: string, placement: Placement, count: number | null, duration?: number) =>
    g.dispatch(startBench({ discipline, placement, count, ...(duration !== undefined ? { duration } : {}) }));
  const craftSpeed = (g: Kernel) => stats(g).craftSpeed;

  it('skill compresses the clock, and past the floor it batches instead', () => {
    expect(benchPace(1, 15)).toEqual({ ticksPer: 15, batch: 1 });
    expect(benchPace(2, 15)).toEqual({ ticksPer: 10, batch: 1 });
    expect(benchPace(4, 15)).toEqual({ ticksPer: 10, batch: 2 });
  });

  it('a counted run works through the stack and stops', () => {
    const g = fresh();
    kitchen(g);
    setSpot(g, 'granary_kitchens');
    const ok = start(g, 'preparing', board('wild_onion', 'c', 'sliced'), 3).ok;
    expect(ok).toBe(true);
    expect(job(g)).toBeTruthy();

    g.tick(100);
    expect(job(g)).toBeNull();
    expect(heldTotal(g, 'wild_onion_sliced')).toBe(3);
    expect(stockOf(g, 'wild_onion', 'c')).toBe(2); // five stocked, three spent
  });

  it('"keep going" runs until the stock is dry', () => {
    const g = fresh();
    grantGraded(g, 'wild_onion', 'c', 2);
    setCooking(g, 1);
    setSpot(g, 'granary_kitchens');
    start(g, 'preparing', board('wild_onion', 'c', 'sliced'), null);

    g.tick(200);
    expect(job(g)).toBeNull();
    expect(heldTotal(g, 'wild_onion_sliced')).toBe(2);
    expect(stockOf(g, 'wild_onion', 'c')).toBe(0);
  });

  it('walking away abandons the board', () => {
    const g = fresh();
    kitchen(g);
    setSpot(g, 'granary_kitchens');
    start(g, 'preparing', board('wild_onion', 'c', 'sliced'), null);
    setSpot(g, 'granary_gate');
    g.tick();
    expect(job(g)).toBeNull();
  });

  it('the stove answers to the clock, not the cook', () => {
    const g = fresh();
    kitchen(g, 50);
    setSpot(g, 'granary_kitchens');
    start(g, 'cooking', pot(['raw_meat', 'c'], ['wild_onion', 'c']), 1, 8);
    // A quick simmer of 8 units is 80 ticks, at Cooking 50 as at Cooking 1.
    expect(job(g)!.ticksPer).toBe(80);

    const stews = () => heldTotal(g, 'hearty_stew');
    g.tick(79);
    expect(stews()).toBe(0);
    g.tick();
    expect(stews()).toBe(1);
    expect(job(g)).toBeNull();
  });

  it('the grill and oven run their own fixed clocks', () => {
    const g = fresh();
    kitchen(g, 50);
    expect(benchJobTicks(DISCIPLINES.grilling, { main: at('raw_meat', 'c') }, craftSpeed(g)).ticksPer).toBe(30);
    expect(benchJobTicks(DISCIPLINES.baking, pot(['rough_flour', 'c'], ['rough_flour', 'c']), craftSpeed(g)).ticksPer).toBe(50);
  });

  it('assembly grows with the stack and shrinks with skill', () => {
    const slow = fresh();
    kitchen(slow, 1);
    const two = pot(['wild_onion', 'c'], ['cave_mushroom', 'c']);
    const three = pot(['wild_onion', 'c'], ['cave_mushroom', 'c'], { third: at('common_herb', 'c') });
    const twoTicks = benchJobTicks(DISCIPLINES.assembling, two, craftSpeed(slow)).ticksPer;
    const threeTicks = benchJobTicks(DISCIPLINES.assembling, three, craftSpeed(slow)).ticksPer;
    expect(threeTicks).toBeGreaterThan(twoTicks);

    const fast = fresh();
    kitchen(fast, 50);
    expect(benchJobTicks(DISCIPLINES.assembling, two, craftSpeed(fast)).ticksPer).toBeLessThan(twoTicks);
  });

  it('the bench and the activity are exclusive, both ways', () => {
    const g = fresh();
    kitchen(g);
    setSpot(g, 'granary_kitchens');
    start(g, 'preparing', board('wild_onion', 'c', 'sliced'), null);
    g.dispatch(selectActivity({ activity: 'job_pans' }));
    expect(job(g)).toBeNull();
    start(g, 'preparing', board('wild_onion', 'c', 'sliced'), null);
    expect(worldOf(g).activity).toBeNull();
    expect(job(g)).toBeTruthy();
  });
});

describe('the basket decides the grade', () => {
  it('better ingredients make a better dish', () => {
    const g = fresh();
    kitchen(g);
    const poor = dishQuality(br(g), pot(['raw_meat', 'f'], ['wild_onion', 'f']));
    const fair = dishQuality(br(g), pot(['raw_meat', 'c'], ['wild_onion', 'c']));
    const fine = dishQuality(br(g), pot(['raw_meat', 's'], ['wild_onion', 's']));
    expect(qualityRank(fair)).toBeGreaterThan(qualityRank(poor));
    expect(qualityRank(fine)).toBeGreaterThan(qualityRank(fair));
  });

  it('one rotten ingredient drags the dish down', () => {
    const g = fresh();
    kitchen(g);
    const clean = dishQuality(br(g), pot(['raw_meat', 'a'], ['wild_onion', 'a']));
    const spoiled = dishQuality(br(g), pot(['raw_meat', 'a'], ['wild_onion', 'f']));
    expect(qualityRank(spoiled)).toBeLessThan(qualityRank(clean));
  });

  it('skill nudges the grade but cannot conjure a feast from refuse', () => {
    const g = fresh();
    kitchen(g, 1);
    const raw = dishQuality(br(g), pot(['raw_meat', 'f'], ['wild_onion', 'f']));
    setCooking(g, 40);
    const skilled = dishQuality(br(g), pot(['raw_meat', 'f'], ['wild_onion', 'f']));
    expect(qualityRank(skilled)).toBeGreaterThanOrEqual(qualityRank(raw));
    expect(skilled).not.toBe('s');
  });

  it('cooking spends the basket and stocks the dish at its grade', () => {
    const g = fresh();
    kitchen(g);
    const before = stockOf(g, 'raw_meat', 'c');

    const result = cook(g, pot(['raw_meat', 'c'], ['wild_onion', 'c']))!;
    expect(result.dish).toBe('hearty_stew');
    expect(stockOf(g, 'raw_meat', 'c')).toBe(before - 1);
    expect(stockOf(g, 'hearty_stew', result.quality)).toBe(1);
  });

  it('cookware is worked with, not eaten', () => {
    const g = fresh();
    kitchen(g);
    grantGraded(g, 'iron_pot', 'b', 1);
    cook(g, pot(['raw_meat', 'c'], ['wild_onion', 'c'], { pot: at('iron_pot', 'b') }));
    expect(stockOf(g, 'iron_pot', 'b')).toBe(1);
  });
});

describe('using what you cooked', () => {
  it('an instant restores the whole amount at once', () => {
    const g = fresh();
    grantGraded(g, 'healing_salve', 'c', 2);
    setPool(g, 'hp', 1);

    use(g, 'healing_salve', 'c');
    // 25 flat + 10% of max, all of it immediately.
    expect(hpOf(g)).toBeGreaterThan(25);
    expect(stockOf(g, 'healing_salve', 'c')).toBe(1);
  });

  it('a sustained effect grants a condition instead, and feeds you over time', () => {
    const g = fresh();
    grantGraded(g, 'hearty_stew', 'c', 1);
    setPool(g, 'hp', 10);

    use(g, 'hearty_stew', 'c');
    expect(hasStatus(g, 'well_fed')).toBe(true);
    const justAfter = hpOf(g);
    g.tick(60);
    expect(hpOf(g)).toBeGreaterThan(justAfter);
  });

  it('grade scales what a dish is worth', () => {
    const poor = fresh();
    const fine = fresh();
    grantGraded(poor, 'hearty_stew', 'e', 1);
    grantGraded(fine, 'hearty_stew', 's', 1);
    use(poor, 'hearty_stew', 'e');
    use(fine, 'hearty_stew', 's');

    const bite = (g: Kernel) => findStatus(g, 'well_fed')!.intensity;
    expect(bite(fine)).toBeGreaterThan(bite(poor));
    expect(stats(fine).maxHp).toBeGreaterThan(stats(poor).maxHp);
  });

  it('spoiled food makes you ill instead of feeding you', () => {
    const g = fresh();
    grantGraded(g, 'hearty_stew', 'f', 1);
    use(g, 'hearty_stew', 'f');
    expect(hasStatus(g, 'well_fed')).toBe(false);
    expect(hasStatus(g, 'queasy')).toBe(true);
  });

  it('will not use what you do not have, and spends nothing trying', () => {
    const g = fresh();
    expect(canUse({ ...reads(g), tick: g.tickCount }, cons(g), 'hearty_stew', 'c').ok).toBe(false);
    expect(use(g, 'hearty_stew', 'c').ok).toBe(false);
  });

  it('respects a cooldown', () => {
    const g = fresh();
    grantGraded(g, 'healing_salve', 'c', 2);
    use(g, 'healing_salve', 'c');
    expect(cooldownLeft(cons(g), 'healing_salve', g.tickCount)).toBeGreaterThan(0);
    expect(use(g, 'healing_salve', 'c').ok).toBe(false);
    expect(stockOf(g, 'healing_salve', 'c')).toBe(1); // nothing wasted

    // The old case advanced `totalTicks` by 200 without ticking.
    expect(canUse({ ...reads(g), tick: g.tickCount + 200 }, cons(g), 'healing_salve', 'c').ok).toBe(true);
  });

  it('a salve counts as real treatment, so it closes wounds', () => {
    const g = fresh();
    grantGraded(g, 'healing_salve', 'c', 1);
    setPool(g, 'hp', 10);
    ask(g, applyStatus, { entity: PLAYER, app: { id: 'bleeding', intensity: 1 }, source: 'test' });
    expect(hasStatus(g, 'bleeding')).toBe(true);

    use(g, 'healing_salve', 'c');
    expect(hasStatus(g, 'bleeding')).toBe(false);
  });

  it('lists what is held, per grade', () => {
    const g = fresh();
    grantGraded(g, 'hearty_stew', 'c', 2);
    grantGraded(g, 'hearty_stew', 'a', 1);
    const list = heldConsumables(reads(g));
    expect(list).toHaveLength(2);
    expect(list.map((h) => h.quality)).toContain('a');
  });
});

describe('a dish lasts the way its condition does', () => {
  it('a set duration runs out on its own', () => {
    const g = fresh();
    grantGraded(g, 'skewered_fish', 'c', 1);
    use(g, 'skewered_fish', 'c');
    expect(findStatus(g, 'steady_hand')!.ticksLeft).toBeGreaterThan(0);

    patch(g, (slices) => {
      const inst = (slices.statuses as StatusesState).held[PLAYER].find((s) => s.id === 'steady_hand')!;
      inst.ticksLeft = 1;
    });
    g.tick();
    expect(hasStatus(g, 'steady_hand')).toBe(false);
  });

  it('a buff actually reaches the stat block while it holds', () => {
    const g = fresh();
    const before = stats(g).crit;
    grantGraded(g, 'skewered_fish', 'c', 1);
    use(g, 'skewered_fish', 'c');
    expect(stats(g).crit).toBeGreaterThan(before);
  });

  it('a dish that only restores does so within its pool ceiling', () => {
    const g = fresh();
    grantGraded(g, 'hearty_stew', 'c', 1);
    use(g, 'hearty_stew', 'c');
    g.tick(200);
    expect(hpOf(g)).toBeLessThanOrEqual(availableMax(stats(g), poolHooks(reads(g)), 'hp'));
  });
});

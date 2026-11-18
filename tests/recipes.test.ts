/**
 * Port of old `tests/recipes.test.ts`. Changed only where the call shape
 * changed: the game is a kernel (`makeGame`), stock is set with `patch`,
 * `previewCook(state, placement)` takes `benchReadsOf(reads(g))`,
 * `knowsRecipe(state, id)` is that reads object's `knowsRecipe(id)`,
 * `useConsumable(state, bus, id)` is the command `consumables/use`, and
 * `state.stats['recipe:<id>']` is a counter.
 *
 * The old reading-hall case called `rollActivityDrops(state, bus, reading)`
 * once per rep. Here the drop roll is inside the world tick, so the case
 * trains at the Reading Hall in steps of `TRAIN_REP_TICKS` and reads the rep
 * count from the mercy ledger (one miss per rep without the card; speed
 * grows with training, so a step can hold more than one rep). The "held"
 * and "known" stretches tick 5,000 base reps each.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import type { Placement } from '../src/systems/benches';
import { benchReadsOf, previewCook } from '../src/systems/cooking';
import { canUse, useConsumable, type ConsumablesState } from '../src/systems/consumables';
import type { MaterialsState, QualityTier } from '../src/systems/materials';
import type { MercyState } from '../src/systems/mercy';
import { NPCS } from '../src/systems/npcs';
import { selectActivity, SPOTS, TRAIN_REP_TICKS } from '../src/systems/world';
import { makeGame, patch, reads, slice } from './helpers';
import { gameAt, setCounters, worldOf } from './worldHelpers';

const at = (id: string, quality: QualityTier = 'c') => ({ id, quality });
const meatAndHerb: Placement = { main: at('raw_meat'), second: at('common_herb') };

function kitchen(seed = 1): Kernel {
  const g = makeGame({ seed });
  patch(g, (slices) => {
    for (const id of ['raw_meat', 'common_herb', 'river_fish', 'wild_onion', 'rough_flour', 'wild_honey']) {
      slices.materials.stock[id] ??= {};
      slices.materials.stock[id].c = (slices.materials.stock[id].c ?? 0) + 5;
    }
  });
  return g;
}

const preview = (g: Kernel, placement: Placement) => previewCook(benchReadsOf(reads(g)), placement);
const countOf = (g: Kernel, id: string) => slice<MaterialsState>(g, 'materials').counts[id];
const setCount = (g: Kernel, id: string, n: number) => patch(g, (slices) => (slices.materials.counts[id] = n));
const use = (g: Kernel, id: string) => g.dispatch(useConsumable({ id }));

describe('recipe cards teach learned dishes', () => {
  it('meat + herb is a ration until the card is read, then Herb-Rubbed Meat', () => {
    const g = kitchen();
    expect(preview(g, meatAndHerb).outcome?.id).toBe('ration');
    setCount(g, 'recipe_herb_rubbed_meat', 1);
    expect(use(g, 'recipe_herb_rubbed_meat').ok).toBe(true);
    expect(benchReadsOf(reads(g)).knowsRecipe('herb_rubbed_meat')).toBe(true);
    expect(countOf(g, 'recipe_herb_rubbed_meat') ?? 0).toBe(0);
    expect(preview(g, meatAndHerb).outcome?.id).toBe('herb_rubbed_meat');
  });

  it('a card for a known recipe cannot be read again (nothing is spent)', () => {
    const g = kitchen();
    setCount(g, 'recipe_fish_onion_pot', 2);
    use(g, 'recipe_fish_onion_pot');
    const cons = slice<ConsumablesState>(g, 'consumables');
    expect(canUse({ ...reads(g), tick: g.tickCount }, cons, 'recipe_fish_onion_pot', 'c').ok).toBe(false);
    expect(use(g, 'recipe_fish_onion_pot').ok).toBe(false);
    expect(countOf(g, 'recipe_fish_onion_pot')).toBe(1);
  });

  it('each learned dish beats the generic outcome its ingredients would otherwise make', () => {
    const g = kitchen();
    setCounters(g, Object.fromEntries(['herb_rubbed_meat', 'fish_onion_pot', 'lectory_porridge'].map((r) => [`recipe:${r}`, 1])));
    // Fish + onion is meat + vegetable too: without the recipe, a stew.
    expect(preview(g, { main: at('river_fish'), second: at('wild_onion') }).outcome?.id).toBe('fish_onion_pot');
    expect(preview(g, { main: at('rough_flour'), second: at('wild_honey') }).outcome?.id).toBe('lectory_porridge');
  });

  it('the chef sells two cards; the third is not on any counter', () => {
    const lines = NPCS.head_chef.shop!.lines.map((l) => l.id);
    expect(lines).toContain('recipe_herb_rubbed_meat');
    expect(lines).toContain('recipe_fish_onion_pot');
    for (const npc of Object.values(NPCS)) {
      expect((npc.shop?.lines ?? []).map((l) => l.id)).not.toContain('recipe_lectory_porridge');
    }
  });
});

describe('reading in the Reading Hall turns up a rare recipe card', () => {
  const reading = SPOTS.the_reading_hall.activities.find((a) => a.id === 'train_int_hall')!;
  const drop = (reading.drops ?? [])[0];
  const KEY = 'drop:train_int_hall:recipe_lectory_porridge';
  const misses = (g: Kernel) => slice<MercyState>(g, 'mercy').ledger[KEY] ?? 0;
  const card = (g: Kernel) => countOf(g, 'recipe_lectory_porridge') ?? 0;

  function reader(seed: number): Kernel {
    const g = gameAt(seed, 'the_reading_hall');
    expect(g.dispatch(selectActivity({ activity: 'train_int_hall' })).ok).toBe(true);
    return g;
  }

  it('drops within a bounded number of reps (drought-protected), then never again while held or known', () => {
    const g = reader(11);
    let reps = 0;
    let lastMisses = 0;
    let chunks = 0;
    while (card(g) === 0 && chunks < 20000) {
      g.tick(TRAIN_REP_TICKS);
      chunks++;
      if (card(g) === 0) lastMisses = misses(g);
      else reps = lastMisses + 1;
    }
    expect(card(g)).toBe(1);
    // Rare: not on the first handful of reps for this seed, and well inside the mercy bound.
    expect(reps).toBeGreaterThan(10);
    expect(reps).toBeLessThan(6000);
    // Held: no second copy.
    g.tick(5000 * TRAIN_REP_TICKS);
    expect(card(g)).toBe(1);
    // Known: still none.
    expect(use(g, 'recipe_lectory_porridge').ok).toBe(true);
    g.tick(5000 * TRAIN_REP_TICKS);
    expect(card(g)).toBe(0);
    // The reps ran the whole time.
    expect(worldOf(g).activity).toBe('train_int_hall');
    // About 3 s alone; over 5 s under the full parallel run.
  }, 30_000);

  it('a completed reading rep is what rolls it', () => {
    const g = reader(11);
    let rolls = 0;
    const orig = drop.chance;
    drop.chance = 1;
    try {
      for (let i = 0; i < 200 && !card(g); i++) {
        g.tick();
        rolls++;
      }
    } finally {
      drop.chance = orig;
    }
    expect(card(g)).toBe(1);
    expect(rolls).toBeGreaterThan(1); // it waited for the rep to complete
  });
});

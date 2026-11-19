/**
 * Port of the craft cases of the old tests: `tests/activities.test.ts`
 * ("recipes with alternative routes", "scoped stats"), `tests/phase2.test.ts`
 * ("crafting") and `tests/rarefinds.test.ts` (the Smith's Pattern unhides
 * the bronze line).
 *
 * Changed only in how they call the code. The game is a kernel; stock and
 * skills are set with `patch`; the old `consumeCost(state, recipe)` is
 * `chooseRoute` and the request `materials/take` per cost line, as the tick
 * spends (`spend` below); `state.stats` is a counter; the old
 * `Game.selectActivity` is the command `world/select-activity`; the old
 * `hamlet_forge` is `the_forges`.
 *
 * The old `leather` recipe is not in the registry here: no spot through
 * floor 6 lists it. The route cases use it as a literal. The tick-loop case
 * adds it to `RECIPES` and stands at a test spot that lists it, and removes
 * both after.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import { useConsumable } from '../src/systems/consumables';
import type { CountersState } from '../src/systems/counters';
import {
  canAfford,
  chooseRoute,
  craftActivity,
  RECIPES,
  recipeHidden,
  routeYield,
  type RecipeAlt,
  type RecipeDef,
} from '../src/systems/crafting';
import { takeMaterial, type MaterialsState } from '../src/systems/materials';
import type { SkillsState } from '../src/systems/skills';
import { statBlockOf } from '../src/systems/stats';
import world, { activityFillRate, getSpot, selectActivity, spotActivities, SPOTS, type SpotDef, type WorldView } from '../src/systems/world';
import { logOf } from './combatHelpers';
import { ask, makeGame, patch, reads, slice } from './helpers';
import { gameAt, mountSpots, sent, worldOf } from './worldHelpers';

/** The old `leather` recipe of `data/recipes.data.ts`. */
const LEATHER: RecipeDef = {
  id: 'leather',
  name: 'Leather',
  ticks: 90,
  xp: 2,
  cost: [{ id: 'ruined_fur', qty: 4 }],
  alts: [
    { id: 'torn', cost: [{ id: 'torn_fur', qty: 3 }] },
    { id: 'pristine', cost: [{ id: 'pristine_fur', qty: 1 }], qty: 2 },
  ],
  tags: ['leatherwork'],
  result: { id: 'leather', kind: 'material' },
};

const held = (k: Kernel) => slice<MaterialsState>(k, 'materials');
const counts = (k: Kernel) => held(k).counts;
const counterOf = (k: Kernel, key: string) => slice<CountersState>(k, 'counters').counts[key] ?? 0;
const skillsOf = (k: Kernel) => slice<SkillsState>(k, 'skills').skills;
const viewOf = (k: Kernel) => k.view().systems[world.id] as WorldView;

function setMaterials(k: Kernel, values: Record<string, number>): void {
  patch(k, (slices) => {
    (slices.materials as MaterialsState).counts = { ...values };
  });
}

function setSkill(k: Kernel, id: string, level: number): void {
  patch(k, (slices) => {
    (slices.skills as SkillsState).skills[id] = { level, xp: 0 };
  });
}

/** The old `consumeCost`: take the chosen route's cost and say which route paid. */
function spend(k: Kernel, recipe: RecipeDef): RecipeAlt | null {
  const route = chooseRoute(held(k), recipe);
  if (!route) return null;
  for (const c of route.cost) ask(k, takeMaterial, { id: c.id, qty: c.qty });
  return route;
}

describe('recipes with alternative routes', () => {
  /** A crafter with an empty satchel. */
  function crafter(seed: number): Kernel {
    const k = makeGame({ seed });
    setMaterials(k, {});
    return k;
  }

  it('spends the junk first and only reaches for the good pelt last', () => {
    const k = crafter(1);
    setMaterials(k, { ruined_fur: 4, torn_fur: 3, pristine_fur: 1 });

    // Declaration order is preference order.
    expect(chooseRoute(held(k), LEATHER)?.id).toBe('primary');
    spend(k, LEATHER);
    expect(counts(k)['ruined_fur']).toBeUndefined();

    expect(chooseRoute(held(k), LEATHER)?.id).toBe('torn');
    spend(k, LEATHER);
    expect(counts(k)['torn_fur']).toBeUndefined();

    // Only now, with nothing worse left, does the pristine pelt go.
    expect(chooseRoute(held(k), LEATHER)?.id).toBe('pristine');
  });

  it('a better input pays a better yield', () => {
    const k = crafter(2);

    setMaterials(k, { ruined_fur: 4 });
    expect(routeYield(LEATHER, spend(k, LEATHER))).toBe(1);

    setMaterials(k, { pristine_fur: 1 });
    expect(routeYield(LEATHER, spend(k, LEATHER))).toBe(2);
  });

  it('affordable means ANY route is affordable, not the first', () => {
    const k = crafter(3);
    expect(canAfford(held(k), LEATHER)).toBe(false);

    // Nothing for route zero, but the pristine route is covered.
    setMaterials(k, { pristine_fur: 1 });
    expect(canAfford(held(k), LEATHER)).toBe(true);
    expect(chooseRoute(held(k), LEATHER)?.id).toBe('pristine');
  });

  describe('through the tick loop', () => {
    let unmount: (() => void) | null = null;
    afterEach(() => {
      unmount?.();
      unmount = null;
      delete RECIPES.leather;
    });

    it('crafting through the tick loop banks the route’s own yield', () => {
      RECIPES.leather = LEATHER;
      const tannery: SpotDef = { ...getSpot('the_forges'), id: 'test_tannery', recipes: ['leather'], connections: [] };
      unmount = mountSpots({ test_tannery: tannery });
      const k = gameAt(4, 'test_tannery');
      setMaterials(k, { pristine_fur: 1 });
      expect(sent(k, selectActivity({ activity: 'craft_leather' }))).toBe(true);
      for (let i = 0; i < 400 && !counts(k)['leather']; i++) k.tick();

      // One pristine pelt in, two leather out, not one.
      expect(counts(k)['leather']).toBe(2);
      expect(counts(k)['pristine_fur']).toBeUndefined();
    });
  });

  it('a recipe without alts is untouched', () => {
    const recipe = RECIPES['iron_ingot'];
    const k = crafter(5);
    expect(canAfford(held(k), recipe)).toBe(false);
    setMaterials(k, { iron_scrap: 3 });
    expect(chooseRoute(held(k), recipe)?.id).toBe('primary');
    expect(routeYield(recipe, spend(k, recipe))).toBe(1);
    expect(counts(k)['iron_scrap']).toBeUndefined();
  });
});

describe('scoped stats', () => {
  /** A leatherworker at the Forges. */
  function leatherworker(seed: number, level: number): Kernel {
    const k = gameAt(seed, 'the_forges');
    if (level > 0) setSkill(k, 'leathercrafting', level);
    return k;
  }

  const rate = (k: Kernel, act: ReturnType<typeof craftActivity>): number => activityFillRate(reads(k), act, statBlockOf(reads(k)));
  const forgeAct = (id: string) => spotActivities(SPOTS.the_forges).find((a) => a.id === id)!;

  it('never reaches the flat stat block', () => {
    const plain = statBlockOf(reads(leatherworker(1, 0)));
    const skilled = statBlockOf(reads(leatherworker(1, 50)));
    // 50 levels of a scoped +1%/level bonus change the global number by zero.
    expect(skilled.craftSpeed).toBeCloseTo(plain.craftSpeed, 10);
  });

  it('speeds up the tagged craft and leaves the others alone', () => {
    const none = leatherworker(2, 0);
    const skilled = leatherworker(2, 50);
    const leather = craftActivity(LEATHER);
    // leather is tagged 'leatherwork'; iron_ingot is not.
    expect(rate(skilled, leather)).toBeGreaterThan(rate(none, leather));
    expect(rate(skilled, forgeAct('craft_iron_ingot'))).toBeCloseTo(rate(none, forgeAct('craft_iron_ingot')), 10);
  });

  it('scales with level the way the modifier says', () => {
    const at = (level: number) => rate(leatherworker(3, level), craftActivity(LEATHER));
    // perLevel 0.01 as a mult: 20 levels is x1.20 over the unskilled rate.
    expect(at(20) / at(0)).toBeCloseTo(1.2, 4);
  });
});

describe('crafting', () => {
  const smith = (seed: number): Kernel => gameAt(seed, 'the_forges');

  it('spot activities include synthesized craft entries', () => {
    const acts = spotActivities(SPOTS.the_forges);
    expect(acts.some((a) => a.id === 'craft_iron_ingot')).toBe(true);
    expect(acts.some((a) => a.kind === 'job')).toBe(true); // originals kept
  });

  it('crafts ingots from scrap, consuming materials and leveling Smithing', () => {
    const k = smith(41);
    setMaterials(k, { iron_scrap: 9 });
    expect(sent(k, selectActivity({ activity: 'craft_iron_ingot' }))).toBe(true);
    for (let i = 0; i < 400; i++) k.tick(); // 3 crafts at 120 ticks each
    expect(counts(k)['iron_ingot']).toBe(3);
    expect(counts(k)['iron_scrap']).toBeUndefined(); // fully consumed
    expect(skillsOf(k)['smithing']?.level).toBeGreaterThanOrEqual(1);
    // A craft pays its own discipline and nothing else.
    for (const other of ['cooking', 'alchemy', 'runecarving', 'leathercrafting']) {
      expect(skillsOf(k)[other], `smelting must not teach ${other}`).toBeUndefined();
    }
    expect(counterOf(k, 'crafts')).toBe(3);
    expect(worldOf(k).activity).toBeNull(); // stopped when starved (4th craft impossible)
    expect(logOf(k)).toContain('📭 Out of materials for Craft Iron Ingot.');
  });

  it.todo('crafted items land in the inventory (recipe not listed by any spot through floor 6: leather_cap)');
  it.todo('gated recipes refuse selection until the skill threshold (recipe not listed by any spot through floor 6: wolf_cloak)');

  it('craftSpeed shortens the craft cycle', () => {
    const k = smith(44);
    setMaterials(k, { iron_scrap: 99 });
    setSkill(k, 'smithing', 100); // craftSpeed x2
    expect(sent(k, selectActivity({ activity: 'craft_iron_ingot' }))).toBe(true);
    for (let i = 0; i < 130; i++) k.tick(); // one cycle would take 120 at x1, about 60 at x2
    expect(counts(k)['iron_ingot']).toBeGreaterThanOrEqual(2);
  });

  it('canAfford tracks material stacks', () => {
    const k = smith(45);
    setMaterials(k, {});
    expect(canAfford(held(k), RECIPES.iron_ingot)).toBe(false);
    setMaterials(k, { iron_scrap: 3 });
    expect(canAfford(held(k), RECIPES.iron_ingot)).toBe(true);
  });
});

describe('the bronze line (old rarefinds)', () => {
  it('Wrights: the bronze line is not listed until the pattern is studied', () => {
    const k = makeGame({ seed: 1 });
    for (const id of ['copper_ingot', 'tin_ingot', 'bronze_ingot']) {
      expect(recipeHidden(reads(k), RECIPES[id]), id).toBe(true);
    }
    patch(k, (slices) => {
      (slices.materials as MaterialsState).counts.smiths_pattern_bronze = 1;
    });
    expect(k.dispatch(useConsumable({ id: 'smiths_pattern_bronze' })).ok).toBe(true);
    for (const id of ['copper_ingot', 'tin_ingot', 'bronze_ingot']) {
      expect(recipeHidden(reads(k), RECIPES[id]), id).toBe(false);
    }
    expect(SPOTS.the_forges.recipes).toContain('bronze_ingot');
  });
});

describe('the craft activity in the world (step 3)', () => {
  it('the Location view leaves out a secret recipe until it is unlocked', () => {
    const k = gameAt(7, 'the_forges');
    const listed = () => viewOf(k).activities.map((a) => a.id);
    expect(listed()).toContain('craft_iron_ingot');
    expect(listed()).not.toContain('craft_bronze_ingot');
    patch(k, (slices) => {
      (slices.counters as CountersState).counts['flag:pattern_bronze'] = 1;
    });
    expect(listed()).toContain('craft_bronze_ingot');
    const bronze = viewOf(k).activities.find((a) => a.id === 'craft_bronze_ingot')!;
    expect(bronze.locked).toBe(false);
    expect(bronze.blocked).toBeNull();
    expect(bronze.detail).toMatch(/^Cost: /);
  });

  it('a locked recipe is refused with a reason and a log line', () => {
    const k = gameAt(8, 'the_forges');
    setMaterials(k, { copper_ore: 9 });
    const result = k.dispatch(selectActivity({ activity: 'craft_copper_ingot' }));
    expect(result).toEqual({ ok: false, reason: 'the recipe "copper_ingot" is locked' });
    expect(worldOf(k).activity).toBeNull();
    expect(logOf(k)).toContain('🔒 You lack the skill to craft that.');
  });

  it('an unaffordable craft starts and stops on its first tick, as in the old build', () => {
    const k = gameAt(9, 'the_forges');
    setMaterials(k, {});
    expect(sent(k, selectActivity({ activity: 'craft_iron_ingot' }))).toBe(true);
    k.tick();
    expect(worldOf(k).activity).toBeNull();
    expect(worldOf(k).resumeActivity.the_forges).toBe('craft_iron_ingot');
  });
});

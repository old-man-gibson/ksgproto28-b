/**
 * Port of old `tests/cookbook.test.ts`: food scaling, harmful conditions, the
 * food lint, cook counts, the plate card, Signatures, the Cook's Book, the
 * cookery novelty domain, Cook's Notes and the Book's threshold notes.
 *
 * Call shape changes:
 * - The game is a kernel (`makeGame`); state is set with `patch` (a save and
 *   a load). The old `kitchen(level)` patches the skill and the stock.
 * - `cook(state, bus, placement, disc, duration)` is the request
 *   `cooking/cook { discipline, placement, duration }`.
 * - The bus events `cooked` and `craft` are the kernel events
 *   `cooking/cooked` and `benches/crafted`, heard with `kernel.onEvent`.
 * - `useConsumable(state, bus, id, q)` is the command `consumables/use`. The
 *   old call returned `{ restored, granted, signature }`; here the case reads
 *   the same facts back: restored health from the health pool, the grants
 *   from the held conditions, the Signature from the eat line in the log
 *   (`Signature: also <name> ×<dose>`).
 * - The cook counters (`state.stats`) are the `counters` slice; the novelty
 *   record (`state.novelty`) is in the `skills` slice; the Cook's Notes lists
 *   (`state.prestige.cookbook`) are the `cooking` slice's `carried`.
 * - Book functions take `bookOf(reads(kernel))` instead of the state;
 *   `carriedCookbook` takes `{ counters, carried }`.
 * - `getDerivedStats(state)` is `statBlockOf(kernel)`; the old comparison with
 *   `computeDerivedStats` is `kernel.staleStats()` empty. `statBreakdown`
 *   takes the collected modifiers.
 * - `bandedXpNeeded(skillProgression(id), level)` is `skillXpNeeded(id, level)`.
 * - `game.prestige(now)` is the command `prestige/now`, `game.buyBoon(id)` the
 *   command `prestige/buy-boon`. `clearFloors` sets the floor clear counters
 *   (as in `tests/prestige.test.ts`).
 * - A bench run (`startBenchWork`) is the command `benches/start`. The old
 *   cases stood at `my_home`; no spot here holds the player base, so they
 *   stand at `granary_kitchens`, which holds the stove.
 *
 * `it.todo`: the save v58 cases that test the old migration and save
 * version. The save here starts at version 1 with no importer. The round
 * trip is ported through the kernel's save and load.
 */
import { describe, expect, it } from 'vitest';
import { PLAYER, type Kernel } from '../src/kernel';
import { DISCIPLINES, startBench, type DisciplineDef, type Placement } from '../src/systems/benches';
import {
  bookOf,
  carriedCookbook,
  COOK_TIME_COOKS,
  cookbook,
  cookedGradeKey,
  cookedKey,
  cookingDishIds,
  cookRequest,
  dishQualityRange,
  benchReadsOf,
  foodProblems,
  SIGNATURE_COOKS,
  type CookingState,
} from '../src/systems/cooking';
import { useConsumable } from '../src/systems/consumables';
import type { CountersState } from '../src/systems/counters';
import { FLOORS } from '../src/systems/ladder';
import type { LogEntry, LogState } from '../src/systems/log';
import { MATERIALS, QUALITY_ORDER, qualityRank, type MaterialDef, type QualityTier } from '../src/systems/materials';
import { buyBoon, prestigeNow, PRESTIGE_BOONS } from '../src/systems/prestige';
import { noveltyRemaining, SKILLS, skillXpNeeded, type SkillsState } from '../src/systems/skills';
import { FOOD_MULT_CAP, statBlockOf, statBreakdown } from '../src/systems/stats';
import { applyStatus, harmOf, heldOf, isHarmful, STATUSES, type StatusDef, type StatusesState } from '../src/systems/statuses';
import { ask, makeGame, patch, reads, slice } from './helpers';
import { hpOf, setPool } from './combatHelpers';
import { setCounters } from './worldHelpers';

const STOVE = 'cooking';
const at = (id: string, quality: QualityTier = 'c') => ({ id, quality });
const stew = (q: QualityTier = 'c'): Placement => ({ main: at('raw_meat', q), second: at('wild_onion', q) });

/** Add graded stock. The old `grantGraded(state, id, q, n)`. */
function grantGraded(g: Kernel, id: string, q: QualityTier, n: number): void {
  patch(g, (s) => {
    s.materials.stock[id] ??= {};
    s.materials.stock[id][q] = (s.materials.stock[id][q] ?? 0) + n;
  });
}

/** Set counters directly. The old `state.stats[key] = n`. */
function setStat(g: Kernel, key: string, n: number): void {
  patch(g, (s) => {
    s.counters.counts[key] = n;
  });
}
const stat = (g: Kernel, key: string): number | undefined => slice<CountersState>(g, 'counters').counts[key];
const counterKeys = (g: Kernel) => Object.keys(slice<CountersState>(g, 'counters').counts);
const skillsOf = (g: Kernel) => slice<SkillsState>(g, 'skills');
const cookingOf = (g: Kernel) => slice<CookingState>(g, 'cooking');
const logEntries = (g: Kernel): LogEntry[] => slice<LogState>(g, 'log').log;
const stats = (g: Kernel) => statBlockOf(g);
const book = (g: Kernel) => bookOf(reads(g));

/** A kitchen with plenty of stock at five grades, and a cook of the given level. */
function kitchen(level = 1): Kernel {
  const g = makeGame({ seed: 1 });
  patch(g, (s) => {
    s.skills.skills.cooking = { level, xp: 0 };
    for (const id of ['raw_meat', 'wild_onion', 'cave_mushroom', 'common_herb', 'rock_salt', 'rough_flour', 'forest_berries']) {
      s.materials.stock[id] ??= {};
      for (const q of ['e', 'd', 'c', 'b', 'a'] as QualityTier[]) s.materials.stock[id][q] = (s.materials.stock[id][q] ?? 0) + 300;
    }
  });
  return g;
}

/** The old `cook(state, bus, placement, disc, duration)`. */
const cook = (g: Kernel, placement: Placement, discipline = STOVE, duration?: number) =>
  ask(g, cookRequest, { discipline, placement, ...(duration !== undefined ? { duration } : {}) });

/**
 * Cook the stove's stew `n` times from ingredients of one grade. Returns the grades
 * that came out, which is what the counters must add up to: the dish's grade
 * depends on the cook's level, and a level drifts as the XP lands.
 */
function cookStew(g: Kernel, n: number, q: QualityTier = 'c'): QualityTier[] {
  const out: QualityTier[] = [];
  for (let i = 0; i < n; i++) {
    const done = cook(g, stew(q), STOVE, 12);
    expect(done).not.toBeNull();
    out.push(done!.quality);
  }
  return out;
}

const tally = (grades: QualityTier[]) => {
  const out: Record<string, number> = {};
  for (const q of grades) out[q] = (out[q] ?? 0) + 1;
  return out;
};

const row = (g: Kernel, benchId: string, outcomeId: string) =>
  cookbook(book(g)).find((r) => r.benchId === benchId && r.outcomeId === outcomeId)!;

const held = (g: Kernel) => heldOf(slice<StatusesState>(g, 'statuses'), PLAYER);
const findStatus = (g: Kernel, id: string) => held(g).find((s) => s.id === id);
const hasStatus = (g: Kernel, id: string) => !!findStatus(g, id);

/**
 * Eat one held dish: the old `useConsumable(state, bus, id, q)`. The old call
 * returned what it did; here it is read back from the slices and the log.
 */
function useIt(g: Kernel, id: string, quality: QualityTier) {
  const hpBefore = hpOf(g);
  const result = g.dispatch(useConsumable({ id, quality }));
  expect(result.ok, result.ok ? id : result.reason).toBe(true);
  const def = MATERIALS[id];
  const spec = def.consumable!;
  // The eat line is the newest line that names the dish.
  const line = [...logEntries(g)].reverse().find((l) => l.msg.includes(` ${def.name}`) && !l.group)?.msg ?? '';
  const sigPart = line.includes('Signature: also') ? line.slice(line.indexOf('Signature: also')) : '';
  const signature = (spec.signature ?? []).map((s) => s.id).filter((sid) => sigPart.includes(STATUSES[sid]?.name ?? sid));
  const grants = qualityRank(quality) > 0 ? (spec.grants ?? []).map((a) => a.id).filter((gid) => hasStatus(g, gid)) : [];
  return {
    restored: [{ resource: 'hp', amount: hpOf(g) - hpBefore }],
    granted: [...grants, ...signature],
    signature,
  };
}

/** Set the counters each floor's `clear` reads, floors 1 to 6. The old `clearFloors`. */
function clearFloors(g: Kernel): void {
  const values: Record<string, number> = {};
  for (const id of ['ascent_f1', 'ascent_f2', 'ascent_f3', 'ascent_f4', 'ascent_f5', 'ascent_f6']) {
    for (const c of FLOORS[id].clear ?? []) if (c.type === 'stat') values[c.key] = c.value;
  }
  setCounters(g, values);
}
const prestige = (g: Kernel): boolean => g.dispatch(prestigeNow()).ok;
const buy = (g: Kernel, boon: string): boolean => g.dispatch(buyBoon({ boon })).ok;
const setPoints = (g: Kernel, points: number) => patch(g, (s) => (s.prestige.points = points));

describe('food scales with Cooking, and the read is capped', () => {
  it('+0.06 Duration every 10 levels, +0.05 Potency every 20', () => {
    const at_ = (level: number) => stats(kitchen(level));
    expect(at_(1).foodDuration).toBe(1);
    expect(at_(1).foodPotency).toBe(1);
    expect(at_(9).foodDuration).toBe(1);
    expect(at_(10).foodDuration).toBeCloseTo(1.06);
    expect(at_(10).foodPotency).toBe(1);
    expect(at_(19).foodPotency).toBe(1);
    expect(at_(20).foodDuration).toBeCloseTo(1.12);
    expect(at_(20).foodPotency).toBeCloseTo(1.05);
    expect(at_(60).foodDuration).toBeCloseTo(1.36);
    expect(at_(60).foodPotency).toBeCloseTo(1.15);
  });

  it('holds at ×1.5 from far past the last milestone, and the breakdown says it is capped', () => {
    expect(FOOD_MULT_CAP).toBe(1.5);
    for (const level of [200, 1000]) {
      const g = kitchen(level);
      const s = stats(g);
      expect(s.foodDuration).toBe(1.5);
      expect(s.foodPotency).toBe(1.5);
      expect(g.staleStats()).toEqual([]);
    }
    // Duration's milestones add up to 1.54 by level 90, Potency's to exactly 1.5
    // at 200: the raw total passes the cap for Duration and the clamp trims it.
    const g = kitchen(1000);
    expect(statBreakdown(g.modifiers(), 'foodDuration').capped).toBe(true);
    expect(stats(g).foodDuration).toBe(1.5);
    // Duration reaches the cap at 90, Potency at 200; neither earlier.
    expect(stats(kitchen(89)).foodDuration).toBeLessThan(1.5);
    expect(stats(kitchen(90)).foodDuration).toBe(1.5);
    expect(stats(kitchen(199)).foodPotency).toBeLessThan(1.5);
    expect(stats(kitchen(200)).foodPotency).toBe(1.5);
  });

  it('anything else that adds to the stat is held at the same line', () => {
    // A condition from outside the skill (a stand-in for gear or a title).
    STATUSES.test_feast = {
      id: 'test_feast',
      name: 'Test Feast',
      icon: '🍽️',
      desc: 'A stand-in for any outside source of food multipliers.',
      stacking: { mode: 'highest' },
      duration: 600,
      mods: [
        { stat: 'foodDuration', op: 'add', value: 5 },
        { stat: 'foodPotency', op: 'add', value: 5 },
      ],
    } as unknown as StatusDef;
    try {
      const g = kitchen(1);
      expect(ask(g, applyStatus, { entity: PLAYER, app: { id: 'test_feast' }, source: 'test' })).not.toBeNull();
      const s = stats(g);
      expect(s.foodDuration).toBe(FOOD_MULT_CAP);
      expect(s.foodPotency).toBe(FOOD_MULT_CAP);
      expect(g.staleStats()).toEqual([]);
    } finally {
      delete STATUSES.test_feast;
    }
  });

  it('a dish lasts foodDuration times as long and lands foodPotency times as hard', () => {
    const novice = kitchen(1);
    const master = kitchen(200);
    for (const g of [novice, master]) {
      grantGraded(g, 'hearty_stew', 'c', 1);
      useIt(g, 'hearty_stew', 'c');
    }
    const base = findStatus(novice, 'well_fed')!;
    const best = findStatus(master, 'well_fed')!;
    expect(base.intensity).toBe(1);
    expect(base.ticksLeft).toBe(STATUSES.well_fed.duration);
    expect(best.intensity).toBeCloseTo(1.5);
    expect(best.ticksLeft).toBe(Math.round((STATUSES.well_fed.duration as number) * 1.5));
    // The stat block follows: more max HP from the same dish.
    expect(stats(master).maxHp).toBeGreaterThan(stats(novice).maxHp);
  });

  it("scales a dish's own explicit duration, not just the condition's", () => {
    const g = kitchen(200);
    grantGraded(g, 'braised_meat', 'c', 1);
    useIt(g, 'braised_meat', 'c');
    // Braised Meat asks for 9000 ticks (15 minutes) in the dish itself.
    expect(findStatus(g, 'well_fed')!.ticksLeft).toBe(Math.round(9000 * 1.5));
    expect(findStatus(g, 'well_fed')!.intensity).toBeCloseTo(1.5 * 1.5);
  });

  it('scales what a dish restores by potency', () => {
    const gain = (level: number) => {
      const g = kitchen(level);
      grantGraded(g, 'herb_rubbed_meat', 'c', 1);
      setPool(g, 'hp', 1);
      return useIt(g, 'herb_rubbed_meat', 'c').restored[0].amount;
    };
    expect(gain(200) / gain(1)).toBeCloseTo(1.5, 2);
  });

  it('leaves non-food alone, a spoiled grade alone, and the spoilage condition alone', () => {
    // A salve is not food: Cooking 200 changes nothing.
    const restored = (level: number) => {
      const g = kitchen(level);
      grantGraded(g, 'healing_salve', 'c', 1);
      setPool(g, 'hp', 1);
      const hp = hpOf(g);
      expect(g.dispatch(useConsumable({ id: 'healing_salve', quality: 'c' })).ok).toBe(true);
      return hpOf(g) - hp;
    };
    expect(restored(200)).toBeCloseTo(restored(1));

    // Refuse grade: a better cook does not make the sickness worse.
    const sour = kitchen(200);
    grantGraded(sour, 'hearty_stew', 'f', 1);
    useIt(sour, 'hearty_stew', 'f');
    expect(findStatus(sour, 'queasy')!.intensity).toBeCloseTo(0.5);
    expect(findStatus(sour, 'queasy')!.ticksLeft).toBe(STATUSES.queasy.duration);

    // The Scorched Mess grants queasy at a positive grade: still unscaled.
    const mess = kitchen(200);
    grantGraded(mess, 'scorched_mess', 'c', 1);
    useIt(mess, 'scorched_mess', 'c');
    expect(findStatus(mess, 'queasy')!.intensity).toBe(1);
    expect(findStatus(mess, 'queasy')!.ticksLeft).toBe(STATUSES.queasy.duration);
  });
});

describe('what counts as a harmful condition', () => {
  const status = (p: Record<string, unknown>): StatusDef =>
    ({
      id: 'test_status',
      name: 'Test Status',
      icon: '🧪',
      desc: 'A stand-in.',
      stacking: { mode: 'highest' },
      duration: 600,
      ...p,
    }) as unknown as StatusDef;

  it('is read from the condition, field by field', () => {
    expect(harmOf(status({ dot: { type: 'poison', flat: 0.1 } }))).toBe('dot');
    expect(harmOf(status({ drains: { resource: 'mana', ofMax: 0.01 } }))).toBe('drains');
    expect(harmOf(status({ detonate: { type: 'arcane', ofDebt: 1 } }))).toBe('detonate');
    expect(harmOf(status({ expireDamage: { type: 'piercing', flat: 1 } }))).toBe('expireDamage');
    expect(harmOf(status({ fatalOnEmpty: { resource: 'hp', retains: 1 } }))).toBe('fatalOnEmpty');
    expect(harmOf(status({ blocks: ['spell'] }))).toBe('blocks');
    expect(harmOf(status({ blocksRegen: ['hp'] }))).toBe('blocksRegen');
    expect(harmOf(status({ ceilings: [{ resource: 'hp', per: 0.1 }] }))).toBe('ceilings');
    expect(harmOf(status({ missChance: 0.1 }))).toBe('missChance');
    expect(harmOf(status({ healCap: 0 }))).toBe('healCap');
    expect(harmOf(status({ disadvantage: true }))).toBe('disadvantage');
    expect(harmOf(status({ element: 'heat' }))).toBe('element');
    expect(harmOf(status({ escalatesTo: 'blazing' }))).toBe('escalatesTo');
    expect(harmOf(status({ expiresTo: 'rot_recovery' }))).toBe('expiresTo');
  });

  it('reads a modifier that makes the bearer worse, either way round', () => {
    expect(harmOf(status({ mods: [{ stat: 'maxHp', op: 'add', value: -8 }] }))).toContain('maxHp');
    expect(harmOf(status({ mods: [{ stat: 'craftSpeed:smithing', op: 'mult', value: -0.1 }] }))).toContain('craftSpeed');
    // Lower is better for damage taken: a negative value there helps.
    expect(harmOf(status({ mods: [{ stat: 'damageTaken', op: 'mult', value: -0.1 }] }))).toBeNull();
    expect(harmOf(status({ mods: [{ stat: 'damageTaken', op: 'mult', value: 0.1 }] }))).toContain('damageTaken');
    expect(harmOf(status({ mods: [{ stat: 'maxHp', op: 'add', value: 8 }] }))).toBeNull();
  });

  it('does not mark what helps or only changes other conditions', () => {
    expect(harmOf(status({ restores: [{ resource: 'hp', ofMax: 0.001 }] }))).toBeNull();
    expect(harmOf(status({ immune: { ids: ['poison'] } }))).toBeNull();
    expect(harmOf(status({ amplifies: [{ id: 'poison', mult: 2 }] }))).toBeNull();
    expect(harmOf(status({}))).toBeNull();
  });

  it('on the live conditions: the five food conditions are harmless, spoilage and the afflictions are not', () => {
    for (const id of ['well_fed', 'steady_hand', 'clear_headed', 'stoked', 'steeped']) {
      expect(harmOf(STATUSES[id]), id).toBeNull();
    }
    for (const id of ['queasy', 'poison', 'bleeding', 'on_fire', 'manaburn', 'blinded', 'fasting']) {
      expect(isHarmful(STATUSES[id]), id).toBe(true);
    }
  });
});

type ConsumableSpec = NonNullable<MaterialDef['consumable']>;

describe('the food flag lint', () => {
  const discs = Object.values(DISCIPLINES);
  const lint = (
    materials: Record<string, MaterialDef>,
    disciplines: DisciplineDef[] = discs,
    statuses: Record<string, StatusDef> = STATUSES,
  ) => foodProblems(disciplines, materials, statuses).map((p) => p.message);
  const mark = (id: string, p: Record<string, unknown>): Record<string, MaterialDef> => ({
    ...MATERIALS,
    [id]: { ...MATERIALS[id], consumable: { ...MATERIALS[id].consumable, ...p } as ConsumableSpec },
  });
  /** Several dishes patched at once. */
  const markAll = (patches: Record<string, Record<string, unknown>>): Record<string, MaterialDef> => {
    let out: Record<string, MaterialDef> = { ...MATERIALS };
    for (const [id, p] of Object.entries(patches)) {
      out = { ...out, [id]: { ...MATERIALS[id], consumable: { ...MATERIALS[id].consumable, ...p } as ConsumableSpec } };
    }
    return out;
  };

  it('passes on the live content', () => {
    expect(lint(MATERIALS)).toEqual([]);
  });

  it('catches a flask marked as food', () => {
    expect(lint(mark('healing_salve', { food: true }))).toEqual([
      "'healing_salve' is marked food but no cooking bench makes it",
    ]);
    // An alchemy bench whose outcome makes a material: marking its product food is the same mistake.
    const brewery = {
      ...DISCIPLINES.cooking,
      id: 'test_brewery',
      skill: 'alchemy',
      outcomes: [{ id: 'tonic', name: 'Tonic', icon: '🧪', requires: [{ tag: 'herb' }], result: { kind: 'material', id: 'test_tonic' } }],
    } as unknown as DisciplineDef;
    const tonic = (food: boolean): MaterialDef =>
      ({
        id: 'test_tonic', name: 'Test Tonic', icon: '🧪', value: 1, graded: true,
        consumable: { food, grants: [{ id: 'well_fed' }] },
      }) as unknown as MaterialDef;
    expect(lint({ ...MATERIALS, test_tonic: tonic(true) }, [...discs, brewery])).toEqual([
      "'test_tonic' is marked food but no cooking bench makes it",
    ]);
    expect(lint({ ...MATERIALS, test_tonic: tonic(false) }, [...discs, brewery])).toEqual([]);
  });

  it('catches a dish left unmarked, one with no signature, and a failure dish that has one', () => {
    expect(lint(mark('hearty_stew', { food: false }))).toContain(
      "'hearty_stew' is made by cooking/stew, a cooking bench, but is not marked food",
    );
    expect(lint(mark('hearty_stew', { signature: undefined }))).toEqual(["'hearty_stew' is a dish and has no signature"]);
    const problems = lint(mark('scorched_mess', { signature: [{ id: 'stoked', intensity: 0.5 }] }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("'scorched_mess' is a failure dish");
  });

  it('catches a signature that does nothing, names nothing, or sits on non-food', () => {
    expect(lint(mark('hearty_stew', { signature: [{ id: 'well_fed', intensity: 0.5 }] }))).toEqual([
      "'hearty_stew' signature repeats its own grant 'well_fed'",
    ]);
    expect(lint(mark('hearty_stew', { signature: [{ id: 'no_such_condition', intensity: 0.5 }] }))).toEqual([
      "'hearty_stew' signature names unknown condition 'no_such_condition'",
    ]);
    expect(lint(mark('healing_salve', { signature: [{ id: 'stoked', intensity: 0.5 }] }))).toEqual([
      "'healing_salve' has a signature but is not food",
    ]);
  });

  it('catches a signature that lists a condition twice', () => {
    expect(
      lint(mark('hearty_stew', { signature: [{ id: 'stoked', intensity: 0.5 }, { id: 'stoked', intensity: 0.25 }] })),
    ).toEqual(["'hearty_stew' signature lists 'stoked' twice"]);
  });

  it('catches a signature that is the spoilage condition, derived from what the failure dish grants', () => {
    // Harmless-looking spoilage: the mess grants a benign condition, so the harm
    // rule is silent and only the spoilage rule can catch a signature on it.
    const benignMess = markAll({
      scorched_mess: { grants: [{ id: 'psionic_haste', intensity: 1 }] },
      berry_pie: { signature: [{ id: 'psionic_haste', intensity: 0.5 }] },
    });
    expect(lint(benignMess)).toEqual(["'berry_pie' signature is the spoilage condition 'psionic_haste'"]);
    // And on the live content, where spoilage is queasy, both rules fire.
    const problems = lint(mark('berry_pie', { signature: [{ id: 'queasy', intensity: 0.5 }] }));
    expect(problems).toContain("'berry_pie' signature is the spoilage condition 'queasy'");
    expect(problems.some((p) => p.includes('harmful condition (dot)'))).toBe(true);
  });

  it("catches food that never ends: 'permanent', or a duration of zero or less", () => {
    expect(lint(mark('hearty_stew', { grants: [{ id: 'well_fed', intensity: 1, duration: 'permanent' }] }))).toEqual([
      "'hearty_stew' grants 'well_fed' with duration 'permanent': a dish's effect must run out",
    ]);
    expect(lint(mark('hearty_stew', { signature: [{ id: 'stoked', intensity: 0.5, duration: 'permanent' }] }))).toEqual([
      "'hearty_stew' signature 'stoked' with duration 'permanent': a dish's effect must run out",
    ]);
    expect(lint(mark('hearty_stew', { grants: [{ id: 'well_fed', intensity: 1, duration: 0 }] }))).toEqual([
      "'hearty_stew' grants 'well_fed' with duration 0: it would end at once",
    ]);
    expect(lint(mark('hearty_stew', { signature: [{ id: 'stoked', intensity: 0.5, duration: -5 }] }))).toEqual([
      "'hearty_stew' signature 'stoked' with duration -5: it would end at once",
    ]);
    // The failure dish is not exempt from this one.
    expect(lint(mark('scorched_mess', { grants: [{ id: 'queasy', intensity: 1, duration: 'permanent' }] }))).toEqual([
      "'scorched_mess' grants 'queasy' with duration 'permanent': a dish's effect must run out",
    ]);
  });

  it('catches food that does nothing: intensity or chance of zero or less; a missing one is the default', () => {
    expect(lint(mark('hearty_stew', { grants: [{ id: 'well_fed', intensity: 0 }] }))).toEqual([
      "'hearty_stew' grants 'well_fed' with intensity 0: it would do nothing",
    ]);
    expect(lint(mark('hearty_stew', { signature: [{ id: 'stoked', intensity: -0.5 }] }))).toEqual([
      "'hearty_stew' signature 'stoked' with intensity -0.5: it would do nothing",
    ]);
    expect(lint(mark('hearty_stew', { grants: [{ id: 'well_fed', intensity: 1, chance: 0 }] }))).toEqual([
      "'hearty_stew' grants 'well_fed' with chance 0: it would never land",
    ]);
    // No intensity is intensity 1 (the eater reads `app.intensity ?? 1`), no chance is certain.
    expect(lint(mark('hearty_stew', { grants: [{ id: 'well_fed' }] }))).toEqual([]);
    expect(lint(mark('hearty_stew', { signature: [{ id: 'stoked' }] }))).toEqual([]);
  });

  it('catches a harmful condition on food, whichever field makes it harmful', () => {
    expect(lint(mark('hearty_stew', { grants: [{ id: 'poison', intensity: 1 }] }))).toEqual([
      "'hearty_stew' grants 'poison' is a harmful condition (dot); food only nourishes",
    ]);
    expect(lint(mark('hearty_stew', { signature: [{ id: 'bleeding', intensity: 0.5 }] }))).toEqual([
      "'hearty_stew' signature 'bleeding' is a harmful condition (dot); food only nourishes",
    ]);
    // The rule reads the condition, not its id: patch the registry with new conditions.
    const harm = (p: Record<string, unknown>): Record<string, StatusDef> => ({
      ...STATUSES,
      test_harm: { id: 'test_harm', name: 'Test Harm', icon: '🧪', desc: 'x', stacking: { mode: 'highest' }, duration: 600, ...p } as unknown as StatusDef,
    });
    const eats = { grants: [{ id: 'test_harm', intensity: 1 }] };
    for (const [field, p] of [
      ['drains', { drains: { resource: 'mana', ofMax: 0.01 } }],
      ['detonate', { detonate: { type: 'arcane', ofDebt: 1 } }],
      ['expireDamage', { expireDamage: { type: 'piercing', flat: 1 } }],
    ] as const) {
      expect(lint(mark('hearty_stew', eats), discs, harm(p)), field).toEqual([
        `'hearty_stew' grants 'test_harm' is a harmful condition (${field}); food only nourishes`,
      ]);
    }
    expect(lint(mark('hearty_stew', eats), discs, harm({ mods: [{ stat: 'maxHp', op: 'add', value: -8 }] }))).toEqual([
      "'hearty_stew' grants 'test_harm' is a harmful condition (mods (maxHp -8)); food only nourishes",
    ]);
    // A benign condition with the same shape passes.
    expect(lint(mark('hearty_stew', eats), discs, harm({ mods: [{ stat: 'maxHp', op: 'add', value: 8 }] }))).toEqual([]);
  });

  it("the failure dish's own harmful grants are the one exception", () => {
    // The live Scorched Mess grants queasy (a dot): the live-content test above already passes.
    expect(MATERIALS.scorched_mess.consumable!.grants!.map((a) => a.id)).toEqual(['queasy']);
    expect(isHarmful(STATUSES.queasy)).toBe(true);
    // Anywhere else queasy is refused as a grant.
    expect(lint(mark('hearty_stew', { grants: [{ id: 'queasy', intensity: 1 }] }))).toEqual([
      "'hearty_stew' grants 'queasy' is a harmful condition (dot); food only nourishes",
    ]);
  });

  it('the live content: every dish a cooking bench makes is food with a signature, the mess aside', () => {
    for (const id of cookingDishIds()) {
      const spec = MATERIALS[id].consumable!;
      expect(spec.food, id).toBe(true);
      expect(!!spec.signature?.length, id).toBe(id !== 'scorched_mess');
      for (const sig of spec.signature ?? []) expect(sig.intensity, id).toBe(0.5);
    }
    // And the converse: nothing that is not a cooking product is food.
    const dishes = new Set(cookingDishIds());
    for (const mat of Object.values(MATERIALS)) {
      if (mat.consumable?.food) expect(dishes.has(mat.id), mat.id).toBe(true);
    }
  });
});

describe('cook counts', () => {
  it('bump once per cook, for the dish and for the grade it came out at', () => {
    // Cooking 40: a level this deep does not move on a few cooks, so the grade
    // each ingredient set earns is steady (Poor -> Fine, Fair -> Superb, Superb -> Divine).
    const g = kitchen(40);
    const made = [...cookStew(g, 3, 'c'), ...cookStew(g, 2, 'e'), ...cookStew(g, 1, 'a')];
    expect(new Set(made).size).toBe(3);
    expect(stat(g, cookedKey('hearty_stew'))).toBe(6);
    for (const [grade, n] of Object.entries(tally(made))) {
      expect(stat(g, cookedGradeKey('hearty_stew', grade as QualityTier)), grade).toBe(n);
    }
    const gradeKeys = counterKeys(g).filter((k) => k.startsWith('cooked:hearty_stew:'));
    expect(gradeKeys).toHaveLength(3);
    // Another dish keeps its own count.
    expect(stat(g, cookedKey('mushroom_broth'))).toBeUndefined();
  });

  it('are keyed by the dish, so one dish from two benches is one count', () => {
    const g = kitchen();
    const ration = (): Placement => ({ main: at('rough_flour', 'c') });
    // Traveler's Ration: any one ingredient on the grill, two on the stove.
    expect(cook(g, ration(), 'grilling')).not.toBeNull();
    expect(cook(g, { main: at('rough_flour'), second: at('rock_salt') }, STOVE, 12)).not.toBeNull();
    expect(stat(g, cookedKey('travelers_ration'))).toBe(2);
  });

  it("do not count the cutting board's cuts, and a cut pays the ordinary rate", () => {
    const g = kitchen();
    const board: Placement = { board: at('wild_onion', 'c'), technique: at('sliced', 'c') };
    expect(cook(g, board, 'preparing')).not.toBeNull();
    expect(counterKeys(g).filter((k) => k.startsWith('cooked:'))).toEqual([]);
    expect(skillsOf(g).novelty.cooking).toBeUndefined();
    expect(cookbook(book(g)).every((r) => r.made === 0)).toBe(true);
  });

  it('count each cook of a bench run, batched or not', () => {
    const g = kitchen();
    patch(g, (s) => (s.world.spot = 'granary_kitchens'));
    expect(g.dispatch(startBench({ discipline: 'cooking', placement: stew('c'), count: 3, duration: 8 })).ok).toBe(true);
    for (let i = 0; i < 400 && slice<{ job: unknown }>(g, 'benches').job; i++) g.tick();
    expect(slice<{ job: unknown }>(g, 'benches').job).toBeNull();
    expect(stat(g, cookedKey('hearty_stew'))).toBe(3);
  });

  it('count the failure dish too', () => {
    const g = kitchen();
    grantGraded(g, 'wild_onion', 'f', 2);
    expect(cook(g, { main: at('wild_onion', 'f'), second: at('wild_onion', 'f') }, STOVE, 12)!.dish).toBe('scorched_mess');
    expect(stat(g, cookedKey('scorched_mess'))).toBe(1);
  });
});

/** Listen to the plate card events: the old bus events `craft` and `cooked`. */
function listen(g: Kernel, types: string[]) {
  const seen: { type: string; [k: string]: unknown }[] = [];
  g.onEvent((e) => {
    if (types.includes(e.type)) seen.push({ type: e.type, ...(e.payload as object) });
  });
  return seen;
}

describe('the plate card event', () => {
  it('says what was made, at what grade, in what range', () => {
    const g = kitchen();
    const seen = listen(g, ['cooking/cooked', 'benches/crafted']);
    expect(cook(g, stew('c'), STOVE, 12)).not.toBeNull();
    expect(seen).toEqual([
      { type: 'benches/crafted', discipline: 'cooking' },
      {
        type: 'cooking/cooked', discipline: 'cooking', outcome: 'stew', dish: 'hearty_stew',
        quality: 'c', low: 'c', high: 'c', qty: 1,
      },
    ]);
  });

  it("carries the preview's grade range, and the grade rolled lands inside it", () => {
    const g = kitchen(9);
    grantGraded(g, 'wild_onion_diced', 'c', 20);
    // Superb meat and a Fair diced onion at Cooking 9: the score straddles the
    // Fine / Superb line (2.46 to 2.60 against 2.5).
    const placement: Placement = { main: at('raw_meat', 'a'), second: at('wild_onion_diced', 'c') };
    const range = dishQualityRange(benchReadsOf(reads(g)), placement);
    expect([range.min, range.max]).toEqual(['b', 'a']);
    const cooked = listen(g, ['cooking/cooked']) as unknown as { quality: QualityTier; low: QualityTier; high: QualityTier }[];
    for (let i = 0; i < 6; i++) {
      patch(g, (s) => (s.skills.skills.cooking = { level: 9, xp: 0 })); // the XP of the last cook must not move the range
      cook(g, placement);
    }
    expect(cooked).toHaveLength(6);
    for (const e of cooked) {
      expect(e.low).toBe(range.min);
      expect(e.high).toBe(range.max);
      expect(qualityRank(e.quality)).toBeGreaterThanOrEqual(qualityRank(e.low));
      expect(qualityRank(e.quality)).toBeLessThanOrEqual(qualityRank(e.high));
    }
  });

  it('is not sent for a cut', () => {
    const g = kitchen();
    const seen = listen(g, ['cooking/cooked', 'benches/crafted']);
    cook(g, { board: at('wild_onion', 'c'), technique: at('sliced', 'c') }, 'preparing');
    expect(seen.map((e) => e.type)).toEqual(['benches/crafted']);
  });
});

describe('Signatures', () => {
  it('arrive when a dish has been cooked 100 times, and not at 99', () => {
    expect(SIGNATURE_COOKS).toBe(100);
    const g = kitchen();
    setStat(g, cookedKey('hearty_stew'), SIGNATURE_COOKS - 2);
    cookStew(g, 1); // 99
    expect(stat(g, cookedKey('hearty_stew'))).toBe(99);
    const before = useIt(g, 'hearty_stew', 'c');
    expect(before.signature).toEqual([]);
    expect(hasStatus(g, 'stoked')).toBe(false);

    cookStew(g, 1); // 100
    const after = useIt(g, 'hearty_stew', 'c');
    expect(after.signature).toEqual(['stoked']);
    expect(after.granted).toEqual(['well_fed', 'stoked']);
    expect(findStatus(g, 'stoked')!.intensity).toBeCloseTo(0.5);
  });

  it('are scaled by grade like the dish itself', () => {
    const g = kitchen();
    setStat(g, cookedKey('hearty_stew'), 500);
    grantGraded(g, 'hearty_stew', 's', 1);
    useIt(g, 'hearty_stew', 's');
    expect(findStatus(g, 'stoked')!.intensity).toBeCloseTo(0.5 * 4);
    expect(findStatus(g, 'well_fed')!.intensity).toBeCloseTo(4);
  });

  it('follow the cook as well: a Signature is food', () => {
    const g = kitchen(200);
    setStat(g, cookedKey('hearty_stew'), 100);
    grantGraded(g, 'hearty_stew', 'c', 1);
    useIt(g, 'hearty_stew', 'c');
    expect(findStatus(g, 'stoked')!.intensity).toBeCloseTo(0.5 * 1.5);
    expect(findStatus(g, 'stoked')!.ticksLeft).toBe(Math.round((STATUSES.stoked.duration as number) * 1.5));
  });

  it('are not granted by spoiled food', () => {
    const g = kitchen();
    setStat(g, cookedKey('hearty_stew'), 500);
    grantGraded(g, 'hearty_stew', 'f', 1);
    useIt(g, 'hearty_stew', 'f');
    expect(hasStatus(g, 'stoked')).toBe(false);
    expect(hasStatus(g, 'queasy')).toBe(true);
  });

  it('every dish grants its own, a different condition from its main grants', () => {
    for (const id of cookingDishIds()) {
      const spec = MATERIALS[id].consumable!;
      if (!spec.signature) continue;
      const g = kitchen();
      setStat(g, cookedKey(id), SIGNATURE_COOKS);
      grantGraded(g, id, 'c', 1);
      const result = useIt(g, id, 'c');
      expect(result.signature, id).toEqual(spec.signature.map((s) => s.id));
      for (const sig of spec.signature) {
        expect(hasStatus(g, sig.id), `${id} -> ${sig.id}`).toBe(true);
        expect(spec.grants!.map((a) => a.id), id).not.toContain(sig.id);
      }
    }
  });
});

describe("the Cook's Book", () => {
  /** What the cooking benches can make, by bench then outcome, worked out from the data alone. */
  const expected = Object.values(DISCIPLINES)
    .filter((d) => d.skill === 'cooking')
    .flatMap((d) => d.outcomes.filter((o) => o.result.kind === 'material').map((o) => `${d.id}/${o.id}`));

  it('lists every cooking-bench outcome once, in bench order then outcome order', () => {
    const rows = cookbook(book(makeGame({ seed: 1 })));
    expect(rows.map((r) => `${r.benchId}/${r.outcomeId}`)).toEqual(expected);
    expect(new Set(rows.map((r) => `${r.benchId}/${r.outcomeId}`)).size).toBe(rows.length);
    // Stove, grill, oven, counter. The cutting board's cut is not a dish.
    expect([...new Set(rows.map((r) => r.benchId))]).toEqual(['cooking', 'grilling', 'baking', 'assembling']);
    expect(rows.some((r) => r.benchId === 'preparing')).toBe(false);
    // Learned dishes are listed although no card has been read.
    expect(rows.map((r) => r.outcomeId)).toContain('seared_stew');
    expect(rows.map((r) => r.outcomeId)).toContain('lectory_porridge');
    for (const r of rows) {
      expect(r.made).toBe(0);
      expect(r.best).toBeNull();
      expect(Object.keys(r.byGrade).sort()).toEqual([...QUALITY_ORDER].sort());
      expect(r.cookTimeKnown).toBe(false);
      expect(r.signature).toBe(false);
      expect(r.heat).toBeUndefined();
    }
  });

  it('reads the counters: made, by grade, best', () => {
    const g = kitchen(40);
    const made = [...cookStew(g, 2, 'c'), ...cookStew(g, 1, 'e')];
    const r = row(g, 'cooking', 'stew');
    expect(r.dishId).toBe('hearty_stew');
    expect(r.made).toBe(3);
    expect(r.byGrade).toEqual({ f: 0, e: 0, d: 0, c: 0, b: 0, a: 0, s: 0, ...tally(made) });
    expect(r.best).toBe(made.reduce((top, q) => (qualityRank(q) > qualityRank(top) ? q : top)));
    // The same dish from another bench shares the count; a different dish does not.
    expect(row(g, 'cooking', 'broth').made).toBe(0);
  });

  it('best never falls as more is cooked', () => {
    const g = kitchen(40);
    let top = -1;
    let seen = -1;
    for (const q of ['c', 'e', 'd', 'a', 'e', 'c', 'd'] as QualityTier[]) {
      const [made] = cookStew(g, 1, q);
      seen = Math.max(seen, qualityRank(made));
      const best = row(g, 'cooking', 'stew').best!;
      expect(qualityRank(best)).toBeGreaterThanOrEqual(top);
      top = qualityRank(best);
    }
    expect(top).toBe(seen);
  });

  it('shows a cook time at 25 cooks, with the window only then', () => {
    expect(COOK_TIME_COOKS).toBe(25);
    const g = kitchen();
    setStat(g, cookedKey('seared_stew'), COOK_TIME_COOKS - 1);
    expect(row(g, 'cooking', 'seared_stew').cookTimeKnown).toBe(false);
    expect(row(g, 'cooking', 'seared_stew').heat).toBeUndefined();
    setStat(g, cookedKey('seared_stew'), COOK_TIME_COOKS);
    const known = row(g, 'cooking', 'seared_stew');
    expect(known.cookTimeKnown).toBe(true);
    expect(known.heat).toEqual([{ tag: 'meat', to: 6 }]);
    // A dish with no window of its own is known but carries none.
    setStat(g, cookedKey('hearty_stew'), COOK_TIME_COOKS);
    expect(row(g, 'cooking', 'stew').cookTimeKnown).toBe(true);
    expect(row(g, 'cooking', 'stew').heat).toBeUndefined();
  });

  it('earns the Signature at 100 cooks; a dish with none never does', () => {
    const g = kitchen();
    setStat(g, cookedKey('hearty_stew'), SIGNATURE_COOKS - 1);
    expect(row(g, 'cooking', 'stew').signature).toBe(false);
    setStat(g, cookedKey('hearty_stew'), SIGNATURE_COOKS);
    expect(row(g, 'cooking', 'stew').signature).toBe(true);
    setStat(g, cookedKey('scorched_mess'), 1000);
    expect(row(g, 'cooking', 'mess').signature).toBe(false);
  });

  it('counts a dish once across the benches that make it', () => {
    const g = kitchen();
    setStat(g, cookedKey('travelers_ration'), 7);
    const rations = cookbook(book(g)).filter((r) => r.dishId === 'travelers_ration');
    expect(rations.map((r) => r.benchId)).toEqual(['cooking', 'grilling', 'baking', 'assembling']);
    for (const r of rations) expect(r.made).toBe(7);
  });
});

describe('the cookery novelty domain', () => {
  const spec = SKILLS.cooking.novelty!;
  /** What the nth repeat of a dish is worth as a multiple of the ordinary payout. */
  const yieldAt = (n: number) => (spec.k + n) / (spec.c + n);

  it('is declared on the cooking skill, keyed by dish', () => {
    expect(spec.domain).toBe('cookery');
    expect(spec.k).toBeGreaterThanOrEqual(spec.c); // opens at k / c >= 1 and never pays below the ordinary rate
  });

  it('pays a dish new to the Book once, then settles to the ordinary rate', () => {
    // A high level, so no cook crosses a level mid-measure and hides its XP.
    const g = kitchen(40);
    const xpOf = () => skillsOf(g).skills.cooking.xp;
    const gain = () => {
      const before = xpOf();
      cookStew(g, 1);
      return xpOf() - before;
    };
    const skillXp = stats(g).skillXp;
    const first = gain();
    const second = gain();
    const third = gain();
    // Same cook, same grade: the base is constant, so the novelty multiple is
    // visible directly as the ratio of one cook to the next.
    const base = second / yieldAt(1);
    expect(third / base).toBeCloseTo(yieldAt(2), 5);
    expect(second / base).toBeGreaterThan(third / base);
    // … and the first also carries the one-time discovery payout.
    expect(first - base * yieldAt(0)).toBeCloseTo(spec.discovery * skillXp, 5);
    expect(noveltyRemaining(skillsOf(g), 'cooking', 'hearty_stew')).toBeCloseTo(yieldAt(3));
    // A second dish is new again.
    const broth = (): Placement => ({ main: at('cave_mushroom'), second: at('common_herb') });
    const before = xpOf();
    cook(g, broth(), STOVE, 12);
    expect(xpOf() - before).toBeGreaterThan(third);
  });

  it('re-pays after a prestige: the novelty record and the Book reset with the run', () => {
    const g = kitchen();
    clearFloors(g);
    cookStew(g, 1);
    expect(noveltyRemaining(skillsOf(g), 'cooking', 'hearty_stew')).toBeCloseTo(yieldAt(1));
    expect(prestige(g)).toBe(true);
    expect(skillsOf(g).novelty.cooking).toBeUndefined();
    expect(noveltyRemaining(skillsOf(g), 'cooking', 'hearty_stew')).toBeCloseTo(yieldAt(0));
  });

  describe('is a garnish on the ordinary rate (tuning, measured at Cooking 1)', () => {
    // The ten dishes a fresh save can cook with no recipe card and no level gate.
    const TEN: { bench: string; place: Placement; duration?: number }[] = [
      { bench: 'cooking', place: { main: at('raw_meat'), second: at('wild_onion') }, duration: 12 }, // stew
      { bench: 'cooking', place: { main: at('cave_mushroom'), second: at('common_herb') }, duration: 12 }, // broth
      { bench: 'cooking', place: { main: at('rough_flour'), second: at('rock_salt') }, duration: 12 }, // ration
      { bench: 'grilling', place: { main: at('river_fish') } }, // skewered fish
      { bench: 'grilling', place: { main: at('raw_meat') } }, // seared steak
      { bench: 'grilling', place: { main: at('wild_onion'), second: at('cave_mushroom') } }, // charred roots
      { bench: 'baking', place: { main: at('rough_flour'), second: at('rough_flour') } }, // loaf
      { bench: 'baking', place: { main: at('rough_flour'), second: at('forest_berries') } }, // pie
      { bench: 'assembling', place: { main: at('rustic_loaf'), second: at('seared_steak') } }, // sandwich
      { bench: 'assembling', place: { main: at('wild_onion'), second: at('cave_mushroom') } }, // salad
    ];
    const fresh = (): Kernel => {
      const g = makeGame({ seed: 1 });
      patch(g, (s) => {
        s.skills.skills.cooking = { level: 1, xp: 0 };
        for (const id of [
          'raw_meat', 'wild_onion', 'cave_mushroom', 'common_herb', 'river_fish', 'rock_salt',
          'rough_flour', 'forest_berries', 'rustic_loaf', 'seared_steak',
        ]) {
          s.materials.stock[id] ??= {};
          s.materials.stock[id].c = (s.materials.stock[id].c ?? 0) + 50;
        }
      });
      return g;
    };
    /** Level plus the share of the next level already earned. */
    const progress = (g: Kernel): number => {
      const s = skillsOf(g).skills.cooking;
      return s.level + s.xp / skillXpNeeded('cooking', s.level);
    };
    const runTen = (g: Kernel): number[] => {
      const after: number[] = [];
      for (const d of TEN) {
        expect(cook(g, d.place, d.bench, d.duration)).not.toBeNull();
        after.push(progress(g));
      }
      return after;
    };

    it('the first cook of a new dish is about one level and a third; one of each of ten is Cooking 8', () => {
      const withNovelty = runTen(fresh());
      // The first stew gains 1.0 to 1.6 levels, the ordinary cook's whole level included.
      expect(withNovelty[0] - 1).toBeGreaterThanOrEqual(1.0);
      expect(withNovelty[0] - 1).toBeLessThan(1.6);
      // Ten dishes land in 6 to 9 (a level shows as its integer part: 6, 7 or 8).
      expect(withNovelty[9]).toBeGreaterThanOrEqual(6);
      expect(withNovelty[9]).toBeLessThan(9);
    });

    it('adds at most two levels over the same ten cooks with no novelty at all', () => {
      const cookingDef = SKILLS.cooking as { novelty?: typeof spec };
      const saved = cookingDef.novelty;
      let floor: number;
      try {
        cookingDef.novelty = undefined;
        floor = runTen(fresh())[9];
      } finally {
        cookingDef.novelty = saved;
      }
      const withNovelty = runTen(fresh())[9];
      expect(floor).toBeGreaterThan(6.5); // ten ordinary cooks are already Cooking 7
      expect(withNovelty).toBeGreaterThan(floor);
      expect(withNovelty - floor).toBeLessThan(2);
    });
  });
});

describe("Cook's Notes: a prestige carries part of the Book", () => {
  /** A run that has cleared band 1, with a Book worth carrying. */
  function veteran(): Kernel {
    const g = makeGame({ seed: 0 });
    clearFloors(g);
    setStat(g, cookedKey('hearty_stew'), 130); // cook time and Signature
    setStat(g, cookedKey('mushroom_broth'), 30); // cook time only
    setStat(g, cookedKey('berry_pie'), 24); // neither
    setStat(g, cookedKey('scorched_mess'), 200); // cook time; it has no Signature
    return g;
  }

  it('is one boon with two ranks', () => {
    const boon = PRESTIGE_BOONS.cooks_notes;
    expect(boon.name).toBe("Cook's Notes");
    expect(boon.cost).toHaveLength(2);
    expect(boon.effect).toEqual({ kind: 'cookbook' });
  });

  it('stores what reached each threshold at prestige, whatever rank is held then', () => {
    const g = veteran();
    expect(carriedCookbook({ counters: slice<CountersState>(g, 'counters'), carried: cookingOf(g).carried })).toEqual({
      timed: ['hearty_stew', 'mushroom_broth', 'scorched_mess'],
      signed: ['hearty_stew'],
    });
    expect(prestige(g)).toBe(true);
    expect(cookingOf(g).carried.timed.slice().sort()).toEqual(['hearty_stew', 'mushroom_broth', 'scorched_mess']);
    expect(cookingOf(g).carried.signed).toEqual(['hearty_stew']);
    // The counters themselves reset with the run.
    expect(stat(g, cookedKey('hearty_stew'))).toBeUndefined();
  });

  it('without the boon the new run starts with an empty Book', () => {
    const g = veteran();
    prestige(g);
    for (const r of cookbook(book(g))) {
      expect(r.made).toBe(0);
      expect(r.cookTimeKnown).toBe(false);
      expect(r.signature).toBe(false);
    }
  });

  it('rank 1 keeps cook times, rank 2 also keeps Signatures', () => {
    const g = veteran();
    prestige(g);
    setPoints(g, 10);

    expect(buy(g, 'cooks_notes')).toBe(true);
    expect(row(g, 'cooking', 'stew').cookTimeKnown).toBe(true);
    expect(row(g, 'cooking', 'broth').cookTimeKnown).toBe(true);
    expect(row(g, 'baking', 'pie').cookTimeKnown).toBe(false);
    expect(row(g, 'cooking', 'stew').signature).toBe(false);
    // The kept cook time is a flag; the count is still the new run's own.
    expect(row(g, 'cooking', 'stew').made).toBe(0);
    grantGraded(g, 'hearty_stew', 'c', 1);
    expect(useIt(g, 'hearty_stew', 'c').signature).toEqual([]);

    expect(buy(g, 'cooks_notes')).toBe(true);
    expect(buy(g, 'cooks_notes')).toBe(false); // two ranks only
    expect(row(g, 'cooking', 'stew').signature).toBe(true);
    expect(row(g, 'cooking', 'broth').signature).toBe(false);
    expect(row(g, 'cooking', 'mess').signature).toBe(false);
    grantGraded(g, 'hearty_stew', 'c', 1);
    expect(useIt(g, 'hearty_stew', 'c').signature).toEqual(['stoked']);
    grantGraded(g, 'mushroom_broth', 'c', 1);
    expect(useIt(g, 'mushroom_broth', 'c').signature).toEqual([]);
  });

  it('a kept cook time shows the heat window of a windowed dish', () => {
    const g = makeGame({ seed: 0 });
    clearFloors(g);
    setStat(g, cookedKey('seared_stew'), 40);
    prestige(g);
    setPoints(g, 5);
    expect(row(g, 'cooking', 'seared_stew').heat).toBeUndefined();
    buy(g, 'cooks_notes');
    expect(row(g, 'cooking', 'seared_stew').heat).toEqual([{ tag: 'meat', to: 6 }]);
  });

  it('never shortens across prestiges: each one adds what its run reached', () => {
    const g = veteran();
    prestige(g);
    clearFloors(g);
    setStat(g, cookedKey('berry_pie'), 60);
    expect(prestige(g)).toBe(true);
    expect(cookingOf(g).carried.timed).toEqual(
      expect.arrayContaining(['hearty_stew', 'mushroom_broth', 'scorched_mess', 'berry_pie']),
    );
    expect(cookingOf(g).carried.signed).toEqual(['hearty_stew']);
    // A run that cooked nothing leaves the lists as they were.
    clearFloors(g);
    const before = JSON.stringify(cookingOf(g).carried);
    expect(prestige(g)).toBe(true);
    expect(JSON.stringify(cookingOf(g).carried)).toBe(before);
  });
});

describe('save v58', () => {
  it.todo('is the version this change took, or a later one (not ported: the save here starts at version 1)');
  it.todo("migrates a v57 legacy block by adding empty Cook's Book lists (not ported: the save here starts at version 1)");
  it.todo('keeps lists a block already carries (not ported: the save here starts at version 1)');

  it('round-trips through serialize and deserialize', () => {
    const g = makeGame({ seed: 4 });
    patch(g, (s) => {
      s.cooking.carried = { timed: ['hearty_stew', 'berry_pie'], signed: ['hearty_stew'] };
      s.counters.counts[cookedKey('hearty_stew')] = 12;
      s.counters.counts[cookedGradeKey('hearty_stew', 'b')] = 3;
    });
    const loaded = makeGame({ seed: 9 });
    const result = loaded.load(JSON.parse(JSON.stringify(g.save(0))));
    expect(result.ok).toBe(true);
    expect(cookingOf(loaded).carried).toEqual({ timed: ['hearty_stew', 'berry_pie'], signed: ['hearty_stew'] });
    expect(stat(loaded, cookedKey('hearty_stew'))).toBe(12);
    expect(cookbook(book(loaded)).find((r) => r.outcomeId === 'stew')!.byGrade.b).toBe(3);
  });

  it.todo('loads an old save through the rails: a backup-v57 copy is kept, nothing is lost (not ported: the save here starts at version 1)');
  it.todo('the Game keeps working on a migrated save: a cook still counts and a prestige still carries (not ported: the save here starts at version 1)');
});

describe('the cook never amplifies a harmful condition a dish carries', () => {
  /** A dish no lint would pass: nourishment, a harmful grant and a harmful Signature. */
  const withCurry = (run: () => void) => {
    MATERIALS.test_curry = {
      id: 'test_curry',
      name: 'Test Curry',
      icon: '🍛',
      value: 1,
      graded: true,
      consumable: {
        food: true,
        grants: [{ id: 'well_fed', intensity: 1 }, { id: 'poison', intensity: 0.5 }],
        signature: [{ id: 'on_fire', intensity: 0.5 }],
      },
    } as unknown as MaterialDef;
    try {
      run();
    } finally {
      delete MATERIALS.test_curry;
    }
  };
  const eat = (level: number): Kernel => {
    const g = kitchen(level);
    setStat(g, cookedKey('test_curry'), SIGNATURE_COOKS);
    grantGraded(g, 'test_curry', 'c', 1);
    expect(useIt(g, 'test_curry', 'c').signature).toEqual(['on_fire']);
    return g;
  };

  it('scales the nourishment and leaves the harm at its own terms, grants and Signature alike', () => {
    withCurry(() => {
      const novice = eat(1);
      const master = eat(200);
      // The harmless grant follows the cook...
      expect(findStatus(novice, 'well_fed')!.intensity).toBe(1);
      expect(findStatus(master, 'well_fed')!.intensity).toBeCloseTo(1.5);
      expect(findStatus(master, 'well_fed')!.ticksLeft).toBe(Math.round((STATUSES.well_fed.duration as number) * 1.5));
      // ...the harmful ones do not: same intensity, same default lifetime.
      for (const id of ['poison', 'on_fire']) {
        const a = findStatus(novice, id)!;
        const b = findStatus(master, id)!;
        expect(b.intensity, id).toBeCloseTo(a.intensity);
        expect(a.intensity, id).toBeCloseTo(0.5);
        expect(b.ticksLeft, id).toBe(STATUSES[id].duration);
        expect(a.ticksLeft, id).toBe(STATUSES[id].duration);
      }
    });
  });

  it('is read from the condition, so a patched harmful condition is not scaled and a benign one is', () => {
    withCurry(() => {
      const original = STATUSES.steeped;
      MATERIALS.test_curry.consumable!.grants = [{ id: 'steeped', intensity: 1 }] as ConsumableSpec['grants'];
      MATERIALS.test_curry.consumable!.signature = [{ id: 'stoked', intensity: 0.5 }] as ConsumableSpec['signature'];
      const eatAt200 = (): Kernel => {
        const g = kitchen(200);
        setStat(g, cookedKey('test_curry'), SIGNATURE_COOKS);
        grantGraded(g, 'test_curry', 'c', 1);
        useIt(g, 'test_curry', 'c');
        return g;
      };
      try {
        // Make Steeped harmful by data alone: no id list is involved.
        STATUSES.steeped = { ...original, dot: { type: 'poison', flat: 0.01 } } as StatusDef;
        const harmful = eatAt200();
        expect(findStatus(harmful, 'steeped')!.intensity).toBeCloseTo(1);
        expect(findStatus(harmful, 'steeped')!.ticksLeft).toBe(original.duration);
      } finally {
        STATUSES.steeped = original;
      }
      const benign = eatAt200();
      expect(findStatus(benign, 'steeped')!.intensity).toBeCloseTo(1.5);
      expect(findStatus(benign, 'steeped')!.ticksLeft).toBe(Math.round((original.duration as number) * 1.5));
    });
  });
});

describe('the Book says so when a cook crosses a threshold', () => {
  // No trailing period: the tally joins its entries with ", ".
  const TIME_NOTE = "Cook's Book: Seared Stew cook time now shown (25 cooks)";
  const SIGNATURE_NOTE = 'Seared Stew is now a Signature dish: eating it also gives Well Fed (100 cooks)';
  /** A kitchen that has read the Seared Stew card. */
  function searedKitchen(): Kernel {
    const g = kitchen(1);
    setStat(g, 'recipe:seared_stew', 1);
    return g;
  }
  /** Meat midway on a Quick simmer: 5.4 units on the heat, under 6. */
  const seared = (g: Kernel, n: number) => {
    for (let i = 0; i < n; i++) {
      const done = cook(g, { main: at('wild_onion'), second: at('raw_meat') }, STOVE, 8);
      expect(done?.dish).toBe('seared_stew');
    }
  };
  /** Every Cook's Book note in the running log, in order: what the player reads. */
  const notes = (g: Kernel) =>
    logEntries(g)
      .flatMap((l) => (l.tally ?? []).map((tl) => tl.label))
      .filter((label) => /cook time now shown|Signature dish/.test(label));

  it('notes the cook time at the 25th cook of a dish that has one, once', () => {
    const g = searedKitchen();
    seared(g, 30);
    expect(notes(g)).toEqual([TIME_NOTE]);
    // It rides the "Cooked:" tally of the cook that crossed it: the same group, the same folding path.
    const crossing = logEntries(g).find((l) => l.tally?.some((tl) => tl.label === TIME_NOTE))!;
    expect(crossing.group).toBe('bench:cooking');
    expect(crossing.prefix).toBe('🍛 Cooked:');
    expect(crossing.msg).toMatch(/^🍛 Cooked: .*Seared Stew ×\d+, /);
    expect(crossing.msg).toContain(TIME_NOTE);
    // The Book on the bench agrees: this is the cook that made it known.
    expect(stat(g, cookedKey('seared_stew'))).toBe(30);
    expect(row(g, 'cooking', 'seared_stew').cookTimeKnown).toBe(true);
    // Thirty cooks leave the note once in the running log, not thirty times, and never on a line of its own.
    const logged = logEntries(g).filter((l) => l.msg.includes('cook time now shown'));
    expect(logged).toHaveLength(1);
    expect(logged[0].msg).toContain('Cooked:');
  });

  it('names the Signature at the 100th cook of a dish that has one, once', () => {
    const g = kitchen(1);
    setStat(g, cookedKey('hearty_stew'), 97);
    cookStew(g, 5);
    expect(notes(g)).toEqual(['Hearty Stew is now a Signature dish: eating it also gives Stoked (100 cooks)']);
  });

  it('says nothing at 25 for a dish with no window of its own, and nothing for the failure dish', () => {
    const g = kitchen(1);
    setStat(g, cookedKey('hearty_stew'), 22);
    cookStew(g, 5); // crosses 25: Hearty Stew has no cook-time window
    expect(notes(g)).toEqual([]);
    expect(row(g, 'cooking', 'stew').cookTimeKnown).toBe(true); // the Book still counts it

    grantGraded(g, 'wild_onion', 'f', 400);
    setStat(g, cookedKey('scorched_mess'), 98);
    for (let i = 0; i < 5; i++) {
      cook(g, { main: at('wild_onion', 'f'), second: at('wild_onion', 'f') }, STOVE, 12);
    }
    expect(stat(g, cookedKey('scorched_mess'))).toBe(103); // past 25 and 100: no window, no Signature
    expect(notes(g)).toEqual([]);
  });

  it('names a Signature on a dish that also has a cook time', () => {
    const g = searedKitchen();
    setStat(g, cookedKey('seared_stew'), 99);
    seared(g, 2);
    expect(notes(g)).toEqual([SIGNATURE_NOTE]);
  });

  it("stays quiet for what Cook's Notes already carried, and speaks when the boon is not held", () => {
    /** Cross 25 and then 100 with the carried lists naming the dish, at the given boon rank. */
    const crossBoth = (rank: number): string[] => {
      const g = searedKitchen();
      patch(g, (s) => {
        s.cooking.carried = { timed: ['seared_stew'], signed: ['seared_stew'] };
        if (rank > 0) s.prestige.purchases.cooks_notes = rank;
      });
      setStat(g, cookedKey('seared_stew'), 24);
      seared(g, 1);
      setStat(g, cookedKey('seared_stew'), 99);
      seared(g, 1);
      return notes(g);
    };
    expect(crossBoth(2)).toEqual([]); // both were carried over: no news
    expect(crossBoth(1)).toEqual([SIGNATURE_NOTE]); // the cook time was carried, the Signature was not
    expect(crossBoth(0)).toEqual([TIME_NOTE, SIGNATURE_NOTE]); // the lists are ignored without the boon
  });

  it('a counted bench run crossing a threshold leaves one note, folded into the run, not a line of its own', () => {
    const g = searedKitchen();
    // Cooking 40: no level-up lines between the cooks to split the run on their own.
    patch(g, (s) => {
      s.skills.skills.cooking = { level: 40, xp: 0 };
      s.world.spot = 'granary_kitchens';
    });
    setStat(g, cookedKey('seared_stew'), 22);
    expect(
      g.dispatch(startBench({ discipline: 'cooking', placement: { main: at('wild_onion'), second: at('raw_meat') }, count: 6, duration: 8 })).ok,
    ).toBe(true);
    for (let i = 0; i < 700 && slice<{ job: unknown }>(g, 'benches').job; i++) g.tick();
    expect(stat(g, cookedKey('seared_stew'))).toBe(28);
    const logged = logEntries(g).filter((l) => l.msg.includes('cook time now shown'));
    expect(logged).toHaveLength(1);
    expect(logged[0].group).toBe('bench:cooking');
    expect(logged[0].msg).toMatch(/Cooked: .*Seared Stew.*Cook's Book: Seared Stew cook time now shown \(25 cooks\)/);
    // The tally's ", " is the only punctuation between entries: no "., " run.
    expect(logged[0].msg).not.toMatch(/\.,/);
    // Nothing logged a line that is only the note.
    expect(logEntries(g).some((l) => l.msg.startsWith("Cook's Book:"))).toBe(false);
  });
});

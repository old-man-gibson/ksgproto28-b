import { describe, expect, it } from 'vitest';
import { PLAYER, type Kernel, type Modifier } from '../src/kernel';
import { attrXpNeeded, grantAttrXp, grantAttrXpSplit } from '../src/systems/attributes';
import { grantLevelXp } from '../src/systems/levels';
import { drawPool, exertPool, hurtPlayer, setExerting, setPace, spendPool } from '../src/systems/resources';
import { checkDiscovery, grantSkillXp, raiseSkillCap } from '../src/systems/skills';
import {
  armedFact,
  computeBlock,
  dampFact,
  resFloorFact,
  resFloorTakenFact,
  resOverrideFact,
  STAT_KEYS,
  statBlockOf,
  statMod,
  statOf,
  uncappedResistance,
  vsVariant,
  wieldTagFact,
} from '../src/systems/stats';
import { applyStatus, heldOf, STATUSES, type StatusesState } from '../src/systems/statuses';
import { ask, emit, makeGame, patch, setMods, slice } from './helpers';

/**
 * Port of the old tests/derivedcache.test.ts. Its intent: identical inputs
 * are served from the cache, and no stat is stale after any change. The old
 * build compared `getDerivedStats` with `computeDerivedStats`; here that is
 * `kernel.staleStats()`, which recomputes every stat of every entity with
 * every source collected again.
 *
 * Changed: the call shape, and where the old cases changed equipment, a
 * buff or a condition, the same modifiers come from the test-only probe.
 *
 * Left behind, for the ports of the systems they need:
 * - forged pieces (assembly), the festival bonus (prestige), Cooking's food
 *   milestones over a cooked dish (cooking);
 * - the rebuild count under a gale on the open ridge (weather);
 * - the long fight of the sweep. The sweep here runs every request these
 *   systems accept instead.
 */

const sound = (kernel: Kernel) => expect(kernel.staleStats()).toEqual([]);

/** The cached block equals a compute from the collected modifiers. */
function matchesFresh(kernel: Kernel, variant = ''): void {
  const fresh = computeBlock(kernel.modifiers(), variant).stats;
  for (const key of STAT_KEYS) expect(statOf(kernel, key, PLAYER, variant), key).toBe(fresh[key]);
}

const RUSTY_SWORD: Modifier[] = [
  armedFact(),
  wieldTagFact('sword'),
  wieldTagFact('metal'),
  statMod('damage', 'add', 3, 'Rusty Sword', { kind: 'item', slot: 'weapon' }),
];

describe('derived-stats cache', () => {
  it('returns the identical object while nothing modifier-relevant changes', () => {
    const kernel = makeGame();
    const first = statBlockOf(kernel);
    expect(statBlockOf(kernel)).toBe(first);
    matchesFresh(kernel);
    // Ticks that touch no source keep the same block: regeneration reads
    // pool locks, never pool values.
    patch(kernel, (slices) => (slices.resources.values.hp = 20));
    const held = statBlockOf(kernel);
    kernel.tick(50);
    expect(statBlockOf(kernel)).toBe(held);
    sound(kernel);
  });

  it('invalidates on equipment changes', () => {
    const kernel = makeGame();
    const bare = statBlockOf(kernel);
    setMods(kernel, RUSTY_SWORD);
    const armed = statBlockOf(kernel);
    expect(armed).not.toBe(bare);
    expect(armed.damage).toBe(bare.damage + 3);
    matchesFresh(kernel);
    setMods(kernel, []);
    const disarmed = statBlockOf(kernel);
    expect(disarmed).not.toBe(armed);
    expect(disarmed).toEqual(bare);
    sound(kernel);
  });

  it('invalidates on the exertion toggle', () => {
    const kernel = makeGame();
    const before = kernel.modifiers();
    kernel.dispatch(setExerting({ on: true }));
    // The toggle touches the lock source, so every source that depends on it
    // is collected again.
    expect(kernel.modifiers()).not.toBe(before);
    sound(kernel);
  });

  it('invalidates on an attribute level-up', () => {
    const kernel = makeGame();
    const before = statBlockOf(kernel);
    emit(kernel, grantAttrXp, { attr: 'str', amount: attrXpNeeded(1) });
    const after = statBlockOf(kernel);
    expect(after).not.toBe(before);
    matchesFresh(kernel);
    expect(after.damage).toBeGreaterThan(before.damage);
    sound(kernel);
  });

  it('invalidates on a condition: its modifiers, its damping, its resistance rules', () => {
    const kernel = makeGame();
    setMods(kernel, RUSTY_SWORD);
    const before = { ...statBlockOf(kernel) };
    // What a chill that dulls weapon bonuses by 50% and takes 30% off cold
    // resistance, floored at -20%, states.
    setMods(kernel, [
      ...RUSTY_SWORD,
      dampFact(0.5, { kinds: ['item', 'affix', 'rune'], slot: 'weapon' }),
      statMod('resCold', 'add', -0.3, 'Chilled', { kind: 'status' }),
      resFloorFact(-0.2),
      resFloorTakenFact('resCold', -0.3),
    ]);
    const afflicted = statBlockOf(kernel);
    expect(afflicted.damage).toBeCloseTo(before.damage - 1.5, 6); // the sword's +3, halved
    expect(afflicted.resCold).toBeCloseTo(-0.2, 6); // held at the floor
    matchesFresh(kernel);
    sound(kernel);
  });

  it('a resistance past the cap is clamped, and the value before the cap is kept for immunity', () => {
    const kernel = makeGame();
    setMods(kernel, [statMod('resPoison', 'add', 1.2, 'Antivenom', { kind: 'status' })]);
    expect(statOf(kernel, 'resPoison')).toBe(0.75);
    expect(uncappedResistance(kernel, 'resPoison')).toBe(1.2);
    expect(uncappedResistance(kernel, 'resCold')).toBe(0);
    // A raised ceiling is read from the stat, not from the constant.
    setMods(kernel, [statMod('resPoison', 'add', 1.2), statMod('resistCap', 'add', 0.15)]);
    expect(statOf(kernel, 'resPoison')).toBeCloseTo(0.9, 9);
    sound(kernel);
  });

  it('a condition may dictate a resistance, and tops up one already past it', () => {
    const kernel = makeGame();
    setMods(kernel, [resOverrideFact('cold', -0.5), resOverrideFact('heat', 0.5, 0.25)]);
    expect(statOf(kernel, 'resCold')).toBe(-0.5);
    expect(statOf(kernel, 'resHeat')).toBe(0.5);
    setMods(kernel, [statMod('resHeat', 'add', 0.6), resOverrideFact('heat', 0.5, 0.25)]);
    expect(statOf(kernel, 'resHeat')).toBe(0.75); // 0.6 + 0.25, then the cap
    sound(kernel);
  });

  it('invalidates when Cooking crosses a food milestone, and holds at the ×1.5 cap', () => {
    const kernel = makeGame();
    const at = (level: number) => {
      patch(kernel, (slices) => (slices.skills.skills.cooking = { level, xp: 0 }));
      return statBlockOf(kernel);
    };
    expect(at(9).foodDuration).toBe(1);
    expect(at(10).foodDuration).toBeCloseTo(1.06, 9);
    expect(at(20).foodPotency).toBeCloseTo(1.05, 9);
    // Nine steps of +0.06 are 1.54 raw; the stat reads at most 1.5.
    expect(at(90).foodDuration).toBe(1.5);
    expect(at(400).foodPotency).toBe(1.5);
    sound(kernel);
  });

  it('serves target-gated variants from the same collection, consistently', () => {
    const kernel = makeGame();
    setMods(kernel, [
      ...RUSTY_SWORD,
      { ...statMod('damage', 'mult', 0.5, 'Beast Hunter', { kind: 'title' }), requiresMonsterTag: 'beast' } as Modifier,
    ]);
    const tags = vsVariant(['vermin', 'beast']);
    expect(tags).toBe('vs:beast,vermin');
    const plain = statBlockOf(kernel);
    const vs = statBlockOf(kernel, PLAYER, tags);
    expect(statBlockOf(kernel, PLAYER, tags)).toBe(vs);
    expect(vs.damage).toBeCloseTo(plain.damage * 1.5, 9);
    matchesFresh(kernel, tags);
    // The empty set is the plain block, not a variant.
    expect(vsVariant([])).toBe('');
    expect(statBlockOf(kernel, PLAYER, vsVariant([]))).toBe(plain);
    // A change rebuilds the variant with the plain block.
    emit(kernel, grantAttrXp, { attr: 'str', amount: attrXpNeeded(1) });
    expect(statBlockOf(kernel, PLAYER, tags)).not.toBe(vs);
    matchesFresh(kernel, tags);
    sound(kernel);
  });

  it('never drifts from a fresh compute across a long run of every request', () => {
    const kernel = makeGame();
    setMods(kernel, RUSTY_SWORD);
    kernel.dispatch(setExerting({ on: true }));
    const beast = vsVariant(['beast']);
    let seed = 11;
    const roll = (n: number): number => {
      // Lehmer generator: the product stays under 2^53.
      seed = (seed * 48271) % 2147483647;
      return seed % n;
    };
    const attrs = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
    const tagSets = [['combat'], ['combat', 'sword'], ['magic', 'arcane'], ['hunt'], ['explore'], ['smithing']];
    for (let i = 0; i < 4000; i++) {
      switch (roll(12)) {
        case 0:
          emit(kernel, grantAttrXp, { attr: attrs[roll(6)], amount: 5 + roll(60) });
          break;
        case 1:
          emit(kernel, grantAttrXpSplit, { weights: { str: 0.5, cha: 0.25 }, amount: 20 });
          break;
        case 2:
          emit(kernel, grantSkillXp, { tags: tagSets[roll(tagSets.length)], amount: 5 + roll(40), sourceKey: 'wolf' });
          break;
        case 3:
          emit(kernel, checkDiscovery, { tags: tagSets[roll(tagSets.length)] });
          break;
        case 4:
          emit(kernel, grantLevelXp, { xp: 10 + roll(80) });
          break;
        case 5:
          emit(kernel, exertPool, { spec: { cost: 0.1, hit: { damage: 0.5 } } });
          break;
        case 6:
          emit(kernel, exertPool, { spec: { cost: 1, drain: true } });
          break;
        case 7:
          emit(kernel, drawPool, { id: 'stamina', amount: roll(8) });
          break;
        case 8:
          emit(kernel, spendPool, { id: 'mana', amount: 1 });
          break;
        case 9:
          emit(kernel, hurtPlayer, { amount: 1 + roll(5), type: 'slashing' });
          break;
        case 10:
          emit(kernel, setPace, { resting: roll(2) === 0, hpMult: roll(2) === 0 ? 15 : 1 });
          break;
        default:
          emit(kernel, raiseSkillCap, { id: 'chronosense' });
      }
      kernel.tick(1 + roll(3));
      // Read both blocks, so both are cached when the check runs.
      statBlockOf(kernel);
      statBlockOf(kernel, PLAYER, beast);
      expect(kernel.staleStats(), `step ${i}`).toEqual([]);
    }
    // The run did exercise the sources: levels, skills and locks all moved.
    const state = kernel.snapshot().slices as Record<string, any>;
    expect(state.levels.level).toBeGreaterThan(5);
    expect(Object.keys(state.skills.skills).length).toBeGreaterThan(3);
    expect(state.attributes.attrs.str.level).toBeGreaterThan(10);
  }, 60000);
});

// ---- conditions, from the statuses system (spine port 2) ----

const dose = (kernel: Kernel, id: string, intensity: number, source = 'test', resist = false) =>
  ask(kernel, applyStatus, { entity: PLAYER, app: { id, intensity }, source, resist });
const holds = (kernel: Kernel, id: string) =>
  heldOf(slice<StatusesState>(kernel, 'statuses')).some((h) => h.id === id);

describe('conditions and the cache', () => {
  it('invalidates on a condition and follows its decay', () => {
    const kernel = makeGame();
    // Any real condition with mods will do.
    const withMods = Object.values(STATUSES).find((s) => s.mods?.length && s.duration);
    expect(withMods).toBeTruthy();
    const before = statBlockOf(kernel);
    dose(kernel, withMods!.id, 2);
    const afflicted = statBlockOf(kernel);
    expect(afflicted).not.toBe(before);
    matchesFresh(kernel);
    sound(kernel);
  });

  it('invalidates on a cooked status and its grade, resistance past the cap included', () => {
    // Steeped Broth: resPoison +0.25 per intensity, and a Divine broth is 4:
    // 1.0 before the cap, which condition immunity reads.
    const kernel = makeGame();
    const before = { ...statBlockOf(kernel) };
    dose(kernel, 'steeped', 1, 'a broth');
    const fair = statBlockOf(kernel);
    expect(fair.resPoison).toBeCloseTo(before.resPoison + 0.25);
    matchesFresh(kernel);

    dose(kernel, 'steeped', 4, 'a broth');
    const divine = statBlockOf(kernel);
    expect(divine).not.toBe(fair);
    expect(divine.resPoison).toBeCloseTo(0.75); // the damage cap
    matchesFresh(kernel);
    // The immunity test sees the 1.0 under the cap.
    expect(dose(kernel, 'poison', 1, 'a fang', true)).toBeNull();
    sound(kernel);
  });
});

/**
 * A condition with `decayWithDuration` has a different effective intensity
 * on every tick it is held. The source is touched for it only when the
 * source reads that intensity (`sourceSignature` in the statuses engine, the
 * old `statBlockIntensity`).
 */
describe('a decaying condition and the cache', () => {
  const DECAYING = Object.values(STATUSES).filter((s) => s.decayWithDuration);
  const reads = (s: (typeof DECAYING)[number]) =>
    (s.mods?.length ?? 0) > 0 || !!s.damp || !!s.resFloor || !!s.attrCeiling || (s.ceilings?.length ?? 0) > 0;

  /**
   * Hold `id` on an idle character until it expires, checking for stale
   * stats on every tick. Returns the number of distinct blocks served from
   * the first tick after the dose to the end, and the ticks it ran.
   */
  function life(id: string, doses: number[]): { blocks: number; ticks: number } {
    const kernel = makeGame({ seed: 21 });
    for (const intensity of doses) dose(kernel, id, intensity);
    expect(holds(kernel, id)).toBe(true);
    let last = statBlockOf(kernel);
    sound(kernel);
    let blocks = 1;
    let ticks = 0;
    for (; holds(kernel, id) && ticks < 20_000; ticks++) {
      kernel.tick();
      const cur = statBlockOf(kernel);
      expect(kernel.staleStats(), `${id} at tick ${ticks}`).toEqual([]);
      if (cur !== last) {
        blocks++;
        last = cur;
      }
    }
    expect(holds(kernel, id), `${id} ran out`).toBe(false);
    return { blocks, ticks };
  }

  it('there are decaying conditions of both kinds to check', () => {
    expect(DECAYING.some(reads)).toBe(true);
    expect(DECAYING.some((s) => !reads(s))).toBe(true);
  });

  it('every decaying condition matches a fresh compute on every tick of its life', () => {
    for (const def of DECAYING) life(def.id, [2, 1]);
  });

  it('a held tainted keeps its decay in the key: the block follows it down', () => {
    const { blocks, ticks } = life('tainted', [2]);
    expect(ticks).toBeGreaterThan(100);
    // Its mods wane with its clock, so the block changes on most ticks of its life.
    expect(blocks).toBeGreaterThan(ticks / 2);
  });

  it('a decaying condition with no field the stat block reads rebuilds nothing as it fades', () => {
    for (const def of DECAYING.filter((s) => !reads(s))) {
      const { blocks, ticks } = life(def.id, [2, 1]);
      expect(ticks, def.id).toBeGreaterThan(100);
      // The old build allowed two blocks: the dose, and the block after it
      // was gone. Here the source returns nothing for it, so there is one.
      expect(blocks, def.id).toBeLessThanOrEqual(2);
    }
  });

  it.todo('under a gale on the open ridge: rebuilds on a minority of ticks (weather: the sky rules that dose buffeted)');
});

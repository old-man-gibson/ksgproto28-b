/**
 * Port of the old tests/antimagic.test.ts (35 cases): `undo`, `with`, the
 * signature of a working, counterspells sprung by a casting in either
 * direction, manaburn on a monster's mind, and the cast trigger subjects.
 *
 * The efficiency formula: 20% for undo, +7.5% per further undo tier, +5% per
 * arcane tier, and a match bonus whose ceiling rises with every tier of
 * tuning while each tier is worth less. Not capped: past 100% the working is
 * gone and the burn keeps growing.
 *
 * Changed: the call shape.
 * - The fight is staged; the monster is its front enemy, read from the slice.
 * - The cast functions take the narrow context of a registered kind and are
 *   called through the probe (`run`). Feed lines arrive when the handler
 *   returns.
 * - The player's book is written with `inscribe`. The reading in the caster's
 *   hands is the bare reading (`specForSource`): word levels are step 3.
 * - The character is made sturdy and given mana with modifiers, not with
 *   attribute levels. No expected number depends on them.
 * - `casting` is in the `spellcraft` slice and names the caster by entity id,
 *   not by slot index.
 * - `TRIGGER_EVENTS` is a list of ids. A subject is read with `triggerSubject`.
 * - The Psionic Slime's own rotation is two psionic shapes. The psionic
 *   school is step 3, so the case that needs the slime to cast gives it an
 *   arcane sentence through its kit.
 *
 * Left as `it.todo`: nothing. Two assertions inside ported cases have no
 * counterpart yet and are marked where they stood:
 * - `isUtilityWorking` (step 3: spellcraft: casting outside a fight).
 * - `readyableSpell` (step 3: martial: the readied spell of the seat).
 * Not in the old file and not here: the refuting body, the legality of a
 * sentence, the writing side of the book, the rotation screen's picker.
 */
import { describe, expect, it } from 'vitest';
import type { Ctx, Kernel } from '../src/kernel';
import { ARCANE_WORDS, composeArcane, parseSentence } from '../src/systems/arcane';
import type { ClockState } from '../src/systems/clock';
import {
  activeRotation,
  mindInDebt,
  monsterMind,
  pickActive,
  setTrigger,
  TRIGGER_EVENTS,
  triggerSubject,
  type CombatState,
  type Enemy,
} from '../src/systems/combat';
import { MONSTERS, type MonsterKit } from '../src/systems/monsters';
import type { ResourcesState } from '../src/systems/resources';
import {
  ARCANE_UNDO_PER_UNIT,
  castCraftedAttack,
  castMonsterWorking,
  counterEfficiency,
  MATCH_FIRST,
  matchCeiling,
  specForSource,
  UNDO_BASE,
  UNDO_PER_TIER,
  undoWorking,
  workingSignature,
  type SpellcraftState,
  type SpellSource,
} from '../src/systems/spellcraft';
import { applyStatus, heldOf, type StatusesState } from '../src/systems/statuses';
import { combat, combatOf, feedOf, hardenFoes, inscribe, patchFight, playerStats, setHp, setPool, stage } from './combatHelpers';
import { ask, makeGame, patch, run, setMods, slice } from './helpers';

const eff = (words: string[], against: string[]) =>
  counterEfficiency(composeArcane(words)!.counter!, workingSignature(composeArcane(against)!));

// ---------- The grammar ----------

describe('undo — a counterspell as the grammar composes it', () => {
  it('an undoing is a counterspell, never a blow', () => {
    const spec = composeArcane(['undo'])!;
    expect(spec.counter).toEqual({ tiers: 1, tuning: {}, burn: 1 });
    expect(spec.strikes).toEqual([]);
    expect(spec.heal).toBeUndefined();
    // The old case also read `isUtilityWorking(spec)` as false. Casting
    // outside a fight is step 3 (spellcraft); the function is not ported.
  });

  it('deepening buys efficiency: 20%, 27.5%, 35%', () => {
    const base = (words: string[]) => counterEfficiency(composeArcane(words)!.counter!, {}).efficiency;
    expect(base(['undo'])).toBeCloseTo(UNDO_BASE, 10);
    expect(base(['undo:2'])).toBeCloseTo(0.275, 10);
    expect(base(['undo', 'undo', 'undo'])).toBeCloseTo(0.35, 10);
    expect(UNDO_PER_TIER).toBe(0.075);
    // A mastered "undo:2" is the same spell as "undo undo".
    expect(composeArcane(['undo:2'])).toEqual(composeArcane(['undo', 'undo']));
  });

  it('deepened undoings pay the grammar’s usual bargain: more mana, slower', () => {
    const [one, two, three] = [['undo'], ['undo:2'], ['undo:3']].map((w) => composeArcane(w)!);
    expect(two.manaCost).toBeGreaterThan(one.manaCost);
    expect(three.manaCost).toBeGreaterThan(two.manaCost);
    expect(three.cooldown).toBeGreaterThan(one.cooldown);
  });

  it('arcane answers everything, 5% a tier — and matches arcane like any element', () => {
    // Against a fire working, arcane cannot match; it still pays its 5% a tier.
    const vsFire = eff(['arcane:3', 'undo'], ['fire', 'pierce']);
    expect(vsFire.arcane).toBeCloseTo(3 * ARCANE_UNDO_PER_UNIT, 10);
    expect(vsFire.match).toBe(0);
    expect(vsFire.efficiency).toBeCloseTo(0.35, 10);
    // Against an arcane working it is both: the universal 5% and a match.
    const vsArcane = eff(['arcane', 'undo'], ['arcane', 'pierce']);
    expect(vsArcane.efficiency).toBeCloseTo(0.2 + 0.05 + 0.1, 10);
  });

  it('the match ceiling climbs with every tier tuned while each tier is worth less', () => {
    expect(matchCeiling(1)).toBeCloseTo(MATCH_FIRST, 10);
    expect(matchCeiling(2)).toBeCloseTo(0.18, 10);
    for (let n = 1; n < 24; n++) {
      expect(matchCeiling(n + 1), `ceiling at ${n + 1}`).toBeGreaterThan(matchCeiling(n));
      expect(matchCeiling(n + 1) / (n + 1), `per tier at ${n + 1}`).toBeLessThan(matchCeiling(n) / n);
    }
  });

  it('the worked examples: fire:1 +10%, fire:2 +18% at 9% each, fire:3 and lightning:2 ~+33%', () => {
    expect(eff(['fire', 'undo'], ['fire', 'pierce']).match).toBeCloseTo(0.1, 10);
    const two = eff(['fire:2', 'undo'], ['fire:2', 'pierce']);
    expect(two.match).toBeCloseTo(0.18, 10);
    expect(two.perUnit).toBeCloseTo(0.09, 10);
    const five = eff(['undo', 'with', 'fire:3', 'with', 'spark:2'], ['fire:3', 'pierce', 'with', 'spark:2']);
    expect(five.tuned).toBe(5);
    expect(five.matched).toBe(5);
    expect(five.match).toBeGreaterThan(0.3);
    expect(five.match).toBeLessThan(0.35);
    expect(five.perUnit).toBeGreaterThan(0.06);
    expect(five.perUnit).toBeLessThan(0.07);
  });

  it('a perfect match is not required — but tuning deeper than the working pays for tiers that find nothing', () => {
    // ice:2 against plain fire: nothing. fire:3 against plain fire: one tier
    // of three matches, and it is worth a third of the ceiling of three.
    expect(eff(['ice:2', 'undo'], ['fire', 'pierce']).match).toBe(0);
    const overTuned = eff(['fire:3', 'undo'], ['fire', 'pierce']);
    expect(overTuned.matched).toBe(1);
    expect(overTuned.efficiency).toBeLessThan(eff(['fire', 'undo'], ['fire', 'pierce']).efficiency);
    // A broad tuning answers more things, each less well than a narrow one.
    const broad = eff(['undo', 'with', 'fire', 'with', 'ice'], ['fire', 'pierce']);
    const narrow = eff(['fire', 'undo'], ['fire', 'pierce']);
    expect(broad.efficiency).toBeGreaterThan(UNDO_BASE);
    expect(broad.efficiency).toBeLessThan(narrow.efficiency);
  });

  it('uncapped: efficiency passes 100% and keeps counting', () => {
    const counter = composeArcane(['undo:3', 'with', 'arcane:3', 'with', 'arcane:3', 'with', 'arcane:3'])!.counter!;
    const reading = counterEfficiency(counter, { arcane: 9 });
    expect(reading.efficiency).toBeGreaterThan(1.2);
  });

  it('zero is nothing to tune against, and nothing to match', () => {
    expect(composeArcane(['zero', 'undo'])!.counter!.tuning).toEqual({});
    expect(workingSignature(composeArcane(['zero', 'pierce'])!)).toEqual({});
  });

  it('the rest of the grammar speaks to the burn: leading, weight, volume', () => {
    // Noun-led undoes harder than verb-led, as a noun-led blow hits harder.
    expect(composeArcane(['fire', 'undo'])!.counter!.burn).toBeGreaterThan(
      composeArcane(['undo', 'fire'])!.counter!.burn,
    );
    // Leading "twice" lays the burn twice; trailing folds it into one deeper.
    expect(composeArcane(['twice', 'undo'])!.counter!.burns).toBe(2);
    expect(composeArcane(['undo', 'twice'])!.counter!.burn).toBeCloseTo(2, 10);
  });

  it('an undoing breaks a strike chain, the way a mending does', () => {
    const spec = composeArcane(['fire', 'pierce', 'undo', 'then', 'ice', 'pierce'])!;
    expect(spec.counter).toBeDefined();
    expect(spec.strikes).toHaveLength(2);
    expect(spec.strikes[1].followUp).toBeUndefined();
  });
});

describe('with — accompaniment', () => {
  it('undo with X with Y is ONE answer tuned two ways', () => {
    const spec = composeArcane(['undo', 'with', 'fire', 'with', 'ice'])!;
    expect(spec.counter!.tuning).toEqual({ heat: 1, cold: 1 });
    expect(spec.counter!.tiers).toBe(1);
    expect(spec.strikes).toEqual([]);
  });

  it('lent to a blow: its riders ride along, the blow’s nature and weight untouched', () => {
    const plain = composeArcane(['fire', 'pierce'])!.strikes[0];
    const lent = composeArcane(['fire', 'pierce', 'with', 'venom'])!;
    expect(lent.strikes).toHaveLength(1);
    expect(lent.strikes[0].type).toBe('heat');
    expect(lent.strikes[0].power).toBeCloseTo(plain.power, 10);
    expect(lent.strikes[0].inflicts!.map((a) => a.id)).toEqual(['on_fire', 'poison']);
  });

  it('zero with venom stays nothing — and poisons', () => {
    const strike = composeArcane(['zero', 'pierce', 'with', 'venom'])!.strikes[0];
    expect(strike.untyped).toBe(true);
    expect(strike.inflicts!.map((a) => a.id)).toEqual(['poison']);
  });

  it('lent to a ward: one more coat, against its own element, at 75%', () => {
    const mods = composeArcane(['fire', 'ward', 'with', 'ice'])!.buff!.mods;
    const heat = mods.find((m) => m.stat === 'resHeat')!.value;
    const cold = mods.find((m) => m.stat === 'resCold')!.value;
    expect(cold).toBeCloseTo(heat * ARCANE_WORDS.with.conjunction!.accompany!, 10);
  });

  it('lent to a mending: its weight joins, at 75%', () => {
    const joined = composeArcane(['water', 'mend', 'with', 'seed'])!.heal!;
    const water = composeArcane(['water', 'mend'])!.heal!;
    const seed = composeArcane(['seed', 'mend'])!.heal!;
    expect(joined).toBeCloseTo(water + 0.75 * seed, 10);
  });

  it('a linked clause that speaks its own verb acts for itself, untaxed', () => {
    const spec = composeArcane(['fire', 'pierce', 'with', 'ice', 'pierce'])!;
    expect(spec.strikes).toHaveLength(2);
    expect(spec.strikes[1].power).toBeCloseTo(composeArcane(['ice', 'pierce'])!.strikes[0].power, 10);
  });

  it('like every conjunction, it must follow something and lead somewhere', () => {
    expect(parseSentence(['with', 'fire']).ok).toBe(false);
    expect(parseSentence(['fire', 'with']).ok).toBe(false);
    expect(ARCANE_WORDS.with.stacked).toBeUndefined();
  });
});

describe('signature — what a working is made of', () => {
  it('an arcane sentence states its own: nouns at depth, bare verbs as their substance', () => {
    expect(composeArcane(['fire:3', 'pierce'])!.signature).toEqual({ heat: 3 });
    expect(composeArcane(['cut'])!.signature).toEqual({ slashing: 1 });
    expect(composeArcane(['fire', 'ward'])!.signature).toEqual({ heat: 1 });
    expect(composeArcane(['undo'])!.signature).toBeUndefined();
  });

  it('a miracle has no words, so each strike stands for one tier of its element', () => {
    expect(workingSignature(specForSource({ school: 'divine', litany: 'holy_fire' }))).toEqual({ heat: 1, light: 1 });
  });

  it('what an undoing leaves: every part of the working at the share that survives', () => {
    const spec = composeArcane(['fire', 'pierce'])!;
    const half = undoWorking(spec, 0.5);
    expect(half.strikes[0].power).toBeCloseTo(spec.strikes[0].power / 2, 10);
    expect(half.strikes[0].inflicts![0].intensity).toBeCloseTo((spec.strikes[0].inflicts![0].intensity ?? 1) / 2, 10);
    const ward = composeArcane(['fire', 'ward'])!;
    expect(undoWorking(ward, 0.5).buff!.mods[0].value).toBeCloseTo(ward.buff!.mods[0].value / 2, 10);
    expect(undoWorking(spec, 1)).toBe(spec);
  });
});

// ---------- The trap ----------

/**
 * A caster with a pool deep enough for any sentence here, facing one
 * specimen. Both have far more health than anything here deals: no case is
 * about who wins. The old `arena`.
 */
function arena(defId = 'death_knight', seed = 5, kit?: MonsterKit): Kernel {
  const g = makeGame({ seed });
  setMods(g, [
    { stat: 'stats/maxHp', kind: 'add', value: 1e7 },
    { stat: 'stats/maxMana', kind: 'add', value: 1e6 },
  ]);
  setHp(g, 1e7);
  setPool(g, 'mana', 1e6);
  stage(g, [{ monsterId: defId, level: 3, ...(kit ? { kit } : {}) }]);
  hardenFoes(g);
  return g;
}

const foeOf = (g: Kernel): Enemy => combatOf(g).fight!.enemies[0]!;
const lines = (g: Kernel): string[] => feedOf(g).map((f) => f.text);
const ticksOf = (g: Kernel): number => slice<ClockState>(g, 'clock').totalTicks;
const manaOf = (g: Kernel): number => slice<ResourcesState>(g, 'resources').values.mana;
const hpOf = (g: Kernel): number => slice<ResourcesState>(g, 'resources').values.hp;
const burnOn = (g: Kernel, entity?: string) =>
  heldOf(slice<StatusesState>(g, 'statuses'), entity).find((s) => s.id === 'manaburn');
const arcane = (words: string[]): { school: 'arcane'; words: string[] } => ({ school: 'arcane', words });

/** Write a prepared sentence into the book. The old `prepare`. Returns its rotation id and its reading. */
function prepare(g: Kernel, words: string[]) {
  const id = inscribe(g, arcane(words));
  return { id, spec: specForSource(arcane(words)) };
}

/** The front enemy casts a sentence as rotation entry `index`. The old direct call of `castMonsterWorking`. */
function monsterCasts(g: Kernel, words: string[], index: number): void {
  run(g, (ctx) => {
    const e = ctx.read(combat).fight!.enemies[0]!;
    castMonsterWorking(ctx as never, e, arcane(words), index);
  });
}

/** The player casts a prepared offensive spell. The old direct call of `castCraftedAttack`. */
function playerCasts(g: Kernel, spell: ReturnType<typeof prepare>): void {
  run(g, (ctx) => castCraftedAttack(ctx as never, spell.id, spell.spec));
}

/** A combat context over a copy of the slice, for the functions of the tick that read `ctx.state`. */
function withCombatCtx<T>(g: Kernel, fn: (ctx: Ctx<CombatState>) => T): T {
  const state = combatOf(g);
  return run(g, (ctx) => {
    const scratch = Object.create(ctx) as Ctx<CombatState>;
    Object.defineProperty(scratch, 'state', { value: state });
    return fn(scratch);
  });
}

describe('the trap: a prepared counterspell springs inside an enemy casting', () => {
  it('never goes off on its own — not on the bar, not from the buff slot, not held in the seat', () => {
    const g = arena();
    const trap = prepare(g, ['fire', 'pierce', 'undo']);
    // The rotation holds it: the pick considers it and passes it over.
    expect(withCombatCtx(g, (ctx) => activeRotation(ctx as never, ctx.state.rotation))).toContain(trap.id);
    expect(withCombatCtx(g, (ctx) => pickActive(ctx as never, 'attack')?.id ?? '')).not.toMatch(/^grimoire:/);
    expect(withCombatCtx(g, (ctx) => pickActive(ctx as never, 'buff')?.id ?? '')).not.toMatch(/^grimoire:/);
    // The old case also read `readyableSpell` as null. The readied spell of
    // the seat is step 3 (martial); the function is not ported.
  });

  it('an enemy casting springs it: paid, clocked, the caster burned, the working thinned', () => {
    const g = arena();
    const foe = foeOf(g);
    const { id, spec } = prepare(g, ['gloom', 'undo']);
    const manaBefore = manaOf(g);
    const { spellPower, manaEff } = playerStats(g);
    monsterCasts(g, ['gloom', 'cut'], 99);

    const c = combatOf(g).fight!;
    // The casting was visible first: stamped for triggers, with what it was.
    expect(c.events.onEnemyCast).toBe(ticksOf(g));
    expect(slice<SpellcraftState>(g, 'spellcraft').casting).toMatchObject({
      school: 'arcane',
      element: 'dark',
      entity: foe.entity,
    });
    // Paid and clocked like any cast.
    expect(c.cooldowns[id]).toBe(spec.cooldown);
    expect(manaOf(g)).toBeCloseTo(manaBefore - spec.manaCost * manaEff, 3);
    // gloom against gloom: 20% + 10%. The caster burns for that share of the
    // undoing's burn, in the speaker's spell power.
    const e = counterEfficiency(spec.counter!, { dark: 1 }).efficiency;
    expect(e).toBeCloseTo(0.3, 10);
    const burn = burnOn(g, foe.entity);
    expect(burn?.intensity).toBeCloseTo(e * spec.counter!.burn * spellPower, 6);
    expect(lines(g).some((t) => /springs on the Death Knight's Gloom Cut: 30% efficiency/.test(t))).toBe(true);
    // What survived still went off.
    expect(lines(g).some((t) => /casts Gloom Cut at .* strength/.test(t))).toBe(true);
  });

  it('at 100% or more nothing of the working arrives — and the burn is never capped', () => {
    const g = arena();
    const foe = foeOf(g);
    const { spec } = prepare(g, ['undo:3', 'with', 'arcane:3', 'with', 'arcane:3', 'with', 'arcane:3']);
    const working = ['arcane:3', 'pierce', 'with', 'arcane:3', 'with', 'arcane:3'];
    const e = counterEfficiency(spec.counter!, workingSignature(composeArcane(working)!)).efficiency;
    expect(e).toBeGreaterThan(1);

    const hp = hpOf(g);
    const { spellPower } = playerStats(g);
    monsterCasts(g, working, 99);
    expect(hpOf(g)).toBe(hp);
    expect(lines(g).some((t) => /is fully undone by your counterspell/.test(t))).toBe(true);
    // Uncapped: the burn is the whole efficiency's worth, past 100%.
    expect(burnOn(g, foe.entity)!.intensity).toBeCloseTo(e * spec.counter!.burn * spellPower, 6);
  });

  it('firing conditions route traps: one tuned for heat waits out a dark working', () => {
    const g = arena();
    const { id } = prepare(g, ['fire', 'undo']);
    const set = g.dispatch(
      setTrigger({ id, trigger: { conditions: [{ subject: 'enemy.castElement', op: 'is', value: 'heat' }] } }),
    );
    expect(set.ok).toBe(true);
    monsterCasts(g, ['gloom', 'cut'], 98);
    expect(combatOf(g).fight!.cooldowns[id]).toBeUndefined();
    monsterCasts(g, ['fire', 'cut'], 99);
    expect(combatOf(g).fight!.cooldowns[id]).toBeGreaterThan(0);
  });

  it('whatever else the sentence carries lands on the caster — and is not itself answered', () => {
    const g = arena();
    prepare(g, ['fire', 'pierce', 'undo']);
    const hp = foeOf(g).hp;
    monsterCasts(g, ['gloom', 'cut'], 99);
    expect(foeOf(g).hp).toBeLessThan(hp);
    // The knight's own undoing is tuned against heat, and was ready. The
    // payload of an undoing is not answered.
    expect(foeOf(g).cooldowns?.[4]).toBeUndefined();
  });
});

describe('monsters undo too', () => {
  const KNIGHT_UNDO = 4;

  it('the Death Knight holds an undoing, and never spends a turn on it', () => {
    const entry = MONSTERS.death_knight.rotation![KNIGHT_UNDO];
    expect('cast' in entry && specForSource(entry.cast as SpellSource).counter?.tuning).toEqual({ light: 1, heat: 1 });
  });

  it('your light is answered: thinned, and you burn for it', () => {
    const g = arena();
    const bolt = prepare(g, ['light', 'pierce']);
    playerCasts(g, bolt);
    expect(foeOf(g).cooldowns?.[KNIGHT_UNDO]).toBeGreaterThan(ticksOf(g));
    expect(burnOn(g)?.intensity).toBeGreaterThan(0);
    expect(lines(g).some((t) => /Death Knight's .* springs on your .*: 29% efficiency/.test(t))).toBe(true);

    // On its clock, the next working goes through untouched.
    const burn = burnOn(g)!.intensity;
    playerCasts(g, bolt);
    expect(burnOn(g)!.intensity).toBe(burn);
  });

  it('a mind in debt cannot shape an undoing', () => {
    const g = arena();
    patchFight(g, (state) => {
      state.fight!.enemies[0]!.mana = -1;
    });
    const bolt = prepare(g, ['light', 'pierce']);
    playerCasts(g, bolt);
    expect(foeOf(g).cooldowns?.[KNIGHT_UNDO]).toBeUndefined();
    expect(burnOn(g)).toBeUndefined();
  });
});

describe('manaburn on a monster eats its mind', () => {
  /** Run the fight, stopping when it closes. `each` runs after every tick. The old `fight`. */
  const fight = (g: Kernel, ticks: number, each?: () => void) => {
    for (let i = 0; i < ticks; i++) {
      g.tick();
      if (!combatOf(g).fight) return;
      each?.();
    }
  };
  const burnTheMind = (g: Kernel, intensity: number) =>
    ask(g, applyStatus, { entity: foeOf(g).entity, app: { id: 'manaburn', intensity }, source: 'test', resist: true });
  const detonated = (g: Kernel) => lines(g).some((t) => /Manaburn detonates on the/.test(t));

  it('the mind is the player’s own arithmetic, read off its attributes', () => {
    const foe = foeOf(arena('psionic_slime'));
    const mind = monsterMind(foe);
    expect(mind.max).toBe(foe.attrs.int);
    expect(mind.current).toBe(mind.max);
    expect(mind.regen).toBeCloseTo(foe.attrs.int * 0.01 + foe.attrs.wis * 0.05, 10);
  });

  it('a burn deeper than the mind runs it into debt, then goes off', () => {
    const g = arena('psionic_slime');
    // No wisdom to recover with. The slime's own WIS mends its mind nearly as
    // fast as a burn this size eats it: the player's rule, and why a wise
    // caster outlasts what floors a clever one.
    patchFight(g, (state) => {
      state.fight!.enemies[0]!.attrs.wis = 0;
    });
    const max = monsterMind(foeOf(g)).max;
    expect(burnTheMind(g, max * 3)).not.toBeNull();
    let debt = false;
    let boom = false;
    const hp = foeOf(g).hp;
    fight(g, 600, () => {
      if (mindInDebt(foeOf(g))) debt = true;
      if (detonated(g)) boom = true;
    });
    expect(debt).toBe(true);
    expect(boom).toBe(true);
    expect(burnOn(g, foeOf(g).entity)).toBeUndefined();
    expect(foeOf(g).hp).toBeLessThan(hp);
  });

  it('a wise mind outlasts a burn its own depth would not', () => {
    const g = arena('psionic_slime');
    const max = monsterMind(foeOf(g)).max;
    expect(burnTheMind(g, max * 3)).not.toBeNull();
    let boom = false;
    fight(g, 600, () => {
      if (detonated(g)) boom = true;
    });
    expect(combatOf(g).fight).not.toBeNull();
    expect(boom).toBe(false);
  });

  it('a mind in debt cannot shape a working — it swings instead', () => {
    // The slime's whole rotation is workings, so whole it casts within the
    // first few fills; in debt, every fill falls through to its plain attack.
    // Its own rotation is psionic (step 3): the kit gives it an arcane sentence.
    const kit: MonsterKit = { rotation: [{ cast: { school: 'arcane', words: ['gloom', 'cut'] } }] };
    const g = arena('psionic_slime', 5, kit);
    fight(g, 600, () => {
      patchFight(g, (state) => {
        state.fight!.enemies[0]!.mana = -5;
      });
    });
    // The first fill is after the first tick, so the debt is set before it.
    expect(combatOf(g).fight).not.toBeNull();
    expect(lines(g).some((t) => / casts /.test(t))).toBe(false);
    // The line that opens a staged fight names the slime too: it is not a swing.
    expect(lines(g).some((t) => /Psionic Slime/.test(t) && !/You /.test(t) && !/ attacks!$/.test(t))).toBe(true);

    const whole = arena('psionic_slime', 5, kit);
    fight(whole, 600);
    expect(lines(whole).some((t) => / casts /.test(t))).toBe(true);
  });

  it('a burned mind recovers, and forgets once it is whole', () => {
    const g = arena('psionic_slime');
    patchFight(g, (state) => {
      const foe = state.fight!.enemies[0]!;
      foe.mana = monsterMind(foe).max - 1e-6;
    });
    expect(foeOf(g).mana).toBeDefined();
    fight(g, 1);
    expect(foeOf(g).mana).toBeUndefined();
  });
});

describe('the enemy-casting trigger', () => {
  it('is an event any entry can gate on, with subjects that read what is being cast', () => {
    expect(TRIGGER_EVENTS).toContain('onEnemyCast');
    const g = arena();
    monsterCasts(g, ['gloom', 'cut'], 99);
    const read = (subject: string) =>
      run(g, (ctx) => {
        const state = ctx.read(combat);
        return triggerSubject(subject)!.read({ ctx: ctx as never, fight: state.fight!, state });
      });
    expect(read('enemy.castSchool')).toBe('arcane');
    expect(read('enemy.castElement')).toBe('dark');
    // Stale once the window has passed: a trigger asks about the present tick.
    patch(g, (slices) => {
      (slices.clock as ClockState).totalTicks += 10;
    });
    expect(read('enemy.castElement')).toBe('');
  });
});

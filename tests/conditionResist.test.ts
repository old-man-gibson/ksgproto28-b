import { describe, expect, it } from 'vitest';
import { PLAYER, type Kernel } from '../src/kernel';
import { ELEMENTAL_TYPES, namedFact, RES_STAT_BY_TYPE, statMod, type StatKey } from '../src/systems/stats';
import {
  applyStatus,
  conditionReadout,
  harmOf,
  isHarmful,
  removeStatus,
  resistanceProblems,
  resistBlock,
  STATUSES,
  type StatusApplication,
  type StatusDef,
  type StatusesState,
  type TitleImmunity,
} from '../src/systems/statuses';
import { ask, makeGame, setMods, slice } from './helpers';

/**
 * Port of the status half of the old tests/conditionResist.test.ts: the
 * unresistable mark, the `resistanceProblems` lint, and the player's
 * resistance block. Changed: the call shape, as in tests/statuses.test.ts.
 *
 * Left behind, for the ports of the systems they need: queasy through food
 * (cooking, consumables), Iron Stomach (titles), overgrowth through forced
 * healing (combat), tag resistances and the damage slices of monsters
 * (combat), monster penetration and its lint (combat, world).
 */

const fresh = (seed = 1): Kernel => makeGame({ seed });

const aStatus = (patch: Partial<StatusDef>): StatusDef => ({
  id: 'test_status',
  name: 'Test Status',
  icon: '🧪',
  desc: 'Test-only.',
  stacking: { mode: 'highest' },
  duration: 600,
  ...patch,
});

/** Every resistance, and the elemental bonus, far past 100%. */
const WALLED = [
  ...Object.values(RES_STAT_BY_TYPE).map((key) => statMod(key as StatKey, 'add', 5)),
  statMod('resElemental', 'add', 5),
];

const apply = (g: Kernel, who: string, app: StatusApplication, resist = true) =>
  ask(g, applyStatus, { entity: who, app, source: 'test', resist });

describe('unresistable conditions', () => {
  const MARKED = [
    'fasting',
    'flat_footed',
    'surprised',
    'toll_steam',
    'toll_ice',
    'toll_overdrive',
    'doused',
    'psionic_compression',
    'psionic_read',
    'unfolded',
    // A statue (Basilisk Hide) and its two branches.
    'petrified',
    'petrified_rubble',
    'petrified_standing',
  ];

  it('exactly these thirteen are marked, each with a reason', () => {
    const marked = Object.values(STATUSES).filter((d) => d.unresistable);
    expect(marked.map((d) => d.id).sort()).toEqual([...MARKED].sort());
    for (const def of marked) expect(def.unresistable!.trim().length, def.id).toBeGreaterThan(0);
  });

  it('every harmful condition has an element or is marked, never both', () => {
    for (const def of Object.values(STATUSES).filter(isHarmful)) {
      expect(!!def.element !== !!def.unresistable, `${def.id} (${harmOf(def)})`).toBe(true);
    }
  });

  it('lands in full on a player whose every resistance is far past 100%', () => {
    // The control first: the same block turns an ordinary condition away.
    const control = fresh(3);
    setMods(control, WALLED);
    expect(apply(control, PLAYER, { id: 'poison', intensity: 1 })).toBeNull();
    for (const id of MARKED) {
      const g = fresh(3);
      setMods(g, WALLED);
      const landed = apply(g, PLAYER, { id, intensity: 1 });
      expect(landed, id).not.toBeNull();
      expect(landed!.intensity, id).toBeCloseTo(1);
      expect(g.staleStats()).toEqual([]);
    }
  });

  it('lands in full on a monster whose every resistance is far past 100%', () => {
    const g = fresh(4);
    setMods(g, WALLED, 'wall');
    expect(apply(g, 'wall', { id: 'poison', intensity: 1 })).toBeNull();
    for (const id of MARKED) {
      ask(g, removeStatus, { entity: 'wall', id });
      const landed = apply(g, 'wall', { id, intensity: 1 });
      expect(landed, id).not.toBeNull();
      expect(landed!.intensity, id).toBeCloseTo(1);
    }
    expect(g.staleStats()).toEqual([]);
  });

  it('the readout says so, and reads nothing for a buff', () => {
    const g = fresh(5);
    const state = slice<StatusesState>(g, 'statuses');
    expect(conditionReadout(g, state, STATUSES.surprised)).toEqual({
      kind: 'unresistable',
      reason: STATUSES.surprised.unresistable,
    });
    expect(conditionReadout(g, state, STATUSES.steady_hand)).toEqual({ kind: 'none' });
    // A resisted condition reads the figure before the cap, and immunity at 1.
    setMods(g, [statMod('resPoison', 'add', 1.2)]);
    expect(conditionReadout(g, state, STATUSES.poison)).toEqual({
      kind: 'resisted',
      element: 'poison',
      total: 1.2,
      immune: true,
    });
  });
});

describe('resistanceProblems: who can resist what', () => {
  const lint = (extra: Record<string, StatusDef> = {}, titles: Record<string, TitleImmunity> = {}) =>
    resistanceProblems({ ...STATUSES, ...extra }, titles).map((p) => p.message);

  it('the live content is clean', () => {
    expect(lint()).toEqual([]);
  });

  it('refuses a harmful condition that names neither an element nor unresistable', () => {
    const bare = aStatus({ id: 'test_bare', dot: { type: 'poison', flat: 0.1 } });
    expect(lint({ test_bare: bare })).toEqual([
      "'test_bare' harms its bearer (dot) but has neither an element to be resisted by nor unresistable: say which",
    ]);
    // Either answer clears it.
    expect(lint({ test_bare: { ...bare, element: 'poison' } })).toEqual([]);
    expect(lint({ test_bare: { ...bare, unresistable: 'state: a test' } })).toEqual([]);
  });

  it('refuses both at once', () => {
    const both = aStatus({ id: 'test_both', element: 'heat', unresistable: 'a test' });
    expect(lint({ test_both: both })).toEqual([
      "'test_both' has both an element (heat) and unresistable ('a test'): it is resisted or it is not",
    ]);
  });

  it('refuses a mark on a condition that harms no one, and an empty reason', () => {
    expect(lint({ test_buff: aStatus({ id: 'test_buff', unresistable: 'a test' }) })).toEqual([
      "'test_buff' is marked unresistable but harms no one: remove the mark",
    ]);
    expect(
      lint({ test_empty: aStatus({ id: 'test_empty', dot: { type: 'poison', flat: 0.1 }, unresistable: '  ' }) }),
    ).toEqual(["'test_empty' has an empty unresistable: give the reason in a few words"]);
  });

  it('refuses an immunity that would switch an unresistable condition off', () => {
    const wall = aStatus({ id: 'test_wall', immune: { ids: ['toll_ice', 'poison'] } });
    expect(lint({ test_wall: wall })).toEqual([
      "immune names 'toll_ice', which is unresistable: nothing may switch it off",
    ]);
    const stomach: TitleImmunity = { id: 'test_title', immune: { ids: ['fasting'] } };
    expect(lint({}, { test_title: stomach })).toEqual([
      "immune names 'fasting', which is unresistable: nothing may switch it off",
    ]);
    // A resistible condition is a fair target for a title, and an element is not a name.
    expect(lint({}, { test_title: { ...stomach, immune: { ids: ['queasy'], elements: ['poison'] } } })).toEqual([]);
  });

  // The old case also checked the real Iron Stomach title. Titles are not ported.
  it('refuses a title whose immunity names a condition that does not exist, or names nothing', () => {
    const stomach: TitleImmunity = { id: 'test_title', immune: { ids: ['queazy'] } };
    expect(lint({}, { test_title: stomach })).toEqual(["immune names unknown condition 'queazy'"]);
    // One real id and one typo: only the typo is named.
    expect(lint({}, { test_title: { ...stomach, immune: { ids: ['queasy', 'queazy'] } } })).toEqual([
      "immune names unknown condition 'queazy'",
    ]);
    expect(lint({}, { test_title: { ...stomach, immune: {} } })).toEqual([
      'immune names no condition and no element — it protects against nothing',
    ]);
    expect(lint({}, { test_title: { ...stomach, immune: { ids: [] } } })).toEqual([
      'immune names no condition and no element — it protects against nothing',
    ]);
    // An element alone is a legal answer.
    expect(lint({}, { test_title: { ...stomach, immune: { elements: ['poison'] } } })).toEqual([]);
  });

  it('names the entry and where in it, for the forge', () => {
    const problems = resistanceProblems({ ...STATUSES, x: aStatus({ id: 'x', element: 'heat', unresistable: 'a test' }) });
    expect(problems).toEqual([expect.objectContaining({ kind: 'status', id: 'x', path: ['unresistable'] })]);
  });
});

describe('queasy, overgrowth and proliferating are resisted through poison', () => {
  it('carry the poison element', () => {
    for (const id of ['queasy', 'overgrowth', 'proliferating']) {
      expect(STATUSES[id].element, id).toBe('poison');
      expect(STATUSES[id].unresistable, id).toBeUndefined();
    }
  });

  it('queasy lands thinned by poison resistance and not at all at 100%', () => {
    const g = fresh(6);
    apply(g, PLAYER, { id: 'steeped', intensity: 2 }, false); // resPoison +0.5
    expect(apply(g, PLAYER, { id: 'queasy', intensity: 1 })!.intensity).toBeCloseTo(0.5);
    const walled = fresh(6);
    apply(walled, PLAYER, { id: 'steeped', intensity: 4 }, false); // 1.0 before the cap
    expect(apply(walled, PLAYER, { id: 'queasy', intensity: 1 })).toBeNull();
    expect(g.staleStats()).toEqual([]);
    expect(walled.staleStats()).toEqual([]);
  });

  it.todo('refuse-grade food is thinned by poison resistance, because it is done to the eater (cooking, consumables)');
  it.todo('the Scorched Mess, which grants Queasy outright, is thinned the same way (cooking, consumables)');
  it.todo('nourishment is still not resisted: a dish’s own grants land in full (cooking, consumables)');
  it.todo('overgrowth lands thinned on a poison-resistant monster, and its escalation is not billed again (port 4: `healEnemy`)');
  it.todo('a monster at 100% poison resistance cannot be overgrown, though forced healing still heals (port 4: `healEnemy`)');
});

describe('immunity stated by another system (the old `TitleDef.immune`)', () => {
  // The titles system will state an earned title's immunity as named facts
  // of the stat pipeline. The probe states them here.
  it('refuses the condition named, by id or by element, for that entity only', () => {
    const g = fresh(7);
    setMods(g, [namedFact('statusImmune:queasy', 1)]);
    expect(apply(g, PLAYER, { id: 'queasy', intensity: 1 }, false)).toBeNull();
    expect(apply(g, PLAYER, { id: 'poison', intensity: 1 }, false)).not.toBeNull();
    // Another entity has no such fact.
    expect(apply(g, 'rat', { id: 'queasy', intensity: 1 })).not.toBeNull();

    setMods(g, [namedFact('statusImmuneElement:heat', 1)]);
    expect(apply(g, PLAYER, { id: 'on_fire', intensity: 1 }, false)).toBeNull();
    expect(apply(g, PLAYER, { id: 'queasy', intensity: 1 }, false)).not.toBeNull();
    expect(g.staleStats()).toEqual([]);
  });
});

describe('a condition’s damage ticks shed what a blow of the same type would', () => {
  it('the player’s block stacks resElemental on the elemental types and holds the body’s cap', () => {
    const block = resistBlock({ resPoison: 0.5, resSlashing: 0.5, resElemental: 0.1, resistCap: 0.75 });
    expect(block.poison).toBeCloseTo(0.6);
    expect(block.slashing).toBeCloseTo(0.5); // not elemental
    expect(ELEMENTAL_TYPES.has('slashing')).toBe(false);
    expect(resistBlock({ resPoison: 0.7, resElemental: 0.2, resistCap: 0.75 }).poison).toBeCloseTo(0.75);
    // A body built to hold more holds more.
    expect(resistBlock({ resPoison: 0.7, resElemental: 0.2, resistCap: 0.95 }).poison).toBeCloseTo(0.9);
    // Vulnerability passes through untouched.
    expect(resistBlock({ resSlashing: -0.5, resistCap: 0.75 }).slashing).toBeCloseTo(-0.5);
  });

  it.todo('a monster’s resistance comes from its tags, not only from what its def declares (port 4)');
  it.todo('elemental resistance counts for the elemental types, as it does for a blow (port 4: `monsterSlice`)');
  it.todo('is the figure monsterSlice stacks, for every type and a spread of bodies (port 4)');
  it.todo('is the figure incomingSlice stacks for the real player, every type (port 4)');
});

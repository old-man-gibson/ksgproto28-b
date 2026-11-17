import { describe, expect, it } from 'vitest';
import type { GameEvent, Kernel } from '../src/kernel';
import type { AttributesState } from '../src/systems/attributes';
import {
  bumpCounter,
  clearCounter,
  CONDITION_TYPES,
  conditionIssues,
  conditionMet,
  conditionProgress,
  conditionsMet,
  conditionsProgress,
  counterChanged,
  counterValue,
  flagKey,
  hasFlag,
  raiseCounter,
  setCounter,
  type Condition,
  type ConditionReader,
  type CountersState,
} from '../src/systems/counters';
import { conditionReader, SKILL_LIST, SKILLS } from '../src/systems/skills';
import { ATTRIBUTE_IDS, armedFact, fuseFact, namedFact, targetIssue, wieldTagFact } from '../src/systems/stats';
import { ATTRIBUTE_LIST, ATTRIBUTE_TRAINING } from '../src/systems/attributes';
import { RESOURCE_LIST } from '../src/systems/resources';
import { emit, makeGame, patch, reads, setMods, slice } from './helpers';

/**
 * Counters and the condition language. The old build had no test file for
 * either on its own: counters were `state.stats` written by
 * `systems/achievements.ts`, and conditions were tested through skills,
 * super-attributes and floors. The condition cases of the old
 * tests/attributes.test.ts and tests/superattrs.test.ts are ported here; the
 * content checks at the bottom are the old content linter's rules for the
 * registries this port owns (tests/content.test.ts).
 */

const counts = (kernel: Kernel) => slice<CountersState>(kernel, 'counters');

describe('counters', () => {
  it('a counter that was never written reads 0 and is absent from the save', () => {
    const kernel = makeGame();
    expect(counterValue(counts(kernel), 'kills')).toBe(0);
    expect(counts(kernel).counts).toEqual({});
  });

  it('bump adds, raise keeps the maximum, set overwrites, clear removes', () => {
    const kernel = makeGame();
    emit(kernel, bumpCounter, { key: 'kills' });
    emit(kernel, bumpCounter, { key: 'kills' });
    emit(kernel, bumpCounter, { key: 'gold:earned', amount: 340 });
    expect(counts(kernel).counts).toEqual({ kills: 2, 'gold:earned': 340 });

    emit(kernel, raiseCounter, { key: 'attr:str', value: 12 });
    emit(kernel, raiseCounter, { key: 'attr:str', value: 9 });
    expect(counterValue(counts(kernel), 'attr:str')).toBe(12);

    emit(kernel, setCounter, { key: 'slain:f6_great_hall:goblin_warchief', value: 1 });
    emit(kernel, setCounter, { key: 'kills', value: 0 });
    expect(counterValue(counts(kernel), 'slain:f6_great_hall:goblin_warchief')).toBe(1);
    expect(counts(kernel).counts.kills).toBe(0);

    emit(kernel, clearCounter, { key: 'kills' });
    expect('kills' in counts(kernel).counts).toBe(false);
    emit(kernel, clearCounter, { key: 'kills' });
    expect(kernel.skips().map((skip) => skip.reason)).toEqual(['counter "kills" is not set']);
  });

  it('every write is announced with the new value, and a raise that changes nothing is not', () => {
    const kernel = makeGame();
    const seen: unknown[] = [];
    kernel.onEvent((event: GameEvent) => {
      if (event.type === counterChanged.type) seen.push(event.payload);
    });
    emit(kernel, bumpCounter, { key: 'kills:tag:goblin', amount: 3 });
    emit(kernel, raiseCounter, { key: 'kills:tag:goblin', value: 2 });
    emit(kernel, setCounter, { key: 'kills:tag:goblin', value: 1 });
    emit(kernel, clearCounter, { key: 'kills:tag:goblin' });
    expect(seen).toEqual([
      { key: 'kills:tag:goblin', value: 3 },
      { key: 'kills:tag:goblin', value: 1 },
      { key: 'kills:tag:goblin', value: 0 },
    ]);
  });

  it('a flag is a counter under flag:', () => {
    const kernel = makeGame();
    expect(flagKey('key_item:toll_office_key')).toBe('flag:key_item:toll_office_key');
    expect(hasFlag(counts(kernel), 'key_item:toll_office_key')).toBe(false);
    emit(kernel, setCounter, { key: flagKey('key_item:toll_office_key'), value: 1 });
    expect(hasFlag(counts(kernel), 'key_item:toll_office_key')).toBe(true);
    // The gate in the old content reads it as a `stat` condition.
    const gate: Condition = { type: 'stat', key: 'flag:key_item:toll_office_key', value: 1 };
    expect(conditionMet(conditionReader(reads(kernel)), gate)).toBe(true);
  });

  it('counters survive a save and a load', () => {
    const kernel = makeGame();
    emit(kernel, bumpCounter, { key: 'kills', amount: 7 });
    const other = makeGame();
    expect(other.load(kernel.save(0)).ok).toBe(true);
    expect(counts(other).counts).toEqual({ kills: 7 });
  });
});

describe('the condition language', () => {
  const reader = (over: Partial<ConditionReader> = {}): ConditionReader => ({
    skillLevel: () => 0,
    attr: () => 0,
    counter: () => 0,
    hasTag: () => false,
    questDone: () => false,
    boonRank: () => 0,
    ...over,
  });

  it('evaluates every kind', () => {
    const r = reader({
      skillLevel: (id) => (id === 'fighting' ? 10 : 0),
      attr: (id) => (id === 'dex' ? 20 : 1),
      counter: (key) => (key === 'kills' ? 5 : 0),
      hasTag: (tag) => tag === 'sword',
      questDone: (id) => id === 'the_first_ascent',
      boonRank: (id) => (id === 'foresight' ? 2 : 0),
    });
    const cases: [Condition, boolean][] = [
      [{ type: 'skill', id: 'fighting', level: 10 }, true],
      [{ type: 'skill', id: 'fighting', level: 11 }, false],
      [{ type: 'attr', attr: 'dex', level: 20 }, true],
      [{ type: 'attr', attr: 'str', level: 2 }, false],
      [{ type: 'stat', key: 'kills', value: 5 }, true],
      [{ type: 'stat', key: 'kills', value: 6 }, false],
      [{ type: 'statMax', key: 'weapon:families', value: 1 }, true],
      [{ type: 'statMax', key: 'kills', value: 4 }, false],
      [{ type: 'equippedTag', tag: 'sword' }, true],
      [{ type: 'equippedTag', tag: 'bow' }, false],
      [{ type: 'quest', id: 'the_first_ascent' }, true],
      [{ type: 'quest', id: 'faces_of_threshold' }, false],
      [{ type: 'boon', id: 'foresight' }, true],
      [{ type: 'boon', id: 'head_start' }, false],
    ];
    for (const [cond, expected] of cases) expect(conditionMet(r, cond), JSON.stringify(cond)).toBe(expected);
    // Every kind is covered above.
    expect(new Set(cases.map(([cond]) => cond.type))).toEqual(new Set(CONDITION_TYPES));
    expect(conditionsMet(r, cases.filter(([, ok]) => ok).map(([cond]) => cond))).toBe(true);
    expect(conditionsMet(r, cases.map(([cond]) => cond))).toBe(false);
    expect(conditionsMet(r, [])).toBe(true);
  });

  it('progress is the distance to a threshold; a condition that is not a threshold reads 1', () => {
    const r = reader({ skillLevel: () => 9, attr: () => 5, counter: () => 50 });
    expect(conditionProgress(r, { type: 'skill', id: 'fighting', level: 10 })).toBeCloseTo(0.9);
    expect(conditionProgress(r, { type: 'skill', id: 'fighting', level: 3 })).toBe(1);
    expect(conditionProgress(r, { type: 'skill', id: 'fighting', level: 0 })).toBe(1);
    expect(conditionProgress(r, { type: 'attr', attr: 'dex', level: 20 })).toBeCloseTo(0.25);
    expect(conditionProgress(r, { type: 'stat', key: 'combat:dodges', value: 100 })).toBeCloseTo(0.5);
    expect(conditionProgress(r, { type: 'stat', key: 'combat:dodges', value: 0 })).toBe(1);
    for (const cond of [
      { type: 'statMax', key: 'kills', value: 0 },
      { type: 'equippedTag', tag: 'bow' },
      { type: 'quest', id: 'x' },
      { type: 'boon', id: 'x' },
    ] as Condition[])
      expect(conditionProgress(r, cond)).toBe(1);
    // The least-advanced threshold of a set; an empty set reads 1.
    expect(
      conditionsProgress(r, [
        { type: 'skill', id: 'fighting', level: 10 },
        { type: 'attr', attr: 'dex', level: 20 },
        { type: 'equippedTag', tag: 'bow' },
      ]),
    ).toBeCloseTo(0.25);
    expect(conditionsProgress(r, [])).toBe(1);
  });

  it('the player’s reader takes each kind from the system that owns it', () => {
    const kernel = makeGame();
    patch(kernel, (slices) => {
      slices.skills.skills.fighting = { level: 10, xp: 0 };
      (slices.attributes as AttributesState).attrs.dex.level = 8;
      slices.counters.counts['combat:dodges'] = 100;
    });
    const met = (cond: Condition) => conditionMet(conditionReader(reads(kernel)), cond);
    expect(met({ type: 'skill', id: 'fighting', level: 10 })).toBe(true);
    expect(met({ type: 'skill', id: 'swordsmanship', level: 1 })).toBe(false);
    expect(met({ type: 'stat', key: 'combat:dodges', value: 100 })).toBe(true);
    expect(met({ type: 'statMax', key: 'weapon:families', value: 1 })).toBe(true);
    // Bare hands wield the pseudo-tag `unarmed`, until a weapon is in hand.
    expect(met({ type: 'equippedTag', tag: 'unarmed' })).toBe(true);
    expect(met({ type: 'equippedTag', tag: 'sword' })).toBe(false);
    expect(met({ type: 'quest', id: 'the_first_ascent' })).toBe(false);
    expect(met({ type: 'boon', id: 'foresight' })).toBe(false);

    // What the items, quests and prestige ports will state.
    setMods(kernel, [
      armedFact(),
      wieldTagFact('sword'),
      namedFact('quest:the_first_ascent', 1),
      namedFact('boon:foresight', 2),
    ]);
    expect(met({ type: 'equippedTag', tag: 'unarmed' })).toBe(false);
    expect(met({ type: 'equippedTag', tag: 'sword' })).toBe(true);
    expect(met({ type: 'quest', id: 'the_first_ascent' })).toBe(true);
    expect(met({ type: 'boon', id: 'foresight' })).toBe(true);
  });

  it('an attribute condition is satisfied through a fused partner (old tests/superattrs.test.ts)', () => {
    const kernel = makeGame();
    patch(kernel, (slices) => {
      (slices.attributes as AttributesState).attrs.str.level = 15;
      (slices.attributes as AttributesState).attrs.cha.level = 9;
    });
    const charisma: Condition = { type: 'attr', attr: 'cha', level: 20 };
    expect(conditionMet(conditionReader(reads(kernel)), charisma)).toBe(false);
    setMods(kernel, [fuseFact('str', 'cha')]);
    // (15 + 2 milestones) x 1.01 + (9 + 1 milestone) = 27.17
    expect(conditionMet(conditionReader(reads(kernel)), charisma)).toBe(true);
  });
});

describe('content of this port (the old content linter’s rules)', () => {
  const skillConditions = SKILL_LIST.flatMap((def) => def.unlock.map((cond) => ({ def, cond })));

  it('every condition carries exactly the fields its type needs', () => {
    for (const { def, cond } of skillConditions) expect(conditionIssues(cond), def.id).toEqual([]);
    expect(conditionIssues({ type: 'skill', id: 'fighting' })).toEqual(['skill condition lacks "level"']);
    expect(conditionIssues({ type: 'quest', id: 'x', level: 3 })).toEqual(['quest condition has unused field "level"']);
  });

  it('every skill a condition names exists, and every attribute is one of the six', () => {
    for (const { def, cond } of skillConditions) {
      if (cond.type === 'skill') expect(SKILLS[cond.id], `${def.id} needs ${cond.id}`).toBeDefined();
      if (cond.type === 'attr') expect(ATTRIBUTE_IDS as readonly string[], def.id).toContain(cond.attr);
    }
  });

  it('every modifier in the content targets a stat key, an attribute or a scoped stat', () => {
    const mods = [
      ...SKILL_LIST.flatMap((def) => [...(def.effects ?? []), ...(def.milestones ?? []).flatMap((m) => m.bonus)]),
      ...Object.values(ATTRIBUTE_TRAINING).flatMap((def) => [
        ...def.tierNames.flatMap((rank) => rank.bonus ?? []),
        ...(def.milestones ?? []).flatMap((m) => m.bonus),
      ]),
      ...RESOURCE_LIST.flatMap((def) => def.reserve?.emptyPenalty ?? []),
    ];
    expect(mods.length).toBeGreaterThan(300);
    for (const mod of mods) expect(targetIssue(mod.stat), JSON.stringify(mod)).toBeNull();
    expect(targetIssue('damgae')).toBe('"damgae" is not a stat key or an attribute id');
    expect(targetIssue('craftSpeed:leatherwork')).toBeNull();
    expect(targetIssue('str:leatherwork')).toBe('"str" in "str:leatherwork" is not a stat key');
  });

  it('rank, milestone and tier lists are sorted by level, which the sources rely on', () => {
    const sorted = (levels: number[]) => levels.every((level, i) => i === 0 || levels[i - 1] <= level);
    for (const def of Object.values(ATTRIBUTE_TRAINING)) {
      expect(sorted(def.tierNames.map((rank) => rank.level)), def.id).toBe(true);
      expect(sorted((def.milestones ?? []).map((m) => m.level)), def.id).toBe(true);
    }
    for (const def of SKILL_LIST) {
      expect(sorted((def.milestones ?? []).map((m) => m.level)), def.id).toBe(true);
      expect(sorted((def.tierNames ?? []).map((t) => t.level)), def.id).toBe(true);
    }
  });

  it('a skill’s parent chain ends, and its curve has a band from level 1', () => {
    for (const def of SKILL_LIST) {
      const seen = new Set<string>();
      for (let at: string | undefined = def.id; at; at = SKILLS[at].parent) {
        expect(seen.has(at), `${def.id} has a parent cycle`).toBe(false);
        seen.add(at);
      }
      if (def.progression) {
        expect(def.progression.length, def.id).toBeGreaterThan(0);
        expect(def.progression[0].from, def.id).toBe(1);
      }
    }
  });

  it('the attributes registry holds the six ids the stat formulas are written for', () => {
    expect(ATTRIBUTE_LIST.map((a) => a.id)).toEqual([...ATTRIBUTE_IDS]);
    expect(Object.keys(ATTRIBUTE_TRAINING).sort()).toEqual([...ATTRIBUTE_IDS].sort());
  });

  it('the conversion kept the counts of the old registries', () => {
    expect(SKILL_LIST).toHaveLength(94);
    expect(RESOURCE_LIST.map((r) => r.id)).toEqual(['hp', 'stamina', 'mana', 'spirit', 'focus']);
    expect(ATTRIBUTE_TRAINING.str.milestones).toHaveLength(20);
    expect(ATTRIBUTE_TRAINING.int.milestones).toHaveLength(3);
  });
});

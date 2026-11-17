import { describe, expect, it } from 'vitest';
import type { GameEvent, Kernel, Modifier } from '../src/kernel';
import {
  attrLevelUp,
  attrXpNeeded,
  grantAttrXp,
  grantAttrXpSplit,
  trainingRankName,
  type AttributesState,
} from '../src/systems/attributes';
import type { CountersState } from '../src/systems/counters';
import { conditionMet } from '../src/systems/counters';
import { conditionReader } from '../src/systems/skills';
import {
  actionTicks,
  ATTACK_SPEED_MOD_CAP,
  attackFillRate,
  attrBreakdown,
  attrValue,
  effectiveAttr,
  fuseFact,
  MIN_ATTACK_TICKS,
  statBlockOf,
  statBreakdown,
  statMod,
  statOf,
  type AttributeId,
} from '../src/systems/stats';
import { emit, makeGame, patch, reads, setMods, slice } from './helpers';

/**
 * Port of the old tests/attributes.test.ts, tests/attackspeed.test.ts and the
 * attribute and stat cases of tests/breakdown.test.ts.
 *
 * Changed: the call shape. Equipment, buffs, achievements and fusion are not
 * ported yet. Where an old test used one of them only as a source of
 * modifiers, the same modifiers come from the test-only probe source here,
 * and the test says so. What each of those systems does beyond emitting
 * modifiers is left behind:
 * - equip and unequip, and item requirements (`canEquip`): the items port;
 * - the rune line and the item line of the damage breakdown: the items port;
 * - damage tooltips and the fight feed's breakdowns: the combat port.
 */

function withLevels(levels: Partial<Record<AttributeId, number>>): Kernel {
  const kernel = makeGame();
  patch(kernel, (slices) => {
    for (const [id, level] of Object.entries(levels)) (slices.attributes as AttributesState).attrs[id as AttributeId].level = level!;
  });
  return kernel;
}

// The modifiers these items carry in the old content (data/items.data.ts).
const STEEL_GREATSWORD: Modifier[] = [
  statMod('str', 'add', 3, 'Steel Greatsword', { kind: 'item', slot: 'weapon' }),
  statMod('damage', 'add', 14, 'Steel Greatsword', { kind: 'item', slot: 'weapon' }),
];
const OAK_STAFF: Modifier[] = [statMod('int', 'add', 2, 'Oak Staff', { kind: 'item', slot: 'weapon' })];
const IRON_DAGGER: Modifier[] = [statMod('dex', 'add', 2, 'Iron Dagger', { kind: 'item', slot: 'weapon' })];
const buff = (name: string, mod: Modifier): Modifier => ({ ...mod, source: `Buff: ${name}`, origin: { kind: 'buff' } }) as Modifier;

describe('effective attributes (stat layer)', () => {
  it('attribute bonuses from an item raise the effective value and derived stats', () => {
    const kernel = withLevels({ str: 10 });
    const before = statOf(kernel, 'damage');

    patch(kernel, (slices) => ((slices.attributes as AttributesState).attrs.str.level = 12));
    setMods(kernel, STEEL_GREATSWORD);
    // 12 trained + 3 sword + 1 milestone (Lv 5), ×1.01 milestone (Lv 10)
    expect(effectiveAttr(kernel, 'str')).toBeCloseTo(16 * 1.01, 5);
    expect(attrValue(kernel, 'str')).toBeCloseTo(16 * 1.01, 5);
    // damage base includes the +3 STR (×1.2) AND the +14 flat
    expect(statOf(kernel, 'damage')).toBeGreaterThan(before + 14 + 3 * 1.2);

    setMods(kernel, []);
    expect(effectiveAttr(kernel, 'str')).toBeCloseTo(13 * 1.01, 5); // sword bonus reverts
    expect(kernel.staleStats()).toEqual([]);
  });

  it('a bonus never changes the trained base', () => {
    const kernel = makeGame();
    setMods(kernel, OAK_STAFF);
    expect(slice<AttributesState>(kernel, 'attributes').attrs.int.level).toBe(1); // trained base untouched
    expect(effectiveAttr(kernel, 'int')).toBe(3);
  });

  it('multiplicative attribute mods compound after adds, floored at 1', () => {
    const kernel = withLevels({ str: 10 });
    setMods(kernel, [buff('Might', statMod('str', 'add', 5)), buff('Giant', statMod('str', 'mult', 0.2))]);
    // adds (10 trained + 5 buff + 1 milestone) then mults (×1.2 buff, ×1.01 milestone)
    expect(effectiveAttr(kernel, 'str')).toBeCloseTo(16 * 1.2 * 1.01, 5);

    setMods(kernel, [buff('Wither', statMod('str', 'add', -99))]);
    expect(effectiveAttr(kernel, 'str')).toBe(1); // floor
  });

  it('unlock conditions see effective attributes', () => {
    const kernel = withLevels({ dex: 8 });
    expect(conditionMet(conditionReader(reads(kernel)), { type: 'attr', attr: 'dex', level: 10 })).toBe(false);
    setMods(kernel, IRON_DAGGER);
    expect(conditionMet(conditionReader(reads(kernel)), { type: 'attr', attr: 'dex', level: 10 })).toBe(true);
  });

  it('fusion sums EFFECTIVE components', () => {
    const kernel = withLevels({ str: 15, cha: 9 });
    // Dominion fuses STR and CHA (old data/superattrs.data.ts).
    setMods(kernel, [fuseFact('str', 'cha')]);
    // eff STR (15+2 milestones)×1.01 + eff CHA (9+1 milestone)
    expect(attrValue(kernel, 'str')).toBeCloseTo(17 * 1.01 + 10, 5);

    setMods(kernel, [fuseFact('str', 'cha'), ...STEEL_GREATSWORD]);
    const expected = (15 + 3 + 2) * 1.01 + 10; // effective STR (with +3 sword) + effective CHA
    expect(attrValue(kernel, 'str')).toBeCloseTo(expected, 5);
    expect(attrValue(kernel, 'cha')).toBeCloseTo(expected, 5); // both components read the sum
    // The effective values stay apart.
    expect(effectiveAttr(kernel, 'cha')).toBeCloseTo(10, 5);
  });

  it('an achievement tier can grant attributes (Honed Body III: +2 STR)', () => {
    const kernel = withLevels({ str: 50 });
    setMods(kernel, [statMod('str', 'add', 2, 'Honed Body III', { kind: 'achievement' })]);
    // 50 + 2 achievement + 5 flat milestones, ×1.01^5 from the five ×-milestones
    expect(effectiveAttr(kernel, 'str')).toBeCloseTo(57 * 1.01 ** 5, 5);
  });
});

describe('attribute training', () => {
  it('XP raises the trained level, one event per level, and the stat block follows', () => {
    const kernel = makeGame();
    const ups: number[] = [];
    kernel.onEvent((event: GameEvent) => {
      if (event.type === attrLevelUp.type) ups.push((event.payload as { level: number }).level);
    });
    const hpBefore = statOf(kernel, 'maxHp');
    emit(kernel, grantAttrXp, { attr: 'con', amount: attrXpNeeded(1) + attrXpNeeded(2) + 3 });
    const con = slice<AttributesState>(kernel, 'attributes').attrs.con;
    expect(con.level).toBe(3);
    expect(con.xp).toBeCloseTo(3, 6);
    expect(ups).toEqual([2, 3]);
    expect(statOf(kernel, 'maxHp')).toBe(hpBefore + 20);
    expect(kernel.staleStats()).toEqual([]);
  });

  it('an attribute level-up raises the attr counter to the value checks read', () => {
    const kernel = makeGame();
    setMods(kernel, OAK_STAFF);
    emit(kernel, grantAttrXp, { attr: 'int', amount: attrXpNeeded(1) });
    // Trained 2, +2 from the staff.
    expect(slice<CountersState>(kernel, 'counters').counts['attr:int']).toBe(4);
  });

  it('a split payout scales the amount per attribute, with nothing normalised', () => {
    const kernel = makeGame();
    emit(kernel, grantAttrXpSplit, { weights: { cha: 0.5, str: 0.25 }, amount: 8 });
    const attrs = slice<AttributesState>(kernel, 'attributes').attrs;
    expect(attrs.cha.xp).toBe(4);
    expect(attrs.str.xp).toBe(2);
    expect(attrs.dex.xp).toBe(0);
  });

  it('ranks step the cost up at 21, 41, 61 and 81, and name the training', () => {
    expect(attrXpNeeded(1)).toBe(10);
    expect(attrXpNeeded(21) / attrXpNeeded(20)).toBeGreaterThan(2);
    expect(trainingRankName('str', 1)).toBe('Strength Training — Beginner');
    expect(trainingRankName('str', 21)).toBe('Strength Training — Intermediate');
    expect(trainingRankName('str', 80)).toBe("Giant's Strength Training");
  });
});

describe('stat breakdowns (tooltips)', () => {
  it('labels each contribution with its source and matches the live total', () => {
    const kernel = withLevels({ str: 21 }); // rank bonus: +2 damage
    setMods(kernel, [statMod('damage', 'add', 6, 'Iron Sword', { kind: 'item', slot: 'weapon' })]);
    const bd = statBreakdown(kernel.modifiers(), 'damage');
    const sources = bd.lines.map((l) => l.source);
    expect(sources).toContain('Iron Sword');
    expect(sources).toContain('Strength Training — Intermediate');
    expect(bd.total).toBeCloseTo(statOf(kernel, 'damage'), 5);
    // Base reflects the formula: 2 + 1.2 × effective STR.
    expect(bd.baseText).toContain('STR');
  });

  it('flags capped stats', () => {
    const kernel = makeGame();
    expect(statBreakdown(kernel.modifiers(), 'dodge').capped).toBe(false);
    setMods(kernel, [buff('Ghost', statMod('dodge', 'add', 5))]);
    const bd = statBreakdown(kernel.modifiers(), 'dodge');
    expect(bd.capped).toBe(true);
    expect(bd.total).toBe(0.75);
    expect(bd.lines.some((l) => l.source === 'Buff: Ghost')).toBe(true);
  });

  it('groups all milestones of one attribute into a single line', () => {
    const kernel = withLevels({ str: 15 }); // milestones: +1 (Lv 5), ×1% (Lv 10), +1 (Lv 15)
    const bd = attrBreakdown(kernel.modifiers(), 'str');
    const milestoneLines = bd.lines.filter((l) => l.source.includes('milestones'));
    // Adds collapse into one line, mults into another — never more.
    expect(milestoneLines).toHaveLength(2);
    expect(milestoneLines.find((l) => l.op === 'add')?.value).toBe(2);
    expect(milestoneLines.find((l) => l.op === 'mult')?.value).toBeCloseTo(0.01, 5);
    expect(bd.trained).toBe(15);
  });

  it('applies skill milestones cumulatively, unscaled by level', () => {
    const kernel = makeGame();
    // Smithing milestones: +0.01 (Lv 5), +0.02 (Lv 10), +0.03 (Lv 15) craftSpeed.
    patch(kernel, (slices) => (slices.skills.skills.smithing = { level: 12, xp: 0 }));
    const bd = statBreakdown(kernel.modifiers(), 'craftSpeed');
    const line = bd.lines.find((l) => l.source === 'Smithing milestones');
    expect(line?.value).toBeCloseTo(0.03, 5); // Lv 5 + Lv 10 only; Lv 15 not yet
    // Milestones ride on top of the per-level effect: flats first (base 1 +
    // 0.03), then the ×1%-per-level multiplier over 12 levels.
    expect(bd.total).toBeCloseTo(1.03 * 1.12, 5);
    expect(statOf(kernel, 'craftSpeed')).toBeCloseTo(bd.total, 5);
  });

  it('attribute breakdown reports fusion partners', () => {
    const kernel = withLevels({ str: 20, cha: 10 });
    setMods(kernel, [fuseFact('str', 'cha')]);
    const bd = attrBreakdown(kernel.modifiers(), 'str');
    expect(bd.fusion?.partner).toBe('cha');
    expect(bd.fusion?.total).toBeCloseTo(bd.effective + bd.fusion!.partnerValue, 5);
  });
});

describe('converging attack speed', () => {
  /** A game whose only attack-speed influences are the given buff mods. */
  function withBuffs(values: number[], dex?: number): Kernel {
    const kernel = dex ? withLevels({ dex }) : makeGame();
    setMods(
      kernel,
      values.map((value) => buff('Test', statMod('attackSpeed', 'mult', value))),
    );
    return kernel;
  }

  const attackTime = (kernel: Kernel) => {
    const stats = statBlockOf(kernel);
    return actionTicks(stats.actionBar, attackFillRate(stats));
  };

  it('two 10% hastes reduce attack time by 19%, not compounding fill', () => {
    const base = attackTime(withBuffs([]));
    const one = attackTime(withBuffs([0.1]));
    const two = attackTime(withBuffs([0.1, 0.1]));
    expect(one / base).toBeCloseTo(0.9);
    expect(two / base).toBeCloseTo(0.81);
  });

  it('slows are symmetric and capped at doubling per source', () => {
    const base = attackTime(withBuffs([]));
    const slowed = attackTime(withBuffs([-0.3]));
    expect(slowed / base).toBeCloseTo(1.3);
    const crawl = attackTime(withBuffs([-5]));
    expect(crawl / base).toBeCloseTo(2);
  });

  it('no single source erases more than half the attack time', () => {
    const base = attackTime(withBuffs([]));
    const capped = attackTime(withBuffs([0.9]));
    expect(capped / base).toBeCloseTo(1 - ATTACK_SPEED_MOD_CAP);
  });

  it('past the floor, speed converts to extra swings instead of vanishing', () => {
    // Enough stacked hastes (each under the per-source cap) to break the floor.
    const kernel = withBuffs(
      Array.from({ length: 8 }, () => 0.4),
      60, // speed pushes the interval further down
    );
    const stats = statBlockOf(kernel);
    const interval = actionTicks(stats.actionBar, attackFillRate(stats));
    expect(interval).toBeCloseTo(MIN_ATTACK_TICKS);
    expect(stats.extraSwings).toBeGreaterThan(0);
    // DPS preserved: floored interval × (1 + extraSwings) = uncapped interval's worth.
    const uncappedInterval = MIN_ATTACK_TICKS / (1 + stats.extraSwings);
    expect(uncappedInterval).toBeLessThan(MIN_ATTACK_TICKS);
  });

  it('a normal fighter never touches the floor', () => {
    const stats = statBlockOf(withBuffs([]));
    expect(actionTicks(stats.actionBar, attackFillRate(stats))).toBeGreaterThan(MIN_ATTACK_TICKS);
    expect(stats.extraSwings).toBe(0);
  });
});

/**
 * Port of the old `tests/styles.test.ts` (11 cases): the stance roster,
 * schools taking a stance's slot, the fallback when the school weapon
 * leaves, and the style modifiers in the stat block.
 *
 * Call shape changes:
 * - `g.setStyle(id)` is the command `styles/set`;
 * - `effectiveStyleId(state)`, `styleSlots(state)`, `styleUnlocked(state, def)`
 *   take a context under `run`;
 * - `getDerivedStats(state)` is `playerStats(kernel)`;
 * - `damageVsMonster('stone_golem', type, dmg, pen)` read the shelved stone
 *   golem's resistances (slashing 0.6, bludgeoning -0.5); the case states
 *   them and calls `afterPenetration`, which the old function used;
 * - skill and attribute levels are written with `patch`.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import { afterPenetration, hunt } from '../src/systems/combat';
import type { SkillsState } from '../src/systems/skills';
import { effectiveStyleId, pickStyle, STYLES, styleSlots, styleUnlocked, type StylesState } from '../src/systems/styles';
import { combatOf, keepHunting, logOf, playerStats, setHp, SITES } from './combatHelpers';
import { equip, giveItem, makeGame, patch, run, slice, unequip } from './helpers';

const GENERIC_IDS = ['balanced', 'aggressive', 'crush', 'cleave', 'quick', 'evasive', 'finesse', 'defensive', 'multi'];

const fresh = (seed = 1): Kernel => makeGame({ seed });

function setLevels(kernel: Kernel, levels: { skills?: Record<string, number>; attrs?: Record<string, number> }): void {
  patch(kernel, (slices) => {
    for (const [id, level] of Object.entries(levels.skills ?? {})) (slices.skills as SkillsState).skills[id] = { level, xp: 0 };
    for (const [id, level] of Object.entries(levels.attrs ?? {})) slices.attributes.attrs[id].level = level;
  });
}

let katanaUid = 0;
/** Arm the character with a katana. The sword schools are gated on the katana tag, not on any sword. */
function armKatana(g: Kernel): void {
  setLevels(g, { attrs: { dex: 8 } }); // the katana's requirement
  katanaUid = giveItem(g, 'katana', { slots: 1 }).uid;
  expect(equip(g, katanaUid).ok).toBe(true);
}

const setStyle = (g: Kernel, id: string) => g.dispatch(pickStyle({ style: id }));
const effective = (g: Kernel): string => run(g, (ctx) => effectiveStyleId(ctx));
const stance = (g: Kernel): string => slice<StylesState>(g, 'styles').style;

describe('stance roster', () => {
  it('a fresh character sees exactly the nine generic stances, all unlocked', () => {
    const g = fresh(1);
    const slots = run(g, (ctx) => styleSlots(ctx));
    expect(slots.map((s) => s.stance.id).sort()).toEqual([...GENERIC_IDS].sort());
    // Nothing manifested yet, so every slot holds its own stance.
    expect(slots.map((s) => s.active.id)).toEqual(slots.map((s) => s.stance.id));
    for (const s of slots) expect(run(g, (ctx) => styleUnlocked(ctx, s.stance)), s.stance.id).toBe(true);
  });

  it('the roster keeps its order and length when a school takes a slot', () => {
    const g = fresh(11);
    const before = run(g, (ctx) => styleSlots(ctx)).map((s) => s.stance.id);
    setLevels(g, { skills: { school_jigen_ryu: 1 } });
    armKatana(g);
    const after = run(g, (ctx) => styleSlots(ctx));
    expect(after.map((s) => s.stance.id)).toEqual(before);
    expect(after.filter((s) => s.active.replaces).map((s) => s.active.id)).toEqual(['jigen_ryu']);
  });

  it('crit damage, penetration and splash stances change the new stats', () => {
    const g = fresh(2);
    expect(playerStats(g).critDamage).toBe(2); // base
    setStyle(g, 'finesse');
    expect(playerStats(g).critDamage).toBeCloseTo(2.8); // ×1.4
    setStyle(g, 'crush');
    expect(playerStats(g).penetration).toBeCloseTo(0.1);
    setStyle(g, 'cleave');
    expect(playerStats(g).splash).toBeCloseTo(0.1);
  });
});

describe('penetration math', () => {
  it('erodes positive resistance toward zero but never deepens vulnerability', () => {
    // The shelved stone golem: slashing 0.6 resist, bludgeoning -0.5 vulnerable.
    const vs = (res: number, pen: number) => 100 * (1 - afterPenetration(res, pen));
    expect(vs(0.6, 0.3)).toBeCloseTo(70);
    expect(vs(0.6, 0.9)).toBeCloseTo(100); // floor 0
    expect(vs(-0.5, 0.3)).toBeCloseTo(150); // untouched
  });
});

describe('school manifestation through stances', () => {
  function swordFighter(seed: number, style: string): Kernel {
    const g = fresh(seed);
    setLevels(g, { skills: { fighting: 30, swordsmanship: 20 }, attrs: { str: 40, con: 40 } });
    setHp(g, 400);
    armKatana(g);
    if (style !== 'balanced') expect(setStyle(g, style).ok).toBe(true);
    expect(g.dispatch(hunt({ site: SITES.woods_edge })).ok).toBe(true);
    return g;
  }
  const held = (g: Kernel, id: string) => !!slice<SkillsState>(g, 'skills').skills[id];

  it('fighting Crush-style with a katana manifests Jigen-ryu (and only sword schools)', () => {
    const g = swordFighter(3, 'crush');
    for (let i = 0; i < 3000 && !held(g, 'school_jigen_ryu'); i++) {
      g.tick();
      keepHunting(g, 'woods_edge');
    }
    expect(held(g, 'school_jigen_ryu')).toBe(true);
    // The unarmed school shares the crush stance but requires bare fists.
    expect(held(g, 'school_muay_thai')).toBe(false);
  });

  it('the wrong stance teaches nothing', () => {
    const g = swordFighter(4, 'aggressive'); // Frenzy, not Crush
    for (let i = 0; i < 2500; i++) {
      g.tick();
      keepHunting(g, 'woods_edge');
    }
    expect(held(g, 'school_jigen_ryu')).toBe(false);
  });

  it('once manifested, the school supplants its stance with no player input', () => {
    const g = swordFighter(5, 'crush');
    expect(effective(g)).toBe('crush');
    setLevels(g, { skills: { school_jigen_ryu: 1 } });
    // No command: holding the sword is the whole trigger.
    expect(effective(g)).toBe('jigen_ryu');
    expect(stance(g)).toBe('crush'); // the slot picked, unchanged
    // The tick states it to combat and says so.
    g.tick();
    expect(combatOf(g).style.id).toBe('jigen_ryu');
    expect(logOf(g).some((l) => l.includes('switched to Jigen-ryu'))).toBe(true);
  });

  it('a school only claims the slot its stance owns', () => {
    const g = swordFighter(8, 'quick');
    setLevels(g, { skills: { school_jigen_ryu: 1 } }); // replaces crush
    expect(effective(g)).toBe('quick');
    setStyle(g, 'crush');
    expect(effective(g)).toBe('jigen_ryu');
  });
});

describe('effective style fallback', () => {
  it('drops to the generic stance when the school weapon leaves', () => {
    const g = fresh(6);
    setLevels(g, { skills: { school_jigen_ryu: 10 } });
    armKatana(g);
    setStyle(g, 'crush');
    expect(effective(g)).toBe('jigen_ryu');
    const armed = playerStats(g).penetration;
    expect(armed).toBeGreaterThan(0.2); // 0.2 + 10×0.002

    unequip(g, 'weapon');
    expect(stance(g)).toBe('crush'); // selection kept
    expect(effective(g)).toBe('crush'); // combat falls back
    expect(playerStats(g).penetration).toBeCloseTo(0.1); // plain crush

    equip(g, katanaUid); // armed again: the school returns on its own
    expect(effective(g)).toBe('jigen_ryu');
    expect(playerStats(g).penetration).toBeCloseTo(armed);
  });

  it('selecting a school id folds to its stance (old saves, stale clicks)', () => {
    const g = fresh(9);
    setStyle(g, 'jigen_ryu');
    expect(stance(g)).toBe('crush');
  });

  it('school styles scale with their skill level', () => {
    const g = fresh(7);
    armKatana(g);
    setLevels(g, { skills: { school_jigen_ryu: 1 } });
    setStyle(g, 'crush');
    const low = playerStats(g).damage;
    setLevels(g, { skills: { school_jigen_ryu: 60 } });
    expect(playerStats(g).damage).toBeGreaterThan(low);
  });
});

describe('the styles system', () => {
  it('a stance change is stated to combat at once, with its exertion', () => {
    const g = fresh(12);
    expect(combatOf(g).style.id).toBe('balanced');
    setStyle(g, 'defensive');
    expect(combatOf(g).style).toEqual({ id: 'defensive', exertion: { on: 'defend', cost: 0.05, hit: { armor: 0.6 } } });
    expect(setStyle(g, 'defensive').ok).toBe(false); // already in it: a reason, not a silent return
  });

  it('every school replaces a stance and names a held-skill gate', () => {
    for (const def of Object.values(STYLES)) {
      if (!def.replaces) continue;
      expect(STYLES[def.replaces]?.replaces, `${def.id} replaces a stance`).toBeUndefined();
      expect(def.unlock?.some((c) => c.type === 'skill' && c.id === def.skill), `${def.id} gate`).toBe(true);
    }
  });
});

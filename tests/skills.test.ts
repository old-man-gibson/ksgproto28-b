import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import type { AttributesState } from '../src/systems/attributes';
import type { CountersState } from '../src/systems/counters';
import type { LogState } from '../src/systems/log';
import { PROGRESSIONS, settleLevels, type ProgressionBand } from '../src/systems/progression';
import {
  checkDiscovery,
  grantDiscoveryXp,
  grantSkillXp,
  grantSkillXpDirect,
  hintedSkills,
  latentXp,
  manifestsByXp,
  noveltyRemaining,
  raiseSkillCap,
  skillCap,
  SKILL_LIST,
  SKILLS,
  skillTreeByCategory,
  skillXpNeeded,
  type SkillsState,
  type SkillState,
} from '../src/systems/skills';
import {
  namedFact,
  scaleFact,
  statBlockOf,
  statOf,
  styleFact,
  type AttributeId,
  type StatMod,
} from '../src/systems/stats';
import { emit, equip, giveItem, makeGame, patch, reads, setMods, slice, unequip } from './helpers';

/**
 * Port of the old tests/skills.test.ts. Changed: the call shape (requests
 * through the kernel; a combat style is a fact from the test-only probe
 * source, standing in for the styles system). A wielded weapon is a real
 * item since spine port 3: uid 1 is the starting rusty sword.
 *
 * Left behind, for the ports of the systems they need:
 * - "kills no longer spray XP across every weapon family" (combat, world);
 * - "filling in the bestiary pays out on top of whatever the kill was worth"
 *   (bestiary; the discovery request itself is tested here);
 * - "speechcraft: novelty from people, payout from finishing" except the
 *   curve comparison (quests);
 * - in "school mastery", switching style through the style command (styles).
 */

const skills = (kernel: Kernel) => slice<SkillsState>(kernel, 'skills');
const held = (kernel: Kernel, id: string): SkillState => skills(kernel).skills[id];

function newGame(setup?: Parameters<typeof give>[1]): Kernel {
  const kernel = makeGame();
  if (setup) give(kernel, setup);
  return kernel;
}

/** Set skills and trained attribute levels directly. */
function give(
  kernel: Kernel,
  setup: { skills?: Record<string, SkillState>; attrs?: Partial<Record<AttributeId, number>>; latent?: Record<string, number> },
): void {
  patch(kernel, (slices) => {
    Object.assign((slices.skills as SkillsState).skills, setup.skills ?? {});
    Object.assign((slices.skills as SkillsState).latent, setup.latent ?? {});
    for (const [id, level] of Object.entries(setup.attrs ?? {}))
      (slices.attributes as AttributesState).attrs[id as AttributeId].level = level!;
  });
}

/** Arm with a katana: the sword schools are gated on that sub-family, not on any sword. */
function armKatana(kernel: Kernel): void {
  const dex = slice<AttributesState>(kernel, 'attributes').attrs.dex.level;
  if (dex < 8) give(kernel, { attrs: { dex: 8 } }); // katana requirement
  expect(equip(kernel, giveItem(kernel, 'katana', { slots: 1 }).uid).ok).toBe(true);
}

const grant = (kernel: Kernel, tags: string[], amount: number, sourceKey?: string | string[]) =>
  emit(kernel, grantSkillXp, { tags, amount, sourceKey });
const discover = (kernel: Kernel, tags: string[]) => emit(kernel, checkDiscovery, { tags });

/** A skill's yield for something never seen: k/c, read from the record. */
function opening(skillId: string): number {
  const spec = SKILLS[skillId].novelty!;
  return spec.k / spec.c;
}

describe('banded xp curves', () => {
  it('different skills cost differently at the same level', () => {
    expect(skillXpNeeded('runecarving', 1)).toBeGreaterThan(skillXpNeeded('fighting', 1));
  });

  it('a band boundary is a wall, never a discount', () => {
    // Fighting steps beginner → novice at 20.
    expect(skillXpNeeded('fighting', 20)).toBeGreaterThan(skillXpNeeded('fighting', 19) * 1.5);
    for (let level = 1; level < 80; level++) {
      expect(skillXpNeeded('fighting', level + 1)).toBeGreaterThan(skillXpNeeded('fighting', level));
    }
  });

  it('a skill that only changes rate has no wall, just a steeper climb', () => {
    const step = (l: number) => skillXpNeeded('runecarving', l + 1) / skillXpNeeded('runecarving', l);
    expect(skillXpNeeded('runecarving', 20) / skillXpNeeded('runecarving', 19)).toBeLessThan(1.3);
    expect(step(60)).toBeGreaterThan(step(10));
  });

  it('hunting pays to enter its second tier, then levels faster than before', () => {
    // Base adept → expert at 25 (the wall), rate slow → fast (the payoff).
    expect(skillXpNeeded('hunting', 25)).toBeGreaterThan(skillXpNeeded('hunting', 24) * 1.5);
    const before = skillXpNeeded('hunting', 20) / skillXpNeeded('hunting', 19);
    const after = skillXpNeeded('hunting', 40) / skillXpNeeded('hunting', 39);
    expect(after).toBeLessThan(before);
  });

  it('a broken curve stalls instead of running away', () => {
    for (const bands of [
      [{ from: 1, base: 'nonsense', rate: 'normal' }],
      // A broken rate only shows up from level 2, since level 1 multiplies an
      // empty product.
      [{ from: 1, base: 'beginner', rate: 'nonsense' }],
    ] as unknown as ProgressionBand[][]) {
      const p = { level: 1, xp: 1e9 };
      expect(settleLevels(p, bands)).toBeLessThanOrEqual(1);
      expect(p.xp).toBeGreaterThan(1e9 - 100); // the bank is intact
    }
  });

  it('caps how many levels one grant can award', () => {
    const cheap = [{ from: 1, base: 'beginner', rate: 'fast' }] as ProgressionBand[];
    const p = { level: 1, xp: 1e9 };
    expect(settleLevels(p, cheap)).toBeLessThanOrEqual(1000);
    expect(p.level).toBeLessThanOrEqual(1001);
  });

  it('grants level up against the skill’s own curve', () => {
    const kernel = newGame({ skills: { runecarving: { level: 1, xp: 0 }, fighting: { level: 1, xp: 0 } } });
    const cheap = skillXpNeeded('fighting', 1);
    grant(kernel, ['runecarving'], cheap);
    grant(kernel, ['combat'], cheap);
    expect(held(kernel, 'fighting').level).toBe(2);
    expect(held(kernel, 'runecarving').xp).toBeGreaterThan(0); // it really landed
    expect(held(kernel, 'runecarving').level).toBe(1); // same XP, costlier craft
  });

  it('every skill that names no curve uses the "simple" shape, and the named shapes are all present', () => {
    expect(Object.keys(PROGRESSIONS).sort()).toEqual(
      ['attribute', 'esoteric', 'foundational', 'insightful', 'perfectionist', 'simple', 'specialist'].sort(),
    );
    const bare = SKILL_LIST.find((def) => !def.progression);
    if (bare) expect(skillXpNeeded(bare.id, 1)).toBe(10);
  });
});

describe('skill discovery & branching', () => {
  it('discovers Fighting on first combat-tagged action with no prerequisites', () => {
    const kernel = newGame();
    expect(held(kernel, 'fighting')).toBeUndefined();
    discover(kernel, ['combat']);
    expect(held(kernel, 'fighting')).toBeDefined();
    expect(held(kernel, 'fighting').level).toBe(1);
    const log = slice<LogState>(kernel, 'log').log;
    expect(log[log.length - 1]).toMatchObject({ msg: '✨ Skill unlocked: 👊 Fighting.', kind: 'skill' });
  });

  it('does not discover Swordsmanship without Fighting 10 + equipped sword', () => {
    const kernel = newGame();
    discover(kernel, ['combat', 'sword']);
    expect(held(kernel, 'swordsmanship')).toBeUndefined();

    // Fighting 10 but bare-handed: still locked.
    give(kernel, { skills: { fighting: { level: 10, xp: 0 } } });
    discover(kernel, ['combat', 'sword']);
    expect(held(kernel, 'swordsmanship')).toBeUndefined();
  });

  it('unlocks the full branch chain when conditions are met', () => {
    const kernel = newGame({ skills: { fighting: { level: 10, xp: 0 } } });
    equip(kernel, 1); // starting rusty sword
    discover(kernel, ['combat', 'sword']);
    expect(held(kernel, 'swordsmanship')).toBeDefined();

    // Ittou-ryu is a school: it manifests from its own stance tag, and wants
    // Swordsmanship 25 + DEX 20 + a katana in hand.
    give(kernel, { skills: { swordsmanship: { level: 25, xp: 0 } }, attrs: { dex: 20 } });
    // Practice flows up the tree: the school's stance tag AND the sword its
    // parent chain claims.
    discover(kernel, ['combat', 'sword', 'style:quick']);
    expect(held(kernel, 'school_ittou_ryu')).toBeUndefined(); // no katana yet

    armKatana(kernel);
    discover(kernel, ['combat', 'sword', 'style:quick']);
    expect(held(kernel, 'school_ittou_ryu')).toBeDefined();
  });

  it('skills gain xp only from matching tags and level up', () => {
    const kernel = newGame({ skills: { fighting: { level: 1, xp: 0 } } });
    grant(kernel, ['explore'], 100);
    expect(held(kernel, 'fighting').xp).toBe(0);

    grant(kernel, ['combat'], skillXpNeeded('fighting', 1) + skillXpNeeded('fighting', 2));
    expect(held(kernel, 'fighting').level).toBeGreaterThanOrEqual(2);
    // Each skill level counts toward `skill:levels`.
    expect(slice<CountersState>(kernel, 'counters').counts['skill:levels']).toBe(held(kernel, 'fighting').level - 1);
    expect(kernel.staleStats()).toEqual([]);
  });

  it('hints children of known skills only once every threshold is at 90%', () => {
    // Fighting 1: swordsmanship wants 10 (10% there), unarmed wants 3 (33%).
    const kernel = newGame({ skills: { fighting: { level: 1, xp: 0 } } });
    expect(hintedSkills(reads(kernel))).toEqual([]);

    // Fighting 9: swordsmanship at 90% appears; unarmed's threshold is met
    // (its equipped-tag condition is not a threshold and never hides it).
    give(kernel, { skills: { fighting: { level: 9, xp: 0 } } });
    const hints = hintedSkills(reads(kernel));
    expect(hints).toContain('swordsmanship');
    expect(hints).toContain('unarmed_combat');
    expect(hints).not.toContain('arcana'); // parent (magic) unknown
  });

  it('Foresight shows locked children at any distance', () => {
    const kernel = newGame({ skills: { fighting: { level: 1, xp: 0 } } });
    // The prestige port states the boon as the named fact `foresight`.
    setMods(kernel, [namedFact('foresight', 1)]);
    const hints = hintedSkills(reads(kernel));
    expect(hints).toContain('swordsmanship');
    expect(hints).toContain('unarmed_combat');
    expect(hints).not.toContain('arcana'); // still needs a known parent
  });
});

describe('categorized skill tree', () => {
  it('nests branches and hints correctly; undiscovered roots stay hidden', () => {
    const kernel = newGame({
      skills: {
        fighting: { level: 30, xp: 0 },
        swordsmanship: { level: 30, xp: 0 },
        school_ittou_ryu: { level: 5, xp: 0 },
      },
    });
    const sections = skillTreeByCategory(reads(kernel));
    expect(sections.map((s) => s.category.id)).toEqual(['combat']); // magic/resistances undiscovered

    const combat = sections[0];
    const fighting = combat.nodes.find((n) => n.def.id === 'fighting')!;
    expect(fighting.state).toBe('unlocked');

    const sword = fighting.children.find((c) => c.def.id === 'swordsmanship')!;
    expect(sword.state).toBe('unlocked');
    const ittou = sword.children.find((c) => c.def.id === 'school_ittou_ryu')!;
    expect(ittou.state).toBe('unlocked');

    // Locked children of known parents are hinted with no visible subtree.
    const unarmed = fighting.children.find((c) => c.def.id === 'unarmed_combat')!;
    expect(unarmed.state).toBe('hinted');
    expect(unarmed.children).toEqual([]);
  });

  it('discovered resistances and crafting show as their own sections', () => {
    const kernel = newGame({ skills: { heat_resistance: { level: 3, xp: 0 }, smithing: { level: 2, xp: 0 } } });
    const ids = skillTreeByCategory(reads(kernel)).map((s) => s.category.id);
    expect(ids).toEqual(['resistance', 'craft']);
  });

  it('a held skill under a locked parent is shown, the parent as hinted', () => {
    // Arcana opens at INT 10, Magic at INT 15: a save can hold Arcana and a
    // word skill with no Magic.
    const kernel = newGame({ skills: { arcana: { level: 3, xp: 0 }, word_spark: { level: 12, xp: 0 } } });
    const magic = skillTreeByCategory(reads(kernel))
      .find((s) => s.category.id === 'magic')!
      .nodes.find((n) => n.def.id === 'magic')!;
    expect(magic.state).toBe('hinted');
    const arcana = magic.children.find((c) => c.def.id === 'arcana')!;
    expect(arcana.state).toBe('unlocked');
    expect(arcana.children.find((c) => c.def.id === 'word_spark')?.state).toBe('unlocked');
    // Only the held branch: no other locked root under Magic is revealed.
    expect(magic.children.map((c) => c.def.id)).toEqual(['arcana']);
  });

  it('the published view carries the same tree', () => {
    const kernel = newGame({ skills: { fighting: { level: 9, xp: 3 } } });
    const view = kernel.view().systems.skills as { categories: { id: string; nodes: { id: string; children: { id: string; state: string }[] }[] }[]; held: number };
    expect(view.held).toBe(1);
    expect(view.categories.map((c) => c.id)).toEqual(['combat']);
    expect(view.categories[0].nodes[0].children.map((c) => c.id)).toContain('swordsmanship');
  });
});

describe('manifesting by XP (user, 2026-11-03)', () => {
  it('covers the skills gated on attributes alone', () => {
    const byXp = SKILL_LIST.filter(manifestsByXp)
      .map((d) => d.id)
      .sort();
    expect(byXp).toEqual(['arcana', 'devotion', 'magic', 'psionics']);
  });

  it('banks XP while locked and manifests at its first level’s worth, keeping the rest', () => {
    const kernel = newGame({ attrs: { int: 9 } }); // under both gates
    const mult = statOf(kernel, 'skillXp');
    const cost = skillXpNeeded('magic', 1);
    grant(kernel, ['combat', 'magic', 'arcane'], (cost / mult) * 0.75);
    expect(held(kernel, 'magic')).toBeUndefined();
    expect(latentXp(skills(kernel), 'magic')).toBeCloseTo(cost * 0.75, 6);
    grant(kernel, ['combat', 'magic', 'arcane'], (cost / mult) * 0.5);
    expect(held(kernel, 'magic')).toEqual({ level: 1, xp: expect.closeTo(cost * 0.25, 6) });
    expect(latentXp(skills(kernel), 'magic')).toBe(0);
    expect(skills(kernel).latent.magic).toBeUndefined();
  });

  it('a manifest by the attribute gate keeps what was banked past the first level', () => {
    const kernel = newGame({ attrs: { int: 15 }, latent: { magic: 5 } });
    discover(kernel, ['magic']);
    expect(held(kernel, 'magic')).toEqual({ level: 1, xp: 0 }); // 5 is under the first level's 20
    expect(skills(kernel).latent.magic).toBeUndefined();
  });

  it('weapon skills and schools never bank: their gates stand', () => {
    const kernel = newGame({ skills: { fighting: { level: 1, xp: 0 } } });
    for (let i = 0; i < 50; i++) grant(kernel, ['combat', 'sword', 'style:quick'], 100);
    expect(held(kernel, 'swordsmanship')).toBeUndefined();
    expect(held(kernel, 'school_ittou_ryu')).toBeUndefined();
    expect(skills(kernel).latent).toEqual({});
  });

  it('casting Spark at INT 9 brings Magic', () => {
    const kernel = newGame({ attrs: { int: 9 }, skills: { arcana: { level: 3, xp: 0 } } });
    for (let i = 0; i < 10 && !held(kernel, 'magic'); i++) {
      grant(kernel, ['combat', 'magic', 'arcane'], 4); // the old attackCastXp
    }
    expect(held(kernel, 'magic')?.level).toBeGreaterThanOrEqual(1);
    expect(slice<LogState>(kernel, 'log').log.some((l) => l.msg.includes('Magic'))).toBe(true);
  });

  it('a direct grant banks for a skill that manifests by XP and skips any other locked skill', () => {
    const kernel = newGame();
    emit(kernel, grantSkillXpDirect, { skillId: 'magic', amount: 5 });
    expect(latentXp(skills(kernel), 'magic')).toBeCloseTo(5 * statOf(kernel, 'skillXp'), 6);
    emit(kernel, grantSkillXpDirect, { skillId: 'swordsmanship', amount: 5 });
    expect(held(kernel, 'swordsmanship')).toBeUndefined();
    expect(kernel.skips().map((skip) => skip.reason)).toEqual([
      'skill "swordsmanship" is locked and does not manifest by XP',
    ]);
  });
});

describe('practice only flows upward', () => {
  /** Every combat skill known, so nothing is missing merely because it's locked. */
  function veteran(): Kernel {
    const all: Record<string, SkillState> = {};
    for (const id of [
      'fighting', 'swordsmanship', 'ittou_ryu', 'unarmed_combat', 'dagger_combat',
      'bow_combat', 'club_combat', 'shield_combat', 'school_jigen_ryu', 'magic',
    ]) {
      all[id] = { level: 1, xp: 0 };
    }
    return newGame({ skills: all });
  }

  it('a club fight trains Club Combat and Fighting, and nothing sideways', () => {
    const kernel = veteran();
    grant(kernel, ['combat', 'hunt', 'blunt'], 500);
    expect(held(kernel, 'club_combat').xp).toBeGreaterThan(0);
    expect(held(kernel, 'fighting').xp).toBeGreaterThan(0);
    for (const idle of ['swordsmanship', 'ittou_ryu', 'unarmed_combat', 'dagger_combat', 'bow_combat']) {
      expect(held(kernel, idle).xp, `${idle} should learn nothing from a club`).toBe(0);
    }
  });

  it('sword schools only train through the branch that leads to them', () => {
    const kernel = veteran();
    // Crushing with a club: the stance matches, the weapon does not.
    grant(kernel, ['combat', 'hunt', 'blunt', 'style:crush'], 500);
    expect(held(kernel, 'school_jigen_ryu').xp).toBe(0);

    grant(kernel, ['combat', 'hunt', 'sword', 'style:crush'], 500);
    expect(held(kernel, 'school_jigen_ryu').xp).toBeGreaterThan(0);
    expect(held(kernel, 'swordsmanship').xp).toBeGreaterThan(0); // and up the chain
    expect(held(kernel, 'fighting').xp).toBeGreaterThan(0);
  });

  it('casting a spell trains magic, not the blade at your hip', () => {
    const kernel = veteran();
    grant(kernel, ['combat', 'magic'], 500);
    expect(held(kernel, 'magic').xp).toBeGreaterThan(0);
    expect(held(kernel, 'fighting').xp).toBeGreaterThan(0);
    expect(held(kernel, 'swordsmanship').xp).toBe(0);
  });

  it('sword bonuses stay in the scabbard when the sword does', () => {
    const kernel = newGame({ skills: { swordsmanship: { level: 40, xp: 0 }, ittou_ryu: { level: 20, xp: 0 } } });
    const bare = { ...statBlockOf(kernel) };
    equip(kernel, 1); // rusty sword
    const armed = statBlockOf(kernel);
    expect(armed.damage).toBeGreaterThan(bare.damage * 1.5);
    expect(armed.crit).toBeGreaterThan(bare.crit);
  });
});

describe('school mastery only pays while you practise the art', () => {
  function jigenMaster(): Kernel {
    const kernel = newGame({
      skills: {
        fighting: { level: 20, xp: 0 },
        swordsmanship: { level: 30, xp: 0 },
        school_jigen_ryu: { level: 40, xp: 0 },
      },
    });
    armKatana(kernel); // the school claims the Crush slot, and its bonus needs a katana
    return kernel;
  }
  /** Lines of a source that apply right now. */
  const lines = (kernel: Kernel, prefix: string) =>
    (kernel.modifiers() as StatMod[]).filter((m) => (m.source ?? '').startsWith(prefix));
  const applied = (kernel: Kernel, prefix: string) => {
    // The damage a line adds is visible as a difference in the block.
    const withLine = statOf(kernel, 'damage');
    return { count: lines(kernel, prefix).length, damage: withLine };
  };

  it('the school bonus lapses in any other stance', () => {
    const kernel = jigenMaster();
    // The school claims the Crush slot: with a katana in hand the style
    // fought in is `jigen_ryu` (old data/styles.data.ts).
    setMods(kernel, [styleFact('jigen_ryu')]);
    const practising = applied(kernel, 'Jigen-ryu Lv').damage;
    setMods(kernel, [styleFact('quick')]);
    const elsewhere = applied(kernel, 'Jigen-ryu Lv').damage;
    // The school's line is 40 x 0.5% = +20% damage, and only in its own style.
    expect(practising / elsewhere).toBeCloseTo(1.2, 6);
    // With no style stated at all, a style-gated line lapses too.
    setMods(kernel, []);
    expect(statOf(kernel, 'damage')).toBeCloseTo(elsewhere, 6);
  });

  it('Swordsmanship still pays with any sword, in any stance', () => {
    const kernel = jigenMaster();
    setMods(kernel, [styleFact('quick')]);
    const withSkill = (level: number) => {
      give(kernel, { skills: { swordsmanship: { level, xp: 0 } } });
      return statOf(kernel, 'damage');
    };
    // Swordsmanship 30 x 1.5% = +45% damage, with any sword.
    expect(withSkill(30) / withSkill(0)).toBeCloseTo(1.45, 6);
    // Out of the hand the line pays nothing: the level no longer matters.
    unequip(kernel, 'weapon');
    expect(withSkill(30)).toBeCloseTo(withSkill(0), 9);
  });
});

describe('novelty learning', () => {
  /** High levels so a grant is never eaten by a level-up. */
  const hunter = () => newGame({ skills: { hunting: { level: 40, xp: 0 }, fighting: { level: 40, xp: 0 } } });

  /** XP that one grant delivered to a skill. */
  function gained(kernel: Kernel, skill: string, run: () => void): number {
    const before = held(kernel, skill).xp;
    run();
    return held(kernel, skill).xp - before;
  }

  it('a first sighting is worth k/c times a worn-out one', () => {
    const kernel = hunter();
    const first = gained(kernel, 'hunting', () => grant(kernel, ['hunt'], 10, 'wolf'));
    for (let i = 0; i < 2000; i++) grant(kernel, ['hunt'], 10, 'wolf');
    const worn = gained(kernel, 'hunting', () => grant(kernel, ['hunt'], 10, 'wolf'));

    // k/c = 20/2 is the exact ceiling, approached from below as the worn-out
    // yield settles onto its floor of 1.
    expect(first / worn).toBeLessThanOrEqual(opening('hunting'));
    expect(first / worn).toBeGreaterThan(opening('hunting') * 0.95);
  });

  it('decays towards the floor without ever reaching it', () => {
    const kernel = hunter();
    for (let i = 0; i < 400; i++) grant(kernel, ['hunt'], 10, 'wolf');
    const worn = noveltyRemaining(skills(kernel), 'hunting', 'wolf');
    expect(worn).toBeLessThan(1.1); // all but exhausted
    expect(worn).toBeGreaterThan(1); // but a kill still teaches something
  });

  it('counts each input separately, so a new species is fresh again', () => {
    const kernel = hunter();
    for (let i = 0; i < 50; i++) grant(kernel, ['hunt'], 10, 'wolf');
    expect(noveltyRemaining(skills(kernel), 'hunting', 'wolf')).toBeLessThan(1.5);
    expect(noveltyRemaining(skills(kernel), 'hunting', 'bear')).toBeCloseTo(opening('hunting'), 5);
  });

  it('leaves drill skills alone — Fighting never tires of wolves', () => {
    const kernel = hunter();
    const run = () => grant(kernel, ['combat', 'hunt'], 10, 'wolf');
    const first = gained(kernel, 'fighting', run);
    const tenth = gained(kernel, 'fighting', run);
    expect(tenth).toBeCloseTo(first, 5);
  });

  it('an unattributed payout pays the floor, never the novelty bonus', () => {
    const kernel = hunter();
    const anonymous = gained(kernel, 'hunting', () => grant(kernel, ['hunt'], 10));
    const attributed = gained(kernel, 'hunting', () => grant(kernel, ['hunt'], 10, 'wolf'));
    expect(anonymous * 10).toBeCloseTo(attributed, 5);
  });

  it('several inputs at once pay their mean', () => {
    const kernel = hunter();
    patch(kernel, (slices) => ((slices.skills as SkillsState).novelty.hunting = { wolf: 2 }));
    const single = statOf(kernel, 'skillXp') * 10;
    const both = gained(kernel, 'hunting', () => grant(kernel, ['hunt'], 10, ['wolf', 'bear']));
    // wolf seen twice: (20 + 2) / (2 + 2) = 5.5; bear new: 10. Mean 7.75.
    expect(both / single).toBeCloseTo(7.75, 6);
  });

  it('a discovery pays every skill of the domain its flat discovery value, times the weight', () => {
    const kernel = hunter();
    const paid = gained(kernel, 'hunting', () => emit(kernel, grantDiscoveryXp, { domain: 'bestiary', weight: 3 }));
    // A new species is discovery 40 x weight 3.
    expect(paid).toBeCloseTo(120 * statOf(kernel, 'skillXp'), 6);
    expect(gained(kernel, 'fighting', () => emit(kernel, grantDiscoveryXp, { domain: 'bestiary' }))).toBe(0);
  });

  it('a locked skill banks no novelty, so nothing is spent before it exists', () => {
    const kernel = newGame();
    grant(kernel, ['hunt'], 10, 'wolf');
    expect(skills(kernel).novelty.hunting).toBeUndefined();
  });

  it('speechcraft falls off harder than hunting does', () => {
    const speech = SKILLS.speechcraft.novelty!;
    const hunt = SKILLS.hunting.novelty!;
    const after = (s: typeof speech, n: number) => (s.k + n) / (s.c + n) / (s.k / s.c);
    // Same number of repeats, more of the novelty gone.
    expect(after(speech, 4)).toBeLessThan(after(hunt, 4));
  });
});

describe('level caps', () => {
  // From the old tests/chronosense.test.ts; the rest of that file needs the sense itself.
  const capped = () => newGame({ skills: { chronosense: { level: 19, xp: 0 } } });

  it('at the cap XP is discarded, not banked', () => {
    const kernel = capped();
    expect(skillCap(reads(kernel), 'chronosense')).toBe(20);
    emit(kernel, grantSkillXpDirect, { skillId: 'chronosense', amount: 1e9 });
    expect(held(kernel, 'chronosense')).toEqual({ level: 20, xp: 0 });
    emit(kernel, grantSkillXpDirect, { skillId: 'chronosense', amount: 50 });
    expect(held(kernel, 'chronosense')).toEqual({ level: 20, xp: 0 });
  });

  it('a raise lifts the ceiling of a held, capped skill and says so', () => {
    const kernel = capped();
    emit(kernel, raiseSkillCap, { id: 'chronosense', by: 2 });
    expect(skillCap(reads(kernel), 'chronosense')).toBe(22);
    const log = slice<LogState>(kernel, 'log').log;
    expect(log[log.length - 1].msg).toContain('cap raised to Lv 22');
    emit(kernel, raiseSkillCap, { id: 'fighting' });
    emit(kernel, raiseSkillCap, { id: 'darkvision' });
    expect(kernel.skips().map((skip) => skip.reason)).toEqual([
      'skill "fighting" has no cap',
      'skill "darkvision" is not held',
    ]);
  });

  it('the legacy raises the ceiling through the named fact skillCap:<id>', () => {
    const kernel = capped();
    setMods(kernel, [namedFact('skillCap:chronosense', 5)]);
    expect(skillCap(reads(kernel), 'chronosense')).toBe(25);
    expect(skillCap(reads(kernel), 'fighting')).toBe(Infinity);
  });
});

describe('talent (the scale fact the prestige port will state)', () => {
  it('scales a skill’s per-level effects and leaves its milestones alone', () => {
    const kernel = newGame({ skills: { smithing: { level: 12, xp: 0 } } });
    expect(statOf(kernel, 'craftSpeed')).toBeCloseTo(1.03 * 1.12, 6);
    setMods(kernel, [scaleFact('talent:smithing', 0.5)]);
    expect(statOf(kernel, 'craftSpeed')).toBeCloseTo(1.03 * (1 + 0.12 * 1.5), 6);
    expect(kernel.staleStats()).toEqual([]);
  });
});

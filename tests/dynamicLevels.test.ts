/**
 * Port of the old `tests/dynamicLevels.test.ts`. The cases keep their names.
 *
 * Dynamic monster levels: on a site whose band sets the rule, a table-rolled
 * spawn gains floor(factor x gap / growth) levels, at most capShare x the
 * rolled level, where gap is the player's three highest final attributes
 * over the monster's three highest at its rolled level. Bosses are exempt
 * and rewards read the level without the bonus.
 *
 * Call shape changes:
 * - the band's rule travels on the site (`EncounterSite.dynamicLevel`); the
 *   world port copies it from its band data;
 * - `dynamicLevelBonus(state, spot, ...)` takes a context;
 * - `killXp(state, monster)` takes the character level.
 *
 * `killXp` and `rewardLevel` were ported in port 1 (`tests/levels.test.ts`);
 * the two reward cases here are the old ones.
 *
 * Left behind: the bestiary's level range (the bestiary port).
 */
import { describe, expect, it } from 'vitest';
import type { Ctx, Kernel } from '../src/kernel';
import type { AttributesState } from '../src/systems/attributes';
import { abandon, dynamicLevelBonus, startForced, type CombatState, type EncounterSite } from '../src/systems/combat';
import { killXp, rewardLevel, type LevelsState } from '../src/systems/levels';
import type { ResourcesState } from '../src/systems/resources';
import { ATTRIBUTE_IDS, finalAttributes, statMod, type AttributeId } from '../src/systems/stats';
import { combatOf, huntingGame, SITES, spawn } from './combatHelpers';
import { ask, equip, giveItem, makeGame, patch, reads, run, setMods } from './helpers';

const ATTRS: readonly AttributeId[] = ATTRIBUTE_IDS;
const edge = SITES.f4_woods_edge;

function character(attrs: Partial<Record<AttributeId, number>>, level = 1, seed = 7): Kernel {
  const g = makeGame({ seed });
  patch(g, (slices) => {
    for (const a of ATTRS) (slices.attributes as AttributesState).attrs[a].level = attrs[a] ?? 1;
    (slices.levels as LevelsState).level = level;
  });
  return g;
}
const all = (n: number) => Object.fromEntries(ATTRS.map((a) => [a, n])) as Record<AttributeId, number>;

const bonus = (g: Kernel, site: EncounterSite, monsterId: string, level: number): number =>
  run(g, (ctx) => dynamicLevelBonus(ctx as Ctx<CombatState>, site, monsterId, level));

/** The worked case by hand: the whole gap over a L8 rat's top three (7.1), over its growth (0.633), capped at 8. */
function ratBonus(g: Kernel): number {
  const f = finalAttributes(reads(g));
  const top = ATTRS.map((a) => f[a])
    .sort((a, b) => b - a)
    .slice(0, 3);
  const p = (top[0] + top[1] + top[2]) / 3;
  return Math.min(8, Math.max(0, Math.floor((1 * (p - 7.1)) / (1.9 / 3))));
}

describe('the bonus', () => {
  it('band 2 carries it: the whole gap, up to double the level', () => {
    expect(edge.dynamicLevel).toEqual({ factor: 1, capShare: 1 });
  });

  it('a fresh character gets none', () => {
    const g = character({});
    for (const e of edge.encounters) expect(bonus(g, edge, e.monsterId, e.level[1]), e.monsterId).toBe(0);
  });

  it('closes the gap, divided by the species growth: a rat at L8', () => {
    const g = character(all(12));
    expect(bonus(g, edge, 'forest_rat', 8)).toBe(ratBonus(g));
    expect(ratBonus(g)).toBeGreaterThan(0);
  });

  it('reads the three highest final attributes, whichever they are: a caster counts', () => {
    const caster = character({ int: 14, wis: 14, cha: 14 });
    expect(bonus(caster, edge, 'forest_rat', 8)).toBe(ratBonus(caster));
    expect(ratBonus(caster)).toBeGreaterThan(0);
  });

  it('reads the character-level bonus', () => {
    const lower = bonus(character(all(8), 1), edge, 'forest_rat', 8);
    const higher = bonus(character(all(8), 5), edge, 'forest_rat', 8);
    expect(higher).toBeGreaterThan(lower);
  });

  it('reads gear: a weapon that adds STR raises it', () => {
    // STR 14 wields the greatsword fully; DEX and CON low keep the bonus under the cap.
    const g = character({ str: 14, dex: 6, con: 6 });
    const before = bonus(g, edge, 'forest_rat', 8);
    const blade = giveItem(g, 'steel_greatsword'); // +3 STR
    expect(equip(g, blade.uid, 'weapon')).toEqual({ ok: true });
    expect(finalAttributes(reads(g)).str).toBeGreaterThan(14 + 2);
    expect(bonus(g, edge, 'forest_rat', 8)).toBe(ratBonus(g));
    expect(bonus(g, edge, 'forest_rat', 8)).toBeGreaterThan(before);
  });

  it('stops at the cap: as many levels as the rolled level', () => {
    expect(bonus(character(all(40)), edge, 'forest_rat', 8)).toBe(8);
  });

  it('the cap grows with the level: an L20 rat can gain 20, an L8 one 8', () => {
    const g = character(all(80));
    expect(bonus(g, edge, 'forest_rat', 20)).toBe(20);
    expect(bonus(g, edge, 'forest_rat', 8)).toBe(8);
  });

  it('a strong species takes fewer levels for the same player', () => {
    const g = character(all(14));
    expect(bonus(g, edge, 'goblin', 8)).toBeLessThan(bonus(g, edge, 'forest_rat', 8));
  });

  it('is band 2 only', () => {
    const g = character(all(40));
    expect(SITES.f2_hall_1.dynamicLevel).toBeUndefined();
    expect(bonus(g, SITES.f2_hall_1, 'forest_rat', 4)).toBe(0);
  });
});

describe('spawning', () => {
  it('a hunt spawn carries its bonus; the rest of its level is the authored roll', () => {
    const g = character(all(40));
    for (let i = 0; i < 40; i++) {
      const m = spawn(g, edge);
      const line = edge.encounters.find((e) => e.monsterId === m.defId)!;
      expect(m.levelBonus, m.defId).toBe(rewardLevel(m));
      expect(rewardLevel(m)).toBeGreaterThanOrEqual(line.level[0]);
      expect(rewardLevel(m)).toBeLessThanOrEqual(line.level[1]);
    }
  });

  it('a fresh character spawns the authored levels and no bonus field', () => {
    const g = character({});
    for (let i = 0; i < 20; i++) {
      const m = spawn(g, edge);
      expect(m.levelBonus).toBeUndefined();
      expect(m.level).toBeLessThanOrEqual(9);
    }
  });

  it('a group filler takes its own bonus, pinned with its level', () => {
    const g = huntingGame(7, edge);
    patch(g, (slices) => {
      for (const a of ATTRS) (slices.attributes as AttributesState).attrs[a].level = 40;
      (slices.resources as ResourcesState).values.hp = 1e6;
    });
    // The old test reset HP to a million every tick. Here the character is
    // given the pool and the regeneration to outlast the loop instead.
    setMods(g, [statMod('maxHp', 'add', 1e6), statMod('hpRegen', 'add', 1e6)]);
    patch(g, (slices) => {
      (slices.resources as ResourcesState).values.hp = 1e6;
    });
    let groups = 0;
    for (let t = 0; t < 20_000 && groups < 5; t++) {
      g.tick();
      const foes = combatOf(g).fight?.enemies.filter((m) => m !== null) ?? [];
      if (foes.length > 1) {
        groups++;
        for (const m of foes) expect(m!.levelBonus, m!.defId).toBe(rewardLevel(m!));
        ask(g, abandon, undefined);
      }
    }
    expect(groups).toBe(5);
  });

  it('a boss and its escorts are exempt', () => {
    const g = character(all(40));
    expect(ask(g, startForced, { site: SITES.f4_ravine_floor })).toBe(true);
    const foes = combatOf(g).fight!.enemies.filter((m) => m !== null);
    expect(foes.length).toBeGreaterThan(1);
    for (const m of foes) {
      expect(m!.levelBonus, m!.defId).toBeUndefined();
      expect(m!.level).toBe(9);
    }
  });
});

describe('rewards read the level without the bonus', () => {
  it('kill XP takes its level-gap share from the paid level', () => {
    // Paid level 12: three below the fighter, a third of the XP. At 20 it would be all of it.
    expect(killXp(15, { xp: 90, level: 20, levelBonus: 8 })).toBeCloseTo(30);
    expect(killXp(15, { xp: 90, level: 20 })).toBeCloseTo(90);
  });

  it('a spawn with a bonus is worth what the same spawn without it is worth', () => {
    const a = spawn(character(all(40)), edge);
    const b = spawn(character({}), edge);
    // Same seed, same draws: the same species, roll and modifier, at double the level.
    expect(a.defId).toBe(b.defId);
    expect(a.level).toBe(2 * b.level);
    expect(a.xp).toBeCloseTo(b.xp);
    expect(a.gold).toBe(b.gold);
  });
});

describe('the bestiary', () => {
  it.todo('quotes the levels this player meets (the bestiary port: `spawnLevels`)');
});

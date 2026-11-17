/**
 * Port of the old `tests/combat.test.ts`. The cases keep their old names.
 *
 * Call shape changes:
 * - a spot is an `EncounterSite` from `tests/sites.json` (`combatHelpers.ts`);
 * - `spawnMonster(state, spot)` is `spawn(kernel, site)`;
 * - `monsterStats(m)` of a live enemy is its entity's stat block; of a
 *   monster outside a fight it is `monsterStatsFromAttrs(m.attrs)`;
 * - `applyStatus(state, foe, app)` is the `statuses/apply` request.
 *
 * Left behind, as `it.todo`: the knockout and its recovery (port 6), combat
 * styles (the styles port), achievement tiers (the achievements port).
 */
import { describe, expect, it } from 'vitest';
import { monsterSlice, playerDefeated } from '../src/systems/combat';
import type { AttributesState } from '../src/systems/attributes';
import type { GoldState } from '../src/systems/gold';
import items, { wielderRank, type ItemsState } from '../src/systems/items';
import {
  innateResistances,
  MODIFIER_TIERS,
  MONSTER_LIST,
  monsterSizeRank,
  TIERS,
} from '../src/systems/monsters';
import type { SkillsState } from '../src/systems/skills';
import {
  MONSTER_EXEMPT_STATS,
  MONSTER_RESIST_CAP,
  MONSTER_STAT_KEYS,
  monsterStatsFromAttrs,
  statMod,
  type DamageType,
} from '../src/systems/stats';
import { applyStatus, findStatus, hasStatus, type StatusesState } from '../src/systems/statuses';
import {
  combatOf,
  counterOf,
  enemyStats,
  feedOf,
  frontEnemy,
  hpOf,
  huntingGame,
  keepHunting,
  spawn,
  stage,
} from './combatHelpers';
import { ask, reads, setMods, slice } from './helpers';
import type { Kernel } from '../src/kernel';

const held = (kernel: Kernel) => slice<StatusesState>(kernel, 'statuses').held.player ?? [];

describe('the fast feeds on action', () => {
  // Every monster is dressed, so the test does not depend on which line of
  // the table rolls.
  function withFastingWorld<T>(body: () => T): T {
    for (const d of MONSTER_LIST) d.wears = [{ id: 'fasting' }];
    try {
      return body();
    } finally {
      for (const d of MONSTER_LIST) delete d.wears;
    }
  }

  function huntUntilHungry(g: Kernel, ticks = 400): boolean {
    for (let i = 0; i < ticks; i++) {
      g.tick();
      if (hasStatus(held(g), 'hunger_anupama')) return true;
    }
    return false;
  }

  it('lands hunger on whoever acts while something in the fight is fasting', () => {
    withFastingWorld(() => {
      const g = huntingGame();
      expect(huntUntilHungry(g)).toBe(true);
      // Intensity carries the imparter's wisdom, so it is never a flat 1.
      expect(findStatus(held(g), 'hunger_anupama')!.intensity).toBeGreaterThan(0);
    });
  });

  it('does nothing at all when nothing is fasting', () => {
    const g = huntingGame();
    expect(huntUntilHungry(g)).toBe(false);
  });
});

describe('monster generation', () => {
  it('spawns within the encounter level range with tier/modifier/rarity classification', () => {
    const g = huntingGame();
    for (let i = 0; i < 50; i++) {
      const m = spawn(g, 'woods_edge');
      expect(m.level).toBeGreaterThanOrEqual(1);
      expect(m.level).toBeLessThanOrEqual(4);
      expect(Object.keys(TIERS)).toContain(m.tier);
      expect(Object.keys(MODIFIER_TIERS)).toContain(m.modifier);
      expect(['common', 'uncommon', 'rare', 'epic']).toContain(m.rarity);
      expect(m.hp).toBeGreaterThan(0);
    }
  });

  it('boss-modified monsters are stronger than normal ones of the same def/level', () => {
    const g = huntingGame();
    let normalHp = 0;
    let bossHp = 0;
    for (let i = 0; i < 2000 && (!normalHp || !bossHp); i++) {
      const m = spawn(g, 'woods_edge');
      if (m.defId === 'forest_rat' && m.level === 2 && m.rarity === 'common') {
        if (m.modifier === 'normal' && !normalHp) normalHp = monsterStatsFromAttrs(m.attrs).maxHp;
        if (m.modifier === 'boss') bossHp = monsterStatsFromAttrs(m.attrs).maxHp;
      }
    }
    // Worst case: normal rolls the basic-tier ceiling (x1.1), boss rolls the floor (x0.8 x 1.5 = 1.2).
    if (normalHp && bossHp) expect(bossHp).toBeGreaterThan(normalHp);
  });
});

describe('combat resolution', () => {
  it('a fresh character eventually wins fights at the starting hunting ground', () => {
    const g = huntingGame();
    for (let i = 0; i < 5000 && counterOf(g, 'kills') < 3; i++) {
      g.tick();
      keepHunting(g, 'woods_edge');
    }
    expect(counterOf(g, 'kills')).toBeGreaterThanOrEqual(3);
    expect(slice<GoldState>(g, 'gold').gold).toBeGreaterThan(0);
  });

  it('combat grants attribute and skill xp', () => {
    const g = huntingGame();
    for (let i = 0; i < 2000; i++) g.tick();
    expect(slice<SkillsState>(g, 'skills').skills.fighting).toBeDefined();
    const str = slice<AttributesState>(g, 'attributes').attrs.str;
    expect(str.xp > 0 || str.level > 1).toBe(true);
  });

  it.todo('knockout triggers recovery instead of death, at the last haven (port 6: the knockout, the retreat, recovery)');

  // New here: the part of the old knockout case that is combat's.
  it('a defeat emits combat/defeat, closes the fight and stops the hunt', () => {
    // A level 1 character straight into the ravine floor (level 8 to 14 monsters).
    const g = huntingGame(13, 'ravine_floor');
    let defeat: unknown = null;
    g.onEvent((event) => {
      if (event.type === playerDefeated.type) defeat = event.payload;
    });
    for (let i = 0; i < 3000 && !defeat; i++) g.tick();
    expect(defeat).toMatchObject({ forced: false, outcome: 'knocked_out', site: 'ravine_floor' });
    const c = combatOf(g);
    expect(c.fight).toBeNull();
    expect(c.hunting).toBe(false);
    expect(c.respawnTimer).toBe(30);
    expect(c.lastFight?.outcome).toBe('knocked_out');
    expect(counterOf(g, 'defeats')).toBe(1);
    expect(hpOf(g)).toBeLessThanOrEqual(1);
    expect(g.entities()).toEqual(['player']);
  });

  it.todo('combat styles change derived stats (the styles port)');
  it.todo('kills feed tiered achievements which grant bonuses (the achievements port)');
});

describe('the training dummy', () => {
  it('the benchmark post takes a beating for hours and can never hurt you back', () => {
    const g = huntingGame(21, 'benchmark_post');
    const startHp = hpOf(g);
    let swung = false;
    let lowestHp = startHp;

    for (let i = 0; i < 2000; i++) {
      g.tick();
      lowestHp = Math.min(lowestHp, hpOf(g));
      const dummy = combatOf(g).fight?.enemies[0];
      if (dummy && dummy.hp < enemyStats(g, dummy).maxHp) swung = true;
    }

    expect(swung).toBe(true); // it does take damage
    // ...and never deals any: health never once dipped.
    expect(lowestHp).toBe(startHp);
    expect(combatOf(g).hunting).toBe(true);
    // Still standing: HP measured in millions.
    expect(enemyStats(g, frontEnemy(g)).maxHp).toBeGreaterThan(1_000_000);
    expect(feedOf(g).some((l) => l.text.includes('no harm done'))).toBe(true);
  });

  it('practice teaches skills but yields no kills, gold or loot', () => {
    const g = huntingGame(22, 'training_grounds');
    for (let i = 0; i < 800; i++) g.tick();
    expect(slice<SkillsState>(g, 'skills').skills.fighting?.level ?? 0).toBeGreaterThan(0);
    expect(counterOf(g, 'kills')).toBe(0);
    expect(slice<GoldState>(g, 'gold').gold).toBe(0);
    // The starting sword is equipped; nothing dropped.
    expect(slice<ItemsState>(g, 'items').inventory.length).toBe(0);
  });
});

describe('innate resistances come from what a thing is made of', () => {
  it('reproduces every declaration it was derived from', () => {
    const disagreements: string[] = [];
    for (const def of MONSTER_LIST) {
      const innate = innateResistances(def.id);
      for (const [type, declared] of Object.entries(def.resistances ?? {})) {
        if (Math.abs(innate[type as DamageType] - declared!) > 1e-9) {
          disagreements.push(`${def.id}.${type}: declared ${declared}, resolved ${innate[type as DamageType]}`);
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('gives a slime its physical block without the species restating it', () => {
    const res = innateResistances('psionic_slime');
    expect(res.slashing).toBeCloseTo(0.5, 5);
    expect(res.piercing).toBeCloseTo(0.5, 5);
    expect(res.bludgeoning).toBeCloseTo(-0.25, 5);
    // Its own declaration still wins over what the fire tag would give it.
    expect(res.heat).toBeCloseTo(0.8, 5);
  });

  it('scales an elemental line with tier but never a physical one', () => {
    expect(innateResistances('slime_fire').heat).toBeCloseTo(0.5, 5);
    expect(innateResistances('slime_fire_advanced').heat).toBeCloseTo(0.6, 5);
    expect(innateResistances('slime_fire_elite').heat).toBeCloseTo(0.7, 5);
    for (const id of ['slime_fire', 'slime_fire_advanced', 'slime_fire_elite']) {
      expect(innateResistances(id).slashing, id).toBeCloseTo(0.5, 5);
    }
  });

  it('lets a species opt out with an explicit zero', () => {
    expect(innateResistances('slime_honey').bludgeoning).toBeCloseTo(0.35, 5);
    expect(innateResistances('slime_wind').slashing).toBeCloseTo(0.3, 5);
  });

  it('is unknown-safe, because statsFromAttrs asks with no species at all', () => {
    const none = innateResistances('');
    expect(Object.values(none).every((v) => v === 0)).toBe(true);
  });
});

describe('a monster reads the same stat block the player does', () => {
  const neutral = () => monsterStatsFromAttrs({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });

  it('defaults every new dial to what the pipeline already did', () => {
    const s = neutral();
    expect(s.attackSpeed).toBe(1);
    expect(s.critTaken).toBe(1);
    expect(s.damageTaken).toBe(1);
    expect(s.ward).toBe(0);
    expect(s.resElemental).toBe(0);
    expect(s.resRanged).toBe(0);
    expect(s.vsSmaller).toBe(0);
    expect(s.fromSmaller).toBe(0);
    expect(s.extraSwings).toBe(0);
    expect(s.missRefund).toBe(0);
    expect(s.graze).toBe(0);
    expect(s.resistCap).toBe(MONSTER_RESIST_CAP);
  });

  it('lets a modifier reach every field of the block', () => {
    // The block here is the shared `DerivedStats`. The monster keys are a
    // list; this checks that a modifier on each one arrives on a live enemy.
    expect(MONSTER_STAT_KEYS).toContain('hpRegen');
    const g = huntingGame();
    const [foe] = stage(g, [{ monsterId: 'forest_rat', level: 3 }]);
    const before = { ...enemyStats(g, foe) };
    setMods(
      g,
      MONSTER_STAT_KEYS.map((key) => statMod(key, 'add', 0.25)),
      foe.entity,
    );
    const after = enemyStats(g, foe);
    const unmoved = MONSTER_STAT_KEYS.filter(
      // Clamped dials are held at their bound; every other one moves by the add.
      (key) => after[key] === before[key] && !['maxHp', 'missRefund', 'graze'].includes(key),
    );
    expect(unmoved).toEqual([]);
    expect(after.graze).toBe(0.25);
    expect(after.missRefund).toBe(0.25);
    expect(g.staleStats()).toEqual([]);
  });

  it('resolves fromStat against the monster, in its own pass', () => {
    // `refutation`: ward 40 flat, plus 1.5 per point of the bearer's spell power.
    const g = huntingGame();
    const [foe] = stage(g, [{ monsterId: 'forest_rat', level: 3 }]);
    const power = enemyStats(g, foe).spellPower;
    expect(power).toBeGreaterThan(0);
    ask(g, applyStatus, { entity: foe.entity, app: { id: 'refutation', intensity: 1 } });
    expect(enemyStats(g, foe).ward).toBeCloseTo(40 + 1.5 * power, 5);
  });

  it('spends that ward on a blow, the way the player does', () => {
    const g = huntingGame();
    const [foe] = stage(g, [{ monsterId: 'forest_rat', level: 3 }]);
    const bare = monsterSlice(enemyStats(g, foe), 'heat', 'test', 100).dealt;
    ask(g, applyStatus, { entity: foe.entity, app: { id: 'refutation', intensity: 1 } });
    const ward = enemyStats(g, foe).ward;
    const warded = monsterSlice(enemyStats(g, foe), 'heat', 'test', 100);
    // Heat, so armour stays out of it and the ward is the whole difference.
    expect(warded.warded).toBeCloseTo(Math.min(bare, ward), 5);
    expect(warded.dealt).toBeCloseTo(Math.max(0, bare - ward), 5);
  });

  it('reads the size gap from whichever side is bigger', () => {
    const big = monsterSizeRank('psionic_slime');
    const small = monsterSizeRank('forest_rat');
    expect(big).toBeGreaterThan(small);
    const g = huntingGame();
    const mine = wielderRank(reads(g).read(items));
    expect(mine).toBeGreaterThan(small);
    expect(mine).toBeLessThan(big);
  });

  it('names maxMana as exempt rather than dropping it silently', () => {
    expect(MONSTER_EXEMPT_STATS.has('maxMana')).toBe(true);
    expect((MONSTER_STAT_KEYS as readonly string[]).includes('maxMana')).toBe(false);
  });
});

// New here: the monster case of the shared stat path.
describe('a monster entity goes through the shared stat path', () => {
  it('a live enemy with no condition reads the monster formulas of its attributes', () => {
    const g = huntingGame();
    const [foe] = stage(g, [{ monsterId: 'filing_automaton', level: 4 }]);
    const block = enemyStats(g, foe);
    const con = foe.attrs.con;
    expect(block.maxHp).toBe(Math.max(1, Math.round(12 + con * 7)));
    expect(block.damage).toBeCloseTo(1.5 + foe.attrs.str * 1.1, 9);
    // Declared armour 2 at level 1, plus 5% per level above 1.
    expect(block.armor).toBeCloseTo(2 * (1 + 3 * 0.05), 9);
    expect(block.resLightning).toBe(-0.5);
    expect(block.resistCap).toBe(MONSTER_RESIST_CAP);
    // The player's block is not the monster's.
    expect(playerMaxHp(g)).toBe(50);
  });

  it('drops the entity and its conditions when the fight ends', () => {
    const g = huntingGame();
    const [foe] = stage(g, [{ monsterId: 'forest_rat', level: 1 }]);
    ask(g, applyStatus, { entity: foe.entity, app: { id: 'bleeding', intensity: 1 } });
    expect(g.entities()).toContain(foe.entity);
    for (let i = 0; i < 3000 && combatOf(g).fight; i++) g.tick();
    expect(combatOf(g).fight).toBeNull();
    expect(g.entities()).toEqual(['player']);
    expect(slice<StatusesState>(g, 'statuses').held[foe.entity]).toBeUndefined();
  });
});

function playerMaxHp(kernel: Kernel): number {
  return kernel.derived('stats/maxHp');
}

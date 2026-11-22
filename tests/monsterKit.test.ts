/**
 * Port of the old `tests/monsterKit.test.ts` (19 cases): a specimen's own kit
 * over its species' record (`kitOf`), the kit in a specimen's stats,
 * attribute emphasis (`biasAttrs`), a staged member with a kit, and the kit
 * in a fight. Every combat read of a species' rotation, damage type, reach,
 * resistances, armour and riders goes through `kitOf`; a specimen without a
 * kit reads its species. Every case keeps its old name. None is left as
 * `it.todo`.
 *
 * Call shape changes:
 * - `createInitialState(seed, HALL)` is `gameAt(seed, HALL)`;
 *   `s.stats['flag:tutorial_done'] = 1` is `setCounters`; `s.attrs[a].level`
 *   is written with `patch`. `ATTRIBUTE_LIST` is `ATTRIBUTE_IDS`.
 * - `spawnMonster(state, SPOTS[HALL], override)` is
 *   `spawn(kernel, HALL, override)`.
 * - `startStagedGroup(state, bus, spot, members)` is the request
 *   `combat/start-staged` (`stage`). `liveEnemies(state.combat!)` is what
 *   `stage` returns; `state.combat.enemies` is `combatOf(kernel).fight.enemies`.
 * - `monsterStats(m)` of a minted specimen is the stat block of that specimen
 *   staged alone (`enemyStats`): a kit reaches a monster's block only through
 *   the combat source, which reads the open fight. `m.kit = ...` on it is
 *   `patchFight`, which reloads the save and so touches every source.
 *   `stats.resistances[type]` is `stats[RES_STAT_BY_TYPE[type]]`.
 * - `statsFromAttrs(attrs)` is `monsterStatsFromAttrs(attrs)`.
 * - `monsterSlice(m, ...)` takes the stat block:
 *   `monsterSlice(enemyStats(kernel, e), ...)`.
 * - `applyStatus(state, target, app, source)` is the request `statuses/apply`.
 *   `hasStatus(state, id)` reads the player's held list in the statuses slice.
 * - The old local `stage` sets the enemy's CON with `patchFight`, then its
 *   health to its stat block's maximum. The old local `run` is `runFight`: it
 *   tops the player up with `setHp`. `state.combatFeed` is `feedOf`.
 * - `TRIGGER_SUBJECTS[id].read(ctx)` is `triggerSubject(id).read(...)` under
 *   `run`.
 */
import { describe, expect, it } from 'vitest';
import { PLAYER, type Kernel } from '../src/kernel';
import type { AttributesState } from '../src/systems/attributes';
import { monsterSlice, triggerSubject, type Enemy, type StagedMember } from '../src/systems/combat';
import { TECHNIQUES } from '../src/systems/martial';
import {
  biasAttrs,
  innateArmor,
  innateResistances,
  kitOf,
  MONSTERS,
  TAG_RESISTANCES,
  type MonsterKit,
} from '../src/systems/monsters';
import { ATTRIBUTE_IDS, monsterStatsFromAttrs, RES_STAT_BY_TYPE, type AttributeId, type DamageType, type DerivedStats } from '../src/systems/stats';
import { applyStatus, hasStatus, heldOf, STATUSES, type StatusesState } from '../src/systems/statuses';
import { combat, combatOf, enemyStats, feedOf, patchFight, playerStats, setHp, SITES, spawn, stage } from './combatHelpers';
import { ask, patch, run, slice } from './helpers';
import { gameAt, setCounters } from './worldHelpers';

const HALL = 'f1_storerooms';
const BRUTE = 'ph_survivor_brute';
const GOBLIN = 'goblin';

/** A specimen of `defId` at `level`, minted the way a staged fight mints it, outside a fight. */
function minted(defId: string, level: number, kit?: MonsterKit): Enemy {
  const m = spawn(gameAt(1, HALL), HALL, { monsterId: defId, level, plain: true });
  if (kit) m.kit = kit;
  return m;
}

interface Fielded {
  k: Kernel;
  e: Enemy;
}

/** A specimen of `defId` at `level` staged alone, so its stat block is the one combat reads. The old `minted` for a stat read. */
function fielded(defId: string, level: number, kit?: MonsterKit): Fielded {
  const k = gameAt(1, HALL);
  const [e] = stage(k, [{ monsterId: defId, level, ...(kit ? { kit } : {}) }], SITES[HALL]);
  return { k, e };
}

const statsOf = (f: Fielded): Readonly<DerivedStats> => enemyStats(f.k, f.e);
const res = (stats: Readonly<DerivedStats>, type: DamageType): number => stats[RES_STAT_BY_TYPE[type]];

/** Change the staged specimen, as the old cases wrote `m.kit` and `e.attrs`. Reloads the save. */
function editSpecimen(f: Fielded, change: (e: Enemy) => void): void {
  patchFight(f.k, (state) => {
    const e = state.fight!.enemies.find((m) => m?.entity === f.e.entity);
    if (!e) throw new Error(`no enemy ${f.e.entity} in the fight`);
    change(e);
  });
}

/** A player far past the specimen's reach to hurt and to kill, mid-fight with one staged member. */
function arena(member: StagedMember): Fielded {
  const k = gameAt(3, HALL);
  setCounters(k, { 'flag:tutorial_done': 1 });
  patch(k, (slices) => {
    for (const id of ATTRIBUTE_IDS) (slices.attributes as AttributesState).attrs[id].level = 100;
  });
  setHp(k, playerStats(k).maxHp);
  const [e] = stage(k, [member], SITES[HALL]);
  const f = { k, e };
  // Nothing in a few hundred ticks kills it, so what it does can be read.
  editSpecimen(f, (m) => {
    m.attrs.con = 1e7;
  });
  const max = statsOf(f).maxHp;
  editSpecimen(f, (m) => {
    m.hp = max;
  });
  return f;
}

/** Tick up to `max` times, topping the player up each tick, until `done` holds. The old local `run`. */
function runFight(k: Kernel, max: number, done: () => boolean, each?: () => void): void {
  for (let i = 0; i < max && combatOf(k).fight && !done(); i++) {
    each?.();
    k.tick();
    setHp(k, playerStats(k).maxHp);
  }
}

const feed = (k: Kernel): string =>
  feedOf(k)
    .map((f) => f.text)
    .join('\n');

const bleeding = (k: Kernel): boolean => hasStatus(heldOf(slice<StatusesState>(k, 'statuses')), 'bleeding');

describe('kitOf', () => {
  it('a specimen without a kit reads exactly its def, for every species', () => {
    for (const def of Object.values(MONSTERS)) {
      const k = kitOf({ defId: def.id });
      expect(k.rotation, def.id).toBe(def.rotation);
      expect(k.damageType, def.id).toBe(def.damageType);
      expect(k.range, def.id).toBe(def.range ?? 'melee');
      expect(k.resistances, def.id).toBe(def.resistances);
      expect(k.armor, def.id).toBe(def.armor);
      expect(k.inflicts, def.id).toBe(def.inflicts);
    }
  });

  it('each field the kit holds replaces the def’s whole, and the rest stay the def’s', () => {
    const def = MONSTERS[GOBLIN];
    expect(def.inflicts?.length, 'the goblin bleeds its target').toBeGreaterThan(0);
    const k = kitOf({ defId: GOBLIN, kit: { damageType: 'cold', range: 'ranged', inflicts: [] } });
    expect(k.damageType).toBe('cold');
    expect(k.range).toBe('ranged');
    // An empty list is a replacement too: the def's riders are gone.
    expect(k.inflicts).toEqual([]);
    expect(k.resistances).toBe(def.resistances);
    expect(k.rotation).toBe(def.rotation);
  });

  it('reads the specimen, not a snapshot of it', () => {
    const m = minted(GOBLIN, 5);
    expect(kitOf(m).damageType).toBe(MONSTERS[GOBLIN].damageType);
    m.kit = { damageType: 'arcane' };
    expect(kitOf(m).damageType).toBe('arcane');
    delete m.kit;
    expect(kitOf(m).damageType).toBe(MONSTERS[GOBLIN].damageType);
  });
});

describe('the kit in a specimen’s stats', () => {
  it('kit.armor is a level-1 figure that grows 5% a level, and 0 beats what the tags imply', () => {
    const m = fielded(GOBLIN, 21);
    expect(statsOf(m).armor).toBe(0);
    editSpecimen(m, (e) => {
      e.kit = { armor: 10 };
    });
    expect(innateArmor(GOBLIN, { armor: 10 })).toBe(10);
    expect(statsOf(m).armor).toBeCloseTo(10 * (1 + 0.05 * 20), 10);
    // A construct is armoured by what it is made of; a kit that says 0 is bare.
    const golem = fielded('slime_golem', 21);
    expect(statsOf(golem).armor).toBeGreaterThan(0);
    editSpecimen(golem, (e) => {
      e.kit = { armor: 0 };
    });
    expect(statsOf(golem).armor).toBe(0);
  });

  it('kit.resistances replace the def’s declared block; the tags still speak for the rest', () => {
    const def = MONSTERS[GOBLIN];
    expect(def.resistances?.poison, 'the goblin resists poison').toBeGreaterThan(0);
    const m = fielded(GOBLIN, 5);
    expect(res(statsOf(m), 'poison')).toBeCloseTo(def.resistances!.poison!, 10);
    const kit: MonsterKit = { resistances: { cold: 0.4 } };
    editSpecimen(m, (e) => {
      e.kit = kit;
    });
    const stats = statsOf(m);
    expect(res(stats, 'cold')).toBeCloseTo(0.4, 10);
    expect(res(stats, 'poison')).toBe(0);
    expect(innateResistances(GOBLIN, kit).cold).toBe(0.4);
    // The golem declares its own slashing resistance, which a kit block replaces; its
    // slime tag still speaks for the type the kit does not name.
    const slime = fielded('slime_golem', 5);
    expect(MONSTERS.slime_golem.resistances?.slashing).toBe(0.75);
    expect(res(statsOf(slime), 'slashing')).toBe(0.75);
    editSpecimen(slime, (e) => {
      e.kit = { resistances: { cold: 0.4 } };
    });
    expect(res(statsOf(slime), 'slashing')).toBe(TAG_RESISTANCES.slime.slashing!.base);
  });

  it('is read fresh on every call: changing the kit changes the next read', () => {
    const m = fielded(GOBLIN, 11, { armor: 4 });
    const a = statsOf(m).armor;
    editSpecimen(m, (e) => {
      e.kit!.armor = 8;
    });
    expect(statsOf(m).armor).toBeCloseTo(a * 2, 10);
    editSpecimen(m, (e) => {
      e.kit!.resistances = { slashing: 0.5 };
    });
    expect(res(statsOf(m), 'slashing')).toBeCloseTo(0.5, 10);
  });

  it('holds through a condition that moves stats', () => {
    const status = Object.values(STATUSES).find((d) => !d.hidden && d.mods?.some((x) => x.stat === 'speed' || x.stat === 'dex'));
    expect(status, 'a status with stat mods exists').toBeTruthy();
    const m = fielded(GOBLIN, 11, { armor: 6, resistances: { cold: 0.3 } });
    expect(ask(m.k, applyStatus, { entity: m.e.entity, app: { id: status!.id, intensity: 1 }, source: 'test' })).toBeTruthy();
    const stats = statsOf(m);
    expect(stats.armor).toBeCloseTo(6 * (1 + 0.05 * 10), 10);
    expect(res(stats, 'cold')).toBeCloseTo(0.3, 10);
  });

  it('armour and resistance change what a blow does to it', () => {
    const bare = fielded(GOBLIN, 21);
    const kitted = fielded(GOBLIN, 21, { armor: 10, resistances: { slashing: 0.5 } });
    const a = monsterSlice(statsOf(bare), 'slashing', 'test', 200);
    const b = monsterSlice(statsOf(kitted), 'slashing', 'test', 200);
    expect(a.armor).toBe(0);
    expect(b.armor).toBeCloseTo(20, 10);
    expect(b.resistance).toBeCloseTo(0.5, 10);
    expect(b.dealt).toBeLessThan(a.dealt);
  });
});

describe('attribute emphasis', () => {
  const attrs = { str: 50, dex: 30, con: 40, int: 10, wis: 10, cha: 10 } as Record<AttributeId, number>;
  const total = (a: Record<AttributeId, number>) => ATTRIBUTE_IDS.reduce((s, id) => s + a[id], 0);

  it('moves points between attributes and keeps the total', () => {
    const out = biasAttrs(attrs, { int: 3, str: 0.5 });
    expect(total(out)).toBeCloseTo(total(attrs), 8);
    expect(out.int).toBeGreaterThan(attrs.int);
    expect(out.str).toBeLessThan(attrs.str);
  });

  it('treats a missing multiplier as 1, a negative one as 0, and no bias as no change', () => {
    expect(biasAttrs(attrs, {})).toEqual(attrs);
    const out = biasAttrs(attrs, { str: -4 });
    expect(out.str).toBe(0);
    expect(total(out)).toBeCloseTo(total(attrs), 8);
  });
});

describe('a staged member with a kit', () => {
  it('takes the name, the kit and the reach, and comes in wounded as a share of the biased maximum', () => {
    const k = gameAt(4, HALL);
    const [e] = stage(
      k,
      [
        {
          monsterId: BRUTE,
          level: 30,
          hpShare: 0.5,
          name: 'Tamsin, mage',
          kit: { range: 'ranged', damageType: 'cold', armor: 3 },
          attrBias: { con: 2 },
        },
      ],
      SITES[HALL],
    );
    expect(e.name).toBe('Tamsin, mage');
    expect(e.defId).toBe(BRUTE);
    expect(e.kit).toEqual({ range: 'ranged', damageType: 'cold', armor: 3 });
    expect(e.range).toBe('ranged');
    expect(e.range).toBe(kitOf(e).range);
    const max = enemyStats(k, e).maxHp;
    expect(e.hp).toBe(Math.round(max * 0.5));
    // CON doubled (then scaled back to keep the total): more health than the book value's.
    const plain = minted(BRUTE, 30);
    expect(max).toBeGreaterThan(monsterStatsFromAttrs(plain.attrs).maxHp * 0.9);
  });

  it('a member without one is the species as before', () => {
    const k = gameAt(4, HALL);
    const [e] = stage(k, [{ monsterId: BRUTE, level: 30, hpShare: 1 }], SITES[HALL]);
    expect(e.kit).toBeUndefined();
    expect(e.name).toBe(MONSTERS[BRUTE].name);
    expect(e.range).toBe(MONSTERS[BRUTE].range ?? 'melee');
    expect(e.hp).toBe(enemyStats(k, e).maxHp);
  });

  it('a melee member is put in front of a ranged one', () => {
    const k = gameAt(4, HALL);
    stage(
      k,
      [
        { monsterId: BRUTE, level: 30, name: 'Back', kit: { range: 'ranged' } },
        { monsterId: BRUTE, level: 30, name: 'Front' },
      ],
      SITES[HALL],
    );
    const enemies = combatOf(k).fight!.enemies;
    expect(enemies[0]!.name).toBe('Front');
    expect(enemies[1]!.name).toBe('Back');
  });
});

describe('the kit in a fight', () => {
  it('kit.range ranged: a standing wall stops its blows, which it does not stop for a melee specimen', () => {
    const wall = (k: Kernel) => () => {
      ask(k, applyStatus, { entity: PLAYER, app: { id: 'kinetic_bulwark', intensity: 1 }, source: 'test' });
    };
    const ranged = arena({ monsterId: BRUTE, level: 30, kit: { range: 'ranged', damageType: 'piercing' } });
    runFight(ranged.k, 600, () => /blocked by your Kinetic Bulwark/.test(feed(ranged.k)), wall(ranged.k));
    expect(feed(ranged.k)).toMatch(/blocked by your Kinetic Bulwark/);
    expect(feed(ranged.k)).not.toMatch(/hits you for|CRITS you for/);

    const melee = arena({ monsterId: BRUTE, level: 30 });
    runFight(melee.k, 600, () => /hits you for|CRITS you for/.test(feed(melee.k)), wall(melee.k));
    expect(feed(melee.k)).toMatch(/hits you for|CRITS you for/);
    expect(feed(melee.k)).not.toMatch(/blocked by your Kinetic Bulwark/);
  }, 60000);

  it('kit.damageType is the type it deals', () => {
    const cold = arena({ monsterId: BRUTE, level: 30, kit: { damageType: 'cold', rotation: [] } });
    runFight(cold.k, 600, () => /(hits|CRITS) you for \d+ cold/.test(feed(cold.k)));
    expect(feed(cold.k)).toMatch(/(hits|CRITS) you for \d+ cold/);
    expect(feed(cold.k)).not.toMatch(new RegExp(`you for \\d+ ${MONSTERS[BRUTE].damageType}`));
    // …and the trigger subject that reads the front enemy's type reads the kit.
    const read = run(cold.k, (ctx) => {
      const state = ctx.read(combat);
      return triggerSubject('enemy.damageType')!.read({ ctx, fight: state.fight!, state });
    });
    expect(read).toBe('cold');
  }, 60000);

  it('kit.rotation is used over the def’s', () => {
    const own = arena({ monsterId: BRUTE, level: 30, kit: { rotation: [{ technique: 'pocket_sand' }] } });
    runFight(own.k, 900, () => /moves into/.test(feed(own.k)));
    expect(feed(own.k)).toContain(`moves into ${TECHNIQUES.pocket_sand.name}`);
    for (const entry of MONSTERS[BRUTE].rotation ?? []) {
      if ('technique' in entry && entry.technique !== 'pocket_sand') {
        expect(feed(own.k)).not.toContain(`moves into ${TECHNIQUES[entry.technique].name}`);
      }
    }
  }, 60000);

  it('a working in a kit rotation is cast', () => {
    const fire = arena({
      monsterId: BRUTE,
      level: 30,
      kit: { rotation: [{ cast: { school: 'arcane', words: ['fire', 'pierce'] } }] },
    });
    runFight(fire.k, 900, () => /casts Fire Pierce/.test(feed(fire.k)));
    expect(feed(fire.k)).toMatch(/casts Fire Pierce/);
  }, 60000);

  it('kit.inflicts are its riders, over the def’s', () => {
    expect(MONSTERS[BRUTE].inflicts, 'the brute inflicts nothing of its own').toBeUndefined();
    const stinging = arena({
      monsterId: BRUTE,
      level: 30,
      kit: { rotation: [], inflicts: [{ id: 'bleeding', intensity: 2, chance: 1 }] },
    });
    runFight(stinging.k, 900, () => bleeding(stinging.k));
    expect(bleeding(stinging.k)).toBe(true);

    const plain = arena({ monsterId: BRUTE, level: 30, kit: { rotation: [] } });
    runFight(plain.k, 300, () => false);
    expect(bleeding(plain.k)).toBe(false);
  }, 60000);

  it('an empty inflicts list removes a def’s riders', () => {
    const def = MONSTERS[GOBLIN];
    expect(def.inflicts?.some((a) => a.id === 'bleeding')).toBe(true);
    const bare = arena({ monsterId: GOBLIN, level: 30, kit: { inflicts: [], rotation: [] } });
    // Many blows at the def's 15% would have landed one by now.
    runFight(bare.k, 1500, () => false);
    expect(bleeding(bare.k)).toBe(false);
  }, 60000);
});

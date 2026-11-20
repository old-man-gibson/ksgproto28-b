import { describe, expect, it } from 'vitest';
import { CORE } from '../src/systems/facet';

// Skipped without the Facet core (docs/SETUP.md); tests/facet.test.ts says so.
import type { Kernel } from '../src/kernel';
import { attrXpNeeded, grantAttrXp, type AttributesState } from '../src/systems/attributes';
import { fightStarted, fightWon, enemyKilled, setRotation, setTrigger, type Enemy } from '../src/systems/combat';
import { consumableUsed, useConsumable } from '../src/systems/consumables';
import { CALORIES_PER_WELL_FED, dishCalories } from '../src/systems/cooking';
import {
  chooseEvolution,
  chooseOption,
  levelsPast,
  pressAction,
  type FacetState,
} from '../src/systems/facet';
import { flaskUsed } from '../src/systems/alchemy';
import type { MaterialsState } from '../src/systems/materials';
import { hitPlayer, resourceValue } from '../src/systems/resources';
import resources from '../src/systems/resources';
import { SKILLS } from '../src/systems/skills';
import { spellCast } from '../src/systems/spellcraft';
import { attrValue, effectiveAttr, formulaAttr, statBlockOf } from '../src/systems/stats';
import { findStatus, heldOf, removeStatus, statueOf, type StatusesState } from '../src/systems/statuses';
import {
  combatOf,
  counterOf,
  enemyStats,
  frontEnemy,
  hardenFoes,
  hpOf,
  patchFight,
  setPool,
  stage,
} from './combatHelpers';
import {
  aMinute,
  capOf,
  cell,
  facetOf,
  facetView,
  fullHp,
  holding,
  intoFight,
  setShare,
} from './facetHelpers';
import { ask, emit, makeGame, patch, reads, setMods, slice } from './helpers';
import { fightTick } from '../src/systems/facet';
import type { LogState } from '../src/systems/log';

const statusesOf = (k: Kernel, entity = 'player') => heldOf(slice<StatusesState>(k, 'statuses'), entity);
const floating = (k: Kernel, name: string) => slice<LogState>(k, 'log').floatingFeed.find((f) => f.group === `ability:${name}`);
/** This fight's lines: the transcript keeps them all, the feed only the newest. */
const transcript = (k: Kernel) => {
  const lg = slice<LogState>(k, 'log');
  return lg.transcript ?? lg.combatFeed;
};

/** A blow from an enemy through the one door every blow takes. `thrown`: the blow before armour. */
function blow(k: Kernel, by: Pick<Enemy, 'entity' | 'name' | 'icon' | 'defId'> | null, amount: number, type = 'slashing', thrown?: number) {
  return ask(k, hitPlayer, {
    amount,
    type: type as 'slashing',
    ...(by
      ? { source: { key: `monster:${by.defId}`, label: by.name, icon: by.icon, by: by.entity, ...(thrown !== undefined ? { thrown } : {}) } }
      : {}),
  });
}

/** Charge at `share` of the cap, then one game minute so the tiers follow. */
function charged(k: Kernel, share: number) {
  setShare(k, 'charge', share);
  aMinute(k);
}

/** Train every combat skill to `level`, then one game minute so Power follows. */
function trained(k: Kernel, level: number) {
  patch(k, (slices) => {
    for (const [id, def] of Object.entries(SKILLS)) {
      if (def.category !== 'combat') continue;
      slices.skills.skills[id] = { ...(slices.skills.skills[id] ?? { xp: 0 }), level };
    }
  });
  aMinute(k);
}

/** Hold the player's bar at empty for `ticks`. */
function idle(k: Kernel, ticks: number) {
  for (let t = 0; t < ticks && combatOf(k).fight; t++) {
    patchFight(k, (s) => {
      if (s.fight) s.fight.playerBar = 0;
    });
    k.tick();
  }
}

// ---------------------------------------------------------------------------

describe.skipIf(!CORE)('Solar Charge tiers', () => {
  it('turns each tier on at its share: 20%, 40%, 60%, 80%', () => {
    const k = holding('solar_charge');
    const tiers = () => ['warmth', 'infuse', 'mend', 'blast'].map((key) => cell(k, key));
    charged(k, 0.1);
    expect(tiers()).toEqual([0, 0, 0, 0]);
    charged(k, 0.3);
    expect(tiers()).toEqual([1, 0, 0, 0]);
    charged(k, 0.45);
    expect(tiers()).toEqual([1, 0.25, 0, 0]);
    charged(k, 0.65);
    expect(tiers()).toEqual([1, 0.25, 1, 0]);
    charged(k, 0.9);
    expect(tiers()).toEqual([1, 0.25, 1, 1]);
  });

  it('adds 10% Cold and Poison resistance from 20%', () => {
    const k = holding('solar_charge');
    charged(k, 0.1);
    const before = statBlockOf(reads(k));
    charged(k, 0.3);
    const after = statBlockOf(reads(k));
    expect(after.resCold - before.resCold).toBeCloseTo(0.1);
    expect(after.resPoison - before.resPoison).toBeCloseTo(0.1);
    expect(after.resHeat).toBeCloseTo(before.resHeat);
    expect(k.staleStats()).toEqual([]);
  });

  it('puts Heat on a bare-handed blow from 40%, and none below', () => {
    const heat = (k: Kernel) =>
      transcript(k).filter((l) => l.damage && !l.damage.incoming && l.damage.slices.some((s) => s.type === 'heat')).length;
    const cold = holding('solar_charge');
    intoFight(cold);
    charged(cold, 0.3);
    for (let t = 0; t < 200 && combatOf(cold).fight; t++) cold.tick();
    expect(heat(cold)).toBe(0);

    const warm = holding('solar_charge');
    intoFight(warm);
    charged(warm, 0.5);
    for (let t = 0; t < 200 && combatOf(warm).fight && heat(warm) === 0; t++) warm.tick();
    expect(heat(warm)).toBeGreaterThan(0);
  });

  it('heals 5% of missing HP a minute from 60%, and not below', () => {
    const k = holding('solar_charge');
    charged(k, 0.95);
    const max = statBlockOf(reads(k)).maxHp;
    patch(k, (s) => (s.resources.values.hp = Math.round(max / 2)));
    const start = hpOf(k);
    const charge = cell(k, 'charge');
    aMinute(k);
    // Ten ticks of the idle trickle ride along; the heal is 5% of what was missing.
    expect(hpOf(k) - start).toBeGreaterThanOrEqual(0.05 * (max - start) - 1e-6);
    expect(cell(k, 'charge')).toBeLessThan(charge);

    const low = holding('solar_charge');
    charged(low, 0.5);
    patch(low, (s) => (s.resources.values.hp = Math.round(max / 2)));
    const lowStart = hpOf(low);
    aMinute(low);
    expect(hpOf(low) - lowStart).toBeLessThan(0.05 * (max - lowStart));
  });
});

describe.skipIf(!CORE)('Sun Blast', () => {
  const BLAST = 'facet:sun_blast';
  const blasts = (k: Kernel) => transcript(k).filter((l) => l.text.includes('You use Sun Blast')).length;

  it('is offered from 80% only', () => {
    const k = holding('solar_charge');
    charged(k, 0.7);
    expect(facetView(k).held[0].actions).toMatchObject([{ id: BLAST, ready: false }]);
    charged(k, 0.85);
    expect(facetView(k).held[0].actions).toMatchObject([{ id: BLAST, ready: true }]);
  });

  it('fires from the rotation, hits every enemy, and pays 5% of the cap', () => {
    const k = holding('solar_charge');
    k.dispatch(setRotation({ order: [BLAST] }));
    intoFight(k);
    hardenFoes(k, 1e6);
    charged(k, 1);
    const foes = combatOf(k).fight!.enemies.filter((e): e is Enemy => !!e);
    const hp = foes.map((f) => f.hp);
    const before = cell(k, 'charge');
    for (let t = 0; t < 400 && blasts(k) === 0 && combatOf(k).fight; t++) k.tick();
    expect(blasts(k)).toBe(1);
    const now = combatOf(k).fight!.enemies.filter((e): e is Enemy => !!e);
    now.forEach((f, i) => expect(f.hp, f.name).toBeLessThan(hp[i]));
    expect(floating(k, 'Solar Charge')?.report?.slices.map((s) => s.type).sort()).toEqual(['heat', 'light']);
    expect(before - cell(k, 'charge')).toBeGreaterThan(0.05 * capOf(k, 'charge') - 3);
    expect(before - cell(k, 'charge')).toBeLessThan(0.05 * capOf(k, 'charge') + 3);
  });

  it('answers to its trigger like any rotation entry', () => {
    const k = holding('solar_charge');
    k.dispatch(setRotation({ order: [BLAST] }));
    k.dispatch(setTrigger({ id: BLAST, trigger: { enabled: false, conditions: [] } }));
    intoFight(k);
    hardenFoes(k, 1e6);
    charged(k, 1);
    for (let t = 0; t < 300 && combatOf(k).fight; t++) k.tick();
    expect(blasts(k)).toBe(0);
  });

  it('is pressed for the next bar fill from the Ability tab, and pressed again to cancel', () => {
    const k = holding('solar_charge');
    k.dispatch(setTrigger({ id: BLAST, trigger: { enabled: false, conditions: [] } }));
    charged(k, 1);
    expect(k.dispatch(pressAction({ key: 'sun_blast' })).ok).toBe(false); // no fight yet
    intoFight(k);
    hardenFoes(k, 1e6);
    charged(k, 1);
    expect(k.dispatch(pressAction({ key: 'sun_blast' })).ok).toBe(true);
    expect(facetOf(k).queued).toBe('sun_blast');
    expect(facetView(k).held[0].actions).toMatchObject([{ key: 'sun_blast', under: 'charge', queued: true }]);
    expect(k.dispatch(pressAction({ key: 'sun_blast' })).ok).toBe(true);
    expect(facetOf(k).queued).toBeNull();
    k.dispatch(pressAction({ key: 'sun_blast' }));
    for (let t = 0; t < 300 && blasts(k) === 0 && combatOf(k).fight; t++) k.tick();
    expect(blasts(k)).toBe(1);
    expect(facetOf(k).queued).toBeNull();
  });

  it('cannot be pressed below 80%', () => {
    const k = holding('solar_charge');
    intoFight(k);
    charged(k, 0.7);
    expect(k.dispatch(pressAction({ key: 'sun_blast' })).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!CORE)('Zenkai', () => {
  /** A fight against a level-`foe` enemy in which HP drops to `share` of max, through the damage door. */
  function fight(k: Kernel, foe: number, share: number) {
    emit(k, fightStarted, { site: 'test', forced: false, enemies: [{ entity: 'm999', defId: 'forest_rat', name: 'Rat', level: foe }] });
    const max = statBlockOf(reads(k)).maxHp;
    blow(k, null, hpOf(k) - share * max);
  }
  const zenkai = (level = 10) => {
    const k = holding('zenkai', { attrs: [] });
    patch(k, (s) => (s.levels.level = level));
    fullHp(k);
    return k;
  };

  it('pays after a win from 10% HP: 1.5% x 0.9 to every attribute', () => {
    const k = zenkai();
    const before = effectiveAttr(reads(k), 'str');
    fight(k, 10, 0.1);
    expect(cell(k, 'low')).toBeCloseTo(0.1);
    emit(k, fightWon, { site: 'test', forced: false });
    expect(cell(k, 'bonus')).toBeCloseTo(0.015 * 0.9);
    expect(cell(k, 'gains')).toBe(1);
    expect(effectiveAttr(reads(k), 'str')).toBeCloseTo(before * (1 + 0.015 * 0.9));
    expect(k.staleStats()).toEqual([]);
  });

  it('pays nothing when HP stayed above 20%', () => {
    const k = zenkai();
    fight(k, 10, 0.3);
    emit(k, fightWon, { site: 'test', forced: false });
    expect(cell(k, 'bonus')).toBe(0);
  });

  it('pays nothing after a flask or a consumable in that fight', () => {
    const flask = zenkai();
    fight(flask, 10, 0.1);
    emit(flask, flaskUsed, { grants: [] });
    emit(flask, fightWon, { site: 'test', forced: false });
    expect(cell(flask, 'bonus')).toBe(0);

    const item = zenkai();
    fight(item, 10, 0.1);
    emit(item, consumableUsed, { id: 'none', quality: 'c', direct: true });
    emit(item, fightWon, { site: 'test', forced: false });
    expect(cell(item, 'bonus')).toBe(0);
  });

  it('pays nothing after a miracle cast in that fight', () => {
    const k = zenkai();
    intoFight(k);
    hardenFoes(k, 1e6);
    fight(k, 10, 0.1);
    emit(k, spellCast, { caster: 'player', school: 'divine', name: 'Prayer', deity: 'sun', manaCost: 0 });
    emit(k, fightWon, { site: 'test', forced: false });
    expect(cell(k, 'bonus')).toBe(0);
  });

  it('forgets a flask from the fight before', () => {
    const k = zenkai();
    emit(k, flaskUsed, { grants: [] });
    fight(k, 10, 0.1);
    emit(k, fightWon, { site: 'test', forced: false });
    expect(cell(k, 'bonus')).toBeGreaterThan(0);
  });

  it('scales by enemy level over yours: nothing under 70%, capped at 1.5', () => {
    const weak = zenkai(10);
    fight(weak, 6, 0.1);
    emit(weak, fightWon, { site: 'test', forced: false });
    expect(cell(weak, 'bonus')).toBe(0);

    const even = zenkai(10);
    fight(even, 7, 0.1);
    emit(even, fightWon, { site: 'test', forced: false });
    expect(cell(even, 'bonus')).toBeCloseTo(0.015 * 0.9 * 0.7);

    const strong = zenkai(10);
    fight(strong, 30, 0.1);
    emit(strong, fightWon, { site: 'test', forced: false });
    expect(cell(strong, 'bonus')).toBeCloseTo(0.015 * 0.9 * 1.5);
  });

  it('multiplies each next gain by 0.97', () => {
    const k = zenkai();
    const first = 0.015 * 0.9;
    for (let i = 0; i < 2; i++) {
      fullHp(k);
      fight(k, 10, 0.1);
      emit(k, fightWon, { site: 'test', forced: false });
    }
    expect(cell(k, 'gains')).toBe(2);
    expect(cell(k, 'bonus')).toBeCloseTo(first + first * 0.97);
  });

  it('in the game loop: hunting from 15% HP, the first win pays', () => {
    const k = holding('zenkai', { attrs: ['str', 'dex', 'con'] });
    const max = statBlockOf(reads(k)).maxHp;
    patch(k, (s) => (s.resources.values.hp = 0.15 * max));
    intoFight(k);
    for (let t = 0; t < 20_000 && cell(k, 'gains') === 0 && counterOf(k, 'defeats') === 0; t++) k.tick();
    expect(counterOf(k, 'defeats')).toBe(0);
    expect(cell(k, 'gains')).toBe(1);
    expect(cell(k, 'bonus')).toBeGreaterThan(0.015 * 0.8);
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!CORE)('Little Moons', () => {
  it('strikes during a hunt with an empty mana pool: four strikes in 8 s', () => {
    const k = holding('little_moons');
    intoFight(k);
    hardenFoes(k, 1e9);
    setPool(k, 'mana', 0);
    // Strikes are counted from the fight's first tick; the fight is a few ticks old here.
    const start = combatOf(k).fight!;
    expect(start).toBeTruthy();
    for (let t = 0; t < 80; t++) k.tick();
    const strikes = floating(k, 'Little Moons')?.tally.find((x) => x.label === 'strike')?.qty ?? 0;
    expect(strikes).toBeGreaterThanOrEqual(4);
    expect(strikes).toBeLessThanOrEqual(5);
    expect(resourceValue(slice(k, 'resources'), 'mana')).toBeGreaterThanOrEqual(0);
  });

  it('a strike that kills is swept by combat: the kill and the win follow', () => {
    const k = holding('little_moons');
    intoFight(k);
    patchFight(k, (s) => {
      for (const e of s.fight!.enemies) if (e) e.hp = 1;
    });
    const kills = counterOf(k, 'kills');
    for (let t = 0; t < 60 && combatOf(k).fight; t++) {
      patchFight(k, (s) => {
        if (s.fight) s.fight.playerBar = 0;
      });
      k.tick();
    }
    expect(combatOf(k).fight).toBeNull();
    expect(counterOf(k, 'kills')).toBeGreaterThan(kills);
  });

  it('counts a boss kill, and only a boss kill', () => {
    const k = holding('little_moons');
    const kill = (boss: boolean) =>
      emit(k, enemyKilled, {
        entity: 'm1', defId: 'x', name: 'x', level: 30, rewardLevel: 30, xp: 0, tags: [], lastHit: null, site: 's', boss, once: false,
      });
    kill(true);
    kill(false);
    expect(cell(k, 'bosses')).toBe(1);
  });

  it('carries no status for its counters, so the stat cache does not move each tick', () => {
    const k = holding('little_moons');
    intoFight(k);
    for (let t = 0; t < 30; t++) k.tick();
    expect(statusesOf(k).filter((s) => s.id.startsWith('fc_'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!CORE)('Bramble', () => {
  const thorns = (k: Kernel) => cell(k, 'thorns');

  it('a blow grows a thorn and the thorns answer its attacker as Piercing', () => {
    const k = holding('bramble');
    intoFight(k);
    hardenFoes(k, 1e9);
    const front = frontEnemy(k);
    blow(k, front, 100);
    expect(thorns(k)).toBe(1);
    expect(frontEnemy(k).hp).toBeLessThan(1e9);
    expect(frontEnemy(k).lastHit).toBe('piercing');
    expect(floating(k, 'Bramble')?.tally.find((x) => x.label === 'thorns')?.qty).toBe(1);
  });

  it('the answer is sized to the blow as thrown, not what got past your armour', () => {
    const k = holding('bramble');
    intoFight(k);
    hardenFoes(k, 1e9);
    const front = frontEnemy(k);
    blow(k, front, 10, 'slashing', 100);
    expect(1e9 - frontEnemy(k).hp).toBe(2);
  });

  it('each second of fight time adds a thorn at cap 10', () => {
    const k = holding('bramble');
    intoFight(k);
    // Ten fight ticks hold exactly one second boundary.
    const start = thorns(k);
    for (let t = 0; t < 10; t++) ask(k, fightTick, undefined);
    expect(thorns(k)).toBe(start + 1);
  });

  it('a Poison blow from your own spell adds 2 + 10% of the cap', () => {
    const k = holding('bramble');
    intoFight(k);
    ask(k, hitPlayer, { amount: 3, type: 'poison', source: { key: 'spell:venom_me', label: 'Venom', icon: '🧪', self: true } });
    expect(thorns(k)).toBe(3);
  });

  it('a hit with no attacker neither grows nor answers', () => {
    const k = holding('bramble');
    intoFight(k);
    hardenFoes(k, 1e9);
    blow(k, null, 100);
    expect(thorns(k)).toBe(0);
    expect(frontEnemy(k).hp).toBe(1e9);
  });

  it('each level slows the action bar by 0.5%, and Heat burns 5 levels', () => {
    const k = holding('bramble');
    intoFight(k);
    hardenFoes(k, 1e9);
    const speed = statBlockOf(reads(k)).speed;
    const front = frontEnemy(k);
    for (let i = 0; i < 8; i++) blow(k, front, 10);
    expect(thorns(k)).toBe(8);
    expect(statBlockOf(reads(k)).speed).toBeCloseTo(speed * (1 - 8 * 0.005), 6);
    blow(k, front, 10, 'heat');
    expect(thorns(k)).toBe(3);
    expect(statBlockOf(reads(k)).speed).toBeCloseTo(speed * (1 - 3 * 0.005), 6);
    expect(k.staleStats()).toEqual([]);
  });

  it('an attacker the thorns kill is swept during the enemy phase: the kill and the win follow', () => {
    const k = holding('bramble');
    intoFight(k);
    setMods(k, [{ stat: 'stats/maxHp', kind: 'add', value: 1e6 }]);
    fullHp(k);
    patchFight(k, (s) => {
      const foe = s.fight!.enemies.find((e) => e)!;
      s.fight!.enemies = [foe, null, null, null, null];
      foe.hp = 1;
    });
    const kills = counterOf(k, 'kills');
    idle(k, 400);
    expect(combatOf(k).fight).toBeNull();
    expect(counterOf(k, 'kills')).toBe(kills + 1);
    expect(slice<{ lastFight: { outcome: string } | null }>(k, 'combat').lastFight?.outcome).toBe('won');
  });

  it('thorns clear when the fight ends, and the fight is counted', () => {
    const k = holding('bramble');
    intoFight(k);
    hardenFoes(k, 1e9);
    const front = frontEnemy(k);
    for (let i = 0; i < 3; i++) blow(k, front, 10);
    expect(thorns(k)).toBe(3);
    patchFight(k, (s) => {
      for (const e of s.fight!.enemies) if (e) e.hp = 0;
    });
    k.tick();
    expect(thorns(k)).toBe(0);
    expect(cell(k, 'fights')).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!CORE)('Basilisk Hide', () => {
  const stoneOn = (k: Kernel, entity: string) => findStatus(statusesOf(k, entity), 'basilisk_stone')?.intensity ?? 0;
  const isStatue = (k: Kernel, entity: string) => statueOf(statusesOf(k, entity)) !== null;
  const setFoe = (k: Kernel, entity: string, change: (e: Enemy) => void) =>
    patchFight(k, (s) => {
      for (const e of s.fight!.enemies) if (e?.entity === entity) change(e);
    });
  /** Blows from `e` until it turns to stone. */
  function petrify(k: Kernel, e: Enemy) {
    for (let i = 0; i < 200 && !isStatue(k, e.entity); i++) blow(k, e, 5, 'slashing', 5);
    expect(isStatue(k, e.entity)).toBe(true);
  }

  it('a blow puts Stone on its attacker, and an attacker with more CON resists it', () => {
    const k = holding('basilisk_hide');
    intoFight(k);
    hardenFoes(k, 1e9);
    const front = frontEnemy(k);
    const con = effectiveAttr(reads(k), 'con');
    setFoe(k, front.entity, (e) => (e.attrs.con = 1));
    blow(k, front, 5, 'slashing', 5);
    const full = stoneOn(k, front.entity);
    expect(full).toBeGreaterThan(0);
    expect(full).toBeLessThanOrEqual(6 + con / 10 + 1e-9);
    ask(k, removeStatus, { entity: front.entity, id: 'basilisk_stone' });
    setFoe(k, front.entity, (e) => (e.attrs.con = con * 2));
    blow(k, front, 5, 'slashing', 5);
    expect(stoneOn(k, front.entity)).toBeCloseTo(full / 2, 6);
  });

  it('Stone slows the attacker 0.5% a point', () => {
    const k = holding('basilisk_hide');
    intoFight(k);
    hardenFoes(k, 1e9);
    const front = frontEnemy(k);
    setFoe(k, front.entity, (e) => (e.attrs.con = 1));
    const speed = enemyStats(k, front).speed;
    blow(k, front, 5, 'slashing', 5);
    expect(enemyStats(k, front).speed).toBeCloseTo(speed * (1 - 0.005 * stoneOn(k, front.entity)), 6);
  });

  it('at 100 Stone the attacker turns to stone, and the Stone is spent', () => {
    const k = holding('basilisk_hide');
    intoFight(k);
    hardenFoes(k, 1e9);
    const front = frontEnemy(k);
    setFoe(k, front.entity, (e) => (e.attrs.con = 1));
    petrify(k, front);
    expect(stoneOn(k, front.entity)).toBe(0);
  });

  it.todo('a statue does nothing, crumbles after 3 s, breaks into rocks: combat statue rules are not ported (README, Left behind)');

  it('a statue counts when the enemy stood at 85% of your level or attribute total', () => {
    const k = holding('basilisk_hide');
    const level = slice<{ level: number }>(k, 'levels').level;
    const [rival, weak] = stage(k, [
      { monsterId: 'forest_rat', level },
      { monsterId: 'forest_rat', level: 0 },
    ]);
    hardenFoes(k, 1e9);
    setFoe(k, rival.entity, (e) => (e.attrs.con = 1));
    setFoe(k, weak.entity, (e) => (e.attrs = { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }));
    petrify(k, rival);
    expect(cell(k, 'statues')).toBe(1);
    petrify(k, weak);
    expect(cell(k, 'statues')).toBe(1);
  });

  it('at 100 the pick is offered, survives a save, and the branch keeps the count', () => {
    const k = holding('basilisk_hide');
    const level = slice<{ level: number }>(k, 'levels').level;
    const [rival] = stage(k, [{ monsterId: 'forest_rat', level }]);
    hardenFoes(k, 1e9);
    setFoe(k, rival.entity, (e) => (e.attrs.con = 1));
    setShare(k, 'statues', 0.99);
    expect(facetView(k).evolution).toBeNull();
    petrify(k, rival);
    const offer = facetView(k).evolution!;
    expect(offer.choices.map((c) => c.name)).toEqual(["Gorgon's Gaze", 'Rubble', 'Stoneskin']);
    expect(offer.choices.every((c) => c.desc.length > 0)).toBe(true);

    const loaded = makeGame({ seed: 5 });
    expect(loaded.load(JSON.parse(JSON.stringify(k.save(0)))).ok).toBe(true);
    expect(facetView(loaded).evolution).not.toBeNull();

    expect(k.dispatch(chooseEvolution({ key: 'bramble' })).ok).toBe(false);
    expect(k.dispatch(chooseEvolution({ key: 'basilisk_stoneskin' })).ok).toBe(true);
    expect(facetOf(k).docs).toHaveLength(1);
    expect(facetOf(k).docs[0].reading?.name).toBe('Stoneskin');
    expect(cell(k, 'statues')).toBe(100);
    expect(facetView(k).evolution).toBeNull();
    expect(k.staleStats()).toEqual([]);
  });

  it.todo('play holds while the pick is on offer: the hold of play is not ported (README, Left behind)');

  it("Gorgon's Gaze stones the front enemy each second, and blows add half", () => {
    const k = holding('basilisk_gorgon');
    const [first, second] = stage(k, [
      { monsterId: 'forest_rat', level: 1 },
      { monsterId: 'forest_rat', level: 1 },
    ]);
    hardenFoes(k, 1e9);
    setFoe(k, first.entity, (e) => (e.attrs.con = 1));
    setFoe(k, second.entity, (e) => (e.attrs.con = 1));
    const con = effectiveAttr(reads(k), 'con');
    for (let t = 0; t < 10; t++) ask(k, fightTick, undefined);
    const second1 = stoneOn(k, first.entity);
    expect(second1).toBeGreaterThan(0);
    expect(stoneOn(k, second.entity)).toBe(0);
    const resisted = second1 / (2 + con / 50);
    blow(k, first, 5, 'slashing', 5);
    expect(stoneOn(k, first.entity) - second1).toBeCloseTo(resisted * 0.5 * (6 + con / 10), 6);
    petrify(k, first);
    expect(stoneOn(k, second.entity)).toBeCloseTo(resisted * 25, 6);
  });

  it.todo('Rubble and Stoneskin: rocks, bursts, standing statues need the combat statue rules (README, Left behind)');
});

// ---------------------------------------------------------------------------

describe.skipIf(!CORE)('Weakest Weapon Master', () => {
  const wearing = (level = 30) => {
    const k = holding('weakest_weapon_master', { level, attrs: ['str', 'dex', 'con', 'int', 'wis', 'cha'] });
    fullHp(k);
    aMinute(k);
    return k;
  };

  it('formulas read the ceiling of 20, gates read the real value', () => {
    const k = wearing(30);
    expect(attrValue(reads(k), 'str')).toBeGreaterThanOrEqual(30);
    expect(formulaAttr(reads(k), 'str')).toBe(20);
    const at30 = statBlockOf(reads(k)).maxHp;
    expect(statBlockOf(reads(wearing(40))).maxHp).toBe(at30);
    const bare = makeGame({ seed: 7 });
    patch(bare, (s) => {
      for (const a of ['str', 'dex', 'con', 'int', 'wis', 'cha']) s.attributes.attrs[a].level = 30;
    });
    expect(statBlockOf(reads(bare)).maxHp).toBeGreaterThan(at30);
  });

  it('routes XP for an attribute at the ceiling into hidden levels, and trains one below it', () => {
    const k = wearing(30);
    patch(k, (s) => (s.attributes.attrs.dex.level = 5));
    const attrs = () => slice<AttributesState>(k, 'attributes').attrs;
    const before = attrs().str.xp;
    emit(k, grantAttrXp, { attr: 'str', amount: 5_000 });
    expect(attrs().str.xp).toBe(before);
    expect(cell(k, 'past_str')).toBe(5_000);
    expect(cell(k, 'hidden')).toBe(levelsPast(20, 5_000));
    expect(cell(k, 'hidden')).toBeGreaterThan(0);
    const dex = attrs().dex.xp;
    emit(k, grantAttrXp, { attr: 'dex', amount: 3 });
    expect(attrs().dex.xp).toBe(dex + 3);
    expect(cell(k, 'past_dex')).toBe(0);
    expect(attrXpNeeded(20)).toBeGreaterThan(0);
  });

  it('the reps carrier says every slotted technique counts, multiplied (read by martial)', () => {
    const k = wearing(30);
    const reps = statusesOf(k).find((s) => s.id.endsWith('_reps'))!;
    expect(reps.intensity).toBeCloseTo(cell(k, 'reps'));
    expect(cell(k, 'reps')).toBeGreaterThanOrEqual(2);
  });

  it('Power adds Power to damage; the readout offers the four stances', () => {
    const k = wearing(30);
    trained(k, 50);
    expect(cell(k, 'power')).toBeGreaterThan(0);
    const ab = facetView(k).held[0];
    expect(ab.choice?.options.map((o) => o.name)).toEqual(['Power', 'Flowing', 'Heavy', 'Empty']);
    expect(ab.cells.find((c) => c.key === 'power')?.acts).toBe(true);
    expect(ab.cells.find((c) => c.key === 'flowing')?.acts).toBe(true);
    expect(ab.cells.find((c) => c.key === 'ceiling')?.acts).toBe(false);
  });

  it('a stance picked in a fight applies at the next bar fill', () => {
    const k = wearing(30);
    intoFight(k);
    hardenFoes(k, 1e9);
    expect(k.dispatch(chooseOption({ v: 3 })).ok).toBe(true);
    expect(cell(k, 'want')).toBe(3);
    expect(cell(k, 'stance')).toBe(1);
    for (let t = 0; t < 60 && cell(k, 'stance') !== 3; t++) k.tick();
    expect(cell(k, 'stance')).toBe(3);
  });

  it('Heavy turns aside a blow smaller than Power and rattles the attacker', () => {
    const k = wearing(30);
    trained(k, 500);
    k.dispatch(chooseOption({ v: 3 }));
    intoFight(k);
    hardenFoes(k, 1e9);
    const hp = hpOf(k);
    const taken = counterOf(k, 'combat:hitsTaken');
    let rattled = false;
    for (let t = 0; t < 200; t++) {
      k.tick();
      rattled ||= combatOf(k).fight?.enemies.some((e) => e && findStatus(statusesOf(k, e.entity), 'rattled')) ?? false;
    }
    expect(counterOf(k, 'combat:hitsTaken')).toBe(taken);
    expect(hpOf(k)).toBeGreaterThanOrEqual(hp);
    expect(rattled).toBe(true);
  });

  it('Flowing parries every blow when Power is twice the blow or more', () => {
    const k = wearing(30);
    trained(k, 500);
    k.dispatch(chooseOption({ v: 2 }));
    intoFight(k);
    hardenFoes(k, 1e9);
    const parries = counterOf(k, 'combat:parries');
    const taken = counterOf(k, 'combat:hitsTaken');
    for (let t = 0; t < 200; t++) k.tick();
    expect(counterOf(k, 'combat:parries')).toBeGreaterThan(parries);
    expect(counterOf(k, 'combat:hitsTaken')).toBe(taken);
  });

  it("Empty blows skip the dummy's resistance and armour", () => {
    const k = wearing(30);
    // Power must be above 0 for the carrier to act: a new character here has no combat skill level.
    trained(k, 5);
    k.dispatch(chooseOption({ v: 4 }));
    intoFight(k, 'base_training_area');
    for (let t = 0; t < 120; t++) k.tick();
    const blows = transcript(k).filter((f) => f.damage && !f.damage.incoming && f.damage.slices.length);
    expect(blows.length).toBeGreaterThan(0);
    for (const f of blows) {
      expect(f.damage!.slices[0].resisted).toBe(0);
      expect(f.damage!.slices[0].armor).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!CORE)('Calorie Burn', () => {
  it('eating fills the store, through the consumables command', () => {
    const k = holding('calorie_burn');
    patch(k, (s) => {
      const m = s.materials as MaterialsState;
      m.stock.hearty_stew ??= {};
      m.stock.hearty_stew.c = 1;
    });
    expect(k.dispatch(useConsumable({ id: 'hearty_stew', quality: 'c' })).ok).toBe(true);
    expect(cell(k, 'kcal')).toBeCloseTo(dishCalories('hearty_stew', 'c'));
    expect(dishCalories('hearty_stew', 'c')).toBeGreaterThanOrEqual(CALORIES_PER_WELL_FED * 0.5);
  });

  it('a full store takes 10% off every attribute', () => {
    const k = holding('calorie_burn');
    const before = effectiveAttr(reads(k), 'str');
    setShare(k, 'kcal', 1);
    aMinute(k);
    expect(cell(k, 'sated')).toBeCloseTo(10, 1);
    expect(effectiveAttr(reads(k), 'str')).toBeCloseTo(before * (1 - cell(k, 'sated') / 100));
  });

  it('a fight burns nothing until it turns dangerous: 33% of HP gone or 20 s', () => {
    const k = holding('calorie_burn');
    setShare(k, 'kcal', 1);
    intoFight(k);
    hardenFoes(k, 1e9);
    setMods(k, [{ stat: 'stats/maxHp', kind: 'add', value: 1e6 }]);
    fullHp(k);
    k.tick();
    expect(cell(k, 'fburn')).toBe(0);
    for (let t = 0; t < 210 && combatOf(k).fight; t++) k.tick();
    expect(cell(k, 'danger')).toBe(1);
    expect(cell(k, 'fburn')).toBeGreaterThan(0);
  });

  it('max HP burned to 90% knocks you out, with the cause on the fight record', () => {
    const k = holding('calorie_burn');
    intoFight(k);
    hardenFoes(k, 1e9);
    setShare(k, 'debt', 1e-5);
    for (let t = 0; t < 20 && combatOf(k).fight; t++) k.tick();
    expect(combatOf(k).fight).toBeNull();
    const last = slice<{ lastFight: { outcome: string; cause?: string } | null }>(k, 'combat').lastFight;
    expect(last?.outcome).toBe('knocked_out');
    expect(last?.cause).toMatch(/max HP burned away/);
    expect(slice<{ recovering: boolean }>(k, 'world').recovering).toBe(true);
  });

  it('eating is not counted out of an unused store: a dish raises eat with its calories', () => {
    const k = holding('calorie_burn');
    emit(k, consumableUsed, { id: 'hearty_stew', quality: 'c', direct: false });
    expect(cell(k, 'kcal')).toBeCloseTo(dishCalories('hearty_stew', 'c'));
  });
});

// ---------------------------------------------------------------------------

describe.skipIf(!CORE)('ability readout', () => {
  const readout = (ability: string) => facetView(holding(ability, { attrs: [] })).held[0];
  const acting = (ability: string) => readout(ability).cells.filter((c) => c.acts).map((c) => c.key);

  it('every bank entry says what it does', () => {
    for (const [key, doc] of Object.entries(Facet.bank!)) expect(doc.reading?.desc, key).toBeTruthy();
  });

  it('marks as acting only the cells whose carrier modifies a number', () => {
    expect(acting('solar_charge')).toEqual(['power', 'warmth', 'infuse']);
    expect(acting('zenkai')).toEqual(['bonus']);
    expect(acting('little_moons')).toEqual([]);
    expect(acting('bramble')).toEqual(['thorns']);
    expect(acting('basilisk_hide')).toEqual([]);
    expect(acting('basilisk_stoneskin')).toEqual(['standing']);
  });

  it('keeps the counters and inputs for the tab', () => {
    const solar = readout('solar_charge');
    expect(solar.cells.map((c) => c.key)).toEqual(['charge', 'power', 'warmth', 'infuse', 'mend', 'blast']);
    expect(solar.inputs.map((i) => i.label)).toEqual(['Sunlight here']);
    expect(readout('bramble').cells.find((c) => c.key === 'fights')?.acts).toBe(false);
  });

  it('lists the conditions an ability applies and what each becomes', () => {
    const hide = readout('basilisk_hide');
    expect(hide.conditions).toHaveLength(1);
    expect(hide.conditions[0].name).toBe('Stone');
    expect(hide.conditions[0].becomes?.name).toBe('Petrified');
    expect(hide.conditions[0].becomes?.desc).toMatch(/Lasts 3 s/);
    expect(readout('basilisk_stoneskin').conditions[0].becomes?.desc).toMatch(/Stays until the fight ends/);
    expect(readout('little_moons').conditions).toEqual([]);
  });

  it('reads the evolution from the clauses: trigger cell, value and branches', () => {
    const hide = readout('basilisk_hide');
    expect(hide.evolves?.label).toBe('Statues');
    expect(hide.evolves?.at).toBe(100);
    expect(hide.evolves?.into.map((b) => b.name)).toEqual(["Gorgon's Gaze", 'Rubble', 'Stoneskin']);
    expect(readout('basilisk_gorgon').evolves).toBeNull();
    expect(readout('bramble').evolves).toBeNull();
  });

  it('a stance cell reads as what Power does in it, not as a bare number', () => {
    const k = holding('weakest_weapon_master', { attrs: [] });
    patch(k, (s) => {
      (s.facet as FacetState).docs[0].cells!.find((c) => c.key === 'flowing')!.state!.v = 29;
    });
    const flowing = facetView(k).held[0].cells.find((c) => c.key === 'flowing')!;
    expect(flowing.line).toBe('parries every blow up to 15');
    expect(flowing.base).toBe('Power');
    expect(facetView(k).held[0].cells.find((c) => c.key === 'ceiling')?.line).toBeNull();
  });

  it("gives a document saved without a description its bank entry's", () => {
    const k = holding('bramble', { attrs: [] });
    patch(k, (s) => {
      delete (s.facet as FacetState).docs[0].reading!.desc;
    });
    expect(facetView(k).held[0].desc).toBe(Facet.bank!.bramble.reading!.desc);
  });

  it('the status list leaves out the carriers of the cells the tab shows', () => {
    const k = holding('solar_charge', { attrs: [] });
    const shown = (kernel: Kernel) =>
      (kernel.view().systems.statuses as { player: { id: string }[] } | undefined)?.player?.map((s) => s.id) ?? [];
    expect(shown(k).some((id) => id.startsWith('fc_'))).toBe(false);
  });
});

void resources;

/**
 * New in spine port 4: the combat system as a kernel system. The old build
 * had no test for these, because the things under test did not exist there:
 * the save holds a fight, the fight is deterministic from a seed, and the
 * rotation kinds of later ports attach through a registry.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { runHeadless, type Kernel, type ScheduledCommand } from '../src/kernel';
import {
  abandon,
  actionSkipped,
  damageEnemy,
  enemyKilled,
  fightClosed,
  fightStarted,
  fightWon,
  hunt,
  registerMonsterAction,
  registerPlayerAction,
  setHuntRest,
  setRotation,
  stampAction,
  stopHunt,
  unregisterAction,
  type CombatView,
  type EncounterSite,
  type Enemy,
} from '../src/systems/combat';
import type { ItemsState } from '../src/systems/items';
import type { LevelsState } from '../src/systems/levels';
import type { MercyState } from '../src/systems/mercy';
import { MONSTERS, type MonsterDef } from '../src/systems/monsters';
import { hitPlayer, setExerting, type ResourcesState } from '../src/systems/resources';
import { statMod } from '../src/systems/stats';
import { applyStatus } from '../src/systems/statuses';
import {
  combatOf,
  counterOf,
  enemyStats,
  feedOf,
  frontEnemy,
  hpOf,
  huntingGame,
  logOf,
  patchFight,
  playerStats,
  setHp,
  SITES,
  stage,
} from './combatHelpers';
import { ask, equip, makeGame, patch, setMods, slice } from './helpers';

const rats: EncounterSite = { id: 'rats', name: 'Rat Hole', encounters: [{ monsterId: 'forest_rat', weight: 1, level: [1, 1] }] };

/** A character that cannot lose: the fights are scaffolding. */
function sturdy(g: Kernel): Kernel {
  setMods(g, [statMod('maxHp', 'add', 1e6)]);
  patch(g, (slices) => {
    (slices.resources as ResourcesState).values.hp = 1e6;
  });
  return g;
}

const texts = (g: Kernel) => feedOf(g).map((l) => l.text);

function events(g: Kernel): { type: string; payload: unknown }[] {
  const seen: { type: string; payload: unknown }[] = [];
  g.onEvent((event) => {
    if (event.type.startsWith('combat/')) seen.push({ type: event.type, payload: event.payload });
  });
  return seen;
}

describe('determinism', () => {
  const commands: ScheduledCommand[] = [
    { at: 0, command: setHuntRest({ at: 0.4, toFull: false }) },
    { at: 0, command: hunt({ site: SITES.woods_edge }) },
    { at: 900, command: hunt({ site: SITES.woods_edge }) },
    { at: 1800, command: hunt({ site: SITES.the_cages }) },
    { at: 2700, command: hunt({ site: SITES.woods_edge }) },
  ];

  function play(seed: number, ticks = 3600): Kernel {
    const g = makeGame({ seed });
    equip(g, 1);
    runHeadless(g, { ticks, commands: commands.filter((c) => c.at < ticks) });
    return g;
  }

  it('the same seed and commands give the same fight', () => {
    const a = play(2026);
    const b = play(2026);
    expect(a.snapshot()).toEqual(b.snapshot());
    // The run fought: kills and a ledger exist, and the generator moved.
    expect(counterOf(a, 'kills')).toBeGreaterThan(0);
    expect(combatOf(a).lastFight).not.toBeNull();
    expect(play(2027).snapshot()).not.toEqual(a.snapshot());
  });

  it('a run split by a save and a load in the middle of a fight gives the same state', () => {
    const whole = play(77);

    const first = makeGame({ seed: 77 });
    equip(first, 1);
    // Stop on a tick where a fight is open.
    let at = 0;
    for (; at < 3600; at++) {
      for (const c of commands) if (c.at === at) first.dispatch(c.command);
      if (at > 400 && combatOf(first).fight && combatOf(first).fight!.playerBar > 0) break;
      first.tick();
    }
    expect(combatOf(first).fight).not.toBeNull();
    const second = makeGame({ seed: 1 });
    expect(second.load(JSON.parse(JSON.stringify(first.save(0)))).ok).toBe(true);
    expect(second.entities()).toEqual(['player']);
    runHeadless(second, {
      ticks: 3600 - at,
      commands: commands.filter((c) => c.at >= at).map((c) => ({ ...c, at: c.at - at })),
    });

    expect(second.snapshot()).toEqual(whole.snapshot());
  });

  it('keeps derived values in step with state through fights, and drops every dead entity', () => {
    const g = huntingGame(5, 'woods_edge');
    for (let i = 0; i < 1500; i++) {
      g.tick();
      if (i % 50 === 0) {
        expect(g.staleStats()).toEqual([]);
        const live = (combatOf(g).fight?.enemies ?? []).filter((e): e is Enemy => !!e).map((e) => e.entity);
        expect(g.entities().filter((id) => id !== 'player').every((id) => live.includes(id))).toBe(true);
      }
    }
  });
});

describe('a fight as events', () => {
  it('emits start, kill, won and closed, in that order, with entity ids', () => {
    const g = sturdy(makeGame({ seed: 3 }));
    equip(g, 1);
    const seen = events(g);
    const [foe] = stage(g, [{ monsterId: 'forest_rat', level: 2, hpShare: 0 }], rats);
    for (let i = 0; i < 2000 && combatOf(g).fight; i++) g.tick();

    const order = seen.map((e) => e.type).filter((t) => [fightStarted, enemyKilled, fightClosed, fightWon].some((d) => d.type === t));
    expect(order).toEqual([fightStarted.type, enemyKilled.type, fightClosed.type, fightWon.type]);
    expect(seen.find((e) => e.type === fightStarted.type)!.payload).toMatchObject({
      site: 'rats',
      forced: true,
      enemies: [{ entity: foe.entity, defId: 'forest_rat', level: 2 }],
    });
    expect(seen.find((e) => e.type === enemyKilled.type)!.payload).toMatchObject({
      entity: foe.entity,
      defId: 'forest_rat',
      level: 2,
      rewardLevel: 2,
      site: 'rats',
      boss: false,
      once: false,
    });
    expect(seen.find((e) => e.type === fightClosed.type)!.payload).toEqual({ site: 'rats', standing: [] });
  });

  it('a kill pays skill XP, level XP, gold and the kill counters', () => {
    const g = sturdy(makeGame({ seed: 4 }));
    equip(g, 1);
    stage(g, [{ monsterId: 'goblin', level: 3, hpShare: 0 }], rats);
    for (let i = 0; i < 2000 && combatOf(g).fight; i++) g.tick();
    expect(counterOf(g, 'kills')).toBe(1);
    expect(counterOf(g, 'kills:goblin')).toBe(1);
    expect(counterOf(g, 'kills:tag:goblin')).toBe(1);
    const levels = slice<LevelsState>(g, 'levels');
    expect(levels.level > 1 || levels.levelXp > 0).toBe(true);
    expect(logOf(g).some((line) => line.includes('Goblin'))).toBe(true);
  });

  it('training equipment pays no level XP', () => {
    const g = makeGame({ seed: 4 });
    equip(g, 1);
    stage(g, [{ monsterId: 'training_dummy', level: 1, hpShare: 0 }], rats);
    for (let i = 0; i < 3000 && combatOf(g).fight; i++) g.tick();
    expect(combatOf(g).lastFight?.outcome).toBe('won');
    expect(slice<LevelsState>(g, 'levels')).toEqual({ level: 1, levelXp: 0 });
  });

  it('the health trickle is told about the fight, and told when it ends', () => {
    const g = sturdy(makeGame({ seed: 5 }));
    equip(g, 1);
    const pace = () => slice<ResourcesState>(g, 'resources').pace;
    expect(pace().inCombat).toBe(false);
    stage(g, [{ monsterId: 'forest_rat', level: 1, hpShare: 0 }], rats);
    expect(pace().inCombat).toBe(true);
    for (let i = 0; i < 2000 && combatOf(g).fight; i++) g.tick();
    expect(pace().inCombat).toBe(false);
  });
});

describe('a condition that finishes the player in a fight', () => {
  it('closes the fight as a knockout, with the condition at the top of the ledger and no defeat counted', () => {
    const g = makeGame({ seed: 30 });
    const seen = events(g);
    // Training equipment never hurts: the bleed is what does it.
    stage(g, [{ monsterId: 'training_dummy', level: 1 }], rats);
    ask(g, applyStatus, { entity: 'player', app: { id: 'bleeding', intensity: 3 } });
    setHp(g, 2);
    for (let i = 0; i < 400 && combatOf(g).fight; i++) g.tick();
    const c = combatOf(g);
    expect(c.fight).toBeNull();
    expect(c.hunting).toBe(false);
    expect(c.respawnTimer).toBe(15);
    expect(c.lastFight?.outcome).toBe('knocked_out');
    expect(c.lastFight!.incoming[0].key).toBe('cond:bleeding');
    expect(seen.find((e) => e.type === 'combat/defeat')!.payload).toMatchObject({
      byCondition: true,
      forced: true,
      site: 'rats',
    });
    expect(counterOf(g, 'defeats')).toBe(0);
    expect(g.entities()).toEqual(['player']);
  });
});

describe('the site record', () => {
  it('a once kill and a boss kill are on the counters the moment they happen', () => {
    const lair: EncounterSite = {
      id: 'lair',
      name: 'The Lair',
      encounters: [{ monsterId: 'forest_rat', weight: 1, level: [1, 1], once: true, boss: true }],
      groupWeights: [{ size: 1, weight: 1 }],
    };
    const g = sturdy(huntingGame(6, lair));
    for (let i = 0; i < 3000 && counterOf(g, 'kills') < 1; i++) g.tick();
    expect(counterOf(g, 'slain:lair:forest_rat')).toBe(1);
    expect(counterOf(g, 'boss:lair')).toBe(1);
    expect(logOf(g).some((line) => line.includes('slain. It will not return.'))).toBe(true);
    expect(logOf(g).some((line) => line.includes('Keeper of The Lair slain.'))).toBe(true);
    // The line is gone from the table: the hunt finds no one.
    g.tick(200);
    expect(combatOf(g).fight).toBeNull();
    expect(counterOf(g, 'kills')).toBe(1);
  });

  it('a site with a fight limit counts its wins, stamps its clear and then spawns nothing', () => {
    const hall: EncounterSite = {
      ...rats,
      id: 'hall',
      name: 'The Hall',
      fightLimit: 2,
      stampOnClear: 'cleared:hall',
      clearedMsg: 'The hall is quiet.',
      groupWeights: [{ size: 1, weight: 1 }],
    };
    const g = sturdy(huntingGame(8, hall));
    for (let i = 0; i < 6000 && counterOf(g, 'fights:hall') < 2; i++) g.tick();
    expect(counterOf(g, 'fights:hall')).toBe(2);
    expect(counterOf(g, 'cleared:hall')).toBe(1);
    expect(logOf(g)).toContain('The hall is quiet.');
    expect(logOf(g).some((line) => line.includes('The Hall cleared.'))).toBe(true);
    g.tick(300);
    expect(combatOf(g).fight).toBeNull();
    expect(counterOf(g, 'kills')).toBe(2);
  });

  it('a monster that keeps its wounds carries them between fights, and its death ends them', () => {
    const def: MonsterDef = { ...MONSTERS.forest_rat, id: 'test_scarred', keepsWounds: { key: 'wounds:test', share: 0.5 } };
    MONSTERS.test_scarred = def;
    try {
      const g = sturdy(makeGame({ seed: 9 }));
      equip(g, 1);
      const [first] = stage(g, [{ monsterId: 'test_scarred', level: 5 }]);
      const max = enemyStats(g, first).maxHp;
      patchFight(g, (state) => {
        state.fight!.enemies[0]!.hp = Math.round(max * 0.4); // 60% missing
      });
      const hp = frontEnemy(g).hp;
      expect(ask(g, abandon, undefined)).toBe(true);
      // Half of what it lost in the fight is kept.
      const kept = counterOf(g, 'wounds:test');
      expect(kept).toBeCloseTo(0.5 * (1 - hp / max), 6);

      const [second] = stage(g, [{ monsterId: 'test_scarred', level: 5 }]);
      const max2 = enemyStats(g, second).maxHp;
      expect(second.hp).toBe(Math.max(1, Math.round(max2 * (1 - kept))));
      for (let i = 0; i < 5000 && combatOf(g).fight; i++) g.tick();
      expect(combatOf(g).lastFight?.outcome).toBe('won');
      expect(counterOf(g, 'wounds:test')).toBe(0);
    } finally {
      delete MONSTERS.test_scarred;
    }
  });
});

describe('rules of the blow', () => {
  it('a pinned-damage monster deals exactly its number, whatever the armour', () => {
    const g = sturdy(makeGame({ seed: 10 }));
    setMods(g, [statMod('maxHp', 'add', 1e6), statMod('armor', 'add', 500), statMod('dodge', 'add', -1)]);
    stage(g, [{ monsterId: 'slime_cell', level: 9 }]);
    const before = hpOf(g);
    let hits = 0;
    for (let i = 0; i < 400; i++) {
      g.tick();
      hits = texts(g).filter((t) => t.includes('hits you for') || t.includes('CRITS you for')).length;
      if (hits >= 3) break;
    }
    expect(hits).toBeGreaterThanOrEqual(3);
    expect(texts(g).filter((t) => /(hits|CRITS) you for/.test(t)).every((t) => /you for 1 /.test(t))).toBe(true);
    expect(before - hpOf(g)).toBeLessThanOrEqual(hits + 1);
  });

  it('a jolt under half health makes the bearer drop the weapon', () => {
    const g = makeGame({ seed: 11 });
    equip(g, 1);
    stage(g, [{ monsterId: 'training_dummy', level: 1 }]);
    ask(g, applyStatus, { entity: 'player', app: { id: 'jolted', intensity: 1 } });
    setHp(g, playerStats(g).maxHp * 0.3);
    for (let i = 0; i < 200 && slice<ItemsState>(g, 'items').equipment.weapon; i++) g.tick();
    expect(slice<ItemsState>(g, 'items').equipment.weapon).toBeUndefined();
    expect(slice<ItemsState>(g, 'items').inventory.some((item) => item.defId === 'rusty_sword')).toBe(true);
    expect(logOf(g).some((line) => line.includes('Rusty Sword dropped.'))).toBe(true);
    expect(texts(g)).toContain('⚡ You drop Rusty Sword!');
  });

  it('a condition that strikes back costs the player for swinging', () => {
    const g = sturdy(makeGame({ seed: 12 }));
    equip(g, 1);
    stage(g, [{ monsterId: 'training_dummy', level: 1 }]);
    ask(g, applyStatus, { entity: 'player', app: { id: 'shardbound', intensity: 2 } });
    for (let i = 0; i < 100 && !texts(g).some((t) => t.includes('tears at you')); i++) g.tick();
    expect(texts(g).some((t) => t.includes('Shardbound tears at you for'))).toBe(true);
  });

  it('a miss lands as a graze for a body that has the stat', () => {
    const g = sturdy(makeGame({ seed: 13 }));
    equip(g, 1);
    setMods(g, [statMod('maxHp', 'add', 1e6), statMod('graze', 'add', 0.5)]);
    const [foe] = stage(g, [{ monsterId: 'training_dummy', level: 1 }]);
    setMods(g, [statMod('dodge', 'add', 0.9)], foe.entity);
    for (let i = 0; i < 300 && counterOf(g, 'combat:grazes') === 0; i++) g.tick();
    expect(counterOf(g, 'combat:grazes')).toBeGreaterThan(0);
    expect(texts(g).some((t) => t.includes('misses but grazes for'))).toBe(true);
  });

  it('splash carries part of the blow into a flanker', () => {
    const g = sturdy(makeGame({ seed: 14 }));
    equip(g, 1);
    setMods(g, [statMod('maxHp', 'add', 1e6), statMod('splash', 'add', 0.5)]);
    stage(g, [
      { monsterId: 'training_dummy', level: 1 },
      { monsterId: 'training_dummy', level: 1 },
    ]);
    for (let i = 0; i < 100 && !texts(g).some((t) => t.includes('carries into')); i++) g.tick();
    expect(texts(g).some((t) => t.includes('The blow carries into the Training Dummy for'))).toBe(true);
  });

  it('the exertion of the style is paid on the swing only while the player has opted in', () => {
    const swingOnce = (exerting: boolean) => {
      const g = sturdy(makeGame({ seed: 15 }));
      equip(g, 1);
      if (exerting) g.dispatch(setExerting({ on: true }));
      stage(g, [{ monsterId: 'training_dummy', level: 1 }]);
      for (let i = 0; i < 100 && counterOf(g, 'combat:attacks') === 0; i++) g.tick();
      const line = feedOf(g).find((l) => l.damage && !l.damage.incoming)!;
      return { steps: line.damage!.steps.map((s) => s.label), stamina: slice<ResourcesState>(g, 'resources').values.stamina };
    };
    const off = swingOnce(false);
    const on = swingOnce(true);
    expect(off.steps).not.toContain('Exertion');
    expect(on.steps).toContain('Exertion');
    expect(on.stamina).toBeLessThan(off.stamina);
  });

  it('a crit at the 5% floor writes no drought key; a raised crit rate writes the player key', () => {
    const fight = (crit: number) => {
      const g = sturdy(makeGame({ seed: 16 }));
      equip(g, 1);
      setMods(g, [statMod('maxHp', 'add', 1e6), statMod('crit', 'add', crit)]);
      stage(g, [{ monsterId: 'training_dummy', level: 1 }]);
      let seen = false;
      for (let i = 0; i < 400; i++) {
        g.tick();
        seen ||= 'proc:crit' in slice<MercyState>(g, 'mercy').ledger;
      }
      return seen;
    };
    expect(fight(0)).toBe(false);
    expect(fight(0.3)).toBe(true);
  });

  it('the toll golem opens with its address: 30 ticks in which nobody acts', () => {
    const g = sturdy(makeGame({ seed: 17 }));
    equip(g, 1);
    stage(g, [{ monsterId: 'toll_collector_golem', level: 4 }]);
    g.tick(29);
    expect(combatOf(g).fight!.playerBar).toBe(0);
    expect(frontEnemy(g).bar).toBe(0);
    // Said at 30 and at 20 ticks left; the second line at 10.
    expect(texts(g).filter((t) => t.includes('Please provide documents.'))).toHaveLength(2);
    expect(texts(g).some((t) => t.includes('Removing interrupting entity.'))).toBe(true);
    g.tick(2);
    expect(combatOf(g).fight!.playerBar).toBeGreaterThan(0);
  });
});

describe('rotation kinds are registered, not coded', () => {
  afterEach(() => {
    unregisterAction('monster', 'technique');
    unregisterAction('monster', 'cast');
    unregisterAction('player', 'technique:');
    unregisterAction('player', 'grimoire:');
  });

  it('an entry whose kind nobody registered is passed over, reported once, and the monster swings plainly', () => {
    const g = sturdy(makeGame({ seed: 20 }));
    const seen = events(g);
    const [foe] = stage(g, [{ monsterId: 'hobgoblin', level: 3 }]);
    for (let i = 0; i < 300; i++) g.tick();
    const skips = g.skips().filter((s) => s.action === 'combat/rotation');
    // One line per rotation entry of the hobgoblin, not one per swing.
    expect(skips.map((s) => s.reason)).toEqual(
      [0, 1, 2, 3, 4].map((i) => `${foe.entity} entry "${i}": no system has registered the action kind "technique"`),
    );
    expect(seen.filter((e) => e.type === actionSkipped.type)).toHaveLength(5);
    expect(texts(g).some((t) => /The Hobgoblin (hits|CRITS) you for/.test(t))).toBe(true);
  });

  it('a monster technique shapes the swing: multiplier, type, riders, clock and walk', () => {
    registerMonsterAction('technique', {
      available: (_ctx, _enemy, entry) => 'technique' in entry && entry.technique === 'lunge',
      shape: () => ({
        name: 'Test Lunge',
        icon: '🗡',
        damageMult: 3,
        damageType: 'heat',
        inflicts: [{ id: 'on_fire', intensity: 1 }],
        cooldown: 50,
        to: 'low',
        watchKey: 'watched:lunge',
      }),
    });
    const g = sturdy(makeGame({ seed: 21 }));
    setMods(g, [statMod('maxHp', 'add', 1e6), statMod('dodge', 'add', -1)]);
    stage(g, [{ monsterId: 'hobgoblin', level: 3 }]);
    for (let i = 0; i < 200 && counterOf(g, 'watched:lunge') === 0; i++) g.tick();
    expect(counterOf(g, 'watched:lunge')).toBe(1);
    expect(texts(g)).toContain('🗡 The Hobgoblin moves into Test Lunge.');
    expect(texts(g).some((t) => /The Hobgoblin (hits|CRITS) you for \d+ heat/.test(t))).toBe(true);
    const foe = frontEnemy(g);
    expect(foe.position).toBe('low');
    // The `lunge` entry is index 2 of its rotation.
    expect(foe.spent).toEqual({ 2: 1 });
    expect(foe.cooldowns![2]).toBeGreaterThan(0);
    // The entries of the kind that were not available fell through without a report.
    expect(g.skips().filter((s) => s.action === 'combat/rotation')).toEqual([]);
    expect(slice<{ held: Record<string, { id: string }[]> }>(g, 'statuses').held.player?.some((h) => h.id === 'on_fire')).toBe(true);
  });

  it('a monster working replaces the swing and is not dodged', () => {
    let performed = 0;
    registerMonsterAction('cast', {
      available: () => true,
      perform: (ctx, enemy, _entry, index) => {
        performed++;
        ctx.request(hitPlayer, { amount: 7, type: 'heat', source: { key: `monster:${enemy.defId}`, label: enemy.name, icon: enemy.icon } });
        ctx.request(stampAction, { entity: enemy.entity, index, cooldown: 100 });
      },
    });
    const g = sturdy(makeGame({ seed: 22 }));
    // Certain dodge: a blow would never land.
    setMods(g, [statMod('maxHp', 'add', 1e6), statMod('dodge', 'add', 5)]);
    stage(g, [{ monsterId: 'goblin_firetongue', level: 3 }]);
    const before = hpOf(g);
    for (let i = 0; i < 60 && performed === 0; i++) g.tick();
    expect(performed).toBe(1);
    // 7 lost, less the health trickle of the ticks since.
    expect(before - hpOf(g)).toBeGreaterThan(5);
    expect(before - hpOf(g)).toBeLessThanOrEqual(7);
    const foe = frontEnemy(g);
    expect(foe.spent).toEqual({ 0: 1 });
    expect(combatOf(g).ledger!.incoming[0]).toMatchObject({ key: 'monster:goblin_firetongue', amount: 7 });
  });

  it('a player active shapes the swing and is put on cooldown', () => {
    registerPlayerAction('technique:', {
      known: () => ['technique:test_cut'],
      pick: (_ctx, id, slot) =>
        slot === 'attack'
          ? { id, cooldown: 500, usesHands: true, shape: { label: '🗡 Test Cut strikes', hitLabel: 'Test Cut', damageMult: 2, to: 'low' } }
          : null,
    });
    const g = sturdy(makeGame({ seed: 23 }));
    equip(g, 1);
    stage(g, [{ monsterId: 'training_dummy', level: 1 }]);
    for (let i = 0; i < 100 && counterOf(g, 'combat:attacks') === 0; i++) g.tick();
    const line = feedOf(g).find((l) => l.text.includes('Test Cut strikes the Training Dummy'))!;
    expect(line).toBeDefined();
    expect(line.damage!.steps).toContainEqual({ label: 'Test Cut', mult: 2 });
    expect(combatOf(g).fight!.cooldowns['technique:test_cut']).toBeGreaterThan(400);
    expect(combatOf(g).fight!.position).toBe('low');
    // On cooldown, the next swing is plain and recovers to neutral.
    for (let i = 0; i < 100 && counterOf(g, 'combat:attacks') < 2; i++) g.tick();
    expect(texts(g).some((t) => t.startsWith('⚔️ You hit the Training Dummy'))).toBe(true);
    expect(combatOf(g).fight!.position).toBe('neutral');
  });

  it('a player working takes the place of the swing and lands through combat/damage-enemy', () => {
    registerPlayerAction('grimoire:', {
      known: () => [],
      pick: (_ctx, id, slot, fight) =>
        slot === 'attack'
          ? {
              id,
              cooldown: 20,
              usesHands: false,
              sure: true,
              approach: 'heat',
              cast: (ctx) => {
                ctx.request(damageEnemy, {
                  entity: fight.enemies[0]!.entity,
                  strikes: [{ type: 'heat', raw: 1e9 }],
                  source: 'Test Bolt',
                });
              },
            }
          : null,
    });
    const g = sturdy(makeGame({ seed: 24 }));
    const seen = events(g);
    g.dispatch(setRotation({ order: ['grimoire:1'] }));
    stage(g, [
      { monsterId: 'forest_rat', level: 1 },
      { monsterId: 'forest_rat', level: 1 },
    ]);
    for (let i = 0; i < 100 && seen.every((e) => e.type !== enemyKilled.type); i++) g.tick();
    // The tick swept the dead and a flanker stepped forward.
    expect(seen.filter((e) => e.type === enemyKilled.type)).toHaveLength(1);
    expect((seen.find((e) => e.type === enemyKilled.type)!.payload as { lastHit: string }).lastHit).toBe('heat');
    expect(combatOf(g).fight!.enemies[0]).not.toBeNull();
    expect(texts(g).some((t) => t.includes('steps forward!'))).toBe(true);
  });

  it('an id in the rotation whose kind nobody registered is reported once and the swing is plain', () => {
    const g = sturdy(makeGame({ seed: 25 }));
    equip(g, 1);
    g.dispatch(setRotation({ order: ['technique:unknown_cut'] }));
    stage(g, [{ monsterId: 'training_dummy', level: 1 }]);
    for (let i = 0; i < 200; i++) g.tick();
    expect(g.skips().filter((s) => s.action === 'combat/rotation').map((s) => s.reason)).toEqual([
      'player entry "technique:unknown_cut": no system has registered the action kind "technique:"',
    ]);
    expect(counterOf(g, 'combat:attacks')).toBeGreaterThan(1);
  });
});

describe('commands, requests and the view', () => {
  it('refuses a site that names an unknown monster, and a stop with nothing to stop', () => {
    const g = makeGame();
    expect(g.dispatch(hunt({ site: { id: 'x', name: 'X', encounters: [{ monsterId: 'no_such', weight: 1, level: [1, 1] }] } }))).toEqual({
      ok: false,
      reason: 'the site names the unknown monster "no_such"',
    });
    expect(g.dispatch(stopHunt())).toEqual({ ok: false, reason: 'no hunt is on and no fight is open' });
  });

  it('combat/damage-enemy answers null for an entity that is not in the fight, with a reason', () => {
    const g = makeGame();
    expect(ask(g, damageEnemy, { entity: 'm999', strikes: [{ type: 'heat', raw: 5 }], source: 'test' })).toBeNull();
    expect(g.skips().some((s) => s.action === 'combat/damage-enemy' && s.reason.includes('m999'))).toBe(true);
  });

  it('combat/damage-enemy lands every slice through the target and reports the kill without sweeping', () => {
    const g = makeGame({ seed: 26 });
    const [foe] = stage(g, [{ monsterId: 'filing_automaton', level: 4 }]);
    const stats = enemyStats(g, foe);
    const result = ask(g, damageEnemy, {
      entity: foe.entity,
      strikes: [
        { type: 'lightning', raw: 10 },
        { type: 'slashing', raw: 10 },
      ],
      source: 'Test',
    })!;
    // Lightning: weak by 0.5, no armour. Slashing: armour first, then 0.2 resisted.
    expect(result.slices[0].dealt).toBeCloseTo(15, 6);
    expect(result.slices[1].dealt).toBeCloseTo((10 - stats.armor) * 0.8, 6);
    expect(result.dealt).toBe(Math.round(result.slices[0].dealt + result.slices[1].dealt));
    expect(result.killed).toBe(false);
    expect(frontEnemy(g).hp).toBe(foe.hp - result.dealt);
    expect(frontEnemy(g).lastHit).toBe('lightning');
    const dead = ask(g, damageEnemy, { entity: foe.entity, strikes: [{ type: 'lightning', raw: 1e6 }], source: 'Test' })!;
    expect(dead.killed).toBe(true);
    // Still in its slot until the tick sweeps.
    expect(combatOf(g).fight!.enemies[0]!.hp).toBeLessThanOrEqual(0);
    g.tick();
    expect(combatOf(g).fight).toBeNull();
    expect(combatOf(g).lastFight?.outcome).toBe('won');
  });

  it('the view always has five enemy slots, in a fight and out of one', () => {
    const g = makeGame({ seed: 27 });
    const view = () => g.view().systems.combat as CombatView;
    expect(view().enemies).toEqual([null, null, null, null, null]);
    expect(view().inFight).toBe(false);
    stage(g, [
      { monsterId: 'forest_rat', level: 2 },
      { monsterId: 'goblin', level: 2 },
    ]);
    g.tick(3);
    const v = view();
    expect(v.enemies).toHaveLength(5);
    expect(v.enemies.filter(Boolean)).toHaveLength(2);
    expect(v.enemies[0]).toMatchObject({ name: 'Forest Rat', level: 2 });
    expect(v.enemies[0]!.maxHp).toBeGreaterThanOrEqual(v.enemies[0]!.hp);
    expect(v.enemies[0]!.bar).toBeGreaterThan(0);
    expect(v.playerBar).toBeGreaterThan(0);
    expect(v.forced).toBe(true);
  });
});

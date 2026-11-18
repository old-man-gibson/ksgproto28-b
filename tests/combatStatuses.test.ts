/**
 * The cases earlier ports left as `it.todo` tagged "port 4", under their old
 * names. Each `describe` names the old test file the cases come from. The
 * `it.todo` lines in the new copies of those files were replaced by a
 * pointer to this file.
 *
 * Call shape changes: a monster is a live enemy of a staged fight (its
 * entity id is its handle); its conditions are in the `statuses` slice; a
 * condition is put on with the `statuses/apply` request.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import type { AttributesState } from '../src/systems/attributes';
import { enemyKilled, incomingSlice, monsterSlice, setStyle, type Enemy } from '../src/systems/combat';
import { MONSTER_LIST, MONSTERS, type MonsterDef } from '../src/systems/monsters';
import type { ResourcesState } from '../src/systems/resources';
import type { SkillsState } from '../src/systems/skills';
import { PARRY_RIPOSTE, RES_STAT_BY_TYPE, type DamageType } from '../src/systems/stats';
import {
  APPLICATION_FLOOR,
  applyStatus,
  hasStatus,
  resistBlock,
  statusBlocks,
  STATUSES,
  tickStatuses,
  type StatusDef,
  type StatusesState,
} from '../src/systems/statuses';
import {
  combatOf,
  enemyStats,
  feedOf,
  frontEnemy,
  huntingGame,
  patchFight,
  playerStats,
  setHp,
  stage,
} from './combatHelpers';
import { ask, emit, equip, giveItem, makeGame, patch, slice } from './helpers';

const held = (g: Kernel, entity = 'player') => slice<StatusesState>(g, 'statuses').held[entity] ?? [];
const give = (g: Kernel, entity: string, id: string, intensity = 1) =>
  ask(g, applyStatus, { entity, app: { id, intensity }, source: 'test', resist: true });

/** Put a condition on directly, with no dose and no resistance. The old tests pushed onto `m.statuses`. */
function put(g: Kernel, entity: string, id: string): void {
  patch(g, (slices) => {
    const all = (slices.statuses as StatusesState).held;
    (all[entity] ??= []).push({ id, intensity: 1, peak: 1, stacks: 1, ticksLeft: null, data: {} });
  });
}

function withStatuses(extra: Record<string, StatusDef>, body: () => void): void {
  Object.assign(STATUSES, extra);
  try {
    body();
  } finally {
    for (const id of Object.keys(extra)) delete (STATUSES as Record<string, StatusDef>)[id];
  }
}

function withSpecies(def: MonsterDef, body: () => void): void {
  MONSTERS[def.id] = def;
  try {
    body();
  } finally {
    delete MONSTERS[def.id];
  }
}

const aStatus = (change: Partial<StatusDef>): StatusDef =>
  ({
    id: 'test_status',
    name: 'Test Status',
    icon: '🧪',
    desc: 'Test-only.',
    stacking: { mode: 'highest' },
    duration: 600,
    ...change,
  }) as StatusDef;

/** A live specimen of a species, alone in a staged fight. The old `monsterOf`. */
function monsterOf(g: Kernel, defId: string, level = 1): Enemy {
  return stage(g, [{ monsterId: defId, level }])[0];
}

/** Get into a real fight and hand back the kernel. The old `fighting`. */
function fighting(seed = 7, site = 'woods_edge'): Kernel {
  const g = huntingGame(seed, site);
  for (let i = 0; i < 3000 && !combatOf(g).fight; i++) g.tick();
  expect(combatOf(g).fight).not.toBeNull();
  return g;
}

describe('statuses.test.ts: conditions a body wears', () => {
  it('a monster wears what it IS from the moment it spawns', () => {
    // `wears` has no content using it, and the mechanism is what is under
    // test: borrow a rat and put it back.
    const def = MONSTERS.forest_rat;
    expect(def.wears).toBeUndefined();
    def.wears = [{ id: 'fasting' }];
    try {
      const g = makeGame();
      const m = monsterOf(g, 'forest_rat');
      expect(hasStatus(held(g, m.entity), 'fasting')).toBe(true);
      // The gate reads the same on a monster as on the player.
      expect(statusBlocks(held(g, m.entity), 'swing')).toBe(true);
      expect(statusBlocks(held(g, m.entity), 'spell')).toBe(false);
    } finally {
      delete def.wears;
    }
  });
});

describe('statuses.test.ts: afflictions in a real fight', () => {
  it('fighting things that burn you leaves you burning', () => {
    const g = huntingGame(11, 'malgeri_base');
    patch(g, (slices) => {
      (slices.attributes as AttributesState).attrs.con.level = 60;
      (slices.resources as ResourcesState).values.hp = 5000;
    });

    let sawStatus = false;
    for (let i = 0; i < 3000 && !sawStatus; i++) {
      g.tick();
      if (held(g).length > 0) sawStatus = true;
    }
    expect(sawStatus).toBe(true);
  });
});

describe('statuses.test.ts: the action bar is not the player’s alone', () => {
  it('a shocked enemy runs its bar backwards instead of filling it', () => {
    const g = fighting();
    patchFight(g, (state) => {
      state.fight!.enemies[0]!.bar = 30;
    });
    give(g, frontEnemy(g).entity, 'shocked');
    const before = frontEnemy(g).bar;
    g.tick();
    expect(frontEnemy(g).bar).toBeLessThan(before);
  });

  it('and a shock finally has a way OFF an enemy short of the fight ending', () => {
    // `barDeplete` is one of the two exits of shocked.
    const g = fighting();
    const e = frontEnemy(g);
    give(g, e.entity, 'shocked');
    patchFight(g, (state) => {
      state.fight!.enemies[0]!.bar = 0.01;
    });
    for (let i = 0; i < 10 && combatOf(g).fight && hasStatus(held(g, e.entity), 'shocked'); i++) g.tick();
    expect(combatOf(g).fight, 'the fight must still be live, or combatEnd did it').toBeTruthy();
    expect(hasStatus(held(g, e.entity), 'shocked')).toBe(false);
  });
});

describe('statuses.test.ts: every ending of a fight fires combatEnd', () => {
  it('being knocked out sheds conditions the action bar was the only cure for', () => {
    const g = fighting(13, 'ravine_floor');
    // Both are timerless: a daze is worn off one swing at a time, a shock
    // when the bar it runs backwards empties.
    for (let i = 0; i < 8; i++) ask(g, applyStatus, { entity: 'player', app: { id: 'dazed', intensity: 1 } });
    ask(g, applyStatus, { entity: 'player', app: { id: 'shocked', intensity: 1 } });
    patchFight(g, (state) => {
      state.fight!.playerBar = 1000; // a long way to reverse: it will not empty first
    });
    setHp(g, 1); // the next thing that lands finishes it

    for (let i = 0; i < 500 && combatOf(g).fight; i++) g.tick();
    expect(combatOf(g).lastFight?.outcome).toBe('knocked_out');
    expect(hasStatus(held(g), 'dazed')).toBe(false);
    expect(hasStatus(held(g), 'shocked')).toBe(false);
  });

  it('winning does the same — a daze you never worked off does not follow you out', () => {
    const g = fighting(21, 'woods_edge');
    const enemy = frontEnemy(g);
    // Dazed blocks the swings, so the poison is what wins this one.
    for (let i = 0; i < 8; i++) ask(g, applyStatus, { entity: 'player', app: { id: 'dazed', intensity: 1 } });
    ask(g, applyStatus, { entity: enemy.entity, app: { id: 'poison', intensity: 40 } });

    for (let i = 0; i < 500 && combatOf(g).fight; i++) g.tick();
    expect(combatOf(g).lastFight?.outcome).toBe('won');
    expect(hasStatus(held(g), 'dazed')).toBe(false);
  });
});

describe('statuses.test.ts: the fight ledger after a knockout', () => {
  it('it does not overwrite the summary of the fight that actually felled you', () => {
    // Knocked out with something corrosive still running.
    const g = fighting(3, 'ravine_floor');
    ask(g, applyStatus, { entity: 'player', app: { id: 'rotting', intensity: 3 } });
    setHp(g, 1);
    for (let i = 0; i < 500 && combatOf(g).fight; i++) g.tick();
    const real = combatOf(g).lastFight;
    expect(real?.outcome).toBe('knocked_out');
    expect(real!.foes.length).toBeGreaterThan(0); // the thing that won

    // The rot bills itself to a new tally outside a fight, which is never
    // promoted over the encounter that ended in the knockout.
    g.tick(300);
    expect(combatOf(g).lastFight).toEqual(real);
    expect(combatOf(g).lastFight!.foes.length).toBeGreaterThan(0);
  });
});

describe('statuses.test.ts: a monster hears the type it was actually hit with', () => {
  it('never reports a slice key as a damage type', () => {
    const g = huntingGame(12, 'woods_edge');
    const seen = new Set<string>();
    for (let i = 0; i < 1200; i++) {
      g.tick();
      const all = slice<StatusesState>(g, 'statuses').held;
      for (const e of combatOf(g).fight?.enemies ?? []) {
        for (const s of (e && all[e.entity]) || []) {
          for (const key of Object.keys(s.data ?? {})) seen.add(key);
        }
      }
    }
    for (const key of seen) expect(key).not.toContain('|');
    expect(RES_STAT_BY_TYPE['cold|Frost Bolt' as never]).toBeUndefined();
  });
});

describe('statuses.test.ts: conditions are resisted on application', () => {
  it('every species that declares resistance 1 or more is immune to that element’s conditions', () => {
    const g = makeGame({ seed: 46 });
    const pairs: string[] = [];
    for (const def of MONSTER_LIST) {
      for (const [type, res] of Object.entries(def.resistances ?? {})) {
        if ((res ?? 0) < 1) continue;
        pairs.push(`${def.id}:${type}`);
        for (const cond of Object.values(STATUSES).filter((s) => s.element === type)) {
          const m = monsterOf(g, def.id);
          expect(give(g, m.entity, cond.id), `${def.id} ${cond.id}`).toBeNull();
        }
      }
    }
    expect(pairs).toContain('death_knight:poison');
  });

  it('a species whose TAGS give it resistance 1 is immune with nothing declared', () => {
    // Lightning-tagged slimes resist lightning 0.7 at basic plus 0.1 per
    // tier step, which is 1.0 at ancient.
    const storm = (id: string, tier: MonsterDef['tier']): MonsterDef => ({
      ...MONSTERS.slime_thunder_elite,
      id,
      tier,
      resistances: undefined,
    });
    withSpecies(storm('test_storm_ancient', 'ancient'), () => {
      withSpecies(storm('test_storm_elite', 'elite'), () => {
        const g = makeGame({ seed: 52 });
        const ancient = monsterOf(g, 'test_storm_ancient');
        expect(enemyStats(g, ancient).resLightning).toBeCloseTo(0.9); // the damage clamp
        expect(give(g, ancient.entity, 'jolted')).toBeNull();
        // One tier down it is 0.9: the floor, not a wall.
        const elite = monsterOf(g, 'test_storm_elite');
        expect(give(g, elite.entity, 'jolted')!.intensity).toBeCloseTo(APPLICATION_FLOOR);
      });
    });
  });
});

describe('conditionResist.test.ts: a condition’s damage ticks shed what a blow of the same type would', () => {
  const plain = (id: string, change: Partial<MonsterDef> = {}): MonsterDef => ({
    ...MONSTERS.goblin,
    id,
    tags: [],
    resistances: undefined,
    ...change,
  });
  /** What one tick of a held condition deals, by condition. */
  const tickOf = (g: Kernel, m: Enemy, id: string) =>
    ask(g, tickStatuses, { entity: m.entity, hp: 100, maxHp: 100, inCombat: true }).hits.find((h) => h.id === id)
      ?.amount ?? 0;

  it('a monster’s resistance comes from its tags, not only from what its def declares', () => {
    withSpecies(plain('test_slime', { tags: ['slime'] }), () => {
      withSpecies(plain('test_bare'), () => {
        const g = makeGame({ seed: 30 });
        const slime = monsterOf(g, 'test_slime');
        expect(enemyStats(g, slime).resSlashing).toBeCloseTo(0.5);
        put(g, slime.entity, 'bleeding');
        // 0.08 flat + 0.15 of 100 current HP = 0.23 a tick, before resistance.
        expect(tickOf(g, slime, 'bleeding')).toBeCloseTo(0.115, 8);
        const bare = monsterOf(g, 'test_bare');
        put(g, bare.entity, 'bleeding');
        expect(tickOf(g, bare, 'bleeding')).toBeCloseTo(0.23, 8);
      });
    });
  });

  it('elemental resistance counts for the elemental types, as it does for a blow', () => {
    const hardened = aStatus({ id: 'test_hardened', mods: [{ stat: 'resElemental', op: 'add', value: 0.4 }] });
    withStatuses({ test_hardened: hardened }, () => {
      withSpecies(plain('test_bare', { resistances: { poison: 0.2, slashing: 0.2 } }), () => {
        const g = makeGame({ seed: 31 });
        const m = monsterOf(g, 'test_bare');
        put(g, m.entity, 'poison');
        put(g, m.entity, 'bleeding');
        expect(tickOf(g, m, 'poison')).toBeCloseTo(0.05 * 0.8, 8);
        expect(tickOf(g, m, 'bleeding')).toBeCloseTo(0.23 * 0.8, 8);
        put(g, m.entity, 'test_hardened');
        // Poison is elemental: 0.2 + 0.4. Slashing is not.
        expect(tickOf(g, m, 'poison')).toBeCloseTo(0.05 * 0.4, 8);
        expect(tickOf(g, m, 'bleeding')).toBeCloseTo(0.23 * 0.8, 8);
      });
    });
  });

  it('is the figure monsterSlice stacks, for every type and a spread of bodies', () => {
    const hardened = aStatus({ id: 'test_hardened', mods: [{ stat: 'resElemental', op: 'add', value: 0.3 }] });
    withStatuses({ test_hardened: hardened }, () => {
      const g = makeGame({ seed: 32 });
      for (const defId of ['goblin', 'slime_golem', 'death_knight', 'slime_fire', 'slime_ice_basic', 'forest_rat']) {
        const m = monsterOf(g, defId);
        for (const wearing of [false, true]) {
          if (wearing) ask(g, applyStatus, { entity: m.entity, app: { id: 'test_hardened', intensity: 1 }, source: 'test' });
          const stats = enemyStats(g, m);
          // The figure a condition's ticks read for a monster.
          const block = resistBlock(stats);
          for (const type of Object.keys(RES_STAT_BY_TYPE) as DamageType[]) {
            expect(block[type], `${defId}/${type}/${wearing}`).toBeCloseTo(
              monsterSlice(stats, type, 'test', 100).resistance,
              10,
            );
          }
        }
      }
    });
  });

  it('is the figure incomingSlice stacks for the real player, every type', () => {
    const warding = aStatus({
      id: 'test_warding',
      mods: [
        { stat: 'resPoison', op: 'add', value: 0.5 },
        { stat: 'resSlashing', op: 'add', value: 0.3 },
        { stat: 'resElemental', op: 'add', value: 0.4 },
      ],
    });
    withStatuses({ test_warding: warding }, () => {
      const g = makeGame({ seed: 33 });
      ask(g, applyStatus, { entity: 'player', app: { id: 'test_warding', intensity: 1 }, source: 'test' });
      const stats = playerStats(g);
      const block = resistBlock(stats);
      for (const type of Object.keys(RES_STAT_BY_TYPE) as DamageType[]) {
        expect(block[type], type).toBeCloseTo(incomingSlice(stats, type, 'test', 100).resistance, 10);
      }
      // 0.5 + 0.4 would be 0.9; the cap holds it at 0.75, as it does a blow.
      expect(block.poison).toBeCloseTo(0.75);
    });
  });
});

describe('loot.test.ts (old desert.test.ts): the killing blow', () => {
  it('damage over time sets lastHit to its type', () => {
    for (const [status, type] of [
      ['poison', 'poison'],
      ['on_fire', 'heat'],
    ] as const) {
      const g = makeGame({ seed: 18 });
      let last: string | null = null;
      g.onEvent((event) => {
        if (event.type === enemyKilled.type) last = (event.payload as { lastHit: string | null }).lastHit;
      });
      // The old test stood on floor 18 and won by a condition. Dazed blocks
      // the player's swings here, so the condition is what kills.
      const [foe] = stage(g, [{ monsterId: 'ph_sand_colossus', level: 1, hpShare: 0.01 }]);
      for (let i = 0; i < 8; i++) ask(g, applyStatus, { entity: 'player', app: { id: 'dazed', intensity: 1 } });
      ask(g, applyStatus, { entity: foe.entity, app: { id: status, intensity: 40 } });
      for (let i = 0; i < 600 && combatOf(g).fight; i++) g.tick();
      expect(combatOf(g).lastFight?.outcome, status).toBe('won');
      expect(last, status).toBe(type);
    }
  });
});

describe('wield.test.ts: parrying in a fight', () => {
  it('turns blows aside and answers them, without spending the action bar', () => {
    // The dummies swing for as long as the test runs, which is the only way
    // to see a 12% chance often enough.
    const g = fighter(7);
    equip(g, giveItem(g, 'rapier').uid);
    equip(g, giveItem(g, 'parrying_dagger').uid);
    expect(playerStats(g).parry).toBeCloseTo(0.12);
    const g2 = huntingGameWith(g, 'training_grounds');

    let parries = 0;
    let barAtParry: number | null = null;
    for (let i = 0; i < 2000; i++) {
      const before = combatOf(g2).fight?.playerBar ?? 0;
      const seen = new Set(feedOf(g2).map((l) => l.text));
      const parriedBefore = [...seen].filter((t) => t.includes('You parry')).length;
      g2.tick();
      const parriedAfter = feedOf(g2).filter((l) => l.text.includes('You parry')).length;
      if (parriedAfter > parriedBefore) {
        parries++;
        // The riposte costs no progress: the bar only moved forward.
        if (barAtParry === null && (combatOf(g2).fight?.playerBar ?? 0) >= before) barAtParry = before;
      }
    }
    expect(parries).toBeGreaterThan(0);
    expect(barAtParry).not.toBeNull();
    // Riposte damage is a fraction of a real swing.
    expect(PARRY_RIPOSTE).toBeLessThan(1);
    // 2,000 ticks with a scan of the feed each: 2.3 s alone, 5.1 s inside the
    // parallel unit run after the martial port (the styles tick). Not a budget.
  }, 15_000);
});

describe('wield.test.ts: the parry line', () => {
  it('Deflection manifests from fighting with a parrying tool — any stance', () => {
    const g = fighter(25);
    patch(g, (slices) => {
      (slices.skills as SkillsState).skills.fighting = { level: 10, xp: 0 };
      (slices.resources as ResourcesState).values.hp = 4000;
    });
    equip(g, giveItem(g, 'iron_sword').uid);
    equip(g, giveItem(g, 'parrying_dagger').uid, 'offhand');
    // Deliberately not a defensive stance. The styles system is not ported;
    // this is the event it will send.
    emit(g, setStyle, { id: 'aggressive' });
    const g2 = huntingGameWith(g, 'woods_edge');

    for (let i = 0; i < 3000 && !slice<SkillsState>(g2, 'skills').skills.deflection; i++) {
      g2.tick();
      if (!combatOf(g2).hunting && !combatOf(g2).fight) huntingGameWith(g2, 'woods_edge');
    }
    expect(slice<SkillsState>(g2, 'skills').skills.deflection).toBeDefined();
  });

  // The Bolognese case of this group stays an `it.todo` in `tests/wield.test.ts` (styles).
});

import { hunt } from '../src/systems/combat';
import { SITES } from './combatHelpers';

/** A character who meets the requirements of the gear these cases use. The `fighter` of `wield.test.ts`. */
function fighter(seed: number): Kernel {
  const g = makeGame({ seed });
  patch(g, (slices) => {
    const attrs = (slices.attributes as AttributesState).attrs;
    attrs.str.level = 25;
    attrs.dex.level = 25;
    attrs.con.level = 25;
    (slices.items as { inventory: unknown[] }).inventory = [];
  });
  return g;
}

/** Send the hunt on a kernel that is already set up. */
function huntingGameWith(g: Kernel, site: string): Kernel {
  const result = g.dispatch(hunt({ site: SITES[site] }));
  if (!result.ok) throw new Error(result.reason);
  return g;
}

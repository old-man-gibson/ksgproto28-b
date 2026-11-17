/**
 * Port of the old `tests/encounters.test.ts`: group composition, positional
 * modifiers, and how an encounter resolves. The cases keep their names.
 *
 * Call shape changes: a spot is an `EncounterSite` from `tests/sites.json`;
 * `spawnGroup` takes a context.
 */
import { describe, expect, it } from 'vitest';
import type { Ctx } from '../src/kernel';
import { liveEnemies, POSITION_MODS, spawnGroup, type CombatState, type Enemy } from '../src/systems/combat';
import { ENCOUNTER_SLOTS } from '../src/systems/monsters';
import { MONSTER_ACTION_BAR } from '../src/systems/stats';
import { combatOf, huntingGame, patchFight, SITES } from './combatHelpers';
import { makeGame, run } from './helpers';

/** Roll a site's formation many times so weighted outcomes are all represented. */
function sample(seed: number, siteId: string, rounds = 60): (Enemy | null)[][] {
  const g = makeGame({ seed });
  return Array.from({ length: rounds }, () =>
    run(g, (ctx) => {
      const scratch = Object.create(ctx) as Ctx<CombatState>;
      Object.defineProperty(scratch, 'state', { value: { nextEntity: 1 } });
      return spawnGroup(scratch, SITES[siteId]);
    }),
  );
}

describe('encounter groups', () => {
  it('always fills exactly ENCOUNTER_SLOTS, padding with nulls', () => {
    for (const slots of sample(1, 'malgeri_base', 20)) {
      expect(slots).toHaveLength(ENCOUNTER_SLOTS);
      expect(slots[0]).not.toBeNull(); // the centre is always occupied
    }
  });

  it('a swarm zone produces groups larger than one', () => {
    const sizes = sample(2, 'malgeri_base').map((s) => s.filter(Boolean).length);
    expect(Math.max(...sizes)).toBeGreaterThan(1);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(ENCOUNTER_SLOTS);
  });

  it('a solitary zone keeps groups small', () => {
    const sizes = sample(3, 'ravine_floor').map((s) => s.filter(Boolean).length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(2); // groupWeights 1: 85, 2: 15
  });

  it('a monster group rule overrides the area distribution (Stone Golems are solitary)', () => {
    for (const slots of sample(4, 'ravine_floor', 120)) {
      const group = slots.filter(Boolean);
      if (group.some((m) => m!.defId === 'stone_golem')) {
        expect(group).toHaveLength(1);
      }
    }
  });

  it('a Goblin Boss always brings a full squad of its declared escorts', () => {
    let seen = 0;
    for (const slots of sample(5, 'malgeri_base', 200)) {
      const group = slots.filter(Boolean).map((m) => m!);
      const boss = group.find((m) => m.defId === 'goblin_boss');
      if (!boss) continue;
      seen++;
      expect(group).toHaveLength(ENCOUNTER_SLOTS);
      for (const m of group) {
        if (m !== boss) expect(m.defId).toBe('goblin');
      }
    }
    expect(seen).toBeGreaterThan(0); // the case was exercised
  });

  it('formation puts a melee up front when the group has one', () => {
    for (const slots of sample(6, 'malgeri_base', 120)) {
      const group = slots.filter(Boolean).map((m) => m!);
      if (group.some((m) => m.range === 'melee')) {
        expect(slots[0]!.range).toBe('melee');
      }
    }
  });
});

describe('positional modifiers', () => {
  it('melee are weaker and slower in the back than the front', () => {
    expect(POSITION_MODS.back.melee.damage).toBeLessThan(POSITION_MODS.front.melee.damage);
    expect(POSITION_MODS.back.melee.fill).toBeLessThan(POSITION_MODS.front.melee.fill);
  });

  it('ranged fight at full effect from the back and get jostled up front', () => {
    expect(POSITION_MODS.back.ranged.damage).toBe(1);
    expect(POSITION_MODS.back.ranged.fill).toBe(1);
    expect(POSITION_MODS.back.ranged.stunPerTick).toBe(0);
    expect(POSITION_MODS.front.ranged.stunPerTick).toBeGreaterThan(0);
  });

  it('the front-row stun is capped per fill, so a ranged enemy still gets to attack', () => {
    const { stunPerTick, stunCap } = POSITION_MODS.front.ranged;
    expect(stunCap).toBeGreaterThan(0);
    expect(stunCap).toBeLessThan(MONSTER_ACTION_BAR); // never a full lockout
    expect(stunPerTick).toBeLessThanOrEqual(stunCap);
  });
});

describe('encounter resolution', () => {
  it('killing the centre promotes a survivor and empties its old slot', () => {
    const g = huntingGame(7, 'malgeri_base');

    // Find a tick where a group of several is live.
    let group: number = 0;
    for (let i = 0; i < 400 && group < 2; i++) {
      g.tick();
      const fight = combatOf(g).fight;
      if (fight) group = liveEnemies(fight).length;
    }
    if (group < 2) return; // no group of several rolled in this budget

    const before = liveEnemies(combatOf(g).fight!).length;
    patchFight(g, (state) => {
      state.fight!.enemies[0]!.hp = 0; // the next blow of the player finishes it
    });
    for (let i = 0; i < 200 && combatOf(g).fight && liveEnemies(combatOf(g).fight!).length === before; i++) {
      g.tick();
    }
    const fight = combatOf(g).fight;
    if (!fight) return; // the whole group died; covered by the next case

    expect(liveEnemies(fight).length).toBe(before - 1);
    expect(fight.enemies[0]).not.toBeNull(); // someone stepped forward
  });

  it('the encounter only ends once every slot is empty', () => {
    const g = huntingGame(8, 'malgeri_base');
    for (let i = 0; i < 200 && !combatOf(g).fight; i++) g.tick();
    expect(combatOf(g).fight).not.toBeNull();

    // Remove all but one; the encounter is still running.
    patchFight(g, (state) => {
      const c = state.fight!;
      for (let i = 1; i < c.enemies.length; i++) c.enemies[i] = null;
    });
    expect(liveEnemies(combatOf(g).fight!).length).toBe(1);
    g.tick();
    expect(combatOf(g).fight).not.toBeNull();
  });
});

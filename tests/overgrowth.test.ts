/**
 * Port of two cases of the old tests/conditionResist.test.ts: overgrowth
 * through forced healing, on a poison-resistant monster and on a monster at
 * 100% poison resistance. They waited for `healEnemy` (spine port 5:
 * request `combat/heal-enemy`).
 *
 * Changed: the call shape. The monster is the enemy of a staged fight, its
 * conditions are in the `statuses` slice, its poison figure is read with
 * `resistBlock` over its stat block, and the healing is the request.
 *
 * Left as `it.todo`: nothing. The other cases of the old describe are in
 * tests/conditionResist.test.ts. The describe 'healing enemies into
 * overgrowth' of the old spellcraft.test.ts is ported in
 * tests/spellcraft.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import { healEnemy, type Enemy } from '../src/systems/combat';
import { MONSTERS, type MonsterDef } from '../src/systems/monsters';
import {
  APPLICATION_FLOOR,
  applyStatus,
  hasStatus,
  heldOf,
  resistBlock,
  type StatusesState,
} from '../src/systems/statuses';
import { combatOf, enemyStats, patchFight, stage } from './combatHelpers';
import { ask, makeGame, slice } from './helpers';

const held = (g: Kernel, e: Enemy) => heldOf(slice<StatusesState>(g, 'statuses'), e.entity);
const find = (g: Kernel, e: Enemy, id: string) => held(g, e).find((s) => s.id === id);
const front = (g: Kernel): Enemy => combatOf(g).fight!.enemies[0]!;

function withSpecies(def: MonsterDef, body: () => void): void {
  MONSTERS[def.id] = def;
  try {
    body();
  } finally {
    delete MONSTERS[def.id];
  }
}

describe('queasy, overgrowth and proliferating are resisted through poison', () => {
  /** A whole, living specimen alone in a staged fight, so forced healing has a target. The old `arena`. */
  function arena(defId: string): { g: Kernel; a: Enemy } {
    const g = makeGame({ seed: 14 });
    const a = stage(g, [{ monsterId: defId, level: 1 }])[0];
    expect(a.hp).toBe(enemyStats(g, a).maxHp);
    return { g, a };
  }

  /** Forced healing of the front enemy. The old `healEnemy(state, 0, amount, 'test', hostile, penetration)`. */
  const force = (g: Kernel, a: Enemy, amount: number, penetration?: number) =>
    ask(g, healEnemy, {
      entity: a.entity,
      amount,
      source: 'test',
      hostile: true,
      ...(penetration === undefined ? {} : { penetration }),
    });

  it('overgrowth lands thinned on a poison-resistant monster, and its escalation is not billed again', () => {
    const { g, a } = arena('goblin');
    // Steeped at intensity 2: poison resistance +0.5.
    ask(g, applyStatus, { entity: a.entity, app: { id: 'steeped', intensity: 2 }, source: 'test', resist: true });
    const res = resistBlock(enemyStats(g, a)).poison;
    expect(res).toBeGreaterThan(0.5);
    expect(res).toBeLessThan(0.9);
    const maxHp = enemyStats(g, a).maxHp;

    force(g, a, maxHp * 0.3);
    const swollen = find(g, a, 'overgrowth')!;
    expect(swollen.intensity).toBeCloseTo(1 - res, 8);

    // Past half its max HP in surplus it becomes proliferating. That is a
    // transformation, not a new dose: the intensity carries over untaxed
    // (a second tax would leave (1 - res) squared).
    force(g, a, maxHp * 0.3);
    expect(find(g, a, 'overgrowth')).toBeUndefined();
    const proliferating = find(g, a, 'proliferating')!;
    expect(proliferating.intensity).toBeCloseTo(1 - res, 8);
    expect(proliferating.data!.surplus).toBeCloseTo(maxHp * 0.6, 3);
  });

  it('a monster at 100% poison resistance cannot be overgrown, though forced healing still heals', () => {
    const wall: MonsterDef = { ...MONSTERS.goblin, id: 'test_poison_wall', resistances: { poison: 1 } };
    withSpecies(wall, () => {
      const { g, a } = arena('test_poison_wall');
      const maxHp = enemyStats(g, a).maxHp;
      patchFight(g, (state) => {
        state.fight!.enemies[0]!.hp = Math.round(maxHp / 2);
      });
      force(g, a, maxHp * 0.25);
      expect(front(g).hp).toBeGreaterThan(Math.round(maxHp / 2));
      expect(hasStatus(held(g, a), 'overgrowth')).toBe(false);
      // The caster's penetration opens the line, as it does for any condition.
      patchFight(g, (state) => {
        state.fight!.enemies[0]!.hp = maxHp;
      });
      force(g, a, maxHp * 0.25, 0.2);
      expect(find(g, a, 'overgrowth')!.intensity).toBeCloseTo(APPLICATION_FLOOR);
    });
  });
});

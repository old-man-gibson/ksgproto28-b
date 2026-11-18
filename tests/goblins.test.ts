/**
 * Port of the old `tests/goblins.test.ts` (9 cases): the goblin roster.
 * Hobgoblins whose techniques a player learns by watching, the firetongue,
 * and the witch doctor with its gods.
 *
 * Ported: the content cases, a hobgoblin's techniques bumping the watch
 * counters in a fight, and the witch doctor's Mud Poultice.
 *
 * Call shape changes:
 * - a fight the old case built by hand is `stage(kernel, members)`;
 * - `castMonsterWorking(state, bus, e, stats, source, index)` is
 *   `castMonsterWorking(ctx, e, source, index)` under `run`;
 * - `state.stats[watchStatKey(id)]` is `counterOf(kernel, watchStatKey(id))`;
 * - `checkTechniqueLearning` is the request `martial/check-learning`; a
 *   counter is written with `patch` so the check runs only when asked.
 *
 * Left as `it.todo`:
 * - step 3 (the divine port): `deityKnown`. The case that asserted it is split: its content
 *   half runs, the unlock half is an `it.todo`.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import type { AttributesState } from '../src/systems/attributes';
import type { Enemy } from '../src/systems/combat';
import { DEITIES, MIRACLES } from '../src/systems/divine';
import {
  checkLearning,
  learnRequest,
  MARTIAL_UNLOCK,
  TECHNIQUE_WATCH_COUNT,
  TECHNIQUES,
  techniqueForm,
  watchLearnProgress,
  watchStatKey,
  type MartialState,
} from '../src/systems/martial';
import type { CountersState } from '../src/systems/counters';
import { MONSTERS } from '../src/systems/monsters';
import type { SkillsState } from '../src/systems/skills';
import { castMonsterWorking } from '../src/systems/spellcraft';
import { combatOf, counterOf, hardenFoes, patchFight, playerStats, setHp, stage } from './combatHelpers';
import { ask, makeGame, patch, run, slice } from './helpers';


const fresh = (seed = 1): Kernel => makeGame({ seed });

/** Constitution 400 and full health, as the old cases set them: the character outlasts the run. */
function sturdy(kernel: Kernel): void {
  patch(kernel, (slices) => {
    (slices.attributes as AttributesState).attrs.con.level = 400;
  });
  setHp(kernel, playerStats(kernel).maxHp);
}

/** A fighter with the skill the goblin techniques are eligible for, the martial unlock open or shut. */
function fighter(open = true): Kernel {
  const g = fresh();
  patch(g, (slices) => {
    (slices.skills as SkillsState).skills.fighting = { level: 10, xp: 0 };
    if (open) slices.counters.counts[MARTIAL_UNLOCK] = 1;
  });
  return g;
}

/** Write a counter as the old cases wrote `state.stats`; the check runs only when asked. */
function setCount(kernel: Kernel, key: string, value: number): void {
  patch(kernel, (slices) => {
    slices.counters.counts[key] = value;
  });
}
const check = (kernel: Kernel): void => ask(kernel, checkLearning, undefined);
const known = (kernel: Kernel, id: string): boolean => !!slice<MartialState>(kernel, 'martial').techniques[id];

describe('learning a technique by watching it', () => {
  it('every watchable technique asks the one shared count', () => {
    for (const id of ['gather', 'lunge', 'heavy_blow', 'hamstring', 'dirty_stab', 'pocket_sand']) {
      expect(TECHNIQUES[id].learn?.watch, id).toBe(TECHNIQUE_WATCH_COUNT);
    }
    expect(TECHNIQUE_WATCH_COUNT).toBe(50);
  });

  it('50 sightings teach it, rough; 49 do not', () => {
    const g = fighter();
    setCount(g, watchStatKey('pocket_sand'), TECHNIQUE_WATCH_COUNT - 1);
    check(g);
    expect(known(g, 'pocket_sand')).toBe(false);
    setCount(g, watchStatKey('pocket_sand'), TECHNIQUE_WATCH_COUNT);
    check(g);
    expect(techniqueForm(slice<MartialState>(g, 'martial'), 'pocket_sand')).toBe('rough');
  });

  it('a shut martial shutter learns nothing, and keeps the count for when it opens', () => {
    const g = fighter(false);
    setCount(g, watchStatKey('pocket_sand'), TECHNIQUE_WATCH_COUNT);
    check(g);
    expect(known(g, 'pocket_sand')).toBe(false);
    setCount(g, MARTIAL_UNLOCK, 1);
    check(g);
    expect(known(g, 'pocket_sand')).toBe(true);
  });

  it('sightings before there is a way in count for nothing (reach)', () => {
    const g = fighter();
    // Hamstring starts coiled; with nothing that coils, it cannot be reached.
    setCount(g, watchStatKey('hamstring'), TECHNIQUE_WATCH_COUNT);
    check(g);
    expect(known(g, 'hamstring')).toBe(false);

    ask(g, learnRequest, { technique: 'gather', form: 'canonical' });
    check(g);
    const progress = () =>
      watchLearnProgress(slice<MartialState>(g, 'martial'), slice<CountersState>(g, 'counters'), TECHNIQUES.hamstring);
    expect(progress()).toBe(0);
    expect(known(g, 'hamstring')).toBe(false);

    setCount(g, watchStatKey('hamstring'), 2 * TECHNIQUE_WATCH_COUNT);
    check(g);
    expect(techniqueForm(slice<MartialState>(g, 'martial'), 'hamstring')).toBe('rough');
  });

  it("a hobgoblin's techniques count as sightings in a real fight", () => {
    const g = fighter();
    sturdy(g);
    stage(g, [{ monsterId: 'hobgoblin', level: 5 }]);
    hardenFoes(g); // the old case gave the hobgoblin constitution 1e5
    for (let i = 0; i < 3000 && combatOf(g).fight; i++) g.tick();
    const seen = ['gather', 'hamstring', 'lunge', 'dirty_stab', 'pocket_sand'].map((id) => counterOf(g, watchStatKey(id)));
    expect(seen.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});

describe('the witch doctor and its gods', () => {
  function pack(withAlly: boolean): { g: Kernel; doctor: Enemy; ally: Enemy | null } {
    const g = fresh(3);
    sturdy(g);
    const [doctor, ally] = stage(g, [
      { monsterId: 'goblin_witch_doctor', level: 5 },
      ...(withAlly ? [{ monsterId: 'goblin', level: 5 }] : []),
    ]);
    return { g, doctor, ally: ally ?? null };
  }

  const enemyOf = (g: Kernel, entity: string): Enemy | undefined =>
    combatOf(g).fight?.enemies.find((e): e is Enemy => e?.entity === entity);

  it('Mud Poultice mends the allies, not the caster', () => {
    const { g, doctor, ally } = pack(true);
    patchFight(g, (state) => {
      for (const e of state.fight!.enemies) if (e) e.hp = 1;
    });
    expect(enemyOf(g, ally!.entity)!.hp).toBe(1);
    run(g, (ctx) => castMonsterWorking(ctx, enemyOf(g, doctor.entity)!, { school: 'divine', litany: 'mud_poultice' }, 0));
    expect(enemyOf(g, ally!.entity)!.hp).toBeGreaterThan(1);
    expect(enemyOf(g, doctor.entity)!.hp).toBe(1);
  });

  it('alone, it never spends a turn on the poultice', () => {
    const { g, doctor } = pack(false);
    hardenFoes(g); // the old case gave the doctor constitution 1e5
    let last = enemyOf(g, doctor.entity)!;
    for (let i = 0; i < 1500 && combatOf(g).fight; i++) {
      g.tick();
      last = enemyOf(g, doctor.entity) ?? last;
    }
    expect(last.cooldowns?.[0]).toBeUndefined();
    expect(last.spent?.[0] ?? 0).toBe(0);
    expect(Object.keys(last.cooldowns ?? {}).length).toBeGreaterThan(0);
  });

  // Split: the old case also asserted `deityKnown(state, god) === false` for each god. That half is the todo below.
  it('fire, mud and the hunt each hold two miracles, and a new player knows none of them', () => {
    for (const god of ['goblin_fire', 'goblin_mud', 'goblin_hunt']) {
      expect(DEITIES[god].tags).toContain('goblin pantheon');
      expect(Object.values(MIRACLES).filter((m) => m.deity === god)).toHaveLength(2);
    }
  });

  it.todo('fire, mud and the hunt each hold two miracles, and a new player knows none of them: a new player knows none of the three gods (step 3: divine: deityKnown)');

  it('the casters speak only what exists', () => {
    for (const id of ['goblin_firetongue', 'goblin_witch_doctor']) {
      expect(MONSTERS[id].rotation?.length, id).toBeGreaterThan(0);
      for (const entry of MONSTERS[id].rotation ?? []) {
        if ('cast' in entry && entry.cast.school === 'divine') expect(MIRACLES[entry.cast.litany], id).toBeDefined();
      }
    }
  });
});

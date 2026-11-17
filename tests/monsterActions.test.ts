/**
 * Spine port 5: the six monsters of floors 4 to 6 use their rotations.
 *
 * Each is staged alone (the witch doctor with kin to tend) against a
 * character that cannot lose, and the fight is run until every entry of the
 * rotation has fired at least once. No skip line is logged for an
 * unregistered kind.
 */
import { describe, expect, it } from 'vitest';
import { PLAYER, type Kernel } from '../src/kernel';
import { actionSkipped, type Enemy } from '../src/systems/combat';
import { kitOf, MONSTERS } from '../src/systems/monsters';
import { specForSource, type SpellSource } from '../src/systems/spellcraft';
import { TECHNIQUES } from '../src/systems/martial';
import { combatOf, feedOf, patchFight, setHp, stage } from './combatHelpers';
import { clearStatuses } from '../src/systems/statuses';
import { ask, equip, makeGame, setMods } from './helpers';

/** The name the feed uses for a rotation entry. */
function entryName(entry: NonNullable<ReturnType<typeof kitOf>['rotation']>[number]): string {
  return 'cast' in entry ? specForSource(entry.cast as SpellSource).name : TECHNIQUES[entry.technique].name;
}

/** Run a staged fight, keeping both sides alive, until every rotation entry of the first enemy has fired or the tick limit is reached. */
function runUntilAllUsed(kernel: Kernel, monsterId: string, limit: number, entries: number): { spent: Record<number, number>; ticks: number } {
  let spent: Record<number, number> = {};
  let ticks = 0;
  for (; ticks < limit; ticks++) {
    kernel.tick();
    // A bleed takes a share of maximum health per tick: what the monster leaves on the player is cleared.
    if (ticks % 10 === 0) ask(kernel, clearStatuses, { entity: PLAYER });
    const fight = combatOf(kernel).fight;
    if (!fight) break;
    const e = fight.enemies.find((m): m is Enemy => m?.defId === monsterId);
    if (!e) break;
    spent = { ...(e.spent ?? {}) };
    if (Object.keys(spent).length === entries) break;
  }
  return { spent, ticks };
}

/** Ticks a case runs at most: five game minutes. */
const RUN_TICKS = 3000;

interface Case {
  id: string;
  level: number;
  /** Kin staged beside it. */
  with?: string;
  /** Entries the old data never lets fire, by index. */
  never?: number[];
  /** Added to its attack speed. */
  haste?: number;
}

const CASES: Case[] = [
  // Dirty Stab (entry 1) starts from `extended`. Nothing in the raid leader's
  // rotation exits there (Pocket Sand and Gather exit to neutral and coiled),
  // and a displacement only ever lands on `off_balance`: the entry cannot fire.
  // The old data has the same rotation.
  { id: 'goblin_raid_leader', level: 8, never: [1] },
  // Lunge (entry 2) and Hamstring (entry 0) both start from `coiled`, and
  // Hamstring is asked first. Pocket Sand (entry 4) is asked last, after an
  // entry for every position the hobgoblin reaches. Each fires only while
  // the entry asked before it is on its clock, and at the hobgoblin's own
  // pace none is (measured over 6,000 ticks at levels 6, 10 and 14: 0 uses of
  // either, about 98 of each of the other three).
  // A faster hobgoblin shows both entries run. The old data has the same
  // rotation and the old pick is the same loop.
  { id: 'hobgoblin', level: 10, never: [2, 4] },
  { id: 'hobgoblin', level: 10, haste: 1.5 },
  { id: 'hobgoblin_champion', level: 10 },
  { id: 'goblin_warchief', level: 12 },
  { id: 'goblin_firetongue', level: 10 },
  // Mud Poultice is for kin only: the witch doctor needs kin standing.
  { id: 'goblin_witch_doctor', level: 12, with: 'goblin' },
];

describe('the monsters of floors 4 to 6 use every entry of their rotation', () => {
  it.each(CASES)('$id (never: $never, haste: $haste)', ({ id, level, with: kin, never = [], haste }) => {
    const kernel = makeGame({ seed: 11 });
    const skipped: string[] = [];
    kernel.onEvent((event) => {
      if (event.type === actionSkipped.type) skipped.push(JSON.stringify(event.payload));
    });
    equip(kernel, 1);
    // Neither side may fall in the run: the test is about the rotation, not the outcome.
    const staged = stage(kernel, [{ monsterId: id, level }, ...(kin ? [{ monsterId: kin, level }] : [])]);
    setMods(kernel, [{ stat: 'stats/maxHp', kind: 'add', value: 1e7 }]);
    for (const e of staged) {
      setMods(
        kernel,
        [
          { stat: 'stats/maxHp', kind: 'add', value: 1e7 },
          ...(haste && e.defId === id ? [{ stat: 'stats/attackSpeed', kind: 'add' as const, value: haste }] : []),
        ],
        e.entity,
      );
    }
    patchFight(kernel, (state) => {
      // The kin is wounded, so the mending has a wound to close.
      for (const e of state.fight!.enemies) if (e) e.hp = e.defId === id ? 1e7 : 5e6;
    });
    setHp(kernel, 1e7);
    const rotation = MONSTERS[id].rotation!;
    const { spent, ticks } = runUntilAllUsed(kernel, id, RUN_TICKS, never.length ? Infinity : rotation.length);
    // An entry that never fires is watched for the whole run.
    if (never.length) expect(ticks).toBe(RUN_TICKS);
    for (let index = 0; index < rotation.length; index++) {
      const label = `${id} entry ${index} (${entryName(rotation[index])})`;
      if (never.includes(index)) expect(spent[index] ?? 0, label).toBe(0);
      else expect(spent[index] ?? 0, label).toBeGreaterThan(0);
    }
    expect(skipped).toEqual([]);
    const lines = feedOf(kernel).map((entry) => entry.text);
    expect(lines.some((line) => line.includes(entryName(rotation[0])))).toBe(true);
  }, 30000);
});

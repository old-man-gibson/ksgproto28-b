/**
 * Port of the old `tests/practice.test.ts` (docs/PRACTICE.md of the old
 * repository: XP from training equipment).
 *
 * One case runs: the Sand offers the post, and the fight is a practice fight.
 * The XP shaping of a practice fight (`practiceShare`, `practiceXp`,
 * `practising`, the practice clock of a fight) is step 3; the Training Area
 * is a spot of the hold, step 4. Each of those cases is an `it.todo` under
 * its old `describe` and name.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import { isPracticeFight, type CombatState } from '../src/systems/combat';
import { MONSTERS } from '../src/systems/monsters';
import { selectActivity, SPOTS } from '../src/systems/world';
import { makeGame, patch, slice } from './helpers';

const combatOf = (g: Kernel) => slice<CombatState>(g, 'combat');

/** A fresh save on The Sand, beating the post. */
function onThePost(seed = 7): Kernel {
  const g = makeGame({ seed });
  patch(g, (slices) => {
    slices.world.spot = 'the_sand';
    if (!slices.world.discovered.includes('the_sand')) slices.world.discovered.push('the_sand');
  });
  expect(g.dispatch(selectActivity({ activity: 'hunt' }))).toEqual({ ok: true });
  patch(g, (slices) => {
    slices.combat.respawnTimer = 0;
  });
  return g;
}

describe('the share', () => {
  it.todo('is the cut at level 1 and falls as F / (F + L − 1) (step 3: practice shaping)');
});

describe('practiceXp', () => {
  it.todo('is the identity outside a practice tick (step 3: practice shaping)');
  it.todo('pays the larger of the cut payout and the floor for the gap (step 3: practice shaping)');
  it.todo('credits at most PRACTICE_FLOOR_GAP seconds for a long pause (step 3: practice shaping)');
  it.todo('never pays more than the uncut amount (step 3: practice shaping)');
  it.todo('keeps one clock per skill and per attribute (step 3: practice shaping)');
  it.todo('a payout made outside the tick is not shaped, even mid-fight (step 3: practice shaping)');
});

describe('what counts as practice', () => {
  it.todo('every standing enemy must be training equipment (step 3: practice shaping)');
  it.todo('a real fight never touches the practice clock (step 3: practice shaping)');
});

describe('the post on The Sand', () => {
  it('The Sand offers it, and it is a lone practice target', () => {
    const sand = SPOTS.the_sand;
    expect(sand.activities.some((a) => a.kind === 'hunt')).toBe(true);
    expect(sand.encounters?.map((e) => e.monsterId)).toEqual(['benchmark_dummy']);
    // What makes it training equipment here: the `passive` flag of the species.
    expect(MONSTERS.benchmark_dummy.passive).toBe(true);
    const g = onThePost();
    for (let i = 0; i < 50 && !combatOf(g).fight; i++) g.tick();
    const fight = combatOf(g).fight;
    expect(fight?.enemies.filter(Boolean).map((e) => e!.defId)).toEqual(['benchmark_dummy']);
    expect(isPracticeFight(fight)).toBe(true);
  });

  it.todo('pays each combat skill about the floor per second, and Hunting nothing (step 3: practice shaping)');
  it.todo('pays far less than the same fight would without the rule (step 3: practice shaping)');
});

describe('the Training Area dummies', () => {
  it.todo('die and respawn but pay no character-level XP (step 4: the hold)');
});

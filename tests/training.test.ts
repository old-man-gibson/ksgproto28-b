/**
 * Port of the old `tests/training.test.ts`: the keeper of the Cages and the
 * dare.
 *
 * Neither is ported: both are step 3 (SPINE.md section 7.8). The spot record
 * carries their data, which the world system keeps and does not read. The
 * first case here asserts that data; the old cases of the keeper and the dare
 * are `it.todo` under their old names.
 *
 * "David and Goslimath" runs since the titles port (step 3, divine): the
 * counter the dare's win bumps is written with `patch`, `checkTitleUnlocks`
 * is the event `titles/check`, `setTitle` is the command `titles/wear`, and
 * the rematch is staged with `combat/start-staged` (`stage`).
 */
import { describe, expect, it } from 'vitest';
import type { CountersState } from '../src/systems/counters';
import { MONSTERS } from '../src/systems/monsters';
import { statOf } from '../src/systems/stats';
import { checkTitles, hasTitle, wearTitle, type TitlesState } from '../src/systems/titles';
import { SPOTS } from '../src/systems/world';
import { combatOf, feedOf, stage } from './combatHelpers';
import { emit, makeGame, patch, reads, slice } from './helpers';

const CAGES = SPOTS.the_cages;
const EVERY = CAGES.dare!.every;

describe('the Cages carry the data of the keeper and the dare', () => {
  it('the spot record has `healBetweenBouts` and `dare`, as the old data did', () => {
    expect(CAGES.healBetweenBouts).toEqual({ maxAttrTotal: 30 });
    expect(CAGES.dare).toMatchObject({ monsterId: 'suspiciously_large_slime', level: 16, every: 8 });
    expect(CAGES.dare!.desc.length).toBeGreaterThan(0);
    expect(MONSTERS[CAGES.dare!.monsterId]).toBeDefined();
    expect(CAGES.activities.map((a) => a.kind)).toContain('hunt');
  });
});

describe('the cage keeper patches up beginners', () => {
  it.todo('a win heals to full and clears bleeding while the attributes are under the cap (step 3: the keeper of the Cages)');
  it.todo('stops once the six attributes total more than the cap (step 3: the keeper of the Cages)');
  it.todo('only at the spot that has a keeper (step 3: the keeper of the Cages)');
});

describe("the keeper's dare holds play", () => {
  it.todo(`comes after ${EVERY} wins, and the dare's own forced fight never counts (step 3: the dare and the hold of play)`);
  it.todo('while held, ticks bank bonus time and move nothing; the step buttons do nothing at all (step 3: the dare and the hold of play)');
  it.todo('fleeing lifts the hold and the cages carry on (step 3: the dare and the hold of play)');
  it.todo('fighting starts the staged slime: alone, plain, and unfleeable (step 3: the dare and the hold of play)');
  it.todo('a stale hold with no dare behind it is dropped instead of freezing the game (step 3: the dare and the hold of play)');
  it.todo('stops asking once the slime is beaten, and never asks a player past the cap (step 3: the dare and the hold of play)');
});

describe('David and Goslimath', () => {
  it('beating the slime earns the hidden title; it pays per size step against larger things', () => {
    const g = makeGame({ seed: 1 });
    expect(hasTitle(slice<TitlesState>(g, 'titles'), 'david_and_goslimath')).toBe(false);
    patch(g, (slices) => {
      (slices.counters as CountersState).counts['kills:suspiciously_large_slime'] = 1;
    });
    emit(g, checkTitles, undefined);
    expect(hasTitle(slice<TitlesState>(g, 'titles'), 'david_and_goslimath')).toBe(true);
    // Earned: the small part always applies. Worn: the large part on top.
    expect(statOf(reads(g), 'vsLarger')).toBeCloseTo(0.03, 6);
    expect(g.dispatch(wearTitle({ title: 'david_and_goslimath' })).ok).toBe(true);
    expect(statOf(reads(g), 'vsLarger')).toBeCloseTo(0.18, 6);
  });

  it('the bonus shows up in the blow against something one size step up', () => {
    const g = makeGame({ seed: 7 });
    patch(g, (slices) => {
      (slices.counters as CountersState).counts['kills:suspiciously_large_slime'] = 1;
    });
    emit(g, checkTitles, undefined);
    g.dispatch(wearTitle({ title: 'david_and_goslimath' }));
    // A rematch, staged directly: the dare itself is not ported.
    stage(g, [{ monsterId: 'suspiciously_large_slime', level: CAGES.dare!.level }]);
    for (let i = 0; i < 600 && combatOf(g).fight; i++) g.tick();
    const mine = feedOf(g)
      .map((l) => l.damage)
      .filter((d) => d !== undefined && !d.incoming);
    expect(mine.length).toBeGreaterThan(0);
    const step = mine[0]!.steps.find((s) => s.label === 'Damage vs Larger');
    expect(step?.mult).toBeCloseTo(1.18, 6);
  });
});

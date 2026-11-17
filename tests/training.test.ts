/**
 * Port of the old `tests/training.test.ts`: the keeper of the Cages and the
 * dare.
 *
 * Neither is ported: both are step 3 (SPINE.md section 7.8). The spot record
 * carries their data, which the world system keeps and does not read. The one
 * case here asserts that data; every old case is an `it.todo` under its old
 * name.
 */
import { describe, expect, it } from 'vitest';
import { MONSTERS } from '../src/systems/monsters';
import { SPOTS } from '../src/systems/world';

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
  it.todo('beating the slime earns the hidden title; it pays per size step against larger things (step 3: the dare and the hold of play; titles)');
  it.todo('the bonus shows up in the blow against something one size step up (step 3: the dare and the hold of play; titles)');
});

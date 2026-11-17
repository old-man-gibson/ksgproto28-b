/**
 * Port of the old `tests/towers.test.ts`: the sequential ascent and shut
 * roads (`Connection.requires`).
 *
 * The ladder reads take a condition reader (`ladderOf`), counters are set by
 * the event, and the old `climbTo` is the command `world/climb`.
 *
 * The hold is step 4. Its two road cases stand on the same structure in the
 * content here: the door from `f1_forms` to `f1_reception` is shut until the
 * daybook is held (`flag:key_item:toll_clerk_book`), and the doors from
 * `f1_reception` into the offices are shut until the office key is held while
 * the door back to `f1_forms` is always open.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import { floorCleared, FLOORS, floorUnlocked, rungStatus } from '../src/systems/ladder';
import { climb, floorOfSpot, STARTING_SPOT, towerAt } from '../src/systems/world';
import { gameAt, hop, ladderOf, patchWorld, sent, setCounters, worldOf } from './worldHelpers';

/**
 * A new game stood at the foot of the tower. The game itself opens one floor
 * down, in the holding cell (`STARTING_SPOT`); the ladder is walked to, so
 * these tests start where it answers.
 */
const FOOT = 'ascent_foot';
const fresh = (): Kernel => gameAt(1, FOOT);

/** Run the current travel to arrival. */
function arrive(k: Kernel): void {
  expect(worldOf(k).travel).toBeTruthy();
  for (let i = 0; i < 10_000 && worldOf(k).travel; i++) k.tick();
  expect(worldOf(k).travel).toBeNull();
}

/** Set the counters the `clear` of each floor reads. The old fixture `clearFloors`. */
function clearFloors(k: Kernel, floorIds: string[]): void {
  const values: Record<string, number> = {};
  for (const id of floorIds) {
    for (const c of FLOORS[id].clear ?? []) if (c.type === 'stat') values[c.key] = c.value;
  }
  setCounters(k, values);
}

describe('the sequential ascent', () => {
  it('opens exactly one rung to a fresh save', () => {
    const k = fresh();
    expect(worldOf(k).spot).toBe(FOOT);
    expect(STARTING_SPOT).toBe('f0_cell');
    expect(floorUnlocked(ladderOf(k), FLOORS.ascent_f1)).toBe(true);
    expect(floorUnlocked(ladderOf(k), FLOORS.ascent_f2)).toBe(false);
    expect(floorUnlocked(ladderOf(k), FLOORS.ascent_f3)).toBe(false);
    // Sealed outranks gated: the unmet gold gate of floor 2 is not the reason
    // it is shut, and the ladder must not say it is.
    expect(rungStatus(ladderOf(k), FLOORS.ascent_f2)).toBe('sealed');
  });

  it('clears floors from counters that already persist, and unlocks in order', () => {
    const k = fresh();
    expect(floorCleared(ladderOf(k), FLOORS.ascent_f1)).toBe(false);
    setCounters(k, { 'boss:f1_toll_hall': 1 });
    expect(floorCleared(ladderOf(k), FLOORS.ascent_f1)).toBe(true);
    // Below cleared but the gate unmet: gated, and not yet unlocked.
    expect(rungStatus(ladderOf(k), FLOORS.ascent_f2)).toBe('gated');
    expect(floorUnlocked(ladderOf(k), FLOORS.ascent_f2)).toBe(false);
    setCounters(k, { 'gold:earned': 150 });
    expect(floorUnlocked(ladderOf(k), FLOORS.ascent_f2)).toBe(true);
    // Floor 3 still waits on the fight budget of floor 2, whatever the gold says.
    setCounters(k, { 'gold:earned': 10_000 });
    expect(floorUnlocked(ladderOf(k), FLOORS.ascent_f3)).toBe(false);
    clearFloors(k, ['ascent_f2']);
    expect(floorUnlocked(ladderOf(k), FLOORS.ascent_f3)).toBe(true);
  });

  it('climbs to an open floor, refuses a shut one, and always comes down', () => {
    const k = fresh();
    expect(towerAt(worldOf(k).spot)?.id).toBe('the_ascent');

    expect(sent(k, climb({ floor: 'ascent_f2' }))).toBe(false);
    expect(worldOf(k).travel).toBeNull();

    expect(sent(k, climb({ floor: 'ascent_f1' }))).toBe(true);
    arrive(k);
    expect(worldOf(k).spot).toBe('f1_landing');
    expect(floorOfSpot(worldOf(k).spot)?.id).toBe('ascent_f1');

    // Down is always open: back to the hub from the floor.
    expect(sent(k, climb({ floor: null }))).toBe(true);
    arrive(k);
    expect(worldOf(k).spot).toBe(FOOT);
  });

  it('the ladder only answers at the tower — not from a city district', () => {
    const k = fresh();
    patchWorld(k, (w) => {
      w.spot = 'lectory_steps';
    });
    expect(towerAt(worldOf(k).spot)).toBeNull();
    expect(sent(k, climb({ floor: 'ascent_f1' }))).toBe(false);
  });
});

describe('the hold (shut roads: Connection.requires)', () => {
  it.todo('is its own map, off every ladder (step 4: the hold)');

  // On the daybook door of floor 1, not on the hold: see the note at the top.
  it("the hold's door is on floor 11: shut until the stronghold, never from the Foot", () => {
    const k = fresh();
    // No road from the Foot, whatever the counters say.
    setCounters(k, { 'prestige:count': 3 });
    expect(hop(k, 'f1_reception')).toBe(false);
    expect(worldOf(k).travel).toBeNull();

    patchWorld(k, (w) => {
      w.spot = 'f1_forms';
    });
    expect(hop(k, 'f1_reception')).toBe(false);
    setCounters(k, { 'flag:key_item:toll_clerk_book': 1 });
    expect(hop(k, 'f1_reception')).toBe(true);
    arrive(k);
    expect(worldOf(k).spot).toBe('f1_reception');
  });

  // On the office doors of floor 1, not on the hold: see the note at the top.
  it('a save inside the hold always walks out to the Foot, and back to floor 11 only with the stronghold', () => {
    const k = fresh();
    patchWorld(k, (w) => {
      w.spot = 'f1_reception';
    });
    expect(hop(k, 'f1_registry')).toBe(false);
    expect(hop(k, 'f1_forms')).toBe(true);
    arrive(k);
    expect(worldOf(k).spot).toBe('f1_forms');

    patchWorld(k, (w) => {
      w.spot = 'f1_reception';
    });
    setCounters(k, { 'flag:key_item:toll_office_key': 1 });
    expect(hop(k, 'f1_registry')).toBe(true);
  });
});

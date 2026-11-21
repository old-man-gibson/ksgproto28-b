/**
 * Port of the old `tests/towers.test.ts`: the sequential ascent and shut
 * roads (`Connection.requires`).
 *
 * The ladder reads take a condition reader (`ladderOf`), counters are set by
 * the event, and the old `climbTo` is the command `world/climb`.
 *
 * The hold and its door on floor 11 are step 4 port C2. Until then its two
 * road cases stood on the daybook and office doors of floor 1; they stand on
 * the hold again.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import { floorCleared, FLOOR_BY_AREA, FLOORS, floorUnlocked, rungStatus } from '../src/systems/ladder';
import { AREAS, climb, floorOfSpot, SPOTS, STARTING_SPOT, towerAt } from '../src/systems/world';
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
  it('is its own map, off every ladder', () => {
    // The hold left the tower in the old build (2026-09-12). No floor names
    // its area, so nothing on the ladder can ever gate on it or be gated by it.
    expect(FLOOR_BY_AREA.has('player_base_v1_area')).toBe(false);
    expect(AREAS.player_base_v1_area.regionId).toBe('the_hold');
    expect(AREAS.player_base_v1_area.regionId).not.toBe(AREAS[SPOTS[STARTING_SPOT].areaId].regionId);
  });

  it("the hold's door is on floor 11: shut until the stronghold, never from the Foot", () => {
    const k = fresh();
    // No road from the Foot, prestiged or not.
    setCounters(k, { 'prestige:count': 3 });
    expect(hop(k, 'base_entrance')).toBe(false);
    expect(worldOf(k).travel).toBeNull();

    patchWorld(k, (w) => {
      w.spot = 'f11_gatehouse';
    });
    expect(hop(k, 'base_entrance')).toBe(false);
    setCounters(k, { 'legacy:stronghold': 1 });
    expect(hop(k, 'base_entrance')).toBe(true);
    arrive(k);
    expect(worldOf(k).spot).toBe('base_entrance');
  });

  it('a save inside the hold always walks out to the Foot, and back to floor 11 only with the stronghold', () => {
    const k = fresh();
    patchWorld(k, (w) => {
      w.spot = 'base_entrance';
    });
    expect(hop(k, 'f11_gatehouse')).toBe(false);
    expect(hop(k, FOOT)).toBe(true);
    arrive(k);
    expect(worldOf(k).spot).toBe(FOOT);

    patchWorld(k, (w) => {
      w.spot = 'base_entrance';
    });
    setCounters(k, { 'legacy:stronghold': 1 });
    expect(hop(k, 'f11_gatehouse')).toBe(true);
  });
});

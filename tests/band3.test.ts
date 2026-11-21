/**
 * Port of the old `tests/band3.test.ts` (19 cases): band 3, the City. The
 * city key, band passes, the castle hub and four any-order wards whose
 * monsters level up with each ward cleared. Step 4 port C1.
 *
 * Also here: the band 3 case of the old `tests/rideEdges.test.ts` ("a band
 * hub is routed once the band is open and the hub discovered"). That file
 * has no port in this repository; its other cases are bands 1 and 2 and the
 * festival.
 *
 * Call shape changes:
 * - `createInitialState(0, FOOT)` is `gameAt(0, FOOT)`; `clearFloors` sets
 *   the counters each floor's `clear` reads.
 * - `s.prestige.purchases[id] = 1` is a patch of the prestige slice.
 * - The ladder reads take a condition reader (`ladderOf`); `bandLevelStep`
 *   takes the area of the spot.
 * - `climbTo` and `climbToHub` are the commands `world/climb` and
 *   `world/climb-hub`; `tickTravel` is a kernel tick.
 * - `getDerivedStats(s).travelSpeed` is the stat block (`statBlockOf`).
 * - `spawnMonster(s, spot)` is `spawn` of the combat helpers over the site
 *   the world builds (`siteOf`), which carries the band's level step.
 * - `checkFloorClears(s, bus)` is the event `ladder/check`; the log is the
 *   log slice.
 * - `harvest(s)` takes a read context and the prestige slice.
 * - The rideEdges case does not call `revealMapped`: the hub is discovered
 *   by the case, and the mapped regions hold no ladder stop.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import { conditionsMet } from '../src/systems/counters';
import {
  BANDS,
  bandLevelStep,
  checkClears,
  CLIMB_TICKS_PER_FLOOR,
  floorCleared,
  FLOORS,
  floorUnlocked,
  hubStatus,
  ladderFloors,
  rungStatus,
} from '../src/systems/ladder';
import type { LevelsState } from '../src/systems/levels';
import type { LogState } from '../src/systems/log';
import { canPrestige, harvest, PRESTIGE_BOON_LIST, PRESTIGE_BOONS, PRESTIGE_UNLOCK, type PrestigeState } from '../src/systems/prestige';
import { statBlockOf } from '../src/systems/stats';
import { climb, climbHub, rideEdges, siteOf, SPOTS, towerAt } from '../src/systems/world';
import { spawn } from './combatHelpers';
import { emit, patch, reads, slice } from './helpers';
import { counterOf, discover, gameAt, ladderOf, sent, setCounters, worldOf } from './worldHelpers';

const CITY = BANDS.ascent_upper;
const WARDS = ['ascent_f7', 'ascent_f8', 'ascent_f9', 'ascent_f10'];
const FOOT = 'ascent_foot';
const BAND_ONE = ['ascent_f1', 'ascent_f2', 'ascent_f3'];
const TO_PRESTIGE = ['ascent_f1', 'ascent_f2', 'ascent_f3', 'ascent_f4', 'ascent_f5', 'ascent_f6'];

const fresh = (): Kernel => gameAt(0, FOOT);

/** Set the counters the `clear` of each floor reads. The old fixture `clearFloors`, floors 1 to 6 by default. */
function clearFloors(k: Kernel, floorIds: string[] = TO_PRESTIGE): void {
  const values: Record<string, number> = {};
  for (const id of floorIds) {
    for (const c of FLOORS[id].clear ?? []) if (c.type === 'stat') values[c.key] = c.value;
  }
  setCounters(k, values);
}

/** Own a prestige boon at rank 1. */
function own(k: Kernel, boon: string): void {
  patch(k, (slices) => {
    (slices.prestige as PrestigeState).purchases[boon] = 1;
  });
}

/** Floors 1-6 cleared and the city key owned: the city is open. */
function cityOpen(): Kernel {
  const k = fresh();
  clearFloors(k);
  own(k, 'city_key');
  return k;
}

/** Run the current travel to arrival; returns its length in ticks. */
function arrive(k: Kernel): number {
  const total = worldOf(k).travel!.total;
  for (let i = 0; i < 10_000 && worldOf(k).travel; i++) k.tick();
  expect(worldOf(k).travel).toBeNull();
  return total;
}

const speedOf = (k: Kernel): number => statBlockOf(reads(k)).travelSpeed;
const harvestOf = (k: Kernel) => harvest(reads(k), slice<PrestigeState>(k, 'prestige'));
const logOf = (k: Kernel): string[] => slice<LogState>(k, 'log').log.map((e) => e.msg);
const checkFloorClears = (k: Kernel): void => emit(k, checkClears, undefined);

describe('the city gate', () => {
  it('is sealed until floor 6 is cleared, then gated on the city key', () => {
    const k = fresh();
    expect(hubStatus(ladderOf(k), CITY)).toBe('sealed');
    for (const id of WARDS) expect(rungStatus(ladderOf(k), FLOORS[id]), id).toBe('sealed');

    clearFloors(k);
    expect(hubStatus(ladderOf(k), CITY)).toBe('gated');
    for (const id of WARDS) expect(rungStatus(ladderOf(k), FLOORS[id]), id).toBe('gated');

    own(k, 'city_key');
    expect(conditionsMet(ladderOf(k), CITY.gate!)).toBe(true);
    expect(hubStatus(ladderOf(k), CITY)).toBe('open');
    for (const id of WARDS) expect(floorUnlocked(ladderOf(k), FLOORS[id]), id).toBe(true);
  });

  it('the key alone opens nothing: band 2 must still be cleared (or passed)', () => {
    const k = fresh();
    own(k, 'city_key');
    clearFloors(k, BAND_ONE);
    expect(hubStatus(ladderOf(k), CITY)).toBe('sealed');
    for (const id of WARDS) expect(floorUnlocked(ladderOf(k), FLOORS[id]), id).toBe(false);
  });

  it('the key costs no more than the floors source of a first harvest pays', () => {
    // Clearing floors 1-6 is what lets a run prestige, and the floors source
    // pays one point per floor, so the first prestige can always buy the key.
    const k = fresh();
    clearFloors(k);
    const floorsLine = harvestOf(k).lines.find((l) => l.id === 'floors')!;
    expect(floorsLine.points).toBe(TO_PRESTIGE.length);
    expect(PRESTIGE_BOONS.city_key.cost[0]).toBeLessThanOrEqual(floorsLine.points);
  });
});

describe('any order', () => {
  it('a ward cleared changes nothing about whether the others are open', () => {
    const k = cityOpen();
    clearFloors(k, ['ascent_f9']);
    expect(rungStatus(ladderOf(k), FLOORS.ascent_f9)).toBe('cleared');
    for (const id of ['ascent_f7', 'ascent_f8', 'ascent_f10']) expect(rungStatus(ladderOf(k), FLOORS[id]), id).toBe('open');
  });

  it('every ward is cleared from its own keeper, in any order', () => {
    for (const order of [WARDS, [...WARDS].reverse()]) {
      const k = cityOpen();
      for (const id of order) {
        clearFloors(k, [id]);
        expect(floorCleared(ladderOf(k), FLOORS[id]), id).toBe(true);
      }
    }
  });
});

describe('the castle hub', () => {
  it('the ladder answers at the castle, and the climb lands there', () => {
    const k = cityOpen();
    const speed = speedOf(k);
    expect(sent(k, climbHub({ band: CITY.id }))).toBe(true);
    const ticks = arrive(k);
    expect(worldOf(k).spot).toBe(CITY.hub);
    expect(towerAt(worldOf(k).spot)?.id).toBe('the_ascent');
    // Seven rungs up from the Foot: the band sits at its lowest floor index.
    expect(ticks).toBe(Math.max(1, Math.round((7 * CLIMB_TICKS_PER_FLOOR) / speed)));
  });

  it('each ward is one rung from the castle and from each other', () => {
    const k = cityOpen();
    sent(k, climbHub({ band: CITY.id }));
    arrive(k);
    // Travel speed can differ by place (shelter, weather), so price each leg
    // from where it departs.
    const one = () => Math.max(1, Math.round(CLIMB_TICKS_PER_FLOOR / speedOf(k)));
    let expected = one();
    expect(sent(k, climb({ floor: 'ascent_f10' }))).toBe(true);
    expect(arrive(k)).toBe(expected);
    expect(worldOf(k).spot).toBe(FLOORS.ascent_f10.landing);
    expected = one();
    expect(sent(k, climb({ floor: 'ascent_f7' }))).toBe(true);
    expect(arrive(k)).toBe(expected);
    expected = one();
    expect(sent(k, climbHub({ band: CITY.id }))).toBe(true);
    expect(arrive(k)).toBe(expected);
  });

  it('refuses a closed city', () => {
    const k = fresh();
    clearFloors(k);
    expect(sent(k, climbHub({ band: CITY.id }))).toBe(false);
    expect(sent(k, climb({ floor: 'ascent_f7' }))).toBe(false);
  });

  it('is a haven off the ladder: a rest spot no floor claims', () => {
    const hub = SPOTS[CITY.hub!];
    expect(hub.activities.some((a) => a.kind === 'rest')).toBe(true);
    expect(ladderFloors('the_ascent').some((f) => f.areaId === hub.areaId)).toBe(false);
  });
});

describe('direction scaling', () => {
  it('each ward cleared raises every ward: +0, +2, +5, +9, and +9 after the last', () => {
    const k = cityOpen();
    const docks = SPOTS.f7_docks.areaId;
    expect(bandLevelStep(ladderOf(k), docks)).toBe(0);
    const seen: number[] = [];
    for (const id of WARDS) {
      clearFloors(k, [id]);
      seen.push(bandLevelStep(ladderOf(k), docks));
    }
    expect(seen).toEqual([2, 5, 9, 9]);
  });

  it('touches nothing off band 3', () => {
    const k = cityOpen();
    clearFloors(k, WARDS);
    expect(bandLevelStep(ladderOf(k), SPOTS.f6_drop.areaId)).toBe(0);
    expect(bandLevelStep(ladderOf(k), SPOTS[CITY.hub!].areaId)).toBe(0);
  });

  it('spawns at the rolled level plus the step; escorts keep their leader’s level', () => {
    const k = cityOpen();
    clearFloors(k, ['ascent_f7', 'ascent_f8']); // +5
    const docks = siteOf(reads(k), SPOTS.f7_docks);
    for (let i = 0; i < 40; i++) {
      const m = spawn(k, docks);
      expect(m.level).toBeGreaterThanOrEqual(12 + 5);
      expect(m.level).toBeLessThanOrEqual(13 + 5);
    }
    const pinned = spawn(k, docks, { monsterId: 'cave_spider', level: 20 });
    expect(pinned.level).toBe(20);
  });
});

describe('band passes', () => {
  it('the band 1 pass opens floor 4 on a fresh run', () => {
    const k = fresh();
    own(k, 'pass_lower');
    for (const id of BAND_ONE) expect(rungStatus(ladderOf(k), FLOORS[id]), id).toBe('cleared');
    expect(floorUnlocked(ladderOf(k), FLOORS.ascent_f4)).toBe(true);
  });

  it('pays no harvest points and no clear XP for passed floors', () => {
    const k = fresh();
    own(k, 'pass_lower');
    expect(harvestOf(k).lines.find((l) => l.id === 'floors')!.points).toBe(0);
    const xpOf = () => {
      const lv = slice<LevelsState>(k, 'levels');
      return lv.levelXp + lv.level * 1_000_000;
    };
    const before = xpOf();
    checkFloorClears(k);
    expect(xpOf()).toBe(before);
  });

  it('the band 2 pass does not open prestige: the warchief must still fall', () => {
    const k = fresh();
    own(k, 'pass_lower');
    own(k, 'pass_wilds');
    expect(floorCleared(ladderOf(k), FLOORS.ascent_f6)).toBe(true);
    expect(conditionsMet(ladderOf(k), PRESTIGE_UNLOCK)).toBe(false);
    expect(canPrestige(ladderOf(k))).toBe(false);
    // ... and floor 6 is open to walk down to and fight: the pass waives its
    // 40-goblin gate, or the rung would read cleared and refuse the climb.
    expect(counterOf(k, 'kills:tag:goblin')).toBe(0);
    expect(floorUnlocked(ladderOf(k), FLOORS.ascent_f6)).toBe(true);
    expect(rungStatus(ladderOf(k), FLOORS.ascent_f6)).toBe('cleared');
  });

  it('a pass alone skips nothing below it: the band 2 pass waits on band 1', () => {
    const k = fresh();
    own(k, 'pass_wilds');
    expect(floorUnlocked(ladderOf(k), FLOORS.ascent_f4)).toBe(false);
    clearFloors(k, BAND_ONE);
    expect(floorUnlocked(ladderOf(k), FLOORS.ascent_f6)).toBe(true);
  });

  it('both passes and the key open the city on a fresh run', () => {
    const k = fresh();
    own(k, 'pass_lower');
    own(k, 'pass_wilds');
    own(k, 'city_key');
    expect(hubStatus(ladderOf(k), CITY)).toBe('open');
  });

  it('are priced above every other boon rank, band 2 above band 1', () => {
    const others = PRESTIGE_BOON_LIST.filter((b) => b.effect.kind !== 'bandPass');
    const dearest = Math.max(...others.flatMap((b) => b.cost));
    expect(PRESTIGE_BOONS.pass_lower.cost[0]).toBeGreaterThan(dearest);
    expect(PRESTIGE_BOONS.pass_wilds.cost[0]).toBeGreaterThan(PRESTIGE_BOONS.pass_lower.cost[0]);
  });
});

describe('the castle is safe', () => {
  it('all four wards cleared stamps the band once, with one log line', () => {
    const k = cityOpen();
    clearFloors(k, WARDS.slice(0, 3));
    checkFloorClears(k);
    expect(counterOf(k, 'cleared:band:ascent_upper')).toBe(0);
    clearFloors(k, WARDS.slice(3));
    checkFloorClears(k);
    checkFloorClears(k);
    expect(counterOf(k, 'cleared:band:ascent_upper')).toBe(1);
    expect(logOf(k).filter((m) => m.includes(CITY.name) && m.includes('every floor cleared'))).toHaveLength(1);
  });
});

// The band 3 case of the old `tests/rideEdges.test.ts`.
describe('rideEdges', () => {
  it('a band hub is routed once the band is open and the hub discovered', () => {
    const k = fresh();
    clearFloors(k);
    setCounters(k, { 'gold:earned': 1_000_000, 'kills:tag:goblin': 1_000 });
    discover(k, ...TO_PRESTIGE.map((f) => FLOORS[f].landing!));
    const stopsFrom = (from: string) => rideEdges(reads(k), worldOf(k), from).map((e) => e.to);
    expect(stopsFrom(FOOT)).not.toContain(CITY.hub);
    // Open (the city key) but never visited: nothing names it yet.
    own(k, 'city_key');
    expect(stopsFrom(FOOT)).not.toContain(CITY.hub);
    discover(k, CITY.hub!);
    const toHub = rideEdges(reads(k), worldOf(k), FOOT).find((e) => e.to === CITY.hub);
    expect(toHub?.ticks).toBe(7 * CLIMB_TICKS_PER_FLOOR);
    // And from the hub, the rest of the stack is one pass away.
    expect(stopsFrom(CITY.hub!)).toContain(FOOT);
  });
});

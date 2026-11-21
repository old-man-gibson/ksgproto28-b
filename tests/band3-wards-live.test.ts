/**
 * Port of the old `tests/band3-wards-live.test.ts` (5 cases): band 3's wards
 * end to end on the live content. The engine (positions, stamps, kept
 * wounds, the window) and the four wards together, on floor 7's real demon.
 * The cases keep their old names.
 *
 * Call shape changes:
 * - `new Game(createInitialState(0, 'castle_court'))` is `gameAt`;
 *   `state.stats` writes are `setCounters`; the city key is bought through
 *   `patch` of the prestige slice.
 * - `game.resyncAnnouncers()` (what a load did, which brought the positions
 *   up to date) and `checkFloorClears(s, bus)` are the event `ladder/check`.
 * - `catchUpTicks(game, n)` is `catchUp` from the kernel and a load of its
 *   envelope.
 * - `s.level` and `s.levelXp` are the `levels` slice; `sourceAmount` takes
 *   the read context.
 * - `eligibleEncounters` is `eligibleAt`; `spawnMonster` takes a context and
 *   the spot's encounter site (`siteOf`).
 *
 * `it.todo`:
 * - "save 60 wakes a save standing in ... the removed marsh and wreck": a
 *   save migration of the old save; there is no importer of the old save.
 */
import { describe, expect, it } from 'vitest';
import { catchUp, type Kernel } from '../src/kernel';
import { systems } from '../src/systems';
import { checkClears, FLOORS, floorCleared } from '../src/systems/ladder';
import type { LevelsState } from '../src/systems/levels';
import { PRESTIGE_SOURCE_LIST, sourceAmount, type PrestigeState } from '../src/systems/prestige';
import { monsterStatsFromAttrs } from '../src/systems/stats';
import { WARD_WINDOWS, wardClockKey } from '../src/systems/wards';
import { eligibleAt, siteOf, SPOTS } from '../src/systems/world';
import { spawn } from './combatHelpers';
import { emit, patch, probe, reads, slice } from './helpers';
import { counterOf, gameAt, ladderOf, setCounters } from './worldHelpers';
import type { CountersState } from '../src/systems/counters';

const WIN = WARD_WINDOWS.find((w) => w.id === 'f7_demon')!;
const FLOORS_SOURCE = PRESTIGE_SOURCE_LIST.find((s) => s.id === 'floors')!;
const TO_PRESTIGE = ['ascent_f1', 'ascent_f2', 'ascent_f3', 'ascent_f4', 'ascent_f5', 'ascent_f6'];

/** A counter as stored: `undefined` when never set. */
const stat = (k: Kernel, key: string): number | undefined => slice<CountersState>(k, 'counters').counts[key];

/** Set the counters each floor's `clear` reads. The old fixture `clearFloors`. */
function clearFloors(k: Kernel, floorIds: string[] = TO_PRESTIGE): void {
  const values: Record<string, number> = {};
  for (const id of floorIds) {
    for (const c of FLOORS[id].clear ?? []) if (c.type === 'stat') values[c.key] = Math.max(counterOf(k, c.key), c.value);
  }
  setCounters(k, values);
}

/** Floors 1-6 cleared, the city key owned, standing in the castle court. */
function cityOpen(): Kernel {
  const k = gameAt(0, 'castle_court');
  clearFloors(k);
  patch(k, (slices) => {
    (slices.prestige as PrestigeState).purchases.city_key = 1;
  });
  return k;
}

const rows = (k: Kernel, spot: string) => eligibleAt(reads(k), SPOTS[spot]).map((e) => e.monsterId);

const check = (k: Kernel): void => emit(k, checkClears, undefined);

const levelsOf = (k: Kernel) => slice<LevelsState>(k, 'levels');

describe('band 3 wards, live', () => {
  it('positions follow the clears: one ward down puts the others at 1, and ward 7 goes to the siege', () => {
    const k = cityOpen();
    k.tick();
    expect(stat(k, 'band:pos:ascent_f7') ?? 0).toBe(0);
    expect(rows(k, 'f7_merchant_road').length).toBeGreaterThan(0);
    clearFloors(k, ['ascent_f8']);
    check(k); // what a load did; a real clear runs the check on the kill
    k.tick();
    expect(stat(k, 'band:pos:ascent_f7')).toBe(1);
    expect(stat(k, 'band:pos:ascent_f9')).toBe(1);
    expect(rows(k, 'f7_merchant_road')).toEqual([]);
    expect(rows(k, 'f7_stockade').length).toBeGreaterThan(0);
  });

  it('ward 7 last: the window opens at the third clear, counts only live ticks, and its lapse clears the ward', () => {
    const k = cityOpen();
    clearFloors(k, ['ascent_f8', 'ascent_f9', 'ascent_f10']);
    check(k);
    k.tick();
    expect(stat(k, 'band:pos:ascent_f7')).toBe(3);
    expect(stat(k, WIN.atKey)).toBeGreaterThan(0);
    expect(rows(k, 'f7_burnt_camp')).toEqual(['ph_camp_demon']);
    // Catch-up does not move the window's clock.
    check(k); // pay the other floors' stamped clears first
    const xpBefore = levelsOf(k).levelXp;
    const levelBefore = levelsOf(k).level;
    const before = stat(k, wardClockKey(WIN)) ?? 0;
    const caught = catchUp({ systems: [...systems, probe], envelope: k.save(0), ticks: 2000, now: 0 });
    expect(k.load(caught).ok).toBe(true);
    expect(stat(k, wardClockKey(WIN)) ?? 0).toBe(before);
    // Live ticks do; at the end the ward is cleared and the unmet flag set.
    for (let i = 0; i < WIN.ticks + 5 && !stat(k, WIN.doneKey); i++) k.tick();
    expect(stat(k, WIN.doneKey)).toBe(1);
    expect(stat(k, WIN.goneKey)).toBe(1);
    expect(stat(k, WIN.flags.unmet)).toBe(1);
    expect(stat(k, WIN.flags.fought)).toBeUndefined();
    expect(floorCleared(ladderOf(k), FLOORS.ascent_f7)).toBe(true);
    expect(rows(k, 'f7_burnt_camp')).toEqual([]);
    // Cleared by time: the way opens, but no clear XP and no harvest floor (Q24).
    expect(stat(k, 'level:floor:ascent_f7')).toBe(1);
    expect([levelsOf(k).level, levelsOf(k).levelXp]).toEqual([levelBefore, xpBefore]);
    const floors = sourceAmount(reads(k), FLOORS_SOURCE);
    clearFloors(k, ['ascent_f7']);
    expect(sourceAmount(reads(k), FLOORS_SOURCE)).toBe(floors);
  }, 60_000);

  it('a demon left carrying wounds counts as fought at the lapse, even with no fight closed (a tab shut mid-fight)', () => {
    const k = cityOpen();
    clearFloors(k, ['ascent_f8', 'ascent_f9', 'ascent_f10']);
    check(k);
    k.tick();
    setCounters(k, { 'ward:f7:demon:wounds': 0.07, [wardClockKey(WIN)]: WIN.ticks - 1 });
    k.tick();
    k.tick();
    expect(stat(k, WIN.doneKey)).toBe(1);
    expect(stat(k, WIN.flags.fought)).toBe(1);
    expect(stat(k, WIN.flags.unmet)).toBeUndefined();
  });

  it.todo(
    'save 60 wakes a save standing in, walking to or planning through the removed marsh and wreck on the docks (no importer of the old save)',
  );

  it("the demon's next spawn starts with its kept wounds", () => {
    const k = cityOpen();
    setCounters(k, { 'band:pos:ascent_f7': 3 });
    const maxOf = (m: ReturnType<typeof spawn>) => monsterStatsFromAttrs(m.attrs).maxHp;
    const whole = spawn(k, siteOf(reads(k), SPOTS.f7_burnt_camp));
    expect(whole.defId).toBe('ph_camp_demon');
    expect(whole.hp).toBe(maxOf(whole));
    setCounters(k, { 'ward:f7:demon:wounds': 0.4 });
    const wounded = spawn(k, siteOf(reads(k), SPOTS.f7_burnt_camp));
    expect(wounded.hp).toBe(Math.max(1, Math.round(maxOf(wounded) * 0.6)));
  });
});

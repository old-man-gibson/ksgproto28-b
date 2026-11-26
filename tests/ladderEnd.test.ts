/**
 * Port of the old `tests/ladderEnd.test.ts` (14 cases), step 4 port C7. The
 * ladder stops at floor 20. Once its clear holds, the ladder says that floor
 * 21 is not in this build. The notice is a reading of the clear counters: no
 * save field, so nothing here changes the save. The cases keep their old
 * names.
 *
 * Call shape changes:
 * - The old UI readers `ladderEnd(state, tower)` and `towerSection(...).end`
 *   are the ladder view's `endNotice` here; the old `ladderBands(...)` card
 *   list (a "next band, name only" card) is the view's rungs: the shell has
 *   no folded band cards (the UI step).
 * - `checkFloorClears(s, bus)` is the event `ladder/check`; the log lines are
 *   read from the log slice.
 * - `prestigeNow(state, 1)` is the command `prestige/now`.
 * - `climbTo(s, bus, floor)` is the command `world/climb`.
 * - The old save check compared the keys of the serialized state with a new
 *   game's. Here every slice's top-level keys are compared, and the ladder's
 *   slice stays empty.
 * - "floor 20 clearing during an absence": the old catch-up suppressed the
 *   log and the welcome-back summary carried the notice
 *   (`OfflineSummary.ladderEnd`). Here catch-up keeps log lines, so the
 *   notice is in the log after it, once; the summary dialog is the UI step
 *   (as the first-calm line, docs/CONTENT.md section 14). Ten minutes of
 *   fights push a line out of the log's 60, so a recorder system (this file
 *   only) keeps every notice line, as `tests/malgeriCatchup.test.ts` does.
 *   The pocket world is mounted with `mountSpots`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catchUp, defineSystem, on, type Kernel } from '../src/kernel';
import { systems } from '../src/systems';
import { checkClears, FLOORS, floorsReachedThisRun, floorUnlocked, ladderEnded, rideStops, TOWERS, topRung, type LadderView } from '../src/systems/ladder';
import { floorXpKey } from '../src/systems/levels';
import { logLine } from '../src/systems/log';
import { prestigeNow } from '../src/systems/prestige';
import { AREAS, climb, selectActivity, type SpotDef } from '../src/systems/world';
import { logOf } from './combatHelpers';
import { emit, makeGame, makeKernel, patch, probe, slice } from './helpers';
import { counterOf, gameAt, ladderOf, mountSpots, patchWorld, setCounters, worldOf } from './worldHelpers';

const ASCENT = TOWERS.the_ascent;
const NOTICE = 'Floor 21: not in this build.';

/** Floors 1 to n of the Ascent, by id. */
const floorsUpTo = (n: number): string[] => Array.from({ length: n }, (_, i) => `ascent_f${i + 1}`);

/** Set the counters each floor's `clear` reads. The old fixture `clearFloors`. */
function clearFloors(k: Kernel, floorIds: string[]): void {
  const values: Record<string, number> = {};
  for (const id of floorIds) {
    for (const c of FLOORS[id].clear ?? []) if (c.type === 'stat') values[c.key] = Math.max(counterOf(k, c.key), c.value);
  }
  setCounters(k, values);
}

/** A run with floors 1 to n cleared, standing at the Foot. */
function clearedTo(n: number): Kernel {
  const k = gameAt(0, 'ascent_foot');
  clearFloors(k, floorsUpTo(n));
  return k;
}

const towerView = (k: Kernel) => (k.view().systems.ladder as LadderView).towers.find((t) => t.id === ASCENT.id)!;
const said = (k: Kernel) => logOf(k).filter((m) => m === NOTICE).length;

describe('the ladder ends at floor 20', () => {
  it('floor 20 is the top rung and nothing is above it', () => {
    expect(topRung('the_ascent')?.id).toBe('ascent_f20');
    expect(Object.values(FLOORS).filter((f) => f.bandId !== undefined && f.index > 20)).toEqual([]);
    expect(FLOORS.ascent_f21).toBeUndefined();
  });

  it('no notice until floor 20 is cleared', () => {
    for (const k of [gameAt(0, 'ascent_foot'), clearedTo(19)]) {
      expect(ladderEnded(ladderOf(k), 'the_ascent')).toBe(false);
      expect(towerView(k).ended).toBe(false);
      expect(towerView(k).endNotice).toBeNull();
    }
  });

  it('floor 20 cleared: the tower section says floor 21 is not in this build', () => {
    const k = clearedTo(20);
    expect(ladderEnded(ladderOf(k), 'the_ascent')).toBe(true);
    expect(towerView(k).ended).toBe(true);
    expect(towerView(k).endNotice).toBe(NOTICE);
  });

  it('a save with floor 20 cleared yields the notice after a load, with no field added to the save', () => {
    const k = clearedTo(20);
    const save = k.save(0);
    const loaded = makeGame({ seed: 5 });
    expect(loaded.load(JSON.parse(JSON.stringify(save))).ok).toBe(true);
    expect(towerView(loaded).endNotice).toBe(NOTICE);
    const bare = gameAt(0, 'ascent_foot').save(0);
    const shape = (env: typeof save) =>
      Object.fromEntries(Object.entries(env.slices).map(([id, s]) => [id, Object.keys(s.data as object).sort()]));
    expect(shape(save)).toEqual(shape(bare));
    expect(save.slices.ladder.data).toEqual({});
  });

  it('clearing floor 20 says it once in the log, and the stamp keeps it from repeating', () => {
    const k = clearedTo(20);
    emit(k, checkClears, undefined);
    emit(k, checkClears, undefined);
    expect(said(k)).toBe(1);
    // The floor's own clear line is still there, unchanged.
    expect(logOf(k).some((m) => m.includes(FLOORS.ascent_f20.name) && m.includes('cleared'))).toBe(true);
  });

  it('floor 19 clearing does not say it', () => {
    const k = clearedTo(19);
    emit(k, checkClears, undefined);
    expect(logOf(k).filter((m) => m.includes('not in this build'))).toEqual([]);
  });

  it('a new run has no notice: the clear counters reset with the run', () => {
    const k = clearedTo(20);
    expect(k.dispatch(prestigeNow()).ok).toBe(true);
    expect(towerView(k).endNotice).toBeNull();
    expect(ladderEnded(ladderOf(k), 'the_ascent')).toBe(false);
  });
});

describe('nothing reaches for floor 21', () => {
  it('no floor, stop, band or card exists past floor 20, however much is cleared', () => {
    const k = clearedTo(20);
    const r = ladderOf(k);
    const banded = Object.values(FLOORS).filter((f) => f.bandId !== undefined);
    expect(Math.max(...banded.filter((f) => floorUnlocked(r, f)).map((f) => f.index))).toBeLessThanOrEqual(20);
    expect(Math.max(...floorsReachedThisRun(r).map((id) => FLOORS[id].index))).toBeLessThanOrEqual(20);
    expect(Math.max(...rideStops(ASCENT).map((stop) => stop.index))).toBeLessThanOrEqual(20);
    // The ladder shows no rung above the desert.
    const rungs = towerView(k).rungs;
    expect(Math.max(...rungs.map((rung) => rung.index))).toBe(20);
    expect(rungs.at(-1)!.band).toBe('The Desert');
  });

  it('a climb to floor 21 is refused and starts no travel', () => {
    const k = clearedTo(20);
    patchWorld(k, (w) => {
      w.spot = FLOORS.ascent_f20.landing!;
      w.discovered.push(w.spot);
    });
    expect(k.dispatch(climb({ floor: 'ascent_f21' })).ok).toBe(false);
    expect(worldOf(k).travel).toBeNull();
    expect(worldOf(k).spot).toBe(FLOORS.ascent_f20.landing);
  });

  it('the clear pass stamps no floor 21 counter', () => {
    const k = clearedTo(20);
    emit(k, checkClears, undefined);
    const counts = (k.snapshot().slices.counters as { counts: Record<string, number> }).counts;
    expect(Object.keys(counts).filter((key) => /f21|floor.?21/i.test(key))).toEqual([]);
  });
});

describe('floor 20 clearing during an absence', () => {
  const base = { icon: 'x', areaId: 'zz_area', desc: '', activities: [], connections: [] };
  const ZZ: Record<string, SpotDef> = {
    zz_camp: {
      ...base,
      id: 'zz_camp',
      name: 'Camp',
      waypoint: true,
      activities: [{ id: 'rest', kind: 'rest', name: 'Camp', icon: 'x' }],
      connections: [{ to: 'zz_field', ticks: 5 }],
    } as SpotDef,
    zz_field: {
      ...base,
      id: 'zz_field',
      name: 'Field',
      activities: [{ id: 'hunt', kind: 'hunt', name: 'Hunt', icon: 'x' }],
      encounters: [{ monsterId: 'forest_rat', weight: 100, level: [1, 1] }],
    } as SpotDef,
  };

  let unmount: () => void = () => {};
  beforeAll(() => {
    AREAS.zz_area = { id: 'zz_area', name: 'zz', regionId: 'the_ascent' } as (typeof AREAS)[string];
    unmount = mountSpots(ZZ);
  });
  afterAll(() => {
    unmount();
    delete AREAS.zz_area;
  });

  /** Keeps every notice line the log is sent. Exists only in this test. */
  const recorder = defineSystem<{ lines: string[] }>({
    id: 'notice-recorder',
    version: 1,
    initial: () => ({ lines: [] }),
    events: [
      on(logLine, (ctx, { payload }) => {
        if (payload.msg === NOTICE) ctx.state.lines.push(payload.msg);
      }),
    ],
  });
  const game = (seed: number): Kernel => makeKernel([probe, recorder], { seed });
  const told = (k: Kernel) => slice<{ lines: string[] }>(k, 'notice-recorder').lines.length;

  /** A hunt in a pocket field with floors 1 to 19 cleared and paid. */
  function start(): Kernel {
    const k = game(27);
    patch(k, (slices) => {
      slices.world.spot = 'zz_field';
      slices.world.discovered.push(...Object.keys(ZZ));
      slices.world.safeSpots = { nearest: 'zz_camp', unconditional: 'zz_camp' };
    });
    clearFloors(k, floorsUpTo(19));
    expect(k.dispatch(selectActivity({ activity: 'hunt' })).ok).toBe(true);
    // Live play until floors 1 to 19 have paid (the first kill runs the clear check).
    for (let i = 0; i < 3000 && !counterOf(k, floorXpKey('ascent_f19')); i++) k.tick();
    expect(counterOf(k, floorXpKey('ascent_f19'))).toBe(1);
    return k;
  }

  /** Ten minutes away, through the kernel's catch-up. The old `runOfflineProgress(g, 10 min)`. */
  function away(k: Kernel): Kernel {
    const back = game(1);
    expect(back.load(catchUp({ systems: [...systems, probe, recorder], envelope: k.save(0), ticks: 6000, now: 0 })).ok).toBe(true);
    return back;
  }

  it('control: cleared during live play, the log says it once', () => {
    const k = start();
    clearFloors(k, ['ascent_f20']);
    for (let i = 0; i < 3000 && !counterOf(k, floorXpKey('ascent_f20')); i++) k.tick();
    expect(told(k)).toBe(1);
  });

  it('cleared while away: the summary carries the notice, and the ladder says it too', () => {
    const k = start();
    clearFloors(k, ['ascent_f20']);
    const back = away(k);
    // The summary's line: the log after catch-up holds it once.
    expect(told(back)).toBe(1);
    expect(counterOf(back, floorXpKey('ascent_f20'))).toBe(1);
    expect(towerView(back).endNotice).toBe(NOTICE);
    // Back in live play the clear is already stamped.
    for (let i = 0; i < 500; i++) back.tick();
    expect(told(back)).toBe(1);
  });

  it('an absence after the ladder had already ended carries nothing', () => {
    const k = start();
    clearFloors(k, ['ascent_f20']);
    for (let i = 0; i < 3000 && !counterOf(k, floorXpKey('ascent_f20')); i++) k.tick();
    expect(told(k)).toBe(1);
    const back = away(k);
    // Nothing new: the one line is the live clear's.
    expect(told(back)).toBe(1);
  });

  it('an absence that does not clear floor 20 carries nothing', () => {
    const k = start();
    const back = away(k);
    expect(told(back)).toBe(0);
  });
});

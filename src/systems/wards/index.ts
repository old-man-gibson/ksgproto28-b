/**
 * Band 3's ward windows (old `systems/wards.ts`, `data/wards.data.ts`): a
 * threat that opens on a ward's position and stays for a number of ticks of
 * play. Ward 7's demon is the only one: it appears when ward 7 is the last
 * ward left and is gone 24 in-game hours of play later. See README.md.
 *
 * - **Open.** When the floor's position (`band:pos:<floor>`, kept by the
 *   ladder's clear) reaches `position` with the floor uncleared and
 *   `doneKey` unset, `atKey` is set to the tick.
 * - **The clock** (`wardClockKey`) counts live ticks only: one per tick
 *   while the window is open and the kernel is not catching up
 *   (`ctx.catchingUp`, docs/KERNEL.md decision 34). Offline time does not
 *   run the window down.
 * - **Fought.** `foughtKey` is set when a fight with `monsterId` at `spotId`
 *   closes with the threat having lost HP, or the threat is killed there,
 *   while the window is open.
 * - **Killed.** The spot's `stampOnClear` writes `doneKey` (combat). The
 *   window does nothing more: no flag.
 * - **Lapsed.** Once the clock reaches `ticks` with `doneKey` unset and no
 *   live fight with the threat at its spot, `goneKey`, `doneKey` and one
 *   flag are set: `flags.fought` if the threat was fought (or keeps
 *   wounds), else `flags.unmet`. Then the ladder checks the clears, which
 *   writes the lapse line and pays no clear XP.
 *
 * Every window key is a run counter of `counters`; this system has no slice
 * of its own.
 */
import { defineSystem, on, registry, s, type Ctx, type DeepReadonly } from '../../kernel';
import clock, { totalTicksOf } from '../clock';
import combat, { enemyKilled, fightClosed, liveEnemies } from '../combat';
import counters, { counterValue, setCounter, type ConditionReader, type CountersState } from '../counters';
import { bandPosKey, checkClears, FLOORS, floorCleared, ladderReader, registerLapse } from '../ladder';
import { MONSTERS } from '../monsters';
import wardWindowsData from './content/ward_windows.json';
import { migrations } from './migrations';

export * from './validation';

// ---- content ----

const wardWindows = registry(
  s.object({
    id: s.id(),
    floorId: s.ref('floors', { help: 'A floor of an any-order band.' }),
    position: s.number({ integer: true, min: 0, help: 'Opens when this many other floors of the band are cleared.' }),
    ticks: s.number({ integer: true, min: 1, help: 'Live ticks the window stays open.' }),
    spotId: s.ref('spots'),
    monsterId: s.ref('monsters'),
    doneKey: s.string({ help: 'The run counter the floor clear reads.' }),
    atKey: s.string({ help: 'The tick the window opened.' }),
    goneKey: s.string({ help: 'Set to 1 when the window closes unkilled, with doneKey.' }),
    foughtKey: s.string({ help: 'Set to 1 once any fight with the threat has happened.' }),
    flags: s.object({ fought: s.string(), unmet: s.string() }),
  }),
  wardWindowsData,
  'Ward windows',
);

export interface WardWindowDef {
  id: string;
  floorId: string;
  position: number;
  ticks: number;
  spotId: string;
  monsterId: string;
  doneKey: string;
  atKey: string;
  goneKey: string;
  foughtKey: string;
  flags: { fought: string; unmet: string };
}

export const WARD_WINDOWS: readonly WardWindowDef[] = wardWindowsData as WardWindowDef[];

/** The run counter of a window's live ticks since it opened. Derived, so the def names it nowhere. */
export function wardClockKey(w: Pick<WardWindowDef, 'atKey'>): string {
  return `${w.atKey}:clock`;
}

/** A counter is set when present at all: the open tick may be 0. */
function isSet(state: DeepReadonly<CountersState>, key: string): boolean {
  return state.counts[key] !== undefined;
}

/** Open, not yet killed or lapsed. */
function windowOpen(state: DeepReadonly<CountersState>, w: WardWindowDef): boolean {
  return isSet(state, w.atKey) && counterValue(state, w.doneKey) < 1;
}

// The ladder reads a lapse through this (old `clearLapsed`).
registerLapse((r: ConditionReader, floorId: string) =>
  WARD_WINDOWS.some((w) => w.floorId === floorId && r.counter(w.goneKey) >= 1),
);

export interface WardsState {}

type W = Ctx<WardsState>;

function markFought(ctx: W, w: WardWindowDef): void {
  const counts = ctx.read(counters);
  if (windowOpen(counts, w) && counterValue(counts, w.foughtKey) < 1) ctx.emit(setCounter, { key: w.foughtKey, value: 1 });
}

/** Stamp the opening tick once the floor's position reaches the window's. */
function openWindow(ctx: W, w: WardWindowDef): void {
  if (counterValue(ctx.read(counters), bandPosKey(w.floorId)) < w.position) return;
  const floor = FLOORS[w.floorId];
  if (!floor || floorCleared(ladderReader(ctx), floor)) return;
  // The clock's count, the old `totalTicks`: the clock ticks first, so this
  // tick is already counted.
  ctx.emit(setCounter, { key: w.atKey, value: totalTicksOf(ctx.read(clock)) });
}

/**
 * The time ran out with the threat alive. A live fight with it is waited
 * out: its kill writes `doneKey` and ends the window with no flag; any other
 * ending leaves the clock full, and the next tick lands here again.
 */
function lapseWindow(ctx: W, w: WardWindowDef): void {
  const c = ctx.read(combat);
  if (c.fight && c.site?.id === w.spotId && liveEnemies(c.fight).some((e) => e.defId === w.monsterId)) return;
  const counts = ctx.read(counters);
  // Kept wounds are a fight's mark too: a fight left by closing the game keeps them.
  const wounds = MONSTERS[w.monsterId]?.keepsWounds;
  const fought = counterValue(counts, w.foughtKey) >= 1 || (wounds !== undefined && counterValue(counts, wounds.key) > 0);
  ctx.emit(setCounter, { key: w.goneKey, value: 1 });
  ctx.emit(setCounter, { key: w.doneKey, value: 1 });
  ctx.emit(setCounter, { key: fought ? w.flags.fought : w.flags.unmet, value: 1 });
  // The ward's clear pays now (the lapse line, the band stamp, the other
  // wards' positions), not on the next kill or arrival.
  ctx.emit(checkClears, undefined);
}

/**
 * Open, run and lapse each window. The old `tickWards`. Exported so a test
 * can run the window step alone, as the old tests did; the system's tick is
 * the only caller in the game.
 */
export function tickWards(ctx: W): void {
  for (const w of WARD_WINDOWS) {
    const counts = ctx.read(counters);
    if (counterValue(counts, w.doneKey) >= 1) continue;
    if (!isSet(counts, w.atKey)) {
      openWindow(ctx, w);
      continue;
    }
    const key = wardClockKey(w);
    let clock = counterValue(counts, key);
    if (!ctx.catchingUp && clock < w.ticks) {
      clock += 1;
      ctx.emit(setCounter, { key, value: clock });
    }
    if (clock >= w.ticks) lapseWindow(ctx, w);
  }
}

// ---- view ----

export interface WardsView {
  windows: { id: string; floor: string; open: boolean; done: boolean; ticksLeft: number | null }[];
}

const wards = defineSystem<WardsState, WardsView>({
  id: 'wards',
  version: 1,
  migrations,
  initial: () => ({}),
  content: { ward_windows: wardWindows },
  // After combat (10) and benches (15): a kill on this tick that ends a
  // window beats its lapse. The old order put `tickWards` after the activity.
  order: 16,

  tick: (ctx) => tickWards(ctx),

  events: [
    on(fightClosed, (ctx, { payload }) => {
      for (const w of WARD_WINDOWS) {
        if (payload.site !== w.spotId) continue;
        if (payload.standing.some((e) => e.defId === w.monsterId && e.hurt)) markFought(ctx, w);
      }
    }),
    // A kill took HP too. The stamp it writes ends the window, so this only
    // keeps `foughtKey` true to its name.
    on(enemyKilled, (ctx, { payload }) => {
      for (const w of WARD_WINDOWS) {
        if (payload.site === w.spotId && payload.defId === w.monsterId) markFought(ctx, w);
      }
    }),
  ],

  // No panel: the window is secret content in the old build (no tracker, no
  // log line, no hint). The view is for tests and tools.
  view: (ctx) => {
    const counts = ctx.read(counters);
    return {
      windows: WARD_WINDOWS.map((w) => ({
        id: w.id,
        floor: w.floorId,
        open: windowOpen(counts, w),
        done: counterValue(counts, w.doneKey) >= 1,
        ticksLeft: isSet(counts, w.atKey) ? Math.max(0, w.ticks - counterValue(counts, wardClockKey(w))) : null,
      })),
    };
  },
});

export default wards;

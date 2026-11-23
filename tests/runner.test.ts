import { describe, expect, it } from 'vitest';
import {
  catchUp,
  createKernel,
  defineCommand,
  defineEvent,
  defineSystem,
  handle,
  OK,
  on,
  runHeadless,
  type Kernel,
  type ScheduledCommand,
} from '../src/kernel';
import { systems } from '../src/systems';
import { buyStep } from '../src/systems/counter';
import type { CountersState } from '../src/systems/counters';
import { bandPosKey, FLOORS } from '../src/systems/ladder';
import { acceptedKey } from '../src/systems/quests';
import { SEA, SEA_CRATES_OFFLINE, SEA_CRATES_WON, SEA_SIDES } from '../src/systems/sea';
import { WARD_WINDOWS, wardClockKey } from '../src/systems/wards';
import { makeKernel, patch } from './helpers';

describe('headless runner', () => {
  it('runs N ticks and the commands at their ticks', () => {
    const kernel = makeKernel();
    const result = runHeadless(kernel, {
      ticks: 300,
      commands: [
        { at: 200, command: buyStep({ stepId: 'small_step' }) },
        { at: 0, command: buyStep({ stepId: 'small_step' }) },
        { at: 300, command: buyStep({ stepId: 'nope' }) },
        { at: 999, command: buyStep({ stepId: 'small_step' }) }, // past the end: not run
      ],
    });
    expect(result.ticks).toBe(300);
    expect(kernel.tickCount).toBe(300);
    expect(result.results.map((entry) => [entry.at, entry.result.ok])).toEqual([
      [0, false],
      [200, true],
      [300, false],
    ]);
  });

  it('reports progress', () => {
    const seen: number[] = [];
    runHeadless(makeKernel(), { ticks: 250, progressEvery: 100, onProgress: (done) => seen.push(done) });
    expect(seen).toEqual([100, 200]);
  });
});

describe('offline catch-up', () => {
  const commands: ScheduledCommand[] = [{ at: 500, command: buyStep({ stepId: 'small_step' }) }];

  it('gives the same state as running the same ticks and commands in place', () => {
    const start = makeKernel();
    start.tick(123);
    const envelope = start.save(1000);

    // Through JSON text both ways, as a worker message would carry it.
    const returned = JSON.parse(
      JSON.stringify(catchUp({ systems, envelope: JSON.parse(JSON.stringify(envelope)), ticks: 4000, commands, now: 2000 })),
    );
    const viaCatchUp = makeKernel();
    expect(viaCatchUp.load(returned).ok).toBe(true);

    runHeadless(start, { ticks: 4000, commands });
    expect(viaCatchUp.snapshot()).toEqual(start.snapshot());
    expect(returned.savedAt).toBe(2000);
  });

  it('throws when the envelope does not load', () => {
    expect(() =>
      catchUp({ systems, envelope: { format: 0 } as never, ticks: 10, now: 0 }),
    ).toThrow(/could not load/);
  });

  // The 8-hour budget of this runner is in tests/budgets.test.ts.
});

/**
 * Kernel change K1 (docs/KERNEL.md decision 34): `ctx.catchingUp` is true in
 * every handler of a `catchUp` run and false elsewhere, `runHeadless` on a
 * live kernel included. The equality case above holds for content with no
 * clock of live play. The systems that read the flag, each with a case:
 * - `wards`: a ward window's clock counts live ticks only.
 * - `sea`: a convoy leg sailed while catching up pays a share of its crates
 *   as cargo and none to `sea:crates:won` (step 4 port C3).
 * The festival (step 4 port C4) does not read the flag: it stops the
 * catch-up while it holds the player (decision 35, below; its cases are in
 * tests/festival.test.ts).
 */
/**
 * Kernel decision 35 (step 4 port C4): a system's `catchUpHold`. `catchUp`
 * asks every system that declares it before each tick; on the first true it
 * stops and the holder's `held` gets the ticks left. `runHeadless` asks only
 * with `hold`, which `catchUp` sets.
 */
describe('a catch-up hold', () => {
  interface Gate {
    shut: boolean;
    ticks: number;
    left: number;
  }
  /** Counts its ticks; shuts itself at tick 5; its hold reads the kept flag. */
  let kept: { slice: object | null; shut: boolean } = { slice: null, shut: false };
  const shutAt = defineCommand<void>('gate/shut');
  const gate = defineSystem<Gate>({
    id: 'gate',
    version: 1,
    initial: () => ({ shut: false, ticks: 0, left: -1 }),
    tick: (ctx) => {
      ctx.state.ticks += 1;
      if (ctx.state.ticks === 5) {
        ctx.state.shut = true;
        kept = { slice: ctx.state, shut: true };
      }
    },
    commands: [
      handle(shutAt, (ctx) => {
        ctx.state.shut = true;
        kept = { slice: ctx.state, shut: true };
        return OK;
      }),
    ],
    catchUpHold: {
      holds: (ctx) => (ctx.state === kept.slice ? kept.shut : (kept = { slice: ctx.state, shut: ctx.state.shut }).shut),
      held: (ctx, left) => {
        ctx.state.left = left;
      },
    },
  });
  const gateOf = (envelope: ReturnType<Kernel['save']>) => envelope.slices.gate.data as unknown as Gate;

  it('stops on the first tick it holds and hands the holder the ticks left', () => {
    const k = makeKernel([gate]);
    const after = catchUp({ systems: [...systems, gate], envelope: k.save(0), ticks: 100, now: 0 });
    expect(gateOf(after)).toEqual({ shut: true, ticks: 5, left: 95 });
    const tickOf = (e: ReturnType<Kernel['save']>) => (e.kernel.data as { tick: number }).tick;
    expect(tickOf(after)).toBe(tickOf(k.save(0)) + 5);
  });

  it('runs no tick when it holds from the start', () => {
    const k = makeKernel([gate]);
    expect(k.dispatch(shutAt()).ok).toBe(true);
    const before = k.save(0);
    const after = catchUp({ systems: [...systems, gate], envelope: before, ticks: 100, now: 0 });
    expect(gateOf(after)).toEqual({ shut: true, ticks: 0, left: 100 });
    expect(after.kernel).toEqual(before.kernel);
  });

  it('is not asked by runHeadless on a live kernel', () => {
    const k = makeKernel([gate]);
    expect(runHeadless(k, { ticks: 20 }).ticks).toBe(20);
    expect(k.snapshot().slices.gate).toEqual({ shut: true, ticks: 20, left: -1 });
  });
});

/**
 * Kernel decision 36 (K2, branch step3-gaps): a system's `playHold`.
 * `kernel.tick()` asks every system that declares it before each tick; on
 * the first true no system ticks, the tick number stays, and the holder's
 * `held` runs and drains. Commands and views are not held. A play holder
 * declares a catch-up hold with the same `holds`; catch-up asks only that,
 * once per tick. The keeper's dare is the one holder
 * (tests/training.test.ts); port F reuses it.
 */
describe('a play hold', () => {
  interface Latch {
    on: boolean;
    ticks: number;
    held: number;
    /** Tick on which the latch's own tick sets the hold; -1 for never. */
    setAt: number;
  }
  interface Watch {
    ticks: number;
    heard: number;
  }
  /** One boolean per latch slice object, as decision 35 asks of a hold. */
  let kept: { slice: object | null; on: boolean } = { slice: null, on: false };
  const keep = (slice: object, on: boolean) => (kept = { slice, on });
  /** Asks of the latch's `holds`, to count them. */
  let asks = 0;
  const latchHolds = (ctx: { state: Latch }) => {
    asks += 1;
    return ctx.state === kept.slice ? kept.on : keep(ctx.state, ctx.state.on).on;
  };
  const setLatch = defineCommand<{ on: boolean }>('latch/set');
  const heldEvent = defineEvent<void>('latch/held');
  const latch = defineSystem<Latch>({
    id: 'latch',
    version: 1,
    initial: () => ({ on: false, ticks: 0, held: 0, setAt: -1 }),
    tick: (ctx) => {
      ctx.state.ticks += 1;
      if (ctx.state.ticks === ctx.state.setAt) {
        ctx.state.on = true;
        keep(ctx.state, true);
      }
    },
    commands: [
      handle(setLatch, (ctx, { on }) => {
        ctx.state.on = on;
        keep(ctx.state, on);
        return OK;
      }),
    ],
    playHold: {
      holds: latchHolds,
      held: (ctx) => {
        ctx.state.held += 1;
        ctx.emit(heldEvent, undefined);
      },
    },
    catchUpHold: {
      holds: latchHolds,
      held: (ctx, left) => {
        ctx.state.held += left;
      },
    },
  });
  /** A second holder that always holds, after the latch in system order. */
  const always = defineSystem<{ held: number }>({
    id: 'zz-always',
    version: 1,
    initial: () => ({ held: 0 }),
    playHold: {
      holds: () => true,
      held: (ctx) => {
        ctx.state.held += 1;
      },
    },
    catchUpHold: { holds: () => true, held: () => {} },
  });
  const watch = defineSystem<Watch>({
    id: 'watch',
    version: 1,
    initial: () => ({ ticks: 0, heard: 0 }),
    tick: (ctx) => {
      ctx.state.ticks += 1;
    },
    events: [
      on(heldEvent, (ctx) => {
        ctx.state.heard += 1;
      }),
    ],
  });
  const toy = (extra: Parameters<typeof createKernel>[0]['systems'] = []) =>
    createKernel({ systems: [latch, watch, ...extra], seed: 1 });
  const slicesOf = (k: Kernel) => k.snapshot().slices as { latch: Latch; watch: Watch; 'zz-always'?: { held: number } };

  it('a tick while it holds runs no system, keeps the tick number, and runs held with its events delivered', () => {
    const k = toy();
    k.tick(4);
    expect(k.dispatch(setLatch({ on: true })).ok).toBe(true);
    k.tick(3);
    expect(k.tickCount).toBe(4);
    expect(slicesOf(k).latch).toMatchObject({ ticks: 4, held: 3 });
    expect(slicesOf(k).watch).toEqual({ ticks: 4, heard: 3 });
  });

  it('commands still run while it holds; one that lifts the hold lets the next tick run', () => {
    const k = toy();
    k.dispatch(setLatch({ on: true }));
    k.tick(2);
    expect(k.tickCount).toBe(0);
    expect(k.view().tick).toBe(0);
    expect(k.dispatch(setLatch({ on: false })).ok).toBe(true);
    k.tick(2);
    expect(k.tickCount).toBe(2);
    expect(slicesOf(k).latch).toMatchObject({ ticks: 2, held: 2 });
  });

  it('a hold set during a tick takes the ticks after it', () => {
    const k = toy();
    k.dispatch(setLatch({ on: false }));
    // Through a load, so the latch's own tick sets the hold at its fifth tick.
    const e = k.save(0);
    (e.slices.latch.data as unknown as Latch).setAt = 5;
    expect(k.load(e).ok).toBe(true);
    k.tick(10);
    expect(k.tickCount).toBe(5);
    expect(slicesOf(k).latch).toMatchObject({ ticks: 5, held: 5 });
  });

  it('after a load, the first ask reads the loaded state', () => {
    const held = toy();
    held.dispatch(setLatch({ on: true }));
    const free = toy();
    free.tick(1);
    // The kept flag belongs to `held`'s slice; `free` loads a held save and holds.
    expect(free.load(held.save(0)).ok).toBe(true);
    free.tick(3);
    expect(free.tickCount).toBe(0);
    // And a save with no hold loaded into a held kernel ticks.
    expect(held.load(toy().save(0)).ok).toBe(true);
    held.tick(3);
    expect(held.tickCount).toBe(3);
  });

  it('the first holder in system order takes the tick; the others are not asked', () => {
    const k = toy([always]);
    k.dispatch(setLatch({ on: true }));
    k.tick(2);
    expect(slicesOf(k).latch.held).toBe(2);
    expect(slicesOf(k)['zz-always']?.held).toBe(0);
    k.dispatch(setLatch({ on: false }));
    k.tick(2);
    expect(slicesOf(k)['zz-always']?.held).toBe(2);
    expect(k.tickCount).toBe(0);
  });

  it('catch-up asks once per tick: the catch-up ask covers the play hold', () => {
    const k = toy();
    asks = 0;
    expect(runHeadless(k, { ticks: 10, hold: true }).ticks).toBe(10);
    expect(asks).toBe(10);
    asks = 0;
    k.tick(10);
    expect(asks).toBe(10);
    // Held from the start: the catch-up hold takes the rest, no tick runs.
    k.dispatch(setLatch({ on: true }));
    const result = runHeadless(k, { ticks: 30, hold: true });
    expect(result).toMatchObject({ ticks: 0, heldBy: 'latch' });
    expect(slicesOf(k).latch).toMatchObject({ ticks: 20, held: 30 });
  });

  it('a play hold without a catch-up hold is refused at declaration', () => {
    expect(() =>
      defineSystem<{ n: number }>({
        id: 'lone',
        version: 1,
        initial: () => ({ n: 0 }),
        playHold: { holds: () => false, held: () => {} },
      }),
    ).toThrow(/a play hold needs a catch-up hold/);
  });

  it('runHeadless counts its loop, not the kernel tick: held ticks are spent', () => {
    const k = toy();
    k.dispatch(setLatch({ on: true }));
    expect(runHeadless(k, { ticks: 7 }).ticks).toBe(7);
    expect(k.tickCount).toBe(0);
    expect(slicesOf(k).latch.held).toBe(7);
  });
});

describe('systems that behave differently in catch-up', () => {
  const W = WARD_WINDOWS[0];
  const clockKey = wardClockKey(W);

  /** Wards 8 to 10 cleared, ward 7's position 3: the demon's window opens on the first tick. */
  function windowOpen(): Kernel {
    const kernel = makeKernel();
    patch(kernel, (slices) => {
      const counts = (slices.counters as CountersState).counts;
      for (const id of ['ascent_f8', 'ascent_f9', 'ascent_f10']) {
        for (const c of FLOORS[id].clear ?? []) if (c.type === 'stat') counts[c.key] = c.value;
      }
      counts[bandPosKey(W.floorId)] = 3;
    });
    kernel.tick();
    const counts = kernel.snapshot().slices.counters as CountersState;
    expect(counts.counts[W.atKey]).toBeDefined();
    return kernel;
  }

  const clockOf = (snapshot: { slices: Record<string, unknown> }) => (snapshot.slices.counters as CountersState).counts[clockKey] ?? 0;

  it('wards: a ward window clock does not advance under catchUp, and does under runHeadless on a live kernel', () => {
    const live = windowOpen();
    const before = clockOf(live.snapshot());

    const returned = catchUp({ systems, envelope: live.save(1000), ticks: 500, now: 2000 });
    const viaCatchUp = makeKernel();
    expect(viaCatchUp.load(returned).ok).toBe(true);
    expect(viaCatchUp.tickCount).toBe(live.tickCount + 500);
    expect(clockOf(viaCatchUp.snapshot())).toBe(before);

    runHeadless(live, { ticks: 500 });
    expect(clockOf(live.snapshot())).toBe(before + 500);
  });

  /** A navy player on the roadstead, the fourth leg of a convoy 10 ticks off, no fight in the way. */
  function atTheRoadstead(): Kernel {
    const kernel = makeKernel();
    patch(kernel, (slices) => {
      const counts = (slices.counters as CountersState).counts;
      counts['legacy:stronghold'] = 1;
      counts[acceptedKey(SEA_SIDES.navy.joinQuest)] = 1;
      slices.quests.quests[SEA_SIDES.navy.joinQuest] = { status: 'active', progress: [0] };
      slices.world.spot = 'f11_roadstead';
      slices.world.activity = 'hunt';
      slices.world.discovered.push('f11_roadstead');
      slices.combat.respawnTimer = 100_000;
      slices.clock.totalTicks = 2 * SEA.convoyTicks + SEA.legs * SEA.legTicks - 10;
    });
    return kernel;
  }

  const crates = (snapshot: { slices: Record<string, unknown> }) => {
    const counts = (snapshot.slices.counters as CountersState).counts;
    return { won: counts[SEA_CRATES_WON] ?? 0, offline: counts[SEA_CRATES_OFFLINE] ?? 0, leg: counts['sea:f11_roadstead:leg'] ?? 0 };
  };

  it('sea: a leg ending under catchUp credits crates offline, and under runHeadless crates won', () => {
    const live = atTheRoadstead();
    const returned = catchUp({ systems, envelope: live.save(1000), ticks: 30, now: 2000 });
    const viaCatchUp = makeKernel();
    expect(viaCatchUp.load(returned).ok).toBe(true);
    const away = crates(viaCatchUp.snapshot());
    expect(away.leg).toBe(SEA.legs);
    expect(away.won).toBe(0);
    expect(away.offline).toBeGreaterThan(0);

    runHeadless(live, { ticks: 30 });
    const here = crates(live.snapshot());
    expect(here.leg).toBe(SEA.legs);
    expect(here.offline).toBe(0);
    expect(here.won).toBe(away.offline);
  });
});

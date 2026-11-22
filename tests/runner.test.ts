import { describe, expect, it } from 'vitest';
import { catchUp, runHeadless, type Kernel, type ScheduledCommand } from '../src/kernel';
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
 * Later: the festival clock.
 */
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

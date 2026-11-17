import { describe, expect, it } from 'vitest';
import { catchUp, createKernel, OFFLINE_CAP_MS, offlineTicks, runHeadless, type ScheduledCommand } from '../src/kernel';
import { systems } from '../src/systems';
import { buyStep } from '../src/systems/counter';
import { makeKernel } from './helpers';

/** Wall-clock limit for simulating 8 hours of ticks with the toy system. */
// Raised from 2,000 in spine port 4: the combat system adds a tick and three
// event handlers. Measured 929 ms alone and 1,447 ms inside the full test run.
const EIGHT_HOUR_BUDGET_MS = 3000;

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

  it(`simulates 8 hours of ticks within ${EIGHT_HOUR_BUDGET_MS} ms`, () => {
    const ticks = offlineTicks(OFFLINE_CAP_MS);
    expect(ticks).toBe(288_000);
    const kernel = createKernel({ systems, seed: 9 });
    kernel.tick(200);
    kernel.dispatch(buyStep({ stepId: 'small_step' }));
    const envelope = kernel.save(0);

    const started = performance.now();
    const result = catchUp({ systems, envelope, ticks, now: OFFLINE_CAP_MS });
    const elapsed = performance.now() - started;

    expect((result.kernel.data as { tick: number }).tick).toBe(200 + ticks);
    expect(elapsed, `8 hours took ${elapsed.toFixed(0)} ms`).toBeLessThan(EIGHT_HOUR_BUDGET_MS);
    // The test's own time limit is above the budget, so the budget is what fails.
  }, EIGHT_HOUR_BUDGET_MS * 5);
});

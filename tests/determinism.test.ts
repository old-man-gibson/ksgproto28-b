import { describe, expect, it } from 'vitest';
import { createKernel, runHeadless, type ScheduledCommand } from '../src/kernel';
import { systems } from '../src/systems';
import { buyStep } from '../src/systems/counter';

const commands: ScheduledCommand[] = [
  { at: 0, command: buyStep({ stepId: 'small_step' }) }, // skipped: count is 0
  { at: 150, command: buyStep({ stepId: 'small_step' }) },
  { at: 400, command: buyStep({ stepId: 'small_step' }) },
  { at: 900, command: buyStep({ stepId: 'big_step' }) },
  { at: 2500, command: buyStep({ stepId: 'doubler' }) },
];

function run(seed: number) {
  const kernel = createKernel({ systems, seed });
  const result = runHeadless(kernel, { ticks: 5000, commands });
  return { kernel, result };
}

describe('determinism', () => {
  it('gives the same state for the same seed and the same commands', () => {
    const a = run(2026);
    const b = run(2026);
    expect(a.kernel.snapshot()).toEqual(b.kernel.snapshot());
    expect(a.result).toEqual(b.result);
    // The run did something: commands ran and the generator was used.
    expect(a.result.results.some((entry) => entry.result.ok)).toBe(true);
    expect(a.kernel.snapshot().kernel.tick).toBe(5000);
    expect(a.kernel.snapshot().kernel.rng).not.toBe(2026);
  });

  it('gives a different state for a different seed', () => {
    expect(run(2026).kernel.snapshot()).not.toEqual(run(2027).kernel.snapshot());
  });

  it('gives the same state when the run is split by a save and a load', () => {
    const whole = run(77).kernel;

    const first = createKernel({ systems, seed: 77 });
    runHeadless(first, { ticks: 2000, commands: commands.filter((c) => c.at < 2000) });
    const second = createKernel({ systems, seed: 1 });
    expect(second.load(JSON.parse(JSON.stringify(first.save(0)))).ok).toBe(true);
    runHeadless(second, {
      ticks: 3000,
      commands: commands.filter((c) => c.at >= 2000).map((c) => ({ ...c, at: c.at - 2000 })),
    });

    expect(second.snapshot()).toEqual(whole.snapshot());
  });

  it('keeps derived values in step with state through the run', () => {
    expect(run(5).kernel.staleStats()).toEqual([]);
  });
});

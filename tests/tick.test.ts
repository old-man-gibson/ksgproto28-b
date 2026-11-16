import { describe, expect, it } from 'vitest';
import {
  createRng,
  MAX_TICKS_PER_FRAME,
  MS_PER_TICK,
  OFFLINE_CAP_MS,
  offlineTicks,
  TickAccumulator,
  TPS,
} from '../src/kernel';

describe('tick timing', () => {
  it('runs 10 ticks per second', () => {
    expect(TPS).toBe(10);
    expect(MS_PER_TICK).toBe(100);
  });

  it('accumulates partial frames', () => {
    const acc = new TickAccumulator();
    expect(acc.advance(60)).toBe(0);
    expect(acc.advance(60)).toBe(1);
    expect(acc.advance(80)).toBe(1);
    expect(acc.advance(1000)).toBe(10);
  });

  it('caps the ticks of one frame and drops the remainder', () => {
    const acc = new TickAccumulator();
    expect(acc.advance(60_000)).toBe(MAX_TICKS_PER_FRAME);
    expect(acc.advance(99)).toBe(0);
    expect(acc.advance(1)).toBe(1);
  });

  it('ignores zero, negative and non-finite elapsed time', () => {
    const acc = new TickAccumulator();
    expect(acc.advance(0)).toBe(0);
    expect(acc.advance(-500)).toBe(0);
    expect(acc.advance(Number.NaN)).toBe(0);
  });

  it('caps offline ticks at the offline cap', () => {
    expect(offlineTicks(1000)).toBe(10);
    expect(offlineTicks(OFFLINE_CAP_MS * 3)).toBe((OFFLINE_CAP_MS / 1000) * TPS);
    expect(offlineTicks(-1)).toBe(0);
  });
});

describe('random generator', () => {
  it('keeps its whole state in the cell', () => {
    let cellA = 42;
    let cellB = 42;
    const a = createRng({ get: () => cellA, set: (v) => (cellA = v) });
    const b = createRng({ get: () => cellB, set: (v) => (cellB = v) });
    const first = [a.next(), a.next(), a.next()];
    expect([b.next(), b.next(), b.next()]).toEqual(first);
    // Copying the cell copies the generator.
    cellB = cellA;
    expect(b.next()).toBe(a.next());
  });

  it('returns values in range', () => {
    let cell = 7;
    const rng = createRng({ get: () => cell, set: (v) => (cell = v) });
    for (let i = 0; i < 1000; i++) {
      const x = rng.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      const n = rng.int(6);
      expect(Number.isInteger(n) && n >= 0 && n < 6).toBe(true);
    }
  });
});

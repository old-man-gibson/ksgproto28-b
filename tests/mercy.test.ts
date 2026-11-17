import { describe, expect, it } from 'vitest';
import { createRng, type Rng } from '../src/kernel';
import {
  MERCY,
  MERCY_MAX_RATE,
  PROC_CAP_MAX,
  PROC_MIN_RATE,
  mercyChance,
  mercyCurve,
  mercyPick,
  mercyRate,
  mercyTracked,
  procChance,
  procRate,
  procTracked,
  rollMercyChance,
  rollMercyPick,
  rollProcChance,
  type MercyLedger,
  type MercyState,
} from '../src/systems/mercy';
import { ask, makeGame, slice } from './helpers';

/**
 * Port of the old tests/mercy.test.ts.
 *
 * Changed: the call shape. The old functions took the game state; here they
 * take a ledger and a generator, and the slice of the `mercy` system holds
 * the ledger. The last block tests the requests, which the old build did not
 * have.
 *
 * Left behind: the migration from save version 45 (the save here starts at
 * version 1).
 */

/** A ledger and a seeded generator, as the old tests used a fresh state per case. */
function fresh(seed: number): { ledger: MercyLedger; rng: Rng; cell: { value: number } } {
  const cell = { value: seed >>> 0 };
  const rng = createRng({ get: () => cell.value, set: (v) => (cell.value = v) });
  return { ledger: {}, rng, cell };
}

/** Long-run rate a curve delivers, computed, not sampled. */
function achievedRate(base: number, slope: number, cap = 1): number {
  let sum = 0;
  let survival = 1;
  for (let n = 0; n < 500_000 && survival > 1e-13; n++) {
    sum += survival;
    const p = Math.min(cap, base + n * slope);
    if (p >= 1) break;
    survival *= 1 - p;
  }
  return 1 / sum;
}

/** Wait-length percentiles under a curve. */
function percentile(base: number, slope: number, q: number): number {
  let survival = 1;
  for (let n = 1; n < 500_000; n++) {
    survival *= 1 - Math.min(1, base + (n - 1) * slope);
    if (1 - survival >= q) return n;
  }
  return Infinity;
}

const RATES = [0.15, 0.12, 0.05, 0.04, 0.03, 0.02, 0.01, 0.005, 0.001];

describe('the mercy curve', () => {
  it('holds the authored rate exactly, at every rate and every mercy', () => {
    for (const rate of RATES) {
      for (const mercy of [0.25, 0.5, MERCY, 1]) {
        const { base, slope } = mercyCurve(rate, mercy);
        expect(achievedRate(base, slope) / rate, `rate ${rate} mercy ${mercy}`).toBeCloseTo(1, 5);
      }
    }
  });

  it('starts below nominal and climbs, never past certainty', () => {
    const { base, slope } = mercyCurve(0.01);
    expect(base).toBeLessThan(0.01);
    expect(slope).toBeGreaterThan(0);
    const { ledger } = fresh(1);
    let last = -1;
    for (const misses of [0, 1, 10, 100, 1000, 100000]) {
      ledger['k'] = misses;
      const p = mercyRate(ledger, 'k', 0.01);
      expect(p).toBeGreaterThan(last);
      expect(p).toBeLessThanOrEqual(1);
      last = p;
    }
  });

  it('cuts the tail, and moves the median the other way', () => {
    const plain = { base: 0.01, slope: 0 };
    const merciful = mercyCurve(0.01);
    expect(percentile(merciful.base, merciful.slope, 0.99)).toBeLessThan(percentile(plain.base, plain.slope, 0.99) * 0.6);
    expect(percentile(merciful.base, merciful.slope, 0.999)).toBeLessThan(
      percentile(plain.base, plain.slope, 0.999) * 0.5,
    );
    expect(percentile(merciful.base, merciful.slope, 0.5)).toBeGreaterThan(percentile(plain.base, plain.slope, 0.5));
  });

  it('leaves common rates alone', () => {
    expect(mercyTracked(MERCY_MAX_RATE)).toBe(false);
    expect(mercyTracked(0.25)).toBe(false);
    expect(mercyTracked(0)).toBe(false);
    expect(mercyTracked(0.01)).toBe(true);
    const { ledger } = fresh(2);
    ledger['k'] = 500;
    expect(mercyRate(ledger, 'k', 0.25)).toBe(0.25);
  });
});

describe('mercy in the stream', () => {
  it('delivers the authored rate over a long run, and bounds the drought', () => {
    const { ledger, rng } = fresh(7);
    const RATE = 0.02;
    const N = 200_000;
    let hits = 0;
    let dry = 0;
    let worst = 0;
    for (let i = 0; i < N; i++) {
      if (mercyChance(ledger, rng, 'gene:wolf', RATE)) {
        hits++;
        worst = Math.max(worst, dry);
        dry = 0;
      } else dry++;
    }
    expect(hits / N).toBeGreaterThan(RATE * 0.93);
    expect(hits / N).toBeLessThan(RATE * 1.07);
    // Plain geometric over this many trials would be near-certain to show a
    // drought past 400 (the 99.97th percentile is 400 at 2%).
    expect(worst).toBeLessThan(300);
  });

  it('clears the key on a hit and never leaves one behind', () => {
    const { ledger, rng } = fresh(11);
    for (let i = 0; i < 5000; i++) {
      if (mercyChance(ledger, rng, 'k', 0.05)) expect(ledger['k']).toBeUndefined();
    }
    // Both above and below the tracking threshold, a hit pays the debt off.
    ledger['loose'] = 40;
    let cleared = false;
    for (let i = 0; i < 200 && !cleared; i++) cleared = mercyChance(ledger, rng, 'loose', 0.5);
    expect(cleared).toBe(true);
    expect(ledger['loose']).toBeUndefined();
  });

  it('escalates only what missed', () => {
    const { ledger, rng } = fresh(3);
    mercyChance(ledger, rng, 'a', 0.01);
    expect(ledger['a']).toBe(1);
    expect(Object.keys(ledger)).toEqual(['a']);
  });
});

describe('mercy on a weighted table', () => {
  const table = [
    { id: 'common', weight: 60 },
    { id: 'rare', weight: 3 },
    { id: 'veryrare', weight: 1 },
    { id: 'nothing', weight: 36 },
  ];
  const keyOf = (e: { id: string }, rate: number) => (e.id !== 'nothing' && mercyTracked(rate) ? `loot:${e.id}` : null);

  it('keeps every entry on its authored share', () => {
    const { ledger, rng } = fresh(21);
    const counts: Record<string, number> = {};
    const N = 200_000;
    for (let i = 0; i < N; i++) {
      const pick = mercyPick(ledger, rng, table, keyOf);
      counts[pick.id] = (counts[pick.id] ?? 0) + 1;
    }
    for (const e of table) {
      expect(counts[e.id] / N, `${e.id} share`).toBeCloseTo(e.weight / 100, 2);
    }
  });

  it('protects the rare lines and lets the common one alone', () => {
    const { ledger, rng } = fresh(22);
    for (let i = 0; i < 500; i++) mercyPick(ledger, rng, table, keyOf);
    expect(Object.keys(ledger).sort()).toEqual(['loot:rare', 'loot:veryrare']);
  });

  it('bounds the drought on the rarest line', () => {
    const { ledger, rng } = fresh(23);
    let dry = 0;
    let worst = 0;
    for (let i = 0; i < 200_000; i++) {
      if (mercyPick(ledger, rng, table, keyOf).id === 'veryrare') {
        worst = Math.max(worst, dry);
        dry = 0;
      } else dry++;
    }
    // 1% under plain geometric would be all but certain to run past 800 here.
    expect(worst).toBeLessThan(500);
  });

  it('survives a table that is all rare lines maturing at once', () => {
    const { ledger, rng } = fresh(24);
    const allRare = [
      { id: 'a', weight: 1 },
      { id: 'b', weight: 1 },
      { id: 'c', weight: 1 },
    ];
    const key = (e: { id: string }) => `x:${e.id}`;
    for (const e of allRare) ledger[`x:${e.id}`] = 100_000;
    const pick = mercyPick(ledger, rng, allRare, key);
    expect(['a', 'b', 'c']).toContain(pick.id);
  });

  it('consumes one roll, like the plain pick it replaces', () => {
    const a = fresh(31);
    const b = fresh(31);
    mercyPick(a.ledger, a.rng, table, keyOf);
    mercyPick(b.ledger, b.rng, table, () => null);
    expect(a.cell.value).toBe(b.cell.value);
  });
});

describe('mercy on combat procs', () => {
  it('holds the authored crit rate over a long run', () => {
    const { ledger, rng } = fresh(41);
    for (const rate of [0.15, 0.2, 0.3, 0.5]) {
      let hits = 0;
      const N = 100_000;
      for (let i = 0; i < N; i++) if (procChance(ledger, rng, `proc:crit:${rate}`, rate)) hits++;
      expect(hits / N, `crit ${rate}`).toBeGreaterThan(rate * 0.95);
      expect(hits / N, `crit ${rate}`).toBeLessThan(rate * 1.05);
    }
  });

  it('cuts dry spells at the rates where a fight can feel them', () => {
    const { ledger, rng } = fresh(42);
    let dry = 0;
    let eight = 0;
    let worst = 0;
    const N = 200_000;
    for (let i = 0; i < N; i++) {
      if (procChance(ledger, rng, 'proc:crit', 0.2)) {
        worst = Math.max(worst, dry);
        dry = 0;
      } else if (++dry >= 8) eight++;
    }
    // Plain 20% spends about 17% of its swings inside a dry spell of 8 or more.
    expect(eight / N).toBeLessThan(0.1);
    expect(worst).toBeLessThan(25);
  });

  it('leaves the 5% floor exactly as it was — mercy there is backwards', () => {
    expect(procTracked(0.05)).toBe(false);
    expect(procTracked(PROC_MIN_RATE)).toBe(true);
    const a = fresh(43);
    const b = fresh(43);
    let same = true;
    for (let i = 0; i < 2000; i++) {
      if (procChance(a.ledger, a.rng, 'proc:crit', 0.05) !== b.rng.next() < 0.05) same = false;
    }
    expect(same).toBe(true);
    expect(a.ledger).toEqual({});
  });

  it('caps what a warmed-up counter can buy', () => {
    const { ledger } = fresh(44);
    ledger['proc:crit'] = 100_000;
    expect(procRate(ledger, 'proc:crit', 0.2)).toBeCloseTo(Math.min(PROC_CAP_MAX, 0.6), 6);
    expect(procRate(ledger, 'proc:crit', 0.4)).toBe(PROC_CAP_MAX);
    expect(procRate(ledger, 'proc:crit', 0.2)).toBeLessThan(1);
  });

  it('holds its rate even against the cap', () => {
    for (const rate of [0.2, 0.3, 0.5]) {
      const c = mercyCurve(rate, MERCY, Math.min(PROC_CAP_MAX, rate * 3));
      expect(achievedRate(c.base, c.slope, c.cap) / rate, `capped ${rate}`).toBeCloseTo(1, 5);
    }
  });
});

describe('mercy in the save', () => {
  it('a fresh save has an empty ledger', () => {
    expect(slice<MercyState>(makeGame(), 'mercy').ledger).toEqual({});
  });

  it.todo('v45 saves migrate with no credit for droughts already suffered (not ported: the save here starts at version 1)');
});

describe('the mercy requests', () => {
  const ledgerOf = (kernel: ReturnType<typeof makeGame>) => slice<MercyState>(kernel, 'mercy').ledger;

  it('a missed drop chance is on the ledger, and the ledger survives a save and a load', () => {
    const kernel = makeGame();
    let misses = 0;
    for (let i = 0; i < 20; i++) if (!ask(kernel, rollMercyChance, { key: 'gene:wolf', rate: 0.01 })) misses++;
    expect(misses).toBeGreaterThan(0);
    const before = ledgerOf(kernel);
    const other = makeGame();
    expect(other.load(JSON.parse(JSON.stringify(kernel.save(0)))).ok).toBe(true);
    expect(ledgerOf(other)).toEqual(before);
  });

  it('a proc under the threshold writes nothing', () => {
    const kernel = makeGame();
    for (let i = 0; i < 50; i++) ask(kernel, rollProcChance, { key: 'proc:crit', rate: 0.05 });
    expect(ledgerOf(kernel)).toEqual({});
  });

  it('a pick answers an index and tracks only the keyed entries', () => {
    const kernel = makeGame();
    const weights = [60, 3, 1, 36];
    const keys = ['common', 'loot:rare', 'loot:veryrare', null].map((k) => (k === 'common' ? null : k));
    for (let i = 0; i < 200; i++) {
      const index = ask(kernel, rollMercyPick, { weights, keys });
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(4);
    }
    for (const key of Object.keys(ledgerOf(kernel))) expect(['loot:rare', 'loot:veryrare']).toContain(key);
  });

  it('the same seed gives the same picks', () => {
    const run = () => {
      const kernel = makeGame();
      return Array.from({ length: 50 }, () => ask(kernel, rollMercyPick, { weights: [5, 1, 4], keys: [null, 'k', null] }));
    };
    expect(run()).toEqual(run());
  });
});

/**
 * Drought prevention. Port of the old `engine/mercy.ts`, on a ledger and a
 * generator passed in instead of the game state.
 *
 * A plain `chance(p)` has no memory, so the wait between hits is geometric and
 * its tail is long: at 1% the 99th-percentile wait is 459 rolls against a mean
 * of 100. Here the chance climbs with every miss on record and resets on a
 * hit: `P(n) = base + n * slope`, `n` the consecutive misses. Both numbers are
 * solved (`mercyCurve`) so that the long-run rate is exactly the authored one.
 *
 * Measured at 1% (the tests assert these):
 *
 * | | plain | mercy 0.85 |
 * |---|---|---|
 * | median wait | 69 | 93 |
 * | 99th percentile | 459 | 251 |
 * | 99.9th percentile | 688 | 306 |
 *
 * The mean is fixed, so cutting the tail moves the median later.
 *
 * Two domains. Drops are tracked when they are rare (`mercyTracked`, under
 * 15%) and run with no cap. Procs (a crit) are tracked when they are common
 * (`procTracked`, 15% and up) and run capped. Escalation pays only over a run
 * longer than about `2 / rate` rolls: thousands of kills for a drop, a dozen
 * swings for a proc.
 */
import type { Rng } from '../../kernel';

/** Misses on record, by key. A key with no miss on record is absent. */
export type MercyLedger = Record<string, number>;

/**
 * How far below nominal the first roll after a hit starts, 0 to 1. 0 is plain
 * geometric; 1 leaves the first roll near zero. At 1% nominal, 0.85 leaves
 * the first roll at 0.16%.
 */
export const MERCY = 0.85;

/** Drop rates at or above this roll plain and untracked. */
export const MERCY_MAX_RATE = 0.15;

/**
 * Proc rates under this roll plain and untracked. Over 8 swings, the odds of
 * no crit at all: 5% plain 66.3%, with mercy 84.2%; 20% plain 16.8%, with
 * mercy 10.2%. Under the threshold escalation makes short dry spells more
 * likely.
 */
export const PROC_MIN_RATE = 0.15;

/**
 * A proc's escalation stops at `min(rate * 3, 75%)`. A proc counter can be
 * advanced on a cheap target and spent on a costly one; the cap removes the
 * certainty that would buy.
 */
export const PROC_CAP_MULT = 3;
export const PROC_CAP_MAX = 0.75;

/** True when a rate is rare enough for a drop to be tracked. */
export function mercyTracked(rate: number): boolean {
  return rate > 0 && rate < MERCY_MAX_RATE;
}

/** True when a proc is frequent enough to be tracked. */
export function procTracked(rate: number): boolean {
  return rate >= PROC_MIN_RATE && rate < 1;
}

export interface MercyCurve {
  /** Chance on the first roll after a hit. */
  base: number;
  /** Added per consecutive miss. */
  slope: number;
  /** The escalation stops here. 1 is no cap. */
  cap: number;
}

/** Expected rolls per hit for a curve: the sum of the odds of no hit after n rolls. */
function meanRolls(base: number, slope: number, cap: number): number {
  let sum = 0;
  let survival = 1;
  for (let n = 0; n < 500_000 && survival > 1e-13; n++) {
    sum += survival;
    const p = Math.min(cap, base + n * slope);
    if (p >= 1) break;
    survival *= 1 - p;
  }
  return sum;
}

const CURVES = new Map<number, MercyCurve>();

/**
 * Solve the curve whose long-run rate is exactly `rate`. The slope is found
 * by bisection: `base` and `slope` rise together, so the achieved rate is
 * monotonic in the slope. A `cap` is solved around, not applied afterwards.
 * Memoized on the rounded inputs.
 */
export function mercyCurve(rate: number, mercy: number = MERCY, cap: number = 1): MercyCurve {
  if (mercy <= 0 || rate <= 0 || rate >= 1) return { base: rate, slope: 0, cap: 1 };
  const key = Math.round(rate * 1e5) * 1e6 + Math.round(mercy * 1e3) * 1e3 + Math.round(cap * 1e3);
  const cached = CURVES.get(key);
  if (cached) return cached;

  const baseFor = (slope: number) => rate * (1 - mercy) + slope * mercy;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const slope = (lo + hi) / 2;
    if (1 / meanRolls(baseFor(slope), slope, cap) > rate) hi = slope;
    else lo = slope;
  }
  const slope = (lo + hi) / 2;
  const curve = { base: baseFor(slope), slope, cap };
  CURVES.set(key, curve);
  return curve;
}

/** Misses on record for a key. */
export function mercyMisses(ledger: Readonly<MercyLedger>, key: string): number {
  return ledger[key] ?? 0;
}

function curveRate(ledger: Readonly<MercyLedger>, key: string, curve: MercyCurve): number {
  return Math.min(curve.cap, curve.base + mercyMisses(ledger, key) * curve.slope);
}

/** The chance a tracked drop rolls at now. To show a rate, show the authored one. */
export function mercyRate(ledger: Readonly<MercyLedger>, key: string, rate: number, mercy: number = MERCY): number {
  if (!mercyTracked(rate)) return rate;
  return curveRate(ledger, key, mercyCurve(rate, mercy));
}

/** The same for a proc: another threshold, and capped. */
export function procRate(ledger: Readonly<MercyLedger>, key: string, rate: number): number {
  if (!procTracked(rate)) return rate;
  return curveRate(ledger, key, mercyCurve(rate, MERCY, Math.min(PROC_CAP_MAX, rate * PROC_CAP_MULT)));
}

/** Record a miss. */
export function mercyMiss(ledger: MercyLedger, key: string): void {
  ledger[key] = (ledger[key] ?? 0) + 1;
}

/** Record a hit: the key goes away. */
export function mercyHit(ledger: MercyLedger, key: string): void {
  delete ledger[key];
}

function roll(ledger: MercyLedger, rng: Rng, key: string, p: number, tracked: boolean): boolean {
  const hit = rng.next() < p;
  // A hit clears the key even on an untracked roll: a rate can climb out of
  // its band, and a counter left standing would pay out twice.
  if (hit) mercyHit(ledger, key);
  else if (tracked) mercyMiss(ledger, key);
  return hit;
}

/** Roll an independent chance under drop mercy. */
export function mercyChance(ledger: MercyLedger, rng: Rng, key: string, rate: number, mercy: number = MERCY): boolean {
  return roll(ledger, rng, key, mercyRate(ledger, key, rate, mercy), mercyTracked(rate));
}

/**
 * Roll a proc under mercy. Under `PROC_MIN_RATE` this is a plain chance and
 * writes nothing. Key it per roller and per proc: `proc:crit` for the player,
 * `proc:crit:<monster id>` for a species.
 */
export function procChance(ledger: MercyLedger, rng: Rng, key: string, rate: number): boolean {
  return roll(ledger, rng, key, procRate(ledger, key, rate), procTracked(rate));
}

/**
 * Weighted pick with mercy on the entries `keyOf` names.
 *
 * `weight / total` is a tracked entry's rate, and its mercy rate replaces it.
 * The untracked entries keep their proportions and share what is left, so in
 * a drop table the `nothing` entry absorbs the difference.
 *
 * `keyOf` returns null to opt an entry out. Draws once from the generator.
 */
export function mercyPick<T extends { weight: number }>(
  ledger: MercyLedger,
  rng: Rng,
  entries: readonly T[],
  keyOf: (entry: T, rate: number) => string | null,
  mercy: number = MERCY,
): T {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  if (total <= 0) return entries[entries.length - 1];

  const keys: (string | null)[] = [];
  const weights: number[] = [];
  let tracked = 0;
  let loose = 0;
  for (const e of entries) {
    const rate = e.weight / total;
    const key = keyOf(e, rate);
    keys.push(key);
    if (key === null) {
      weights.push(rate);
      loose += rate;
    } else {
      const p = mercyRate(ledger, key, rate, mercy);
      weights.push(p);
      tracked += p;
    }
  }

  // Tracked entries own their exact odds; the rest divide the remainder in
  // their own proportions. Two shapes fall back to plain normalization:
  // tracked demand over 100%, and a table with no untracked entry.
  const spare = Math.max(0, 1 - tracked);
  if (loose > 0) {
    for (let i = 0; i < entries.length; i++) {
      if (keys[i] === null) weights[i] = (weights[i] / loose) * spare;
    }
  }

  let at = rng.next() * weights.reduce((sum, w) => sum + w, 0);
  let picked = entries.length - 1;
  for (let i = 0; i < entries.length; i++) {
    at -= weights[i];
    if (at <= 0) {
      picked = i;
      break;
    }
  }

  for (let i = 0; i < entries.length; i++) {
    const key = keys[i];
    if (key === null) continue;
    if (i === picked) mercyHit(ledger, key);
    else mercyMiss(ledger, key);
  }
  return entries[picked];
}

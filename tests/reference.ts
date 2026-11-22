/**
 * The yardstick of the speed test (`tests/speed.test.ts`): a fixed CPU
 * workload with no game code. Seeded integer arithmetic, Map traffic, small
 * objects, a JSON round trip and a sort; about 200 ms on the machine of
 * docs/PERFORMANCE.md.
 *
 * A budget divides its run time by this workload's time, measured in the same
 * process right before the run, so a slower or a loaded machine slows both
 * sides of the ratio.
 *
 * The workload is the one the old build's yardstick time was measured with
 * (`reference.mjs` of the baseline, docs/PERFORMANCE.md section 5.1).
 * Changing it changes what every recorded old-build ratio means: a change to
 * `workload` needs the old build's yardstick time measured again
 * (docs/PERFORMANCE.md section 5.6, "Updating the old-build constants").
 */
import { performance } from 'node:perf_hooks';

/** One pass of the fixed workload. Returns a number so the work cannot be dropped. */
export function workload(): number {
  let x = 42 >>> 0;
  const rnd = () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x;
  };
  const m = new Map<string, { n: number; sum: number; tags: number[] }>();
  let acc = 0;
  for (let i = 0; i < 400_000; i++) {
    const k = `k${rnd() % 5000}`;
    const o = m.get(k) ?? { n: 0, sum: 0, tags: [] };
    o.n += 1;
    o.sum += (rnd() % 1000) / 7;
    if (o.tags.length < 8) o.tags.push(rnd() % 32);
    m.set(k, o);
    acc += o.n;
  }
  const blob = { list: [...m.entries()].slice(0, 2000).map(([k, v]) => ({ k, ...v })) };
  for (let i = 0; i < 20; i++) acc += (JSON.parse(JSON.stringify(blob)) as typeof blob).list.length;
  const arr = Array.from({ length: 200_000 }, () => rnd());
  arr.sort((a, b) => a - b);
  return acc + arr[1000];
}

export interface Yardstick {
  /** Median of the timed passes, ms. */
  ms: number;
  /** Every timed pass, ms, in run order. */
  runs: number[];
  /** (slowest - fastest) / median of the timed passes. */
  spread: number;
}

/** Sink for the workload's result. */
let sink = 0;

/** One warm-up pass (unless `warm` is false), then `passes` timed passes; the median is the yardstick. The baseline used 5 after one warm-up. */
export function measureYardstick(passes = 5, warm = true): Yardstick {
  if (warm) sink += workload();
  const runs: number[] = [];
  for (let i = 0; i < passes; i++) {
    const started = performance.now();
    sink += workload();
    runs.push(performance.now() - started);
  }
  const sorted = [...runs].sort((a, b) => a - b);
  const ms = sorted[Math.floor(sorted.length / 2)];
  return { ms, runs, spread: (sorted[sorted.length - 1] - sorted[0]) / ms };
}

/** The workload's sum, so no engine can prove it unused. */
export function yardstickSink(): number {
  return sink;
}

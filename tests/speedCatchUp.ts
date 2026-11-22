/**
 * One attempt of the speed test (`tests/speed.test.ts`, docs/PERFORMANCE.md
 * section 5.2): a garbage collection, the yardstick, 8 hours of catch-up from
 * a state's save, a yardstick after the run, and the machine's load over the
 * attempt. `tests/speedRun.ts` runs it in a fresh Node process, one process
 * per attempt, as the old build's medians were measured. The speed test
 * itself uses `loadState` and `collect` for the figures it only reports.
 */
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import v8 from 'node:v8';
import vm from 'node:vm';
import { createKernel, OFFLINE_CAP_MS, offlineTicks, parseEnvelope, runHeadless, type Kernel, type SaveEnvelope } from '../src/kernel';
import { systems } from '../src/systems';
import { measureYardstick, yardstickSink, type Yardstick } from './reference';

/**
 * A full garbage collection before each yardstick and each timed run. The
 * measuring process starts with `--expose-gc`. In a vitest worker, which
 * takes `execArgv` only for every project at once, the flag is set at run
 * time and `gc` taken from a new context created after it.
 */
function exposeGc(): (() => void) | undefined {
  const own: unknown = (globalThis as { gc?: unknown }).gc;
  if (typeof own === 'function') return own as () => void;
  try {
    v8.setFlagsFromString('--expose-gc');
    const gc: unknown = vm.runInNewContext('gc');
    return typeof gc === 'function' ? (gc as () => void) : undefined;
  } catch {
    return undefined;
  }
}
const exposedGc = exposeGc();

/** True when `collect` runs a garbage collection. */
export const canCollect = exposedGc !== undefined;
export const collect = () => exposedGc?.();

export function loadState(json: string, catchingUp: boolean): { kernel: Kernel; envelope: SaveEnvelope } {
  const parsed = parseEnvelope(json);
  if (!parsed.ok) throw new Error(parsed.error);
  // As `catchUp` (src/kernel/runner.ts) and the built page create a kernel: no content validation, no view freezing.
  const kernel = createKernel({ systems, validateContent: false, catchingUp });
  const loaded = kernel.load(parsed.value);
  if (!loaded.ok) throw new Error(loaded.error);
  return { kernel, envelope: parsed.value };
}

const kills = (envelope: SaveEnvelope) => (envelope.slices.counters.data as { counts: Record<string, number> }).counts.kills ?? 0;
const level = (envelope: SaveEnvelope) => (envelope.slices.levels.data as { level: number }).level;

/** The body of `catchUp`; the time is the `runHeadless` part, as in the baseline. */
function catchUpRun(json: string): { ms: number; kills: number; level: number } {
  const ticks = offlineTicks(OFFLINE_CAP_MS);
  const { kernel, envelope } = loadState(json, true);
  collect();
  const started = performance.now();
  runHeadless(kernel, { ticks, onProgress: () => {}, hold: true });
  const ms = performance.now() - started;
  const after = kernel.save(0);
  return { ms, kills: kills(after) - kills(envelope), level: level(after) };
}

/** Busy and total processor time of the whole machine, summed over all logical processors. */
function cpuTimes(): { busy: number; total: number } {
  let busy = 0;
  let total = 0;
  for (const { times } of os.cpus()) {
    const all = times.user + times.nice + times.sys + times.idle + times.irq;
    total += all;
    busy += all - times.idle;
  }
  return { busy, total };
}

/** The line `tests/speedRun.ts` prints its attempt on starts with this. */
export const ATTEMPT_MARK = 'SPEED_ATTEMPT ';

export interface Attempt {
  yard: Yardstick;
  /** A yardstick right after the run, reported only: it shows whether the machine's load changed during the run. */
  after: Yardstick;
  run: { ms: number; kills: number; level: number };
  ratio: number;
  /** Share of all logical processors busy from the first yardstick pass to the last, this process included. */
  load: number;
  /** Whether a garbage collection ran before each timed span. */
  collected: boolean;
  /** The workload's sum modulo 10, so no engine can prove the yardstick unused. */
  sink: number;
}

export function attempt(json: string): Attempt {
  const cpu = cpuTimes();
  collect();
  const yard = measureYardstick();
  const run = catchUpRun(json);
  collect();
  const after = measureYardstick(3, false);
  const end = cpuTimes();
  return {
    yard,
    after,
    run,
    ratio: run.ms / yard.ms,
    load: (end.busy - cpu.busy) / (end.total - cpu.total),
    collected: canCollect,
    sink: yardstickSink() % 10,
  };
}

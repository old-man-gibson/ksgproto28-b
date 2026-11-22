/**
 * The speed test: the rebuild against the old build, through a yardstick
 * (docs/PERFORMANCE.md section 5, docs/KERNEL.md section 8). The vitest
 * project `speed`, run alone after `budget-world`.
 *
 * Each figure is a ratio: a run's wall-clock time divided by the time of a
 * fixed workload with no game code (`tests/reference.ts`), measured in the
 * same process right before the run. The old build's ratio is its median from
 * docs/PERFORMANCE.md section 1.1 divided by the same workload's time on the
 * same machine. A slower machine slows both sides of each ratio. A second
 * process running game code slows the run more than the yardstick
 * (docs/PERFORMANCE.md section 5.3).
 *
 * Held (fails the run):
 * - 8 hours of catch-up (288,000 ticks) in four states built from John
 *   (`tests/speedStates.ts`): rebuild ratio < FACTOR x old ratio. FACTOR is
 *   0.5 (user decision, 2026-11-21): catch-up takes at most half the old
 *   build's time. The rebuild's kills must be within 10% of the old build's,
 *   so a run that stopped hunting cannot pass on speed.
 * - Each attempt (yardstick, run) runs in a fresh Node process under
 *   vite-node (`tests/speedRun.ts`), as the old build's medians were
 *   measured. The worker builds the states and starts the processes one
 *   after the other.
 * - A state whose first attempt fails is measured once more, in a new
 *   process, and passes if the second attempt passes. Each attempt prints
 *   the machine's load during it and a yardstick taken after the run.
 *
 * Reported, not held (printed, never fails; both fail today, a later speed
 * pass fixes them), measured in the worker:
 * - Live play, headless: `kernel.tick()` plus `kernel.view()` per tick
 *   against the old `game.tick()` per tick.
 * - Save size of the floor 6 state against the old build's.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { measureYardstick, yardstickSink, type Yardstick } from './reference';
import { ATTEMPT_MARK, collect, loadState, type Attempt } from './speedCatchUp';
import { buildSpeedStates, SPEED_STATES, type SpeedState, type SpeedStates } from './speedStates';

/** Catch-up must take at most this share of the old build's time (user decision, 2026-11-21). */
const FACTOR = 0.5;

/*
 * The old build. Source: docs/PERFORMANCE.md (commit a72b168), measured
 * 2026-11-20 evening local time (2026-11-21 UTC) on an AMD Ryzen 7 7735HS,
 * 8 cores, 16 threads, Windows 11, Node 24.18.0; old `main` at 7c1267b,
 * vite-node 3.2.4, one fresh process per run, medians of 5. To change these,
 * see docs/PERFORMANCE.md section 5.6, "Updating the old-build constants".
 * Section 5.3 has a measurement of the old build by this test's method on
 * 2026-11-21, same machine: its ratios were at or above these.
 */

/** Section 1.1: 8 hours of `runOfflineProgress`, ms, median of 5. */
const OLD_CATCHUP_MS: Record<SpeedState, number> = { floor1: 20_702, floor6: 29_043, town: 6_545, floor7: 28_482 };
/** Section 1.1: kills in those 8 hours. The rebuild must do the same work: a run that stops hunting is fast. */
const OLD_KILLS: Record<SpeedState, number> = { floor1: 10_636, floor6: 11_605, town: 0, floor7: 13_008 };
/**
 * Section 5.1: the yardstick (`tests/reference.ts`) on the same machine
 * after the measurement batches, three processes, medians 199.3, 200.7 and
 * 203.5 ms. The median of the three.
 */
const OLD_YARDSTICK_MS = 200.7;
/** Section 1.2: old `game.tick()`, microseconds per tick, median of 5 (1,000 ticks warm-up, 5,000 timed). */
const OLD_TICK_US: Record<SpeedState, number> = { floor1: 94.7, floor6: 124.2, town: 35.6, floor7: 140.9 };
/** Section 1.5: the old build's floor 6 save, bytes. */
const OLD_FLOOR_SIX_SAVE_BYTES = 17_559;

/** The rebuild's kills may differ from the old build's by this share (each is a port of the other). */
const KILLS_TOLERANCE = 0.1;

const LABEL: Record<SpeedState, string> = {
  floor1: 'hunting floor 1 (Vermin Hall)',
  floor6: 'hunting floor 6 (the Tunnels)',
  town: 'idle in town (Chancery Arch)',
  floor7: 'hunting floor 7 (the Docks)',
};

/** Ticks of live play timed per state, after a warm-up. The baseline timed 5,000 after 1,000; fewer here to keep the run short. */
const LIVE_WARM = 100;
const LIVE_TICKS = 300;

const oldRatio = (name: SpeedState) => OLD_CATCHUP_MS[name] / OLD_YARDSTICK_MS;
const fmt = (n: number, digits = 0) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const yardText = (y: Yardstick) => `${fmt(y.ms, 1)} ms (passes ${y.runs.map((r) => fmt(r, 1)).join(', ')}; spread ${fmt(y.spread * 100, 1)}%)`;

/** Let the worker answer vitest between long synchronous cases. */
const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/*
 * The measuring process. vite-node is the loader the old build's medians
 * were measured with (docs/PERFORMANCE.md section 2.1) and the one
 * `npm run pacing` uses; it comes with vitest. Its config has no plugins
 * (`tests/speedRun.config.ts`). Its environment is the worker's without
 * vitest's variables, as a process started from a shell.
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VITE_NODE = join(dirname(dirname(createRequire(import.meta.url).resolve('vite-node'))), 'vite-node.mjs');
const RUN_SCRIPT = fileURLToPath(new URL('./speedRun.ts', import.meta.url));
const RUN_CONFIG = fileURLToPath(new URL('./speedRun.config.ts', import.meta.url));
/** A measuring process still running after this long is stopped and the attempt fails. */
const PROCESS_TIMEOUT_MS = 150_000;

function processEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^VITEST/.test(key) || key === 'TEST' || key === 'NODE_ENV') continue;
    env[key] = value;
  }
  return env;
}

const tail = (text: string) => text.trim().split(/\r?\n/).slice(-12).join('\n');

/** One attempt in a fresh process: start to exit, ms, and the attempt it printed. */
function attemptInProcess(name: SpeedState, json: string): Promise<{ attempt: Attempt; processMs: number }> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, ['--expose-gc', VITE_NODE, '--config', RUN_CONFIG, RUN_SCRIPT, '--', name], {
      cwd: ROOT,
      env: processEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (err += d));
    const timer = setTimeout(() => child.kill(), PROCESS_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const processMs = performance.now() - started;
      const line = out.split(/\r?\n/).find((l) => l.startsWith(ATTEMPT_MARK));
      if (code !== 0 || line === undefined) {
        const why = signal ? `stopped by ${signal} after ${fmt(processMs)} ms` : `exit code ${code}`;
        reject(new Error(`${name}: the measuring process gave no attempt (${why}):\n${tail(err) || tail(out)}`));
        return;
      }
      resolve({ attempt: JSON.parse(line.slice(ATTEMPT_MARK.length)) as Attempt, processMs });
    });
    child.stdin.end(json);
  });
}

let states: SpeedStates;
const lines: string[] = [];
let processesCollected = true;
const sinks: number[] = [];

beforeAll(() => {
  states = buildSpeedStates();
  const setup = SPEED_STATES.map((s) => `${s} ${states.setupTicks[s]}`).join(', ');
  lines.push(`John to floor 7: ${fmt(states.johnMs)} ms. Set-up ticks: ${setup}.`);
}, 120_000);

afterAll(() => {
  const gcText = processesCollected ? 'garbage collected before each timed span' : 'gc() not available in a measuring process: no collection before its timed spans';
  console.log(
    [
      `Speed test (factor ${FACTOR}, old yardstick ${OLD_YARDSTICK_MS} ms, one process per attempt, ${gcText}):`,
      ...lines,
      `(sinks ${[...sinks, yardstickSink() % 10].join(' ')})`,
    ].join('\n'),
  );
});

/** Attempts per state: a second runs only when the first fails, so a burst of load on the machine during one run does not fail the case. */
const ATTEMPTS = 2;

describe('speed against the old build: held', () => {
  for (const name of SPEED_STATES) {
    it(`8 hours of catch-up ${LABEL[name]} take at most ${FACTOR} of the old build's time, over the yardstick`, async () => {
      const limit = FACTOR * oldRatio(name);
      const tries: Attempt[] = [];
      do {
        const { attempt: a, processMs } = await attemptInProcess(name, states.json[name]);
        tries.push(a);
        sinks.push(a.sink);
        if (!a.collected) processesCollected = false;
        lines.push(
          `${name}${tries.length > 1 ? ` (attempt ${tries.length})` : ''}: ${fmt(a.run.ms)} ms, yardstick ${yardText(a.yard)}, ` +
            `after the run ${yardText(a.after)}, machine load ${fmt(a.load * 100)}%; ratio ${fmt(a.ratio, 2)}, limit ${fmt(limit, 2)} ` +
            `(${fmt((a.ratio / limit) * 100)}% of it; old ${fmt(oldRatio(name), 2)}, rebuild/old ${fmt(a.ratio / oldRatio(name), 3)}); ` +
            `${a.run.kills} kills (old ${OLD_KILLS[name]}), level ${a.run.level}; process ${fmt(processMs / 1000, 1)} s`,
        );
      } while (tries[tries.length - 1].ratio >= limit && tries.length < ATTEMPTS);
      const { run } = tries[0];
      const killsOff = OLD_KILLS[name] === 0 ? run.kills : Math.abs(run.kills - OLD_KILLS[name]) / OLD_KILLS[name];
      expect(killsOff, `${name}: ${run.kills} kills against the old build's ${OLD_KILLS[name]}`).toBeLessThanOrEqual(
        OLD_KILLS[name] === 0 ? 0 : KILLS_TOLERANCE,
      );
      const best = Math.min(...tries.map((a) => a.ratio));
      expect(
        best,
        `${name}: ` +
          tries.map((a) => `${fmt(a.run.ms)} ms over a yardstick of ${fmt(a.yard.ms, 1)} ms is ${fmt(a.ratio, 2)}`).join('; ') +
          `; ${FACTOR} x the old build's ${fmt(oldRatio(name), 2)} is ${fmt(limit, 2)}`,
      ).toBeLessThan(limit);
    }, ATTEMPTS * PROCESS_TIMEOUT_MS + 30_000);
  }
});

describe('speed against the old build: reported, not held', () => {
  it('live play, headless: kernel.tick() plus kernel.view() per tick against the old game.tick() (printed, never fails)', async () => {
    await yieldToEventLoop();
    collect();
    const yard = measureYardstick();
    lines.push(`Live play, reported, not held (${LIVE_TICKS} ticks after ${LIVE_WARM}; yardstick ${yardText(yard)}):`);
    for (const name of SPEED_STATES) {
      const { kernel } = loadState(states.json[name], false);
      for (let i = 0; i < LIVE_WARM; i++) {
        kernel.tick();
        kernel.view();
      }
      collect();
      let tickMs = 0;
      let viewMs = 0;
      for (let i = 0; i < LIVE_TICKS; i++) {
        const a = performance.now();
        kernel.tick();
        const b = performance.now();
        kernel.view();
        tickMs += b - a;
        viewMs += performance.now() - b;
      }
      const tickUs = (tickMs / LIVE_TICKS) * 1000;
      const viewUs = (viewMs / LIVE_TICKS) * 1000;
      const ratio = (tickUs + viewUs) / 1000 / yard.ms;
      const limit = (FACTOR * OLD_TICK_US[name]) / 1000 / OLD_YARDSTICK_MS;
      const tickRatio = tickUs / 1000 / yard.ms;
      lines.push(
        `  ${name}: tick ${fmt(tickUs, 1)} us + view ${fmt(viewUs, 1)} us = ${fmt(tickUs + viewUs, 1)} us (old tick ${OLD_TICK_US[name]} us); ` +
          `tick+view at ${fmt(ratio / limit, 1)} x the limit, ${ratio < limit ? 'would pass' : 'would fail'}; ` +
          `tick alone at ${fmt(tickRatio / limit, 2)} x the limit`,
      );
    }
    expect(true).toBe(true);
  }, 120_000);

  it('save size of the floor 6 state against the old build (printed, never fails)', () => {
    const { kernel } = loadState(states.json.floor6, false);
    // A 13-digit time stamp, as a page save has.
    const envelope = kernel.save(1_763_700_000_000);
    const bytes = Buffer.byteLength(JSON.stringify(envelope));
    const sizes = Object.entries(envelope.slices)
      .map(([id, s]) => [id, Buffer.byteLength(JSON.stringify(s))] as const)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, n]) => `${id} ${fmt(n)}`)
      .join(', ');
    lines.push(
      `Save size, reported, not held: floor 6 ${fmt(bytes)} bytes, old ${fmt(OLD_FLOOR_SIX_SAVE_BYTES)} bytes, ` +
        `${fmt(bytes / OLD_FLOOR_SIX_SAVE_BYTES, 2)} x the old; ${bytes <= FACTOR * OLD_FLOOR_SIX_SAVE_BYTES ? 'would pass' : 'would fail'} at ${FACTOR}, ` +
        `${bytes <= OLD_FLOOR_SIX_SAVE_BYTES ? 'would pass' : 'would fail'} at 1.0. Largest slices: ${sizes}`,
    );
    expect(bytes).toBeGreaterThan(0);
  });
});

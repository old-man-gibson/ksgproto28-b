/**
 * Headless runner. Runs a kernel for N ticks with a list of commands and no
 * DOM. Tests, balance measurement and offline catch-up all use this path.
 */
import { createKernel, type Kernel } from './kernel';
import type { SaveEnvelope } from './save';
import type { AnySystem, Command, CommandResult } from './system';

export interface ScheduledCommand {
  /** Ticks after the start of the run. 0 runs before the first tick. */
  at: number;
  command: Command;
}

export interface RunOptions {
  ticks: number;
  commands?: readonly ScheduledCommand[];
  /** Called every `progressEvery` ticks with the ticks done so far. */
  onProgress?: (done: number) => void;
  /** Default 6000 ticks, which is 10 minutes of game time. */
  progressEvery?: number;
  /**
   * Ask the systems' catch-up holds before each tick and stop on the first
   * that holds (decision 35); the tick then skips the play-hold ask, which
   * the catch-up ask covers (decision 36). Set by `catchUp` only.
   */
  hold?: boolean;
}

export interface RunResult {
  /** Ticks run. Fewer than asked when a catch-up hold stopped the run. */
  ticks: number;
  results: { at: number; type: string; result: CommandResult }[];
  /** The system whose catch-up hold stopped the run, if one did. */
  heldBy?: string;
}

export function runHeadless(kernel: Kernel, options: RunOptions): RunResult {
  const ticks = Math.max(0, Math.floor(options.ticks));
  const progressEvery = options.progressEvery ?? 6000;
  // Stable sort: commands at the same tick keep their list order.
  const pending = [...(options.commands ?? [])].sort((a, b) => a.at - b.at);
  const results: RunResult['results'] = [];
  let next = 0;
  const runDue = (at: number) => {
    while (next < pending.length && pending[next].at <= at) {
      const { command } = pending[next++];
      results.push({ at, type: command.type, result: kernel.dispatch(command) });
    }
  };
  const hold = options.hold === true;
  for (let done = 0; done < ticks; done++) {
    runDue(done);
    if (hold) {
      // The rest is the holding system's to account for; later commands do not run.
      const heldBy = kernel.catchUpHeld(ticks - done);
      if (heldBy !== null) return { ticks: done, results, heldBy };
      // That ask covered the play holds too (decision 36): one ask per tick.
      kernel.tickAfterHolds();
    } else {
      kernel.tick();
    }
    if (options.onProgress && (done + 1) % progressEvery === 0) options.onProgress(done + 1);
  }
  runDue(ticks);
  return { ticks, results };
}

export interface CatchUpInput {
  systems: readonly AnySystem[];
  envelope: SaveEnvelope;
  ticks: number;
  commands?: readonly ScheduledCommand[];
  /** Wall-clock time to stamp on the returned envelope. */
  now: number;
  onProgress?: (done: number) => void;
}

/**
 * Offline catch-up: load an envelope into a new kernel, run it, return the
 * new envelope. It takes and returns plain JSON, so it runs the same in a Web
 * Worker, in a test and on the main thread. Throws when the envelope does not
 * load.
 */
export function catchUp(input: CatchUpInput): SaveEnvelope {
  // Content was validated when the calling kernel was created.
  const kernel = createKernel({ systems: input.systems, validateContent: false, catchingUp: true });
  const loaded = kernel.load(input.envelope);
  if (!loaded.ok) throw new Error(`catch-up could not load the state: ${loaded.error}`);
  runHeadless(kernel, { ticks: input.ticks, commands: input.commands, onProgress: input.onProgress, hold: true });
  return kernel.save(input.now);
}

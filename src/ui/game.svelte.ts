/**
 * The shell's link to the kernel. The kernel and its state are plain objects
 * held in module variables; they never enter a Svelte proxy. What the UI
 * reads is `game.view`, a `$state.raw` field that is replaced by a new
 * published view after each batch of ticks and after each command.
 */
import {
  createKernel,
  MAX_TICKS_PER_FRAME,
  MS_PER_TICK,
  offlineTicks,
  SaveStore,
  TickAccumulator,
  type Command,
  type CommandResult,
  type DeepReadonly,
  type GameEvent,
  type PublishedView,
  type SystemDef,
} from '../kernel';
import { systems } from '../systems';
import { runCatchUp } from './catchup';
import { browserStorage, MODE } from './env';

const AUTOSAVE_MS = 10_000;
/** A gap longer than one frame may tick goes to catch-up. */
const CATCH_UP_AFTER_MS = MAX_TICKS_PER_FRAME * MS_PER_TICK;
const EVENT_LOG_SIZE = 30;

function newSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0;
}

const kernel = createKernel({ systems, seed: newSeed(), freezeViews: import.meta.env.DEV });
const store = new SaveStore(browserStorage(), MODE);
const acc = new TickAccumulator();
const eventLog: GameEvent[] = [];
kernel.onEvent((event) => {
  eventLog.push(event);
  if (eventLog.length > EVENT_LOG_SIZE) eventLog.shift();
});

class Game {
  view = $state.raw<PublishedView>(kernel.view());
  events = $state.raw<readonly GameEvent[]>([]);
  /** Set when the stored save could not be read or loaded. Saving is locked while set. */
  loadError = $state<string | null>(null);
  /** Progress of a running catch-up, or null. */
  catchUp = $state.raw<{ done: number; total: number } | null>(null);
  /** The last problem with saving or catch-up, or null. */
  problem = $state<string | null>(null);
  savedAt = $state<number | null>(null);
  readonly storageKey = store.key;
}

export const game = new Game();

let busy = false;
let lastFrame = 0;
/** Wall-clock time the kernel state is simulated up to. Stamped on saves. */
let simulatedAt = Date.now();
let started = false;

function publish(): void {
  game.view = kernel.view();
  game.events = [...eventLog];
}

/** Send a command to the kernel. The result carries the reason when it was skipped. */
export function send(command: Command): CommandResult {
  if (busy) return { ok: false, reason: 'catch-up is running' };
  const result = kernel.dispatch(command);
  publish();
  return result;
}

/** The published view of one system, typed by its declaration. */
export function viewOf<V>(system: SystemDef<any, V>): DeepReadonly<V> {
  return game.view.systems[system.id] as DeepReadonly<V>;
}

export function save(): void {
  // During catch-up the kernel still holds the state from before the gap.
  if (busy || !started) return;
  const result = store.write(kernel.save(simulatedAt));
  if (result.ok) {
    game.savedAt = simulatedAt;
    if (game.loadError === null) game.problem = null;
  } else {
    game.problem = result.reason;
  }
}

async function catchUpFor(elapsedMs: number): Promise<void> {
  const ticks = offlineTicks(elapsedMs);
  if (ticks <= 0) return;
  if (ticks <= MAX_TICKS_PER_FRAME) {
    kernel.tick(ticks);
    return;
  }
  busy = true;
  game.catchUp = { done: 0, total: ticks };
  try {
    const now = Date.now();
    const envelope = await runCatchUp({ envelope: kernel.save(now), ticks, now }, (done) => {
      game.catchUp = { done, total: ticks };
    });
    const loaded = kernel.load(envelope);
    if (!loaded.ok) throw new Error(loaded.error);
  } catch (err) {
    // The kernel state is unchanged: the gap is not simulated.
    game.problem = `catch-up failed: ${(err as Error).message}`;
  } finally {
    busy = false;
    game.catchUp = null;
    acc.reset();
    lastFrame = performance.now();
    simulatedAt = Date.now();
    publish();
  }
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  if (busy) return;
  const elapsed = now - lastFrame;
  lastFrame = now;
  if (elapsed > CATCH_UP_AFTER_MS) {
    // The tab was hidden or stalled. Same path as time away between sessions.
    void catchUpFor(elapsed);
    return;
  }
  const ticks = acc.advance(elapsed);
  simulatedAt = Date.now();
  if (ticks > 0) {
    kernel.tick(ticks);
    publish();
  }
}

/** Load the save, catch up on time away, start the frame loop. Call once. */
export async function boot(): Promise<void> {
  const read = store.read();
  if (!read.ok) {
    game.loadError = read.error;
  } else if (read.envelope) {
    const loaded = kernel.load(read.envelope);
    if (!loaded.ok) {
      store.lock(loaded.error);
      game.loadError = loaded.error;
    } else {
      game.savedAt = read.envelope.savedAt;
      await catchUpFor(Date.now() - read.envelope.savedAt);
    }
  }
  simulatedAt = Date.now();
  started = true;
  publish();
  lastFrame = performance.now();
  requestAnimationFrame(frame);
  setInterval(save, AUTOSAVE_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save();
  });
  window.addEventListener('pagehide', save);
}

/**
 * Leave a failed load behind: copy the stored text to a backup key, unlock
 * saving and carry on with the new game that is already running.
 */
export function setAsideBrokenSave(): string | null {
  const backupKey = store.setAsideBroken(Date.now());
  game.loadError = null;
  game.problem = null;
  save();
  return backupKey;
}

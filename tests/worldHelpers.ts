/**
 * Shared set-up of the ported world tests (navigation, map, towers, job,
 * finds, forced, worldSystem).
 *
 * The old tests wrote `state.spot`, `state.discovered` and `state.stats`
 * directly and called the system functions with the state. Here the slices are
 * patched through a save and a load, counters are set by the event, reads take
 * `reads(kernel)` and the world slice, and a change runs inside the world
 * system (a command, or the request `world/travel` for one hop).
 */
import type { Command, Kernel, KernelOptions } from '../src/kernel';
import { setCounter, type CountersState } from '../src/systems/counters';
import { ladderReader } from '../src/systems/ladder';
import { ADJACENCY, buildAdjacency, SPOTS, travelHop, type SpotDef, type WorldState } from '../src/systems/world';
import { ask, emit, makeGame, patch, reads, slice } from './helpers';

export const worldOf = (k: Kernel): WorldState => slice<WorldState>(k, 'world');

export const counterOf = (k: Kernel, key: string): number => slice<CountersState>(k, 'counters').counts[key] ?? 0;

/** Change the world slice directly, for test setup. */
export function patchWorld(k: Kernel, change: (world: WorldState) => void): void {
  patch(k, (slices) => change(slices.world as WorldState));
}

/** Mark spots discovered, as an old test pushed into `state.discovered`. */
export function discover(k: Kernel, ...spots: string[]): void {
  patchWorld(k, (w) => {
    for (const id of spots) if (!w.discovered.includes(id)) w.discovered.push(id);
  });
}

/**
 * A new game standing at `spot` with it discovered. The old
 * `createInitialState(seed, spot)`, and the old tests that wrote `state.spot`.
 */
export function gameAt(seed: number, spot: string, options: Partial<KernelOptions> = {}): Kernel {
  const k = makeGame({ seed, ...options });
  patchWorld(k, (w) => {
    w.spot = spot;
    if (!w.discovered.includes(spot)) w.discovered.push(spot);
  });
  return k;
}

/** Set counters, as an old test wrote `state.stats[key]`. */
export function setCounters(k: Kernel, values: Record<string, number>): void {
  for (const [key, value] of Object.entries(values)) emit(k, setCounter, { key, value });
}

/** One hop by a visible road or a ride: the old `startTravel` and the old `Game.travelTo`. */
export function hop(k: Kernel, to: string): boolean {
  return ask(k, travelHop, { to });
}

/** Whether a command ran. */
export function sent(k: Kernel, command: Command): boolean {
  return k.dispatch(command).ok;
}

/** Tick until the journey is over. The old `walkUntilStill`. */
export function walkUntilStill(k: Kernel, max = 2000): void {
  for (let i = 0; i < max && worldOf(k).travel; i++) k.tick();
}

/** The read arguments of a world function: the context and the slice. */
export function worldReads(k: Kernel) {
  return { ctx: reads(k), state: worldOf(k) };
}

/** The condition reader the ladder reads take. */
export function ladderOf(k: Kernel) {
  return ladderReader(reads(k));
}

/**
 * Add test spots to the registries of this test file's module graph, with
 * their roads mirrored the way the registry mirrors real ones. Returns the
 * function that removes them.
 */
export function mountSpots(spots: Record<string, SpotDef>): () => void {
  for (const [id, spot] of Object.entries(spots)) SPOTS[id] = spot;
  for (const [id, edges] of buildAdjacency(Object.values(spots))) ADJACENCY.set(id, edges);
  return () => {
    for (const id of Object.keys(spots)) {
      delete SPOTS[id];
      ADJACENCY.delete(id);
    }
  };
}

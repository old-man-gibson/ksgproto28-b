/**
 * The six offline budget runs of 8 hours, as functions, and an outcome
 * digest of a finished run. Shared by `tests/budgets.test.ts`,
 * `tests/budgetsWorld.test.ts`, `tests/outcome.test.ts` and
 * `scripts/budget-runs.ts` (profiling and digest recording).
 *
 * Each run returns the save envelope it ended at and the wall-clock time of
 * the simulated span alone (set-up excluded).
 */
import { performance } from 'node:perf_hooks';
import {
  catchUp,
  createKernel,
  OFFLINE_CAP_MS,
  offlineTicks,
  PLAYER,
  runHeadless,
  type Kernel,
  type Modifier,
  type SaveEnvelope,
  type ScheduledCommand,
} from '../src/kernel';
import { systems } from '../src/systems';
import { hunt, setHuntRest, type EncounterSite } from '../src/systems/combat';
import { buyStep } from '../src/systems/counter';
import { applyStatus } from '../src/systems/statuses';
import { spellCast } from '../src/systems/spellcraft';
import { selectActivity, type WorldState } from '../src/systems/world';
import { SITES } from './combatHelpers';
import { ask, equip, makeGame, patch, probe, setMods } from './helpers';

export const TICKS = 288_000;

/** A character that holds floor 6: the probe stands in for trained attributes, skills and gear. */
export const FLOOR_SIX_CHARACTER: Modifier[] = [
  { stat: 'stats/maxHp', kind: 'add', value: 900 },
  { stat: 'stats/damage', kind: 'add', value: 45 },
  { stat: 'stats/armor', kind: 'add', value: 12 },
];

export interface RunResult {
  ms: number;
  envelope: SaveEnvelope;
  /** The kernel the run ended in; null for the catch-up runs, which own theirs. */
  kernel: Kernel | null;
  casts: number;
}

export type RunName = 'idle' | 'poison' | 'floor1' | 'floor6' | 'world4' | 'world6';

export const RUN_NAMES: RunName[] = ['idle', 'poison', 'floor1', 'floor6', 'world4', 'world6'];

function timed(kernel: Kernel, body: () => void, casts: () => number = () => 0): RunResult {
  const started = performance.now();
  body();
  const ms = performance.now() - started;
  return { ms, envelope: kernel.save(0), kernel, casts: casts() };
}

function standAt(g: Kernel, spot: string, known: string[]): void {
  patch(g, (slices) => {
    const w = slices.world as WorldState;
    w.spot = spot;
    w.discovered = ['ascent_foot', ...known];
    w.safeSpots = { nearest: known[0], unconditional: known[0] };
  });
}

function huntCommands(site: EncounterSite): ScheduledCommand[] {
  const commands: ScheduledCommand[] = [{ at: 0, command: setHuntRest({ at: 0.5, toFull: true }) }];
  for (let at = 0; at < TICKS; at += 600) commands.push({ at, command: hunt({ site }) });
  return commands;
}

function countCasts(g: Kernel): () => number {
  let casts = 0;
  g.onEvent((event) => {
    if (event.type === spellCast.type) casts += 1;
  });
  return () => casts;
}

export const RUNS: Record<RunName, () => RunResult> = {
  /** No fight, no condition: catch-up of a new game. */
  idle() {
    const ticks = offlineTicks(OFFLINE_CAP_MS);
    const kernel = createKernel({ systems, seed: 9 });
    kernel.tick(200);
    kernel.dispatch(buyStep({ stepId: 'small_step' }));
    const envelope = kernel.save(0);
    const started = performance.now();
    const result = catchUp({ systems, envelope, ticks, now: 0 });
    return { ms: performance.now() - started, envelope: result, kernel: null, casts: 0 };
  },
  /** A timerless poison, which deals damage on every tick. */
  poison() {
    const g = makeGame({ seed: 9 });
    ask(g, applyStatus, { entity: PLAYER, app: { id: 'poison', intensity: 2, duration: 'permanent' } });
    ask(g, applyStatus, { entity: PLAYER, app: { id: 'tainted', intensity: 2, duration: 'permanent' } });
    const envelope = g.save(0);
    const started = performance.now();
    const result = catchUp({ systems: [...systems, probe], envelope, ticks: TICKS, now: 0 });
    return { ms: performance.now() - started, envelope: result, kernel: null, casts: 0 };
  },
  /** The Vermin Hall table of floor 1 sent to combat, no fight limit. */
  floor1() {
    const g = makeGame({ seed: 9 });
    equip(g, 1);
    const commands = huntCommands({ ...SITES.f1_storerooms, fightLimit: undefined });
    return timed(g, () => runHeadless(g, { ticks: TICKS, commands }));
  },
  /** The Tunnels of floor 6 sent to combat, the probe character. */
  floor6() {
    const g = makeGame({ seed: 9 });
    equip(g, 1);
    setMods(g, FLOOR_SIX_CHARACTER);
    const casts = countCasts(g);
    const commands = huntCommands({ ...SITES.f6_tunnels });
    return timed(g, () => runHeadless(g, { ticks: TICKS, commands }), casts);
  },
  /** The hunt activity at the Woods Edge of floor 4, a new character under the open sky. */
  world4() {
    const g = makeGame({ seed: 9 });
    equip(g, 1);
    standAt(g, 'f4_woods_edge', ['f4_treeline', 'f4_woods_edge']);
    if (!g.dispatch(setHuntRest({ at: 0.5, toFull: true })).ok) throw new Error('hunt rest refused');
    if (!g.dispatch(selectActivity({ activity: 'hunt' })).ok) throw new Error('hunt activity refused');
    return timed(g, () => runHeadless(g, { ticks: TICKS }));
  },
  /** The hunt activity at the Tunnels of floor 6, the probe character. */
  world6() {
    const g = makeGame({ seed: 9 });
    equip(g, 1);
    setMods(g, FLOOR_SIX_CHARACTER);
    standAt(g, 'f6_tunnels', ['f6_warren_mouth', 'f6_tunnels']);
    if (!g.dispatch(setHuntRest({ at: 0.5, toFull: true })).ok) throw new Error('hunt rest refused');
    if (!g.dispatch(selectActivity({ activity: 'hunt' })).ok) throw new Error('hunt activity refused');
    return timed(g, () => runHeadless(g, { ticks: TICKS }));
  },
};

/** FNV-1a, 32 bits, over a string. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export interface Digest {
  tick: number;
  rng: number;
  kills: number;
  defeats: number;
  level: number;
  gold: number;
  /** FNV-1a of the kernel block and every slice, as saved. */
  state: string;
}

/** The outcome of a run, from the envelope it ended at. */
export function digestOf(envelope: SaveEnvelope): Digest {
  const kernel = envelope.kernel.data as { tick: number; rng: number };
  const data = (id: string) => envelope.slices[id]?.data as any;
  const counts = (data('counters')?.counts ?? {}) as Record<string, number>;
  return {
    tick: kernel.tick,
    rng: kernel.rng,
    kills: counts.kills ?? 0,
    defeats: counts.defeats ?? 0,
    level: data('levels')?.level ?? 0,
    gold: data('gold')?.gold ?? 0,
    state: fnv1a(JSON.stringify({ kernel: envelope.kernel, slices: envelope.slices })),
  };
}

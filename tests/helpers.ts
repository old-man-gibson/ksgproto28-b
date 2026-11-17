import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createKernel,
  defineCommand,
  defineSystem,
  handle,
  OK,
  PLAYER,
  type AnySystem,
  type Ctx,
  type DeepReadonly,
  type EventDef,
  type Kernel,
  type KernelOptions,
  type Modifier,
  type SystemDef,
} from '../src/kernel';
import { systems } from '../src/systems';

export const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** A kernel over the real system list, plus any test-only systems. */
export function makeKernel(extra: AnySystem[] = [], options: Partial<KernelOptions> = {}): Kernel {
  return createKernel({ systems: [...systems, ...extra], seed: 12345, ...options });
}

// ---- the probe: a test-only system ----

interface ProbeState {
  /** Modifiers the probe's source returns, each for one entity. */
  mods: { entity: string; mod: Modifier }[];
}

const probeRun = defineCommand<(ctx: Ctx<ProbeState>) => void>('probe/run');

/**
 * A system that exists only in tests. It stands in for systems that are not
 * ported yet: its source returns whatever modifiers a test gives it, and its
 * one command runs a function with a real context, so a test can emit any
 * event the way a system would.
 */
export const probe = defineSystem<ProbeState>({
  id: 'probe',
  version: 1,
  initial: () => ({ mods: [] }),
  modifiers: [
    {
      id: 'probe/mods',
      collect: ({ state, entity }) => state.mods.filter((m) => m.entity === entity).map((m) => ({ ...m.mod })),
    },
  ],
  commands: [
    handle(probeRun, (ctx, fn) => {
      fn(ctx);
      return OK;
    }),
  ],
});

/** A kernel over the real systems and the probe. */
export function makeGame(options: Partial<KernelOptions> = {}): Kernel {
  return makeKernel([probe], options);
}

/** Emit an event the way a system would. Needs a kernel from `makeGame`. */
export function emit<P>(kernel: Kernel, event: EventDef<P>, payload: P): void {
  const result = kernel.dispatch(probeRun((ctx) => ctx.emit(event, payload)));
  if (!result.ok) throw new Error(result.reason);
}

/** Replace the modifiers the probe gives one entity. Needs a kernel from `makeGame`. */
export function setMods(kernel: Kernel, mods: Modifier[], entity: string = PLAYER): void {
  kernel.dispatch(
    probeRun((ctx) => {
      ctx.state.mods = [...ctx.state.mods.filter((m) => m.entity !== entity), ...mods.map((mod) => ({ entity, mod }))];
      ctx.touch('probe/mods', entity);
    }),
  );
}

/**
 * Change slices directly, for test setup. Goes through a save and a load, so
 * every modifier source is touched.
 */
export function patch(kernel: Kernel, change: (slices: Record<string, any>) => void): void {
  const envelope = kernel.save(0);
  const slices: Record<string, any> = {};
  for (const [id, entry] of Object.entries(envelope.slices)) slices[id] = entry.data;
  change(slices);
  const result = kernel.load(envelope);
  if (!result.ok) throw new Error(result.error);
}

/**
 * What a system's context can read, built over a kernel: derived values and
 * other slices. For calling a system's read functions from a test.
 */
export function reads(kernel: Kernel) {
  const slices = kernel.snapshot().slices;
  return {
    derived: kernel.derived,
    stats: kernel.stats,
    modifiers: kernel.modifiers,
    read: <T>(system: SystemDef<T, any>): DeepReadonly<T> => slices[system.id] as DeepReadonly<T>,
  };
}

/** One slice of the state, as a copy. */
export function slice<T>(kernel: Kernel, id: string): T {
  return kernel.snapshot().slices[id] as T;
}

/** Every file under a folder of the repository, as paths from the root with forward slashes. */
export function listFiles(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(rel));
    else out.push(rel);
  }
  return out;
}

export function readText(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

export function readJson(file: string): unknown {
  return JSON.parse(readText(file));
}

export function exists(file: string): boolean {
  return fs.existsSync(path.join(ROOT, file));
}

/** Source text with comments removed, for import and identifier scans. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

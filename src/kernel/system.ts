/**
 * The system module contract. A system is one folder under src/systems/. Its
 * index.ts default-exports the result of `defineSystem`. The kernel composes
 * the game from the list of declarations and from nothing else.
 */
import type { ContentIndex, RegistryDef } from './content';
import type { DeepReadonly, Json } from './json';
import type { Rng } from './rng';

// ---- commands ----

export interface Command<P = unknown> {
  readonly type: string;
  readonly payload: P;
}

/** A command type and its payload type. Call it to build a command. */
export interface CommandDef<P> {
  (payload: P): Command<P>;
  readonly type: string;
}

export function defineCommand<P = void>(type: string): CommandDef<P> {
  const make = (payload: P): Command<P> => ({ type, payload });
  return Object.assign(make, { type });
}

/** A command either ran or was skipped with a reason. */
export type CommandResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export const OK: CommandResult = Object.freeze({ ok: true });

export function skipped(reason: string): CommandResult {
  return { ok: false, reason };
}

export interface CommandHandler<S> {
  readonly command: CommandDef<any>;
  handle(ctx: Ctx<S>, payload: any): CommandResult;
}

export function handle<S, P>(
  command: CommandDef<P>,
  fn: (ctx: Ctx<S>, payload: P) => CommandResult,
): CommandHandler<S> {
  return { command, handle: fn };
}

// ---- events ----

/** An event type and its payload type. */
export interface EventDef<P> {
  readonly type: string;
  /** Type marker only. Never set. */
  readonly __payload?: P;
}

export function defineEvent<P = void>(type: string): EventDef<P> {
  return { type };
}

export interface GameEvent<P = unknown> {
  readonly type: string;
  /** Who caused it. Defaults to the id of the emitting system. */
  readonly source: string;
  readonly tick: number;
  readonly payload: P;
}

export interface EventHandler<S> {
  readonly event: EventDef<any>;
  handle(ctx: Ctx<S>, event: GameEvent<any>): void;
}

export function on<S, P>(event: EventDef<P>, fn: (ctx: Ctx<S>, event: GameEvent<P>) => void): EventHandler<S> {
  return { event, handle: fn };
}

// ---- requests ----

/**
 * A request type, its payload type and its result type. A request is a call
 * from one system into another that returns a value inside the caller's
 * handler. See docs/KERNEL.md section 7a.
 */
export interface RequestDef<P, R> {
  readonly type: string;
  /** Type markers only. Never set. */
  readonly __payload?: P;
  readonly __result?: R;
}

export function defineRequest<P = void, R = void>(type: string): RequestDef<P, R> {
  return { type };
}

export interface RequestHandler<S> {
  readonly request: RequestDef<any, any>;
  handle(ctx: Ctx<S>, payload: any): any;
}

/** Declare the answer to a request. The function runs with the answering system's context. */
export function answer<S, P, R>(request: RequestDef<P, R>, fn: (ctx: Ctx<S>, payload: P) => R): RequestHandler<S> {
  return { request, handle: fn };
}

// ---- derived values ----

/**
 * One modifier. A source may return objects with more fields than these (a
 * label, a gate, an origin). The kernel passes them through untouched; a
 * resolver reads them.
 */
export interface Modifier {
  /** A declared stat, or a target under the prefix of a system with a resolver. */
  stat: string;
  /** Default formula: value of a stat = (base + sum of add) * product of mult. */
  kind: 'add' | 'mult';
  value: number;
}

export interface StatDef {
  base: number;
}

/** What a modifier source may read. It may not read derived values. */
export interface SourceCtx<S> {
  readonly state: DeepReadonly<S>;
  readonly content: ContentIndex;
  /** The entity the modifiers are collected for. `PLAYER` unless a system reads another. */
  readonly entity: string;
  read<T>(system: SystemDef<T, any>): DeepReadonly<T>;
}

export interface ModifierSourceDef<S> {
  /** `<system id>/<name>`. */
  id: string;
  /**
   * Ids of other sources whose inputs this one also reads, through `read`. A
   * touch of one of them touches this source too, in the same call.
   */
  dependsOn?: string[];
  collect(ctx: SourceCtx<S>): Modifier[];
}

/**
 * What a resolver gets. It is a pure function of these fields (decision 32):
 * no slice, no other system, no derived value. The kernel keeps its output
 * while the modifiers under its prefix are unchanged.
 */
export interface ResolveCtx<S> {
  readonly content: ContentIndex;
  /** The entity the block is for. */
  readonly entity: string;
  /** An opaque key the resolver defines. `''` is the plain block. */
  readonly variant: string;
  /** Every modifier collected for the entity that targets `<system id>/`, from every source, in source order. */
  readonly mods: readonly Modifier[];
}

/** Reads of derived values. `entity` defaults to the player, `variant` to the plain block. */
export interface DerivedReads {
  derived(stat: string, entity?: string, variant?: string): number;
  /** Every stat of an entity. Read-only. */
  stats(entity?: string, variant?: string): ReadonlyMap<string, number>;
  /**
   * The output of the resolver of `prefix` (`<system id>/`): every stat under
   * it. The same object while the modifiers under the prefix are unchanged, so
   * a reader may key a cache of its own on it. Read-only.
   */
  resolved(prefix: string, entity?: string, variant?: string): Readonly<Record<string, number>>;
  /** Every modifier collected for an entity. Read-only. */
  modifiers(entity?: string): readonly Modifier[];
}

// ---- contexts ----

/** Read access, given to `view`. */
export interface ViewCtx<S> extends DerivedReads {
  readonly state: DeepReadonly<S>;
  readonly tick: number;
  readonly content: ContentIndex;
  read<T>(system: SystemDef<T, any>): DeepReadonly<T>;
}

/** Write access to the system's own slice, given to tick, commands and events. */
export interface Ctx<S> extends DerivedReads {
  /** The system's own slice. Mutate it in place. */
  readonly state: S;
  readonly tick: number;
  /**
   * True while the kernel runs offline catch-up (`catchUp`), false in play
   * and in `runHeadless` on a live kernel. Read-only. A system that reads it
   * behaves differently in catch-up; `tests/runner.test.ts` names each one.
   */
  readonly catchingUp: boolean;
  readonly rng: Rng;
  readonly content: ContentIndex;
  /** Another system's slice, read-only. */
  read<T>(system: SystemDef<T, any>): DeepReadonly<T>;
  /** Queue an event. Delivery happens after the current handler returns. */
  emit<P>(event: EventDef<P>, payload: P, source?: string): void;
  /**
   * Ask the system that declares `request` and get its answer now, inside
   * this handler. The answering system changes its own slice only. Events it
   * emits are queued like any other.
   */
  request<P, R>(request: RequestDef<P, R>, payload: P): R;
  /**
   * Bump the change counter of a modifier source. Call it when its inputs
   * change. With an entity, only that entity's values are rebuilt.
   */
  touch(sourceId: string, entity?: string): void;
  /** Forget the derived values of an entity that no longer exists. */
  dropEntity(entity: string): void;
  /** Record an action that did not happen, outside a command. */
  skip(action: string, reason: string): void;
  /**
   * End the run. After the current command or tick step has drained its
   * events, every slice starts new and each system's `newRun` runs. See
   * docs/KERNEL.md decision 30.
   */
  endRun(): void;
}

/** Reads a slice as the run that just ended left it. Given to `newRun`. */
export type PreviousRead = <T>(system: SystemDef<T, any>) => DeepReadonly<T>;

// ---- the declaration ----

export interface SystemDef<S, V = unknown> {
  /** Equals the folder name. Lower case letters, digits and hyphens. */
  id: string;
  /** Version of the slice shape. Starts at 1. */
  version: number;
  /** A new slice. Must be JSON. */
  initial(): S;
  /** Step N takes slice data at version N to version N + 1. Defined in migrations.ts. */
  migrations?: Record<number, (data: Json) => Json>;
  /** Derived values this system owns, keyed `<system id>/<name>`. */
  stats?: Record<string, StatDef>;
  modifiers?: ModifierSourceDef<S>[];
  /**
   * Computes every stat under `<system id>/` that has no base, from the
   * modifiers collected for one entity that target that prefix. Every returned key starts with
   * `<system id>/`. Modifier targets under that prefix are the resolver's to
   * check.
   */
  resolve?(ctx: ResolveCtx<S>): Record<string, number>;
  tick?(ctx: Ctx<S>): void;
  commands?: CommandHandler<S>[];
  events?: EventHandler<S>[];
  /** Answers to requests. Types start with `<system id>/`. One answer per type. */
  requests?: RequestHandler<S>[];
  /** Registry name to registry. Names are unique across the game. */
  content?: Record<string, RegistryDef>;
  /** What the UI sees of this system. Must return new objects, never the slice. */
  view?(ctx: ViewCtx<S>): V;
  /** Tick order: lower runs first. Ties run in id order. Default 0. */
  order?: number;
  /**
   * Runs after a new run has replaced every slice with `initial()`, in system
   * order. `previous` reads any slice as the old run left it. A system copies
   * here what it carries across a run.
   */
  newRun?(ctx: Ctx<S>, previous: PreviousRead): void;
  /**
   * Stops offline catch-up while it holds (decision 35). `catchUp` asks
   * `holds` before every tick, so it answers from memory the system keeps,
   * never from the slices. On the first true the catch-up stops and `held`
   * runs with the ticks left; its events are delivered.
   */
  catchUpHold?: CatchUpHold<S>;
}

/** A system's hold on offline catch-up (decision 35). */
export interface CatchUpHold<S> {
  holds(ctx: Ctx<S>): boolean;
  held(ctx: Ctx<S>, ticksLeft: number): void;
}

const SYSTEM_ID = /^[a-z][a-z0-9-]*$/;

/** Check a declaration and return it. Throws on a contract breach. */
export function defineSystem<S, V = unknown>(def: SystemDef<S, V>): SystemDef<S, V> {
  const bad = (message: string): never => {
    throw new Error(`system "${def.id}": ${message}`);
  };
  if (!SYSTEM_ID.test(def.id)) bad('id must match ' + SYSTEM_ID.source);
  if (!Number.isInteger(def.version) || def.version < 1) bad('version must be an integer of 1 or more');

  const steps = Object.keys(def.migrations ?? {})
    .map(Number)
    .sort((a, b) => a - b);
  const expected = Array.from({ length: def.version - 1 }, (_, i) => i + 1);
  if (steps.length !== expected.length || steps.some((step, i) => step !== expected[i]))
    bad(`version ${def.version} needs migrations for exactly [${expected.join(', ')}], got [${steps.join(', ')}]`);

  const prefix = def.id + '/';
  const owned = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (!id.startsWith(prefix) || id.length === prefix.length) bad(`${kind} "${id}" must start with "${prefix}"`);
      if (seen.has(id)) bad(`${kind} "${id}" is declared twice`);
      seen.add(id);
    }
  };
  owned('stat', Object.keys(def.stats ?? {}));
  owned('modifier source', (def.modifiers ?? []).map((m) => m.id));
  owned('command', (def.commands ?? []).map((c) => c.command.type));
  owned('request', (def.requests ?? []).map((r) => r.request.type));
  return def;
}

export type AnySystem = SystemDef<any, any>;

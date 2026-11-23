/**
 * The kernel. It owns plain state, composes the game from system
 * declarations, and is the only thing that changes state: through `dispatch`
 * (a command) or `tick`. It imports nothing from Svelte and touches no DOM.
 */
import { collectRegistries, ContentIndex, formatIssue, validateContent, type RegistryEntry } from './content';
import { Derived, PLAYER } from './derived';
import { cloneJson, deepFreeze, isRecord, type DeepReadonly, type Json } from './json';
import { KERNEL_SLICE_VERSION, kernelMigrations } from './migrations';
import { createRng, normalizeSeed } from './rng';
import { checkEnvelope, migrateEntry, SAVE_FORMAT, type SaveEnvelope } from './save';
import type {
  AnySystem,
  Command,
  CommandResult,
  Ctx,
  EventDef,
  GameEvent,
  Modifier,
  RequestDef,
  SystemDef,
} from './system';

export interface KernelSlice {
  tick: number;
  /** State of the random generator. An unsigned 32-bit integer. */
  rng: number;
}

export interface KernelState {
  kernel: KernelSlice;
  slices: Record<string, unknown>;
}

export interface SkipEntry {
  readonly tick: number;
  /** Id of the system that skipped, or "kernel". */
  readonly source: string;
  readonly action: string;
  readonly reason: string;
}

/** What the UI reads. Rebuilt on every `view()` call; never the live state. */
export interface PublishedView {
  readonly tick: number;
  readonly systems: Readonly<Record<string, unknown>>;
  readonly skips: readonly SkipEntry[];
}

export interface KernelOptions {
  systems: readonly AnySystem[];
  /** Seed of a new game. Default 1. */
  seed?: number;
  /** Validate every registry at creation and throw on an issue. Default true. */
  validateContent?: boolean;
  /** Deep-freeze published views, to catch a UI that writes to one. Default false. */
  freezeViews?: boolean;
  /** How many skipped actions to keep. Default 50. */
  skipLogSize?: number;
  /**
   * This kernel runs offline catch-up: `ctx.catchingUp` is true in every
   * handler. Set by `catchUp`; false everywhere else. Decision 34.
   */
  catchingUp?: boolean;
}

export type LoadResult = { ok: true; warnings: string[] } | { ok: false; error: string };

export interface Kernel {
  readonly systems: readonly AnySystem[];
  readonly registries: readonly RegistryEntry[];
  readonly content: ContentIndex;
  readonly tickCount: number;
  /** Run a command. A skipped command returns its reason and is logged. */
  dispatch(command: Command): CommandResult;
  /**
   * Advance game time by `count` ticks (default 1). A tick asked while a
   * system's `playHold` holds runs that system's `held` instead and leaves
   * the tick number as it was (decision 36).
   */
  tick(count?: number): void;
  view(): PublishedView;
  /** A derived value. `entity` defaults to the player, `variant` to the plain block. */
  derived(stat: string, entity?: string, variant?: string): number;
  /** Every stat of an entity. Read-only. */
  stats(entity?: string, variant?: string): ReadonlyMap<string, number>;
  /** The output of the resolver of `prefix`. The same object while its inputs are unchanged. Read-only. */
  resolved(prefix: string, entity?: string, variant?: string): Readonly<Record<string, number>>;
  /** Every modifier collected for an entity. Read-only. */
  modifiers(entity?: string): readonly Modifier[];
  /** Entities that have derived values, the player first. */
  entities(): string[];
  /**
   * Stats whose cached value differs from a full recompute, over every
   * entity. Empty when sound.
   */
  staleStats(): string[];
  /** A deep copy of the state. For tests and tools. */
  snapshot(): KernelState;
  skips(): readonly SkipEntry[];
  /** Listen to every event after the systems have handled it. Returns the remover. */
  onEvent(listener: (event: GameEvent) => void): () => void;
  save(now: number): SaveEnvelope;
  /** Replace the state from an envelope. On failure the state is unchanged. */
  load(envelope: unknown): LoadResult;
  /** Start a new game with the given seed. */
  reset(seed: number): void;
  /**
   * Offline catch-up asks before each tick (decision 35): the first system
   * whose `catchUpHold.holds` is true stops it; its `held` runs with
   * `ticksLeft` and its events drain. Answers that system's id, or null when
   * nothing holds. Asks only the systems that declare the field.
   */
  catchUpHeld(ticksLeft: number): string | null;
  /**
   * One tick that does not ask the play holds (decision 36). For
   * `runHeadless` with `hold`, which has asked `catchUpHeld` for this tick:
   * a system that holds play also declares `catchUpHold` with the same
   * `holds` (`defineSystem` checks), so one ask per tick covers both.
   */
  tickAfterHolds(): void;
}

/** Events delivered in one drain before the kernel assumes a loop. */
const MAX_EVENTS_PER_DRAIN = 100_000;

/** Requests nested inside one another before the kernel assumes a loop. */
const MAX_REQUEST_DEPTH = 32;

export function orderSystems(systems: readonly AnySystem[]): AnySystem[] {
  const seen = new Set<string>();
  for (const system of systems) {
    if (seen.has(system.id)) throw new Error(`system "${system.id}" is listed twice`);
    seen.add(system.id);
  }
  return [...systems].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : 1));
}

export function createKernel(options: KernelOptions): Kernel {
  const systems = orderSystems(options.systems);
  const registries = collectRegistries(systems);
  if (options.validateContent !== false) {
    const issues = validateContent(systems);
    if (issues.length > 0)
      throw new Error(`content is invalid:\n${issues.slice(0, 20).map(formatIssue).join('\n')}`);
  }
  const content = new ContentIndex(registries);
  const skipLogSize = options.skipLogSize ?? 50;
  const catchingUp = options.catchingUp === true;

  let state: KernelState = freshState(normalizeSeed(options.seed ?? 1));
  const skipLog: SkipEntry[] = [];
  const queue: GameEvent[] = [];
  const listeners = new Set<(event: GameEvent) => void>();
  const derived = new Derived();

  function freshState(seed: number): KernelState {
    const slices: Record<string, unknown> = {};
    for (const system of systems) slices[system.id] = system.initial();
    return { kernel: { tick: 0, rng: seed }, slices };
  }

  const rng = createRng({
    get: () => state.kernel.rng,
    set: (value) => {
      state.kernel.rng = value;
    },
  });

  const read = <T>(system: SystemDef<T, any>): DeepReadonly<T> => {
    if (!(system.id in state.slices)) throw new Error(`system "${system.id}" is not part of this kernel`);
    return state.slices[system.id] as DeepReadonly<T>;
  };

  const logSkip = (source: string, action: string, reason: string) => {
    skipLog.push({ tick: state.kernel.tick, source, action, reason });
    if (skipLog.length > skipLogSize) skipLog.splice(0, skipLog.length - skipLogSize);
  };

  const reads = {
    derived: (stat: string, entity: string = PLAYER, variant = '') => derived.get(stat, entity, variant),
    stats: (entity: string = PLAYER, variant = '') => derived.table(entity, variant),
    resolved: (prefix: string, entity: string = PLAYER, variant = '') => derived.resolved(prefix, entity, variant),
    modifiers: (entity: string = PLAYER) => derived.modifiers(entity),
  };

  // Requests: a call from one system into another that returns a value. The
  // answer runs at once, with the answering system's context.
  const requestHandlers = new Map<string, { system: AnySystem; handle: (ctx: Ctx<any>, payload: any) => any }>();
  let requestDepth = 0;
  const request = <P, R>(def: RequestDef<P, R>, payload: P): R => {
    const entry = requestHandlers.get(def.type);
    if (!entry) throw new Error(`no system answers the request "${def.type}"`);
    if (requestDepth >= MAX_REQUEST_DEPTH)
      throw new Error(`more than ${MAX_REQUEST_DEPTH} nested requests; last type "${def.type}"`);
    requestDepth++;
    try {
      return entry.handle(contexts.get(entry.system.id)!, payload) as R;
    } finally {
      requestDepth--;
    }
  };

  // One context per system, built once. The getters read the current state
  // object, so a context stays valid after `load` replaces the state.
  const contexts = new Map<string, Ctx<any>>();
  for (const system of systems) {
    const id = system.id;
    contexts.set(id, {
      get state() {
        return state.slices[id];
      },
      get tick() {
        return state.kernel.tick;
      },
      catchingUp,
      rng,
      content,
      ...reads,
      read,
      emit: <P>(event: EventDef<P>, payload: P, source?: string) => {
        queue.push({ type: event.type, source: source ?? id, tick: state.kernel.tick, payload });
      },
      request,
      touch: (sourceId, entity) => derived.touch(sourceId, entity),
      dropEntity: (entity) => derived.dropEntity(entity),
      skip: (action, reason) => logSkip(id, action, reason),
      endRun: () => {
        runEnding = true;
      },
    });
  }

  // A new run (decision 30). Asked for with `ctx.endRun()`, done after the
  // command or tick step that asked has drained its events.
  let runEnding = false;
  function settleRun(): void {
    while (runEnding) {
      runEnding = false;
      const before = state.slices;
      const slices: Record<string, unknown> = {};
      for (const system of systems) slices[system.id] = system.initial();
      state = { kernel: state.kernel, slices };
      queue.length = 0;
      derived.touchAll();
      const previous = <T>(system: SystemDef<T, any>): DeepReadonly<T> => {
        if (!(system.id in before)) throw new Error(`system "${system.id}" is not part of this kernel`);
        return before[system.id] as DeepReadonly<T>;
      };
      for (const system of systems) {
        if (!system.newRun) continue;
        system.newRun(contexts.get(system.id)!, previous);
        drain();
      }
    }
  }

  // Registration. Everything below is read from the declarations.
  const commandHandlers = new Map<string, { system: AnySystem; handle: (ctx: Ctx<any>, payload: any) => CommandResult }>();
  const subscribers = new Map<
    string,
    { system: AnySystem; handle: (ctx: Ctx<any>, event: GameEvent<any>) => void; ctx: Ctx<any> }[]
  >();
  const ticking = systems.filter((system) => system.tick);
  for (const system of systems) {
    for (const [stat, def] of Object.entries(system.stats ?? {})) derived.defineStat(stat, def.base);
    for (const source of system.modifiers ?? []) {
      derived.register(source.id, (entity) =>
        source.collect({ state: state.slices[system.id] as DeepReadonly<unknown>, content, read, entity }),
      );
    }
    if (system.resolve) {
      derived.registerResolver(system.id + '/', ({ entity, variant, mods }) =>
        system.resolve!({ content, entity, variant, mods }),
      );
    }
    for (const handler of system.commands ?? []) {
      // defineSystem already checked that the type starts with the system id.
      commandHandlers.set(handler.command.type, { system, handle: handler.handle });
    }
    for (const handler of system.requests ?? []) {
      if (requestHandlers.has(handler.request.type))
        throw new Error(`request "${handler.request.type}" is answered twice`);
      requestHandlers.set(handler.request.type, { system, handle: handler.handle });
    }
    for (const handler of system.events ?? []) {
      const list = subscribers.get(handler.event.type) ?? [];
      list.push({ system, handle: handler.handle, ctx: contexts.get(system.id)! });
      subscribers.set(handler.event.type, list);
    }
  }

  // The catch-up holds (decision 35), each with its context, in system order:
  // asked before every catch-up tick, so the ask is a flat loop.
  const holders = systems
    .filter((system) => system.catchUpHold)
    .map((system) => ({ id: system.id, ctx: contexts.get(system.id)!, hold: system.catchUpHold! }));

  // The play holds (decision 36), asked before every tick the same way.
  const playHolders = systems
    .filter((system) => system.playHold)
    .map((system) => ({ ctx: contexts.get(system.id)!, hold: system.playHold! }));

  /** The holder that holds this tick, or null. Asked before every tick: kept small. */
  function playHolder(): (typeof playHolders)[number] | null {
    for (let i = 0; i < playHolders.length; i++) {
      const h = playHolders[i];
      if (h.hold.holds(h.ctx)) return h;
    }
    return null;
  }

  /** A held tick: the holder's `held` runs and drains in place of the tick. */
  function runHeld(h: (typeof playHolders)[number]): void {
    h.hold.held(h.ctx);
    drain();
    if (runEnding) settleRun();
  }

  // After every source is registered, so a dependency may name a source of a
  // system that comes later in the order.
  for (const system of systems) {
    for (const source of system.modifiers ?? []) {
      for (const on of source.dependsOn ?? []) derived.depend(source.id, on);
    }
  }

  function drain(): void {
    let delivered = 0;
    while (queue.length > 0) {
      const event = queue.shift()!;
      if (++delivered > MAX_EVENTS_PER_DRAIN)
        throw new Error(`more than ${MAX_EVENTS_PER_DRAIN} events in one drain; last type "${event.type}"`);
      const list = subscribers.get(event.type);
      if (list) for (let i = 0; i < list.length; i++) list[i].handle(list[i].ctx, event);
      if (listeners.size > 0) for (const listener of listeners) listener(event);
    }
  }

  function tickOnce(): void {
    for (const system of ticking) {
      system.tick!(contexts.get(system.id)!);
      drain();
      if (runEnding) settleRun();
    }
    state.kernel.tick++;
  }

  function buildState(input: unknown): { state: KernelState; warnings: string[] } {
    const checked = checkEnvelope(input);
    if (!checked.ok) throw new Error(checked.error);
    const envelope = checked.value;
    const warnings: string[] = [];

    const kernelData = migrateEntry('kernel slice', envelope.kernel, KERNEL_SLICE_VERSION, kernelMigrations);
    if (
      !isRecord(kernelData) ||
      !Number.isInteger(kernelData.tick) ||
      (kernelData.tick as number) < 0 ||
      !Number.isInteger(kernelData.rng) ||
      (kernelData.rng as number) < 0 ||
      (kernelData.rng as number) > 0xffffffff
    )
      throw new Error('kernel slice has no valid tick and rng');

    const slices: Record<string, unknown> = {};
    for (const system of systems) {
      const entry = envelope.slices[system.id];
      if (!entry) {
        slices[system.id] = system.initial();
        warnings.push(`slice "${system.id}" was not in the save; it starts new`);
        continue;
      }
      slices[system.id] = migrateEntry(`slice "${system.id}"`, entry, system.version, system.migrations ?? {});
    }
    for (const id of Object.keys(envelope.slices)) {
      if (!(id in slices)) warnings.push(`slice "${id}" has no system in this build; it was dropped`);
    }
    return {
      state: { kernel: { tick: kernelData.tick as number, rng: kernelData.rng as number }, slices },
      warnings,
    };
  }

  function replaceState(next: KernelState): void {
    state = next;
    queue.length = 0;
    runEnding = false;
    derived.touchAll();
  }

  return {
    systems,
    registries,
    content,
    get tickCount() {
      return state.kernel.tick;
    },

    dispatch(command) {
      const entry = commandHandlers.get(command.type);
      if (!entry) {
        const reason = `unknown command "${command.type}"`;
        logSkip('kernel', command.type, reason);
        return { ok: false, reason };
      }
      const result = entry.handle(contexts.get(entry.system.id)!, command.payload);
      if (!result.ok) logSkip(entry.system.id, command.type, result.reason);
      drain();
      if (runEnding) settleRun();
      return result;
    },

    tick(count = 1) {
      const asks = playHolders.length > 0;
      for (let i = 0; i < count; i++) {
        const h = asks ? playHolder() : null;
        if (h === null) tickOnce();
        else runHeld(h);
      }
    },

    view() {
      const views: Record<string, unknown> = {};
      for (const system of systems) {
        if (!system.view) continue;
        views[system.id] = system.view({
          state: state.slices[system.id] as DeepReadonly<unknown>,
          tick: state.kernel.tick,
          content,
          ...reads,
          read,
        });
      }
      const view: PublishedView = { tick: state.kernel.tick, systems: views, skips: [...skipLog] };
      return options.freezeViews ? deepFreeze(view) : view;
    },

    ...reads,
    entities: () => derived.entityIds(),
    staleStats: () => derived.findStale(),
    snapshot: () => cloneJson(state),
    skips: () => [...skipLog],

    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    save(now) {
      const slices: SaveEnvelope['slices'] = {};
      for (const system of systems) {
        slices[system.id] = { version: system.version, data: cloneJson(state.slices[system.id]) as Json };
      }
      return {
        format: SAVE_FORMAT,
        savedAt: now,
        kernel: { version: KERNEL_SLICE_VERSION, data: { tick: state.kernel.tick, rng: state.kernel.rng } },
        slices,
      };
    },

    load(envelope) {
      try {
        const built = buildState(envelope);
        replaceState(built.state);
        return { ok: true, warnings: built.warnings };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },

    reset(seed) {
      replaceState(freshState(normalizeSeed(seed)));
    },

    tickAfterHolds() {
      tickOnce();
    },

    catchUpHeld(ticksLeft) {
      for (let i = 0; i < holders.length; i++) {
        const h = holders[i];
        if (!h.hold.holds(h.ctx)) continue;
        h.hold.held(h.ctx, ticksLeft);
        drain();
        if (runEnding) settleRun();
        return h.id;
      }
      return null;
    },
  };
}

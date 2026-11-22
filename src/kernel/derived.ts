/**
 * Derived values. Systems register modifier sources. Each source has a change
 * counter; a touch bumps it, and the next read collects that source again.
 *
 * Values are kept per entity. The player is the entity `PLAYER`; any other id
 * (a monster in a fight) gets its own record on first use and loses it with
 * `dropEntity`. A source is collected once per entity. A touch with no entity
 * bumps the source for every entity; a touch with an entity bumps it for that
 * entity only.
 *
 * A stat is computed in one of two ways:
 * - the default formula, `(base + sum of add) * product of mult`, for stats a
 *   system declares with a base;
 * - a resolver, a function a system declares, which gets the modifiers that
 *   target its prefix and returns the stats under that prefix.
 *
 * Groups (decision 32). The collected modifiers of an entity are split into
 * groups by target: one group per resolver prefix, and one for the stats
 * with a base. When a touched source is collected again, its modifiers are
 * compared with what it returned before, group by group. A resolver whose
 * group is equal keeps its output, every variant of it; only the groups that
 * differ are computed again. A resolver is a pure function of its group's
 * modifiers, the entity and the variant, so a kept output is the value a new
 * computation would give.
 */
import type { Modifier } from './system';

/** The default entity. */
export const PLAYER = 'player';

export interface ResolveInput {
  entity: string;
  /** An opaque key the resolver understands. `''` is the plain block. */
  variant: string;
  /** Every modifier collected for the entity that targets the resolver's prefix, in source order. */
  mods: readonly Modifier[];
}

/** A resolver's output: stat id to value. Shared with the cache: do not change it. */
export type Resolved = Readonly<Record<string, number>>;

interface Source {
  id: string;
  /** Position in registration order: the index of this source in a record's `counters` and `collected`. */
  index: number;
  /** Bumped by a touch with no entity. */
  counter: number;
  collect: (entity: string) => Modifier[];
  /** Sources touched whenever this one is. */
  dependents: Source[];
}

interface Resolver {
  /** `<system id>/`. The resolver owns every stat and target under it. */
  prefix: string;
  resolve: (input: ResolveInput) => Record<string, number>;
}

interface Collected {
  /** The source's counter at collection. */
  global: number;
  /** The entity's counter of the source at collection. */
  local: number;
  mods: Modifier[];
  /** `mods` split by group: index = resolver index, last = the stats with a base. */
  byGroup: Modifier[][];
}

interface EntityRecord {
  /**
   * Per source, by its index: bumped by a touch that names this entity, and
   * what was collected. Arrays, not maps: a record that is new or dirty
   * checks every source.
   */
  counters: number[];
  collected: (Collected | undefined)[];
  /** A source may have been touched since the last collection. */
  dirty: boolean;
  /** Every group has been computed once. */
  ready: boolean;
  mods: Modifier[];
  /** Per group, the modifiers of every source, in source order. */
  groupMods: Modifier[][];
  /** Per resolver, variant to output. */
  outputs: Map<string, Resolved>[];
  /** Per resolver, the output of the plain variant `''`, the most read: no map lookup. */
  plainOutputs: (Resolved | undefined)[];
  /** The stats with a base, computed; null when their group changed. */
  plain: Map<string, number> | null;
  /** Variant to the whole table. */
  tables: Map<string, Table>;
  /** The table of the plain variant `''`, the most read: no map lookup. Cleared with `tables`. */
  plainTable: Table | null;
}

function newRecord(): EntityRecord {
  return {
    counters: [],
    collected: [],
    dirty: true,
    ready: false,
    mods: [],
    groupMods: [],
    outputs: [],
    plainOutputs: [],
    plain: null,
    tables: new Map(),
    plainTable: null,
  };
}

/** Structural equality of two values a source returned. Numbers compare with `Object.is`. */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  // Only plain objects compare by content. Anything else (a Map, a Set, a
  // class instance) is equal only to itself.
  const pa = Object.getPrototypeOf(a);
  if ((pa !== Object.prototype && pa !== null) || Object.getPrototypeOf(b) !== pa) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    const k = ka[i];
    if (k !== kb[i]) return false;
    if (!same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

function sameList(a: readonly Modifier[], b: readonly Modifier[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
  return true;
}

/**
 * The table of one entity and variant: the stats with a base, then each
 * resolver's output, read in place. Making one copies nothing, so a change of
 * one group costs that group alone. Iteration builds a plain map once.
 */
class Table implements ReadonlyMap<string, number> {
  /** The output of the resolver of `prefix` this table reads, or undefined. */
  outputOf(prefix: string): Resolved | undefined {
    const r = this.prefixes.indexOf(prefix);
    return r < 0 ? undefined : this.outs[r];
  }

  private all: Map<string, number> | null = null;

  constructor(
    private readonly plain: ReadonlyMap<string, number>,
    private readonly prefixes: readonly string[],
    private readonly outs: readonly Resolved[],
  ) {}

  get(stat: string): number | undefined {
    // Resolver outputs first: most reads are of them. A resolver's keys all
    // start with its prefix, which holds a slash, so no key inherited from
    // Object.prototype can match. A stat with a base may share the prefix.
    for (let r = 0; r < this.prefixes.length; r++) {
      if (!stat.startsWith(this.prefixes[r])) continue;
      const value = this.outs[r][stat];
      if (value !== undefined) return value;
      break;
    }
    return this.plain.get(stat);
  }

  has(stat: string): boolean {
    return this.get(stat) !== undefined;
  }

  get size(): number {
    return this.full().size;
  }

  entries() {
    return this.full().entries();
  }

  keys() {
    return this.full().keys();
  }

  values() {
    return this.full().values();
  }

  forEach(fn: (value: number, key: string, map: ReadonlyMap<string, number>) => void, thisArg?: unknown): void {
    this.full().forEach((value, key) => fn.call(thisArg, value, key, this));
  }

  [Symbol.iterator]() {
    return this.full()[Symbol.iterator]();
  }

  private full(): Map<string, number> {
    if (!this.all) {
      this.all = new Map(this.plain);
      for (const out of this.outs) for (const stat in out) this.all.set(stat, out[stat]);
    }
    return this.all;
  }
}

/**
 * The output of the resolver of `prefix` that a table from `stats()` was
 * built from: what `resolved(prefix)` returned when the table was current.
 * For a reader that holds a table across a change and reads the block of
 * that moment. Undefined for a map the kernel did not make.
 */
export function resolvedOf(table: ReadonlyMap<string, number>, prefix: string): Resolved | undefined {
  return table instanceof Table ? table.outputOf(prefix) : undefined;
}

export class Derived {
  private readonly stats = new Map<string, number>();
  private readonly sources: Source[] = [];
  private readonly byId = new Map<string, Source>();
  private readonly resolvers: Resolver[] = [];
  /** The prefix of each resolver, in resolver order. */
  private readonly prefixes: string[] = [];
  private readonly prefixIndex = new Map<string, number>();
  /** The split of an empty list. Never written to: `fresh` copies group lists. */
  private emptySplit: Modifier[][] = [[]];
  /**
   * The player's record, also under `PLAYER` in `entities`. Most reads are
   * the player's: this skips the map. The player is never dropped, and
   * `touchAll` keeps the record, so the object is the same for the cache's
   * life.
   */
  private readonly player: EntityRecord = newRecord();
  private readonly entities = new Map<string, EntityRecord>([[PLAYER, this.player]]);
  /** The prefix `resolved` looked up last and its resolver index: nearly every read asks for `stats/`. */
  private lastPrefix = '';
  private lastPrefixIndex = -1;
  /** Target to group index, filled on first sight of a target. */
  private readonly groupOf = new Map<string, number>();

  /** Times a resolver computed a block. For tests. */
  rebuilds = 0;

  defineStat(id: string, base: number): void {
    if (this.stats.has(id)) throw new Error(`stat "${id}" is declared twice`);
    this.stats.set(id, base);
    this.invalidateAll();
  }

  register(id: string, collect: (entity: string) => Modifier[]): void {
    if (this.byId.has(id)) throw new Error(`modifier source "${id}" is registered twice`);
    const source: Source = { id, index: this.sources.length, counter: 0, collect, dependents: [] };
    this.sources.push(source);
    this.byId.set(id, source);
    this.invalidateAll();
  }

  /** Register the resolver of the stats under `prefix`. One per prefix. */
  registerResolver(prefix: string, resolve: Resolver['resolve']): void {
    if (this.resolvers.some((r) => r.prefix === prefix)) throw new Error(`resolver "${prefix}" is registered twice`);
    this.resolvers.push({ prefix, resolve });
    this.prefixIndex.set(prefix, this.prefixes.length);
    this.prefixes.push(prefix);
    this.emptySplit = this.prefixes.map(() => []).concat([[]]);
    this.invalidateAll();
  }

  /**
   * Declare that `id` reads what `on` reads: a touch of `on` touches `id`
   * too. Both must be registered. A cycle is an error.
   */
  depend(id: string, on: string): void {
    const source = this.byId.get(id);
    const target = this.byId.get(on);
    if (!source) throw new Error(`unknown modifier source "${id}"`);
    if (!target) throw new Error(`modifier source "${id}" depends on unknown source "${on}"`);
    const reaches = (from: Source, to: Source): boolean =>
      from === to || from.dependents.some((next) => reaches(next, to));
    if (reaches(source, target)) throw new Error(`modifier sources "${id}" and "${on}" depend on each other`);
    if (!target.dependents.includes(source)) target.dependents.push(source);
  }

  touch(id: string, entity?: string): void {
    const source = this.byId.get(id);
    if (!source) throw new Error(`unknown modifier source "${id}"`);
    this.bump(source, entity);
  }

  private bump(source: Source, entity: string | undefined): void {
    if (entity === undefined) {
      source.counter++;
      for (const record of this.entities.values()) record.dirty = true;
    } else {
      const record = this.record(entity);
      record.counters[source.index] = (record.counters[source.index] ?? 0) + 1;
      record.dirty = true;
    }
    for (const dependent of source.dependents) this.bump(dependent, entity);
  }

  /** Bump every counter. Used when the whole state is replaced. */
  touchAll(): void {
    for (const source of this.sources) source.counter++;
    // Entities other than the player are short-lived and belong to the state
    // that was replaced. Their records are made again on first read.
    for (const entity of [...this.entities.keys()]) if (entity !== PLAYER) this.entities.delete(entity);
    this.entities.get(PLAYER)!.dirty = true;
  }

  /** Forget an entity: its cache and its counters. The player cannot be dropped. */
  dropEntity(entity: string): void {
    if (entity === PLAYER) throw new Error('the player entity cannot be dropped');
    this.entities.delete(entity);
  }

  /** Entities that have a record, the player first. */
  entityIds(): string[] {
    return [...this.entities.keys()];
  }

  /** The change stamps of every registered source for an entity, as one string. For tests. */
  cacheKeyNow(entity: string = PLAYER): string {
    const record = this.record(entity);
    return this.sources.map((source) => `${source.id}:${source.counter}.${record.counters[source.index] ?? 0}`).join('|');
  }

  get(stat: string, entity: string = PLAYER, variant = ''): number {
    const value = this.table(entity, variant).get(stat);
    if (value === undefined) throw new Error(`unknown stat "${stat}"`);
    return value;
  }

  /** Every stat of an entity. Shared with the cache: do not change it. */
  table(entity: string = PLAYER, variant = ''): ReadonlyMap<string, number> {
    const record = this.fresh(entity);
    if (variant === '' && record.plainTable) return record.plainTable;
    let table = record.tables.get(variant);
    if (!table) {
      const outs: Resolved[] = [];
      for (let r = 0; r < this.resolvers.length; r++) outs.push(this.output(record, entity, r, variant));
      table = new Table(this.plainOf(record), this.prefixes, outs);
      record.tables.set(variant, table);
    }
    if (variant === '') record.plainTable = table;
    return table;
  }

  /**
   * The output of the resolver of `prefix` for an entity: every stat under the
   * prefix. The same object while the modifiers of that group are unchanged,
   * so a reader may key its own cache on it.
   */
  resolved(prefix: string, entity: string = PLAYER, variant = ''): Resolved {
    let r = this.lastPrefixIndex;
    if (prefix !== this.lastPrefix) {
      const found = this.prefixIndex.get(prefix);
      if (found === undefined) throw new Error(`no resolver for "${prefix}"`);
      r = found;
      this.lastPrefix = prefix;
      this.lastPrefixIndex = found;
    }
    const record = this.fresh(entity);
    // The plain variant once computed: the most frequent read.
    if (variant === '') {
      const plain = record.plainOutputs[r];
      if (plain !== undefined) return plain;
    }
    return this.output(record, entity, r, variant);
  }

  /** Every modifier collected for an entity. Shared with the cache: do not change it. */
  modifiers(entity: string = PLAYER): readonly Modifier[] {
    return this.fresh(entity).mods;
  }

  /**
   * Recompute every stat of every entity with every source collected again
   * and compare with what `get` returns. A difference means a system changed
   * the inputs of a source and did not call `touch`. Returns the stale stats:
   * the stat id for the player, `<entity> <stat>` for another entity, with
   * ` [<variant>]` appended for a variant other than the plain block.
   */
  findStale(): string[] {
    const stale: string[] = [];
    for (const [entity, record] of this.entities) {
      const mods = this.sources.flatMap((source) => source.collect(entity));
      const variants = new Set(['', ...record.tables.keys()]);
      for (const variant of variants) {
        const fresh = this.build(entity, variant, mods);
        const cached = this.table(entity, variant);
        for (const stat of new Set([...fresh.keys(), ...cached.keys()])) {
          if (Object.is(fresh.get(stat), cached.get(stat))) continue;
          stale.push((entity === PLAYER ? stat : `${entity} ${stat}`) + (variant === '' ? '' : ` [${variant}]`));
        }
      }
    }
    return stale;
  }

  private record(entity: string): EntityRecord {
    let record = this.entities.get(entity);
    if (!record) {
      record = newRecord();
      this.entities.set(entity, record);
    }
    return record;
  }

  private invalidateAll(): void {
    this.groupOf.clear();
    for (const record of this.entities.values()) {
      record.dirty = true;
      record.ready = false;
      record.collected.length = 0;
    }
  }

  /** The group of a target: a resolver index, or `resolvers.length` for a stat with a base. */
  private group(stat: string): number {
    let g = this.groupOf.get(stat);
    if (g === undefined) {
      if (this.stats.has(stat)) g = this.resolvers.length;
      else {
        // A target under a resolver's prefix is the resolver's to check.
        g = this.resolvers.findIndex((r) => stat.startsWith(r.prefix));
        if (g < 0) throw new Error(`a modifier targets unknown stat "${stat}"`);
      }
      this.groupOf.set(stat, g);
    }
    return g;
  }

  private split(mods: readonly Modifier[]): Modifier[][] {
    // Most sources return nothing for most entities: one shared empty split.
    if (mods.length === 0) return this.emptySplit;
    const byGroup: Modifier[][] = [];
    for (let g = 0; g <= this.resolvers.length; g++) byGroup.push([]);
    for (const mod of mods) byGroup[this.group(mod.stat)].push(mod);
    return byGroup;
  }

  /** The record of an entity with every touched source collected again and changed groups cleared. */
  private fresh(entity: string): EntityRecord {
    // The common case: nothing was touched since the last read. Kept small,
    // apart from the collection, so the engine inlines it into every read.
    const known = entity === PLAYER ? this.player : this.entities.get(entity);
    if (known !== undefined && !known.dirty) return known;
    return this.recollect(entity, known);
  }

  /** `fresh` for a record that is new or dirty. */
  private recollect(entity: string, known: EntityRecord | undefined): EntityRecord {
    const record = known ?? this.record(entity);
    const groups = this.resolvers.length + 1;
    const changed: boolean[] = new Array(groups).fill(!record.ready);
    let recollected = !record.ready;
    const sources = this.sources;
    const collected = record.collected;
    for (let s = 0; s < sources.length; s++) {
      const source = sources[s];
      const local = record.counters[s] ?? 0;
      const old = collected[s];
      if (old && old.global === source.counter && old.local === local) continue;
      const mods = source.collect(entity);
      const byGroup = this.split(mods);
      for (let g = 0; g < groups; g++) {
        if (!changed[g] && (!old || !sameList(old.byGroup[g], byGroup[g]))) changed[g] = true;
      }
      collected[s] = { global: source.counter, local, mods, byGroup };
      recollected = true;
    }
    record.dirty = false;
    if (!recollected) return record;
    const all: Modifier[] = [];
    for (let s = 0; s < sources.length; s++) for (const mod of collected[s]!.mods) all.push(mod);
    record.mods = all;
    let any = false;
    for (let g = 0; g < groups; g++) {
      if (!changed[g]) continue;
      any = true;
      const list: Modifier[] = [];
      for (let s = 0; s < sources.length; s++) for (const mod of collected[s]!.byGroup[g]) list.push(mod);
      record.groupMods[g] = list;
      if (g < this.resolvers.length) {
        record.outputs[g] = new Map();
        record.plainOutputs[g] = undefined;
      }
      else record.plain = null;
    }
    if (any) {
      record.tables = new Map();
      record.plainTable = null;
    }
    record.ready = true;
    return record;
  }

  /** The stats with a base, from the record's group. */
  private plainOf(record: EntityRecord): Map<string, number> {
    if (!record.plain) record.plain = this.defaults(record.groupMods[this.resolvers.length]);
    return record.plain;
  }

  private output(record: EntityRecord, entity: string, r: number, variant: string): Resolved {
    if (variant === '') {
      const plain = record.plainOutputs[r];
      if (plain) return plain;
    }
    let out = record.outputs[r].get(variant);
    if (!out) {
      out = this.compute(r, entity, variant, record.groupMods[r]);
      record.outputs[r].set(variant, out);
      if (variant === '') record.plainOutputs[r] = out;
      this.rebuilds++;
    }
    return out;
  }

  private compute(r: number, entity: string, variant: string, mods: readonly Modifier[]): Resolved {
    const resolver = this.resolvers[r];
    const out = resolver.resolve({ entity, variant, mods });
    for (const stat in out) {
      if (!stat.startsWith(resolver.prefix))
        throw new Error(`resolver "${resolver.prefix}" returned stat "${stat}" outside its prefix`);
      if (this.stats.has(stat)) throw new Error(`stat "${stat}" has a base and a resolver`);
    }
    return out;
  }

  /** `(base + sum of add) * product of mult` for every stat with a base. */
  private defaults(mods: readonly Modifier[]): Map<string, number> {
    const add = new Map<string, number>();
    const mult = new Map<string, number>();
    for (const mod of mods) {
      if (mod.kind === 'add') add.set(mod.stat, (add.get(mod.stat) ?? 0) + mod.value);
      else mult.set(mod.stat, (mult.get(mod.stat) ?? 1) * mod.value);
    }
    const table = new Map<string, number>();
    for (const [stat, base] of this.stats) {
      table.set(stat, (base + (add.get(stat) ?? 0)) * (mult.get(stat) ?? 1));
    }
    return table;
  }

  /** A whole table from a collected list, with no cache. */
  private build(entity: string, variant: string, mods: readonly Modifier[]): Map<string, number> {
    const byGroup = this.split(mods);
    const table = this.defaults(byGroup[this.resolvers.length]);
    for (let r = 0; r < this.resolvers.length; r++) {
      const out = this.compute(r, entity, variant, byGroup[r]);
      for (const stat in out) table.set(stat, out[stat]);
    }
    return table;
  }
}

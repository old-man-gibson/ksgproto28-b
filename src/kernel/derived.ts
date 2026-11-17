/**
 * Derived values. Systems register modifier sources. Each source has a change
 * counter. The cache key is the list of counters of every registered source,
 * so a newly registered source is part of the key with no other edit.
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
 * - a resolver, a function a system declares, which gets every modifier
 *   collected for the entity and returns the stats under its own prefix.
 */
import type { Modifier } from './system';

/** The default entity. */
export const PLAYER = 'player';

export interface ResolveInput {
  entity: string;
  /** An opaque key the resolver understands. `''` is the plain block. */
  variant: string;
  /** Every modifier collected for the entity, in source order. */
  mods: readonly Modifier[];
}

interface Source {
  id: string;
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
  /** The `stamp` the modifiers were collected at. */
  at: string;
  mods: Modifier[];
}

interface EntityRecord {
  /** Bumped by a touch that names this entity, per source id. */
  counters: Map<string, number>;
  collected: Map<string, Collected>;
  key: string;
  keyStale: boolean;
  /** The key `tables` and `mods` were built at, or null. */
  builtKey: string | null;
  mods: Modifier[];
  /** Variant to stat table. */
  tables: Map<string, Map<string, number>>;
}

function newRecord(): EntityRecord {
  return {
    counters: new Map(),
    collected: new Map(),
    key: '',
    keyStale: true,
    builtKey: null,
    mods: [],
    tables: new Map(),
  };
}

export class Derived {
  private readonly stats = new Map<string, number>();
  private readonly sources: Source[] = [];
  private readonly byId = new Map<string, Source>();
  private readonly resolvers: Resolver[] = [];
  private readonly entities = new Map<string, EntityRecord>([[PLAYER, newRecord()]]);

  /** Times a stat table was rebuilt. For tests. */
  rebuilds = 0;

  defineStat(id: string, base: number): void {
    if (this.stats.has(id)) throw new Error(`stat "${id}" is declared twice`);
    this.stats.set(id, base);
    this.invalidateAll();
  }

  register(id: string, collect: (entity: string) => Modifier[]): void {
    if (this.byId.has(id)) throw new Error(`modifier source "${id}" is registered twice`);
    const source: Source = { id, counter: 0, collect, dependents: [] };
    this.sources.push(source);
    this.byId.set(id, source);
    this.invalidateAll();
  }

  /** Register the resolver of the stats under `prefix`. One per prefix. */
  registerResolver(prefix: string, resolve: Resolver['resolve']): void {
    if (this.resolvers.some((r) => r.prefix === prefix)) throw new Error(`resolver "${prefix}" is registered twice`);
    this.resolvers.push({ prefix, resolve });
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
      for (const record of this.entities.values()) record.keyStale = true;
    } else {
      const record = this.record(entity);
      record.counters.set(source.id, (record.counters.get(source.id) ?? 0) + 1);
      record.keyStale = true;
    }
    for (const dependent of source.dependents) this.bump(dependent, entity);
  }

  /** Bump every counter. Used when the whole state is replaced. */
  touchAll(): void {
    for (const source of this.sources) source.counter++;
    // Entities other than the player are short-lived and belong to the state
    // that was replaced. Their records are made again on first read.
    for (const entity of [...this.entities.keys()]) if (entity !== PLAYER) this.entities.delete(entity);
    this.entities.get(PLAYER)!.keyStale = true;
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

  /** The cache key of an entity, built from the registered sources. */
  cacheKeyNow(entity: string = PLAYER): string {
    const record = this.record(entity);
    if (record.keyStale) {
      record.key = this.sources.map((source) => this.stamp(source, record)).join('|');
      record.keyStale = false;
    }
    return record.key;
  }

  get(stat: string, entity: string = PLAYER, variant = ''): number {
    const value = this.table(entity, variant).get(stat);
    if (value === undefined) throw new Error(`unknown stat "${stat}"`);
    return value;
  }

  /** Every stat of an entity. Shared with the cache: do not change it. */
  table(entity: string = PLAYER, variant = ''): ReadonlyMap<string, number> {
    const record = this.fresh(entity);
    let table = record.tables.get(variant);
    if (!table) {
      table = this.build(entity, variant, record.mods);
      record.tables.set(variant, table);
      this.rebuilds++;
    }
    return table;
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

  private stamp(source: Source, record: EntityRecord): string {
    return `${source.id}:${source.counter}.${record.counters.get(source.id) ?? 0}`;
  }

  private invalidateAll(): void {
    for (const record of this.entities.values()) {
      record.keyStale = true;
      record.builtKey = null;
    }
  }

  /** The record of an entity with its modifiers collected at the current key. */
  private fresh(entity: string): EntityRecord {
    // The common case: nothing was touched since the last build.
    const known = this.entities.get(entity);
    if (known && !known.keyStale && known.builtKey === known.key) return known;
    const key = this.cacheKeyNow(entity);
    const record = this.entities.get(entity)!;
    if (record.builtKey === key) return record;
    const mods: Modifier[] = [];
    for (const source of this.sources) {
      const at = this.stamp(source, record);
      let collected = record.collected.get(source.id);
      if (!collected || collected.at !== at) {
        collected = { at, mods: source.collect(entity) };
        record.collected.set(source.id, collected);
      }
      for (const mod of collected.mods) mods.push(mod);
    }
    record.mods = mods;
    record.tables = new Map();
    record.builtKey = key;
    return record;
  }

  private build(entity: string, variant: string, mods: readonly Modifier[]): Map<string, number> {
    const add = new Map<string, number>();
    const mult = new Map<string, number>();
    for (const mod of mods) {
      if (!this.stats.has(mod.stat)) {
        // A target under a resolver's prefix is the resolver's to check.
        if (this.resolvers.some((r) => mod.stat.startsWith(r.prefix))) continue;
        throw new Error(`a modifier targets unknown stat "${mod.stat}"`);
      }
      if (mod.kind === 'add') add.set(mod.stat, (add.get(mod.stat) ?? 0) + mod.value);
      else mult.set(mod.stat, (mult.get(mod.stat) ?? 1) * mod.value);
    }
    const table = new Map<string, number>();
    for (const [stat, base] of this.stats) {
      table.set(stat, (base + (add.get(stat) ?? 0)) * (mult.get(stat) ?? 1));
    }
    for (const resolver of this.resolvers) {
      for (const [stat, value] of Object.entries(resolver.resolve({ entity, variant, mods }))) {
        if (!stat.startsWith(resolver.prefix))
          throw new Error(`resolver "${resolver.prefix}" returned stat "${stat}" outside its prefix`);
        if (this.stats.has(stat)) throw new Error(`stat "${stat}" has a base and a resolver`);
        table.set(stat, value);
      }
    }
    return table;
  }
}

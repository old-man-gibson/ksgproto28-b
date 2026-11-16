/**
 * Derived values. Systems register modifier sources. Each source has a change
 * counter. The cache key is the list of counters of every registered source,
 * so a newly registered source is part of the key with no other edit.
 */
import type { Modifier } from './system';

interface Source {
  id: string;
  counter: number;
  collect: () => Modifier[];
  /** The counter value `mods` was collected at, or -1. */
  collectedAt: number;
  mods: Modifier[];
}

export class Derived {
  private readonly stats = new Map<string, number>();
  private readonly sources: Source[] = [];
  private readonly byId = new Map<string, Source>();
  private key = '';
  private keyStale = true;
  private cacheKey: string | null = null;
  private cache = new Map<string, number>();

  /** Times the table was rebuilt. For tests. */
  rebuilds = 0;

  defineStat(id: string, base: number): void {
    if (this.stats.has(id)) throw new Error(`stat "${id}" is declared twice`);
    this.stats.set(id, base);
    this.cacheKey = null;
  }

  register(id: string, collect: () => Modifier[]): void {
    if (this.byId.has(id)) throw new Error(`modifier source "${id}" is registered twice`);
    const source: Source = { id, counter: 0, collect, collectedAt: -1, mods: [] };
    this.sources.push(source);
    this.byId.set(id, source);
    this.keyStale = true;
  }

  touch(id: string): void {
    const source = this.byId.get(id);
    if (!source) throw new Error(`unknown modifier source "${id}"`);
    source.counter++;
    this.keyStale = true;
  }

  /** Bump every counter. Used when the whole state is replaced. */
  touchAll(): void {
    for (const source of this.sources) source.counter++;
    this.keyStale = true;
  }

  /** The cache key, built from the registered sources. */
  cacheKeyNow(): string {
    if (this.keyStale) {
      this.key = this.sources.map((source) => `${source.id}:${source.counter}`).join('|');
      this.keyStale = false;
    }
    return this.key;
  }

  get(stat: string): number {
    const key = this.cacheKeyNow();
    if (key !== this.cacheKey) {
      this.cache = this.build(false);
      this.cacheKey = key;
      this.rebuilds++;
    }
    const value = this.cache.get(stat);
    if (value === undefined) throw new Error(`unknown stat "${stat}"`);
    return value;
  }

  /**
   * Recompute every stat with every source collected again and compare with
   * what `get` returns. A difference means a system changed the inputs of a
   * source and did not call `touch`. Returns the ids of the stale stats.
   */
  findStale(): string[] {
    const fresh = this.build(true);
    return [...fresh.keys()].filter((stat) => this.get(stat) !== fresh.get(stat));
  }

  private build(ignoreCounters: boolean): Map<string, number> {
    const add = new Map<string, number>();
    const mult = new Map<string, number>();
    for (const source of this.sources) {
      let mods = source.mods;
      if (ignoreCounters) {
        mods = source.collect();
      } else if (source.collectedAt !== source.counter) {
        mods = source.mods = source.collect();
        source.collectedAt = source.counter;
      }
      for (const mod of mods) {
        if (!this.stats.has(mod.stat))
          throw new Error(`modifier source "${source.id}" targets unknown stat "${mod.stat}"`);
        if (mod.kind === 'add') add.set(mod.stat, (add.get(mod.stat) ?? 0) + mod.value);
        else mult.set(mod.stat, (mult.get(mod.stat) ?? 1) * mod.value);
      }
    }
    const table = new Map<string, number>();
    for (const [stat, base] of this.stats) {
      table.set(stat, (base + (add.get(stat) ?? 0)) * (mult.get(stat) ?? 1));
    }
    return table;
  }
}

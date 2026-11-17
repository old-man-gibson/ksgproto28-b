import { describe, expect, it } from 'vitest';
import { createKernel, defineCommand, defineSystem, Derived, handle, OK, PLAYER } from '../src/kernel';

/**
 * Stats per entity, resolvers and source dependencies: the kernel extension
 * of port 1. The systems here are test-only.
 */

describe('derived values per entity', () => {
  it('collects a source once per entity and keeps the values apart', () => {
    const derived = new Derived();
    const calls: string[] = [];
    derived.defineStat('a/x', 1);
    derived.register('a/src', (entity) => {
      calls.push(entity);
      return [{ stat: 'a/x', kind: 'add', value: entity === PLAYER ? 10 : 100 }];
    });
    expect(derived.get('a/x')).toBe(11);
    expect(derived.get('a/x', 'm1')).toBe(101);
    expect(derived.get('a/x', 'm1')).toBe(101);
    expect(derived.get('a/x')).toBe(11);
    expect(calls).toEqual([PLAYER, 'm1']);
    expect(derived.entityIds()).toEqual([PLAYER, 'm1']);
  });

  it('a touch that names an entity rebuilds that entity only', () => {
    const derived = new Derived();
    const calls: string[] = [];
    const bonus: Record<string, number> = { [PLAYER]: 1, m1: 2 };
    derived.defineStat('a/x', 0);
    derived.register('a/src', (entity) => {
      calls.push(entity);
      return [{ stat: 'a/x', kind: 'add', value: bonus[entity] }];
    });
    derived.get('a/x');
    derived.get('a/x', 'm1');
    bonus.m1 = 5;
    derived.touch('a/src', 'm1');
    expect(derived.get('a/x', 'm1')).toBe(5);
    expect(derived.get('a/x')).toBe(1);
    expect(calls).toEqual([PLAYER, 'm1', 'm1']);
  });

  it('a touch with no entity rebuilds every entity', () => {
    const derived = new Derived();
    let bonus = 1;
    derived.defineStat('a/x', 0);
    derived.register('a/src', () => [{ stat: 'a/x', kind: 'add', value: bonus }]);
    derived.get('a/x');
    derived.get('a/x', 'm1');
    bonus = 7;
    derived.touch('a/src');
    expect(derived.get('a/x')).toBe(7);
    expect(derived.get('a/x', 'm1')).toBe(7);
  });

  it('the cache key of an entity is built from the registered sources, with no list', () => {
    const derived = new Derived();
    derived.defineStat('a/x', 0);
    derived.register('a/one', () => []);
    const before = derived.cacheKeyNow('m1');
    derived.register('a/two', () => []);
    const after = derived.cacheKeyNow('m1');
    expect(after).not.toBe(before);
    expect(after).toContain('a/two');
    derived.touch('a/two', 'm1');
    expect(derived.cacheKeyNow('m1')).not.toBe(after);
    // The player's key did not move.
    const player = derived.cacheKeyNow();
    derived.touch('a/two', 'm1');
    expect(derived.cacheKeyNow()).toBe(player);
  });

  it('findStale reports a missing touch on any entity, and names the entity', () => {
    const derived = new Derived();
    const bonus: Record<string, number> = { [PLAYER]: 1, m1: 2 };
    derived.defineStat('a/x', 0);
    derived.register('a/src', (entity) => [{ stat: 'a/x', kind: 'add', value: bonus[entity] ?? 0 }]);
    derived.get('a/x');
    derived.get('a/x', 'm1');
    expect(derived.findStale()).toEqual([]);
    bonus.m1 = 9;
    expect(derived.findStale()).toEqual(['m1 a/x']);
    bonus[PLAYER] = 3;
    expect(derived.findStale()).toEqual(['a/x', 'm1 a/x']);
    derived.touch('a/src');
    expect(derived.findStale()).toEqual([]);
  });

  it('a dropped entity loses its cache and its counters; the player cannot be dropped', () => {
    const derived = new Derived();
    let calls = 0;
    derived.defineStat('a/x', 0);
    derived.register('a/src', () => (calls++, []));
    derived.get('a/x', 'm1');
    derived.touch('a/src', 'm1');
    const touched = derived.cacheKeyNow('m1');
    derived.dropEntity('m1');
    expect(derived.entityIds()).toEqual([PLAYER]);
    // The id is free again: a new entity under it starts from zero.
    expect(derived.cacheKeyNow('m1')).not.toBe(touched);
    derived.get('a/x', 'm1');
    expect(calls).toBe(2);
    expect(() => derived.dropEntity(PLAYER)).toThrow(/cannot be dropped/);
  });

  it('touchAll forgets every entity but the player', () => {
    const derived = new Derived();
    derived.defineStat('a/x', 0);
    derived.register('a/src', () => []);
    derived.get('a/x', 'm1');
    derived.get('a/x', 'm2');
    derived.touchAll();
    expect(derived.entityIds()).toEqual([PLAYER]);
  });
});

describe('resolvers', () => {
  const make = () => {
    const derived = new Derived();
    derived.defineStat('plain/x', 1);
    derived.registerResolver('r/', ({ entity, variant, mods }) => {
      const sum = mods.filter((m) => m.stat === 'r/in').reduce((total, m) => total + m.value, 0);
      return { 'r/out': sum * (variant === 'double' ? 2 : 1), 'r/who': entity === PLAYER ? 0 : 1 };
    });
    return derived;
  };

  it('computes the stats under its prefix from every collected modifier', () => {
    const derived = make();
    derived.register('a/src', () => [
      { stat: 'r/in', kind: 'add', value: 2 },
      { stat: 'r/in', kind: 'add', value: 3 },
      { stat: 'plain/x', kind: 'add', value: 1 },
    ]);
    expect(derived.get('r/out')).toBe(5);
    expect(derived.get('plain/x')).toBe(2);
    expect(derived.get('r/who', 'm1')).toBe(1);
    expect([...derived.table().keys()].sort()).toEqual(['plain/x', 'r/out', 'r/who']);
  });

  it('a target under the prefix is the resolver’s; any other unknown target is an error', () => {
    const derived = make();
    derived.register('a/src', () => [{ stat: 'r/anything:at:all', kind: 'add', value: 1 }]);
    expect(() => derived.get('r/out')).not.toThrow();
    derived.register('a/bad', () => [{ stat: 'nope/x', kind: 'add', value: 1 }]);
    expect(() => derived.get('r/out')).toThrow(/unknown stat "nope\/x"/);
  });

  it('serves variants from one collection and rebuilds them together', () => {
    const derived = make();
    let value = 2;
    let collected = 0;
    derived.register('a/src', () => (collected++, [{ stat: 'r/in', kind: 'add', value }]));
    expect(derived.get('r/out')).toBe(2);
    expect(derived.get('r/out', PLAYER, 'double')).toBe(4);
    expect(collected).toBe(1);
    value = 5;
    expect(derived.findStale()).toEqual(['r/out', 'r/out [double]']);
    derived.touch('a/src');
    expect(derived.get('r/out', PLAYER, 'double')).toBe(10);
    expect(derived.get('r/out')).toBe(5);
    expect(collected).toBe(3); // one for findStale, one for the rebuild
  });

  it('passes extra fields of a modifier through untouched', () => {
    const derived = new Derived();
    derived.registerResolver('r/', ({ mods }) => ({
      'r/labelled': mods.filter((m) => (m as { source?: string }).source === 'Sword').length,
    }));
    derived.register('a/src', () => [{ stat: 'r/in', kind: 'add', value: 1, source: 'Sword' } as never]);
    expect(derived.get('r/labelled')).toBe(1);
    expect(derived.modifiers()[0]).toMatchObject({ source: 'Sword' });
  });

  it('rejects a stat outside the prefix and a stat that also has a base', () => {
    const outside = new Derived();
    outside.registerResolver('r/', () => ({ 'other/x': 1 }));
    expect(() => outside.get('other/x')).toThrow(/outside its prefix/);
    const both = new Derived();
    both.defineStat('r/x', 1);
    both.registerResolver('r/', () => ({ 'r/x': 1 }));
    expect(() => both.get('r/x')).toThrow(/a base and a resolver/);
  });
});

describe('source dependencies', () => {
  it('a touch of a source touches the sources that depend on it', () => {
    const derived = new Derived();
    const calls = { locks: 0, style: 0, other: 0 };
    derived.defineStat('a/x', 0);
    derived.register('res/locks', () => (calls.locks++, []));
    derived.register('style/exertion', () => (calls.style++, []));
    derived.register('other/src', () => (calls.other++, []));
    derived.depend('style/exertion', 'res/locks');
    derived.get('a/x');
    derived.touch('res/locks');
    derived.get('a/x');
    expect(calls).toEqual({ locks: 2, style: 2, other: 1 });
    // Not the other way round.
    derived.touch('style/exertion');
    derived.get('a/x');
    expect(calls).toEqual({ locks: 2, style: 3, other: 1 });
  });

  it('rejects an unknown source and a cycle', () => {
    const derived = new Derived();
    derived.register('a/one', () => []);
    derived.register('a/two', () => []);
    expect(() => derived.depend('a/one', 'a/missing')).toThrow(/unknown source/);
    derived.depend('a/one', 'a/two');
    expect(() => derived.depend('a/two', 'a/one')).toThrow(/depend on each other/);
  });
});

describe('entities through the kernel', () => {
  interface Foes {
    foes: Record<string, { bonus: number }>;
    locked: boolean;
  }
  const spawn = defineCommand<{ id: string; bonus: number }>('foes/spawn');
  const hurt = defineCommand<{ id: string; bonus: number; touch: boolean }>('foes/hurt');
  const kill = defineCommand<{ id: string }>('foes/kill');
  const lock = defineCommand<void>('foes/lock');

  const foes = defineSystem<Foes>({
    id: 'foes',
    version: 1,
    initial: () => ({ foes: {}, locked: false }),
    stats: { 'foes/power': { base: 1 } },
    modifiers: [
      {
        id: 'foes/body',
        collect: ({ state, entity }) =>
          state.foes[entity] ? [{ stat: 'foes/power', kind: 'add', value: state.foes[entity].bonus }] : [],
      },
      { id: 'foes/lock', collect: () => [] },
    ],
    commands: [
      handle(spawn, (ctx, { id, bonus }) => {
        ctx.state.foes[id] = { bonus };
        ctx.touch('foes/body', id);
        return OK;
      }),
      handle(hurt, (ctx, { id, bonus, touch }) => {
        ctx.state.foes[id].bonus = bonus;
        if (touch) ctx.touch('foes/body', id);
        return OK;
      }),
      handle(kill, (ctx, { id }) => {
        delete ctx.state.foes[id];
        ctx.dropEntity(id);
        return OK;
      }),
      handle(lock, (ctx) => {
        ctx.state.locked = true;
        ctx.touch('foes/lock');
        return OK;
      }),
    ],
    view: (ctx) => ({
      power: Object.fromEntries(Object.keys(ctx.state.foes).map((id) => [id, ctx.derived('foes/power', id)])),
    }),
  });

  // A second system whose source reads the first one's slice and says so.
  const watcher = defineSystem<Record<string, never>>({
    id: 'watcher',
    version: 1,
    initial: () => ({}),
    stats: { 'watcher/penalty': { base: 0 } },
    modifiers: [
      {
        id: 'watcher/lock',
        dependsOn: ['foes/lock'],
        collect: ({ read }) => (read(foes).locked ? [{ stat: 'watcher/penalty', kind: 'add', value: 1 }] : []),
      },
    ],
  });

  it('a monster gets its stats by the same code path as the player', () => {
    const kernel = createKernel({ systems: [foes] });
    kernel.dispatch(spawn({ id: 'm1', bonus: 4 }));
    kernel.dispatch(spawn({ id: 'm2', bonus: 9 }));
    expect(kernel.derived('foes/power')).toBe(1);
    expect(kernel.derived('foes/power', 'm1')).toBe(5);
    expect(kernel.derived('foes/power', 'm2')).toBe(10);
    expect(kernel.entities()).toEqual([PLAYER, 'm1', 'm2']);
    expect((kernel.view().systems.foes as { power: Record<string, number> }).power).toEqual({ m1: 5, m2: 10 });
    expect(kernel.staleStats()).toEqual([]);
  });

  it('staleStats catches a missing touch on a monster', () => {
    const kernel = createKernel({ systems: [foes] });
    kernel.dispatch(spawn({ id: 'm1', bonus: 4 }));
    expect(kernel.derived('foes/power', 'm1')).toBe(5);
    kernel.dispatch(hurt({ id: 'm1', bonus: 2, touch: false }));
    expect(kernel.staleStats()).toEqual(['m1 foes/power']);
    kernel.dispatch(hurt({ id: 'm1', bonus: 2, touch: true }));
    expect(kernel.staleStats()).toEqual([]);
    expect(kernel.derived('foes/power', 'm1')).toBe(3);
  });

  it('a dead monster leaves nothing behind', () => {
    const kernel = createKernel({ systems: [foes] });
    for (let i = 0; i < 50; i++) {
      kernel.dispatch(spawn({ id: `m${i}`, bonus: i }));
      expect(kernel.derived('foes/power', `m${i}`)).toBe(1 + i);
      kernel.dispatch(kill({ id: `m${i}` }));
    }
    expect(kernel.entities()).toEqual([PLAYER]);
    expect(kernel.staleStats()).toEqual([]);
  });

  it('a load keeps the monsters in the state and rebuilds their stats on first read', () => {
    const kernel = createKernel({ systems: [foes] });
    kernel.dispatch(spawn({ id: 'm1', bonus: 4 }));
    kernel.derived('foes/power', 'm1');
    const other = createKernel({ systems: [foes] });
    expect(other.load(kernel.save(0)).ok).toBe(true);
    expect(other.entities()).toEqual([PLAYER]);
    expect(other.derived('foes/power', 'm1')).toBe(5);
  });

  it('a declared dependency keeps a source that reads another system fresh in the same call', () => {
    const kernel = createKernel({ systems: [foes, watcher] });
    expect(kernel.derived('watcher/penalty')).toBe(0);
    kernel.dispatch(lock());
    expect(kernel.derived('watcher/penalty')).toBe(1);
    expect(kernel.staleStats()).toEqual([]);
  });

  it('a dependency on a source that no system registers stops the kernel at creation', () => {
    const broken = defineSystem<Record<string, never>>({
      id: 'broken',
      version: 1,
      initial: () => ({}),
      modifiers: [{ id: 'broken/src', dependsOn: ['nobody/src'], collect: () => [] }],
    });
    expect(() => createKernel({ systems: [broken] })).toThrow(/depends on unknown source "nobody\/src"/);
  });
});
